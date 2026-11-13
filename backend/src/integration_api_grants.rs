//! Transactional, cross-token-rotation idempotent mutations.
//! A completed grant can never run twice for the same integration client/key.
use super::{Problem, ServicePrincipal, now_ms, reply};
use crate::AppState;
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct GrantRequest {
    days: i64,
    #[serde(default)]
    source_reference: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AccessRequest {
    reason: String,
}

fn key(headers: &HeaderMap) -> Result<String, Problem> {
    let invalid = || {
        Problem::new(
            StatusCode::BAD_REQUEST,
            "idempotency_key_required",
            "A unique Idempotency-Key UUID is required",
        )
    };
    let value = headers
        .get("idempotency-key")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(invalid)?;
    let value = value.trim_matches('"');
    if value.len() != 36 {
        return Err(invalid());
    }
    let uuid = Uuid::parse_str(value).map_err(|_| invalid())?;
    Ok(uuid.to_string())
}

fn request_hash(action: &str, user_id: i64, body: &impl Serialize) -> Result<String, Problem> {
    let body = serde_json::to_vec(body).map_err(|_| {
        Problem::new(
            StatusCode::BAD_REQUEST,
            "validation_error",
            "Invalid payload",
        )
    })?;
    let mut hash = Sha256::new();
    hash.update(action.as_bytes());
    hash.update(b":");
    hash.update(user_id.to_string().as_bytes());
    hash.update(b":");
    hash.update(body);
    Ok(hex::encode(hash.finalize()))
}

async fn claim(
    tx: &mut Transaction<'_, Postgres>,
    principal: &ServicePrincipal,
    idempotency_key: &str,
    action: &str,
    hash: &str,
) -> Result<Option<Value>, Problem> {
    sqlx::query(
        "INSERT INTO integration_operations
         (client_id,idempotency_key,action,request_hash)
         VALUES($1,$2::uuid,$3,$4) ON CONFLICT DO NOTHING",
    )
    .bind(principal.client_id)
    .bind(idempotency_key)
    .bind(action)
    .bind(hash)
    .execute(&mut **tx)
    .await?;
    let entry = sqlx::query(
        "SELECT request_hash,action,response FROM integration_operations
         WHERE client_id=$1 AND idempotency_key=$2::uuid FOR UPDATE",
    )
    .bind(principal.client_id)
    .bind(idempotency_key)
    .fetch_one(&mut **tx)
    .await?;
    let existing_hash: String = entry.try_get("request_hash")?;
    let existing_action: String = entry.try_get("action")?;
    if existing_hash != hash || existing_action != action {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "idempotency_conflict",
            "Idempotency key already used for another request",
        ));
    }
    let response: Option<Value> = entry.try_get("response")?;
    Ok(response)
}

async fn complete(
    tx: &mut Transaction<'_, Postgres>,
    principal: &ServicePrincipal,
    idempotency_key: &str,
    action: &str,
    id: i64,
    value: &Value,
) -> Result<(), Problem> {
    sqlx::query(
        "UPDATE integration_operations SET response=$3,completed_at=NOW()
         WHERE client_id=$1 AND idempotency_key=$2::uuid",
    )
    .bind(principal.client_id)
    .bind(idempotency_key)
    .bind(value)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO panel_audit_log(actor,action,collection,record_id,detail)
         VALUES($1,$2,'users',$3,$4)",
    )
    .bind(format!(
        "integration:{}:{}",
        principal.client_id, principal.name
    ))
    .bind(action)
    .bind(id)
    .bind(
        json!({"clientId":principal.client_id,"tokenId":principal.token_id,
        "idempotencyKey":idempotency_key}),
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn replay(value: Value) -> Json<Value> {
    let mut result = reply(value);
    result.0["data"]["replayed"] = json!(true);
    result
}

#[expect(
    clippy::too_many_lines,
    reason = "Entitlement grant must remain atomic with ledger deduplication and account updates"
)]
pub(super) async fn grant(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(body): Json<GrantRequest>,
) -> Result<Json<Value>, Problem> {
    principal.allow_scope("entitlements:grant")?;
    principal.allow_user(id)?;
    if !(1..=3650).contains(&body.days)
        || body
            .source_reference
            .as_ref()
            .is_some_and(|s| s.is_empty() || s.len() > 128)
        || body.reason.as_ref().is_some_and(|s| s.len() > 256)
    {
        return Err(Problem::new(
            StatusCode::BAD_REQUEST,
            "validation_error",
            "Invalid entitlement grant",
        ));
    }
    let idempotency_key = key(&headers)?;
    let hash = request_hash("entitlement.grant", id, &body)?;
    let mut tx = state.pool.begin().await?;
    if let Some(previous) = claim(
        &mut tx,
        &principal,
        &idempotency_key,
        "entitlement.grant",
        &hash,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(replay(previous));
    }
    let row = sqlx::query(
        "SELECT data FROM panel_records
         WHERE collection='users' AND id=$1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| Problem::new(StatusCode::NOT_FOUND, "not_found", "User not found"))?;
    let mut user: Value = row.try_get("data")?;
    let now = now_ms();
    let period = body.days.checked_mul(86_400_000).ok_or_else(|| {
        Problem::new(
            StatusCode::BAD_REQUEST,
            "validation_error",
            "Invalid duration",
        )
    })?;
    let hold = user.get("hold").and_then(Value::as_bool) == Some(true);
    let before = user.get("expireAt").and_then(Value::as_i64);
    let result = if hold {
        let original = user.get("holdDays").and_then(Value::as_i64).unwrap_or(0);
        let new_days = original
            .checked_add(body.days)
            .filter(|v| (1..=3650).contains(v))
            .ok_or_else(|| {
                Problem::new(
                    StatusCode::CONFLICT,
                    "entitlement_limit",
                    "Deferred entitlement exceeds limit",
                )
            })?;
        user["holdDays"] = json!(new_days);
        json!({"userId":id,"operationId":idempotency_key,"applied":true,
            "mode":"deferred","holdDays":new_days,"expireAtMs":before,
            "replayed":false,"requiresNodeSync":true})
    } else {
        let current = before.unwrap_or(0);
        if current <= 0 {
            return Err(Problem::new(
                StatusCode::CONFLICT,
                "unlimited_expiry",
                "Cannot extend an unlimited subscription",
            ));
        }
        let new_expiry = current.max(now).checked_add(period).ok_or_else(|| {
            Problem::new(
                StatusCode::CONFLICT,
                "expiry_overflow",
                "Expiry exceeds allowed range",
            )
        })?;
        user["expireAt"] = json!(new_expiry);
        json!({"userId":id,"operationId":idempotency_key,"applied":true,
            "mode":"active","previousExpireAtMs":current,"expireAtMs":new_expiry,
            "replayed":false,"requiresNodeSync":true})
    };
    sqlx::query(
        "UPDATE panel_records SET data=$2,updated_at=NOW()
         WHERE collection='users' AND id=$1",
    )
    .bind(id)
    .bind(user)
    .execute(&mut *tx)
    .await?;
    complete(
        &mut tx,
        &principal,
        &idempotency_key,
        "entitlement.grant",
        id,
        &result,
    )
    .await?;
    tx.commit().await?;
    Ok(reply(result))
}

pub(super) async fn set_access(
    state: AppState,
    principal: ServicePrincipal,
    id: i64,
    disabled: bool,
    headers: HeaderMap,
    body: AccessRequest,
) -> Result<Json<Value>, Problem> {
    principal.allow_scope("users:write")?;
    principal.allow_user(id)?;
    if body.reason.trim().len() < 3 || body.reason.len() > 256 {
        return Err(Problem::new(
            StatusCode::BAD_REQUEST,
            "validation_error",
            "Access change requires a reason (3-256 chars)",
        ));
    }
    let idempotency_key = key(&headers)?;
    let action = if disabled {
        "user.disable"
    } else {
        "user.enable"
    };
    let hash = request_hash(action, id, &body)?;
    let mut tx = state.pool.begin().await?;
    if let Some(previous) = claim(&mut tx, &principal, &idempotency_key, action, &hash).await? {
        tx.commit().await?;
        return Ok(replay(previous));
    }
    let row =
        sqlx::query("SELECT data FROM panel_records WHERE collection='users' AND id=$1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| Problem::new(StatusCode::NOT_FOUND, "not_found", "User not found"))?;
    let mut user: Value = row.try_get("data")?;
    user["disabled"] = json!(disabled);
    sqlx::query(
        "UPDATE panel_records SET data=$2,updated_at=NOW()
         WHERE collection='users' AND id=$1",
    )
    .bind(id)
    .bind(user)
    .execute(&mut *tx)
    .await?;
    let result = json!({"userId":id,"disabled":disabled,
        "operationId":idempotency_key,"applied":true,"replayed":false,
        "requiresNodeSync":true});
    complete(&mut tx, &principal, &idempotency_key, action, id, &result).await?;
    tx.commit().await?;
    Ok(reply(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn key_is_namespaced_by_operation_user_and_payload() {
        let first = GrantRequest {
            days: 30,
            source_reference: None,
            reason: None,
        };
        let second = GrantRequest {
            days: 31,
            source_reference: None,
            reason: None,
        };
        assert_ne!(
            request_hash("entitlement.grant", 1, &first).unwrap(),
            request_hash("entitlement.grant", 1, &second).unwrap()
        );
        assert_ne!(
            request_hash("entitlement.grant", 1, &first).unwrap(),
            request_hash("entitlement.grant", 2, &first).unwrap()
        );
        assert_ne!(
            request_hash("entitlement.grant", 1, &first).unwrap(),
            request_hash("entitlement.revoke", 1, &first).unwrap()
        );
    }
}
