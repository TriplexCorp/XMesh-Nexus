//! Scoped lookups by the panel's existing "tg" field (one ID -> many VPN users).
//! A trusted bot may bind only an account provisioned by its own integration client.
//! A Telegram numeric ID is never, on its own, proof of ownership.
use super::{Problem, ServicePrincipal, grants, reply, user_mutations, users};
use crate::AppState;
use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::Sha256;
use sqlx::Row;

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LookupQuery {
    cursor: Option<String>,
    limit: Option<i64>,
}

const fn invalid() -> Problem {
    Problem::new(
        StatusCode::BAD_REQUEST,
        "invalid_telegram_id",
        "Invalid Telegram user ID",
    )
}

pub(super) fn canonical_id(raw: &str) -> Result<String, Problem> {
    if raw.is_empty() || raw.len() > 19 || raw.as_bytes().iter().any(|byte| !byte.is_ascii_digit())
    {
        return Err(invalid());
    }
    let value: i64 = raw.parse().map_err(|_| invalid())?;
    if value <= 0 || raw != value.to_string() {
        return Err(invalid());
    }
    Ok(raw.to_owned())
}

fn body_id(body: &Value) -> Result<String, Problem> {
    let object = body.as_object().ok_or_else(invalid)?;
    if object.len() != 1 {
        return Err(invalid());
    }
    let raw = object
        .get("telegramId")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    canonical_id(raw)
}

const fn invalid_cursor() -> Problem {
    Problem::new(
        StatusCode::BAD_REQUEST,
        "invalid_cursor",
        "Invalid lookup cursor",
    )
}

fn cursor_sign(
    state: &AppState,
    principal: &ServicePrincipal,
    telegram_id: &str,
    id: i64,
) -> Result<String, Problem> {
    let message = format!(
        "integration-tg-v1:{}:{telegram_id}:{id}",
        principal.client_id
    );
    let mut mac = Hmac::<Sha256>::new_from_slice(&state.subscription_key)
        .map_err(|_| Problem::unavailable())?;
    mac.update(message.as_bytes());
    Ok(URL_SAFE_NO_PAD.encode(format!(
        "{message}:{}",
        hex::encode(mac.finalize().into_bytes())
    )))
}

fn cursor_read(
    state: &AppState,
    principal: &ServicePrincipal,
    telegram_id: &str,
    raw: &str,
) -> Result<i64, Problem> {
    if raw.len() > 256 {
        return Err(invalid_cursor());
    }
    let bytes = URL_SAFE_NO_PAD.decode(raw).map_err(|_| invalid_cursor())?;
    let text = std::str::from_utf8(&bytes).map_err(|_| invalid_cursor())?;
    let (message, signature) = text.rsplit_once(':').ok_or_else(invalid_cursor)?;
    let (prefix, id) = message.rsplit_once(':').ok_or_else(invalid_cursor)?;
    let expected = format!("integration-tg-v1:{}:{telegram_id}", principal.client_id);
    if prefix != expected {
        return Err(invalid_cursor());
    }
    let id = id
        .parse::<i64>()
        .ok()
        .filter(|id| *id > 0)
        .ok_or_else(invalid_cursor)?;
    let digest = hex::decode(signature).map_err(|_| invalid_cursor())?;
    let mut mac = Hmac::<Sha256>::new_from_slice(&state.subscription_key)
        .map_err(|_| Problem::unavailable())?;
    mac.update(message.as_bytes());
    mac.verify_slice(&digest).map_err(|_| invalid_cursor())?;
    Ok(id)
}

pub(super) async fn lookup(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Path(raw_id): Path<String>,
    Query(query): Query<LookupQuery>,
) -> Result<Json<Value>, Problem> {
    principal.allow_scope("telegram:read")?;
    principal.allow_scope("users:read")?;
    let telegram_id = canonical_id(&raw_id)?;
    let limit = query.limit.unwrap_or(50);
    if !(1..=100).contains(&limit) {
        return Err(Problem::new(
            StatusCode::BAD_REQUEST,
            "validation_error",
            "Invalid page limit",
        ));
    }
    let start = match query.cursor {
        Some(cursor) => cursor_read(&state, &principal, &telegram_id, &cursor)?,
        None => 0,
    };
    // Existing manually entered Telegram IDs are searchable too. All user
    // records remain constrained to the token's user allowlist.
    let records = sqlx::query(
        "SELECT id,data,(EXTRACT(EPOCH FROM updated_at)*1000000)::BIGINT AS revision
         FROM panel_records
         WHERE collection='users' AND data ? 'tg'
           AND BTRIM(data->>'tg')=$1 AND id>$2
           AND ($3::BIGINT[] IS NULL OR id=ANY($3))
         ORDER BY id LIMIT $4",
    )
    .bind(&telegram_id)
    .bind(start)
    .bind(principal.allowed_user_ids.clone())
    .bind(limit + 1)
    .fetch_all(&state.pool)
    .await?;
    let more = records.len() > usize::try_from(limit).unwrap_or(100);
    let mut matches = Vec::new();
    let mut last_id = start;
    for row in records
        .into_iter()
        .take(usize::try_from(limit).unwrap_or(100))
    {
        let id: i64 = row.try_get("id")?;
        let user: Value = row.try_get("data")?;
        let revision: i64 = row.try_get("revision")?;
        last_id = id;
        matches.push(users::with_meter(&state, id, user, revision).await?);
    }
    let mut response = reply(json!(matches));
    response.0["meta"]["limit"] = json!(limit);
    response.0["meta"]["nextCursor"] = if more {
        json!(cursor_sign(&state, &principal, &telegram_id, last_id)?)
    } else {
        Value::Null
    };
    Ok(response)
}

pub(super) async fn assign(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Problem> {
    principal.allow_scope("telegram:assign")?;
    principal.allow_user(id)?;
    let tg = body_id(&body)?;
    let key = grants::key(&headers)?;
    let hash = grants::request_hash("user.telegram.assign", id, &body)?;
    let mut tx = state.pool.begin().await?;
    if let Some(previous) =
        grants::claim(&mut tx, &principal, &key, "user.telegram.assign", &hash).await?
    {
        tx.commit().await?;
        let mut replay = reply(previous);
        replay.0["meta"]["replayed"] = json!(true);
        return Ok(replay);
    }
    let record = sqlx::query(
        "SELECT data,(EXTRACT(EPOCH FROM updated_at)*1000000)::BIGINT AS revision
         FROM panel_records WHERE collection='users' AND id=$1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| Problem::new(StatusCode::NOT_FOUND, "not_found", "User not found"))?;
    let revision: i64 = record.try_get("revision")?;
    user_mutations::matches_revision(&headers, revision)?;
    let provisioner: Option<i64> =
        sqlx::query_scalar("SELECT client_id FROM integration_user_provisioners WHERE user_id=$1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    // This gate is independent of allUsers: even an allUsers bot cannot
    // seize an account created manually or by a different integration.
    if provisioner != Some(principal.client_id) {
        return Err(Problem::new(
            StatusCode::FORBIDDEN,
            "provisioner_mismatch",
            "Existing accounts require owner-managed Telegram assignment",
        ));
    }
    let mut user: Value = record.try_get("data")?;
    let previous = user.get("tg").and_then(Value::as_str).unwrap_or("").trim();
    if !previous.is_empty() && previous != tg {
        return Err(Problem::new(
            StatusCode::CONFLICT,
            "telegram_already_assigned",
            "An existing Telegram ID cannot be replaced by a service token",
        ));
    }
    let changed = previous.is_empty();
    let new_revision = if changed {
        user["tg"] = json!(tg.clone());
        crate::validate_record("users", &user).map_err(Problem::from)?;
        let result = sqlx::query(
            "UPDATE panel_records SET data=$2,updated_at=NOW()
             WHERE collection='users' AND id=$1
             RETURNING (EXTRACT(EPOCH FROM updated_at)*1000000)::BIGINT AS revision",
        )
        .bind(id)
        .bind(user)
        .fetch_one(&mut *tx)
        .await?;
        result.try_get::<i64, _>("revision")?
    } else {
        revision
    };
    let result = json!({"userId":id,"telegramId":tg,"revision":new_revision,"changed":changed});
    grants::complete(
        &mut tx,
        &principal,
        &key,
        "user.telegram.assign",
        id,
        &result,
    )
    .await?;
    tx.commit().await?;
    Ok(reply(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn id_validation_is_canonical_and_excludes_chat_ids() {
        for invalid_input in [
            "",
            "0",
            "0001",
            "-123",
            "+123",
            "abc",
            " 123",
            "123 ",
            "1.1",
            "9999999999999999999",
        ] {
            assert!(canonical_id(invalid_input).is_err(), "{invalid_input}");
        }
        for valid in ["1", "1855665674", "9007199254740991"] {
            assert_eq!(canonical_id(valid).unwrap(), valid);
        }
    }
    #[test]
    fn assignment_rejects_unknown_fields_and_numeric_json() {
        for invalid_body in [
            json!({"telegramId":123}),
            json!({"tg":"123"}),
            json!({"telegramId":"123","username":"forged"}),
            json!({"telegramId":null}),
            json!({}),
        ] {
            assert!(body_id(&invalid_body).is_err(), "{invalid_body}");
        }
        assert_eq!(body_id(&json!({"telegramId":"123"})).unwrap(), "123");
    }
}
