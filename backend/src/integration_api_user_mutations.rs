//! Explicitly whitelisted service user mutations.
//! No browser cookies, raw credential input, implicit unlimited accounts or arbitrary JSON patches.
use super::{Problem, ServicePrincipal, grants, now_ms, reply, users};
use crate::{AppState, protocol_credentials, user_subscriptions};
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::{Map, Value, json};
use sqlx::Row;

fn invalid(message: &'static str) -> Problem {
    Problem::new(StatusCode::BAD_REQUEST, "validation_error", message)
}

fn object<'a>(data: &'a Value, fields: &[&str]) -> Result<&'a Map<String, Value>, Problem> {
    let fields_map = data.as_object().ok_or_else(|| invalid("A JSON object is required"))?;
    if fields_map.keys().any(|name| !fields.contains(&name.as_str())) {
        return Err(invalid("Unknown or read-only field"));
    }
    Ok(fields_map)
}

fn name(value: &Value) -> Result<String, Problem> {
    let username = value.as_str().ok_or_else(|| invalid("Invalid username"))?.trim();
    if username.is_empty()
        || username.chars().count() > 128
        || username.chars().any(char::is_control)
    {
        return Err(invalid("Invalid username"));
    }
    Ok(username.to_owned())
}

fn limit(value: &Value) -> Result<f64, Problem> {
    let amount = value.as_f64().ok_or_else(|| invalid("Quota must be a number"))?;
    if !amount.is_finite() || !(0.0..=1_000_000.0).contains(&amount) {
        return Err(invalid("Quota must be between 0 and 1000000 GB"));
    }
    Ok(amount)
}

async fn references(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    object: &Map<String, Value>,
) -> Result<(), Problem> {
    if let Some(squads) = object.get("squadIds") {
        let array = squads.as_array().ok_or_else(|| invalid("Invalid squadIds"))?;
        if array.len() > 256 {
            return Err(invalid("Too many squads"));
        }
        let mut ids = array
            .iter()
            .map(|value| value.as_i64().filter(|id| *id > 0).ok_or_else(|| invalid("Invalid squad ID")))
            .collect::<Result<Vec<_>, _>>()?;
        ids.sort_unstable();
        ids.dedup();
        if ids.len() != array.len() {
            return Err(invalid("Duplicate squad ID"));
        }
        let found: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM panel_records WHERE collection='squads' AND id=ANY($1::BIGINT[])",
        )
        .bind(&ids)
        .fetch_one(&mut **tx)
        .await?;
        if found != i64::try_from(ids.len()).unwrap_or(i64::MAX) {
            return Err(invalid("Referenced squad does not exist"));
        }
    }
    if let Some(template) = object.get("templateId")
        && !template.is_null()
    {
        let template_id = template.as_i64().filter(|id| *id > 0).ok_or_else(|| invalid("Invalid template ID"))?;
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM panel_records WHERE collection='templates' AND id=$1)",
        )
        .bind(template_id)
        .fetch_one(&mut **tx)
        .await?;
        if !exists {
            return Err(invalid("Referenced template does not exist"));
        }
    }
    Ok(())
}

fn build_create(body: &Value, now: i64) -> Result<Value, Problem> {
    let fields = object(body, &[
        "username", "hold", "holdDays", "expireAtMs", "limitGb",
        "cdnLimitGb", "squadIds", "templateId",
    ])?;
    let username = name(fields.get("username").ok_or_else(|| invalid("username required"))?)?;
    let hold = fields.get("hold").map_or(Ok(false), |v| {
        v.as_bool().ok_or_else(|| invalid("hold must be boolean"))
    })?;
    let expiry = fields.get("expireAtMs");
    let days = fields.get("holdDays");
    let mut data = Map::new();
    data.insert("username".into(), json!(username));
    data.insert("hold".into(), json!(hold));
    data.insert("used".into(), json!(0));
    if hold {
        let days = days.and_then(Value::as_i64).filter(|v| (1..=3650).contains(v))
            .ok_or_else(|| invalid("holdDays (1-3650) is required for hold"))?;
        if expiry.is_some() {
            return Err(invalid("A held subscription cannot have an active expiry"));
        }
        data.insert("holdDays".into(), json!(days));
    } else {
        if days.is_some() {
            return Err(invalid("holdDays is only valid when hold=true"));
        }
        let expiry = expiry.and_then(Value::as_i64)
            .filter(|v| *v > now && *v <= now.saturating_add(3_650_i64 * 86_400_000))
            .ok_or_else(|| invalid("An explicit future expireAtMs is required"))?;
        data.insert("expireAt".into(), json!(expiry));
    }
    for (external, internal) in [("limitGb", "limit"), ("cdnLimitGb", "cdnLimitGb")] {
        if let Some(value) = fields.get(external) {
            data.insert(internal.into(), json!(limit(value)?));
        }
    }
    if let Some(squads) = fields.get("squadIds") {
        data.insert("squads".into(), squads.clone());
    }
    if let Some(template) = fields.get("templateId") {
        if template.as_i64().filter(|v| *v > 0).is_none() {
            return Err(invalid("Invalid template ID"));
        }
        data.insert("templateId".into(), template.clone());
    }
    protocol_credentials::provision(&mut data);
    let value = Value::Object(data);
    crate::validate_record("users", &value).map_err(Problem::from)?;
    Ok(value)
}

fn apply_patch(data: &mut Value, body: &Value) -> Result<(), Problem> {
    let fields = object(body, &[
        "username", "limitGb", "cdnLimitGb", "squadIds", "templateId", "note",
    ])?;
    if fields.is_empty() {
        return Err(invalid("Empty user patch"));
    }
    let current = data.as_object_mut().ok_or_else(Problem::unavailable)?;
    for (field, value) in fields {
        match field.as_str() {
            "username" => { current.insert("username".into(), json!(name(value)?)); }
            "limitGb" => { current.insert("limit".into(), json!(limit(value)?)); }
            "cdnLimitGb" => { current.insert("cdnLimitGb".into(), json!(limit(value)?)); }
            "squadIds" => {
                if !value.is_array() {
                    return Err(invalid("squadIds must be an array"));
                }
                current.insert("squads".into(), value.clone());
            }
            "templateId" => {
                if value.is_null() {
                    current.remove("templateId");
                } else if value.as_i64().is_some_and(|v| v > 0) {
                    current.insert("templateId".into(), value.clone());
                } else {
                    return Err(invalid("Invalid template ID"));
                }
            }
            "note" => {
                let note = value.as_str().ok_or_else(|| invalid("note must be a string"))?;
                if note.len() > 2048 || note.chars().any(char::is_control) {
                    return Err(invalid("Invalid note"));
                }
                current.insert("note".into(), json!(note));
            }
            _ => return Err(invalid("Unknown user field")),
        }
    }
    crate::validate_record("users", data).map_err(Problem::from)
}

/// ETag values use database updated_at microseconds, not a client-controlled JSON field.
/// Reads and writes share the same epoch-based revision, including legacy panel edits.
pub(super) fn matches_revision(headers: &HeaderMap, revision: i64) -> Result<(), Problem> {
    let raw = headers.get("if-match").and_then(|value| value.to_str().ok())
        .ok_or_else(|| Problem::new(
            StatusCode::PRECONDITION_REQUIRED,
            "precondition_required",
            "If-Match with current user revision is required",
        ))?;
    let expected = format!("\"{revision}\"");
    if raw != expected {
        return Err(Problem::new(
            StatusCode::PRECONDITION_FAILED,
            "revision_conflict",
            "User changed; read the newest revision",
        ));
    }
    Ok(())
}

pub(super) async fn create(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, Problem> {
    principal.allow_scope("users:create")?;
    // A limited token cannot give itself a newly created user outside its assigned IDs.
    if principal.allowed_user_ids.is_some() {
        return Err(Problem::new(StatusCode::FORBIDDEN, "scope_denied", "Creating users requires an explicitly approved allUsers token"));
    }
    let data = build_create(&body, now_ms())?;
    let key = grants::key(&headers)?;
    let hash = grants::request_hash("user.create", 0, &body)?;
    let mut tx = state.pool.begin().await?;
    if let Some(previous) = grants::claim(&mut tx, &principal, &key, "user.create", &hash).await? {
        tx.commit().await?;
        let mut response = reply(previous);
        response.0["meta"]["replayed"] = json!(true);
        return Ok((StatusCode::OK, response).into_response());
    }
    let username = data["username"].as_str().ok_or_else(Problem::unavailable)?;
    // Serialize concurrent creations from this API for the same normalized username.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(username.to_lowercase()).execute(&mut *tx).await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM panel_records WHERE collection='users' AND LOWER(data->>'username')=LOWER($1))",
    )
    .bind(username).fetch_one(&mut *tx).await?;
    if exists {
        return Err(Problem::new(StatusCode::CONFLICT, "duplicate_username", "Username already exists"));
    }
    references(&mut tx, object(&body, &[
        "username", "hold", "holdDays", "expireAtMs", "limitGb",
        "cdnLimitGb", "squadIds", "templateId",
    ])?).await?;
    let row = sqlx::query(
        "INSERT INTO panel_records(collection,data) VALUES('users',$1)
         RETURNING id,(EXTRACT(EPOCH FROM updated_at)*1000000)::BIGINT AS revision",
    )
    .bind(data.clone()).fetch_one(&mut *tx).await?;
    let id: i64 = row.try_get("id")?;
    let revision: i64 = row.try_get("revision")?;
    user_subscriptions::provision_new_user(&state, id, &mut tx).await.map_err(Problem::from)?;
    let mut user = data;
    user["id"] = json!(id);
    let mut result = users::safe_user(&user);
    result["revision"] = json!(revision);
    grants::complete(&mut tx, &principal, &key, "user.create", id, &result).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, reply(result)).into_response())
}

pub(super) async fn patch(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Problem> {
    principal.allow_scope("users:update")?;
    principal.allow_user(id)?;
    // Validate before consuming an idempotency key or obtaining a row lock.
    object(&body, &["username", "limitGb", "cdnLimitGb", "squadIds", "templateId", "note"])?;
    let key = grants::key(&headers)?;
    let hash = grants::request_hash("user.patch", id, &body)?;
    let mut tx = state.pool.begin().await?;
    if let Some(previous) = grants::claim(&mut tx, &principal, &key, "user.patch", &hash).await? {
        tx.commit().await?;
        let mut response = reply(previous);
        response.0["meta"]["replayed"] = json!(true);
        return Ok(response);
    }
    let row = sqlx::query(
        "SELECT data,(EXTRACT(EPOCH FROM updated_at)*1000000)::BIGINT AS revision
         FROM panel_records WHERE collection='users' AND id=$1 FOR UPDATE",
    )
    .bind(id).fetch_optional(&mut *tx).await?
    .ok_or_else(|| Problem::new(StatusCode::NOT_FOUND,"not_found","User not found"))?;
    let revision: i64 = row.try_get("revision")?;
    matches_revision(&headers, revision)?;
    let mut user: Value = row.try_get("data")?;
    apply_patch(&mut user, &body)?;
    references(&mut tx, object(&body, &[
        "username", "limitGb", "cdnLimitGb", "squadIds", "templateId", "note",
    ])?).await?;
    if let Some(username) = body.get("username").and_then(Value::as_str) {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM panel_records WHERE collection='users'
             AND id<>$1 AND LOWER(data->>'username')=LOWER($2))",
        )
        .bind(id).bind(username).fetch_one(&mut *tx).await?;
        if exists {
            return Err(Problem::new(StatusCode::CONFLICT, "duplicate_username", "Username already exists"));
        }
    }
    let row = sqlx::query(
        "UPDATE panel_records SET data=$2,updated_at=NOW()
         WHERE collection='users' AND id=$1
         RETURNING (EXTRACT(EPOCH FROM updated_at)*1000000)::BIGINT AS revision",
    ).bind(id).bind(&user).fetch_one(&mut *tx).await?;
    user["id"] = json!(id);
    let mut result = users::safe_user(&user);
    result["revision"] = json!(row.try_get::<i64,_>("revision")?);
    grants::complete(&mut tx,&principal,&key,"user.patch",id,&result).await?;
    tx.commit().await?;
    Ok(reply(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reject_credential_overpost_and_unbounded_new_accounts() {
        let now = 1_800_000_000_000_i64;
        assert!(build_create(&json!({"username":"alice","expireAtMs":now+86_400_000}),now).is_ok());
        assert!(build_create(&json!({"username":"alice","xrayId":"forged","expireAtMs":now+86_400_000}),now).is_err());
        assert!(build_create(&json!({"username":"alice"}),now).is_err());
        assert!(build_create(&json!({"username":"alice","hold":true,"holdDays":30}),now).is_ok());
        assert!(build_create(&json!({"username":"alice","hold":true,"holdDays":30,"expireAtMs":now+86_400_000}),now).is_err());
        assert!(build_create(&json!({"username":"alice","limitGb":-1,"expireAtMs":now+86_400_000}),now).is_err());
    }
    #[test]
    fn patch_never_accepts_usage_credentials_or_expiry() {
        for forbidden in ["xrayId","usedGb","used","expireAtMs","disabled","holdDays","cdnUsedBytes"] {
            let mut body = json!({"limitGb":5.0});
            body[forbidden] = json!(100);
            let mut user = json!({"username":"alice","limit":1.0});
            assert!(apply_patch(&mut user,&body).is_err(), "{forbidden}");
        }
        let mut user=json!({"username":"alice","limit":1.0});
        assert!(apply_patch(&mut user,&json!({"limitGb":5})).is_ok());
        assert_eq!(user["limit"],5.0);
    }
    #[test]
    fn revision_requires_strict_quoted_tag() {
        let mut headers=HeaderMap::new();
        assert!(matches_revision(&headers,42).is_err());
        headers.insert("if-match",axum::http::HeaderValue::from_static("42"));
        assert!(matches_revision(&headers,42).is_err());
        headers.insert("if-match",axum::http::HeaderValue::from_static("\"42\""));
        assert!(matches_revision(&headers,42).is_ok());
    }
}
