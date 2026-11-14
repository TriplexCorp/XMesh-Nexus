//! Bounded per-client user views. Never serialize raw `panel_records` user JSON.
use super::{Problem, ServicePrincipal, grants, now_ms, reply};
use crate::{AppState, cdn_quota};
use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::Sha256;
use sqlx::Row;

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub(super) struct ListQuery {
    cursor: Option<String>,
    limit: Option<i64>,
}

fn cursor_sign(state: &AppState, principal: &ServicePrincipal, id: i64) -> String {
    let msg = format!("integration-cursor-v1:{}:{id}", principal.client_id);
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(&state.subscription_key) else {
        return String::new();
    };
    mac.update(msg.as_bytes());
    let sig = hex::encode(mac.finalize().into_bytes());
    URL_SAFE_NO_PAD.encode(format!("{msg}:{sig}"))
}

fn cursor_read(state: &AppState, principal: &ServicePrincipal, raw: &str) -> Result<i64, Problem> {
    let invalid = || {
        Problem::new(
            StatusCode::BAD_REQUEST,
            "validation_error",
            "Invalid cursor",
        )
    };
    if raw.len() > 256 {
        return Err(invalid());
    }
    let decoded = URL_SAFE_NO_PAD.decode(raw).map_err(|_| invalid())?;
    let text = std::str::from_utf8(&decoded).map_err(|_| invalid())?;
    let (payload, sig) = text.rsplit_once(':').ok_or_else(invalid)?;
    let last = payload.rsplit_once(':').ok_or_else(invalid)?.1;
    let id = last.parse::<i64>().map_err(|_| invalid())?;
    if id <= 0 {
        return Err(invalid());
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(&state.subscription_key)
        .map_err(|_| Problem::unavailable())?;
    mac.update(payload.as_bytes());
    let parsed_sig = hex::decode(sig).map_err(|_| invalid())?;
    mac.verify_slice(&parsed_sig).map_err(|_| invalid())?;
    if !payload.starts_with(&format!("integration-cursor-v1:{}:", principal.client_id)) {
        return Err(invalid());
    }
    Ok(id)
}

pub(super) fn safe_user(user: &Value) -> Value {
    // Fixed, opt-in projection. New backend fields stay secret by default.
    let pick = |name: &str| user.get(name).cloned().unwrap_or(Value::Null);
    json!({
        "id": pick("id"),
        "username": pick("username"),
        "disabled": pick("disabled") == Value::Bool(true),
        "status": crate::user_status(user, now_ms()),
        "hold": pick("hold") == Value::Bool(true),
        "holdDays": pick("holdDays"),
        "expireAtMs": pick("expireAt"),
        "limitGb": pick("limit"),
        "usedGb": pick("used"),
        "cdnLimitGb": pick("cdnLimitGb"),
        "cdnUsedBytes": pick("cdnUsedBytes"),
        "onlineAtMs": pick("onlineAt"),
        "squadIds": user.get("squads").and_then(Value::as_array)
            .map_or_else(Vec::new, |items| items.iter().filter(|v| v.is_i64() || v.is_u64()).cloned().collect::<Vec<_>>())
    })
}

async fn with_meter(state: &AppState, id: i64, mut user: Value, revision: i64) -> Result<Value, Problem> {
    user["id"] = json!(id);
    let metered_bytes = crate::user_metered_bytes(&state.pool, id)
        .await
        .map_err(Problem::from)?;
    crate::add_metered_usage(&mut user, metered_bytes);
    cdn_quota::attach_usage(&state.pool, std::slice::from_mut(&mut user))
        .await
        .map_err(Problem::from)?;
    let mut safe = safe_user(&user);
    safe["revision"] = json!(revision);
    Ok(safe)
}

pub(super) async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Value>, Problem> {
    principal.allow_scope("users:read")?;
    let limit = query.limit.unwrap_or(50);
    if !(1..=100).contains(&limit) {
        return Err(Problem::new(
            StatusCode::BAD_REQUEST,
            "validation_error",
            "Invalid limit",
        ));
    }
    let start = match query.cursor {
        Some(cursor) => cursor_read(&state, &principal, &cursor)?,
        None => 0,
    };
    let rows = sqlx::query(
        "SELECT id,data,(EXTRACT(EPOCH FROM updated_at)*1000000)::BIGINT AS revision FROM panel_records
         WHERE collection='users' AND id>$1
           AND ($2::bigint[] IS NULL OR id=ANY($2))
         ORDER BY id LIMIT $3",
    )
    .bind(start)
    .bind(principal.allowed_user_ids.clone())
    .bind(limit + 1)
    .fetch_all(&state.pool)
    .await?;
    let more = rows.len() > usize::try_from(limit).unwrap_or(100);
    let mut items = Vec::new();
    let mut last_id = start;
    for row in rows.into_iter().take(usize::try_from(limit).unwrap_or(100)) {
        let id: i64 = row.try_get("id")?;
        let user: Value = row.try_get("data")?;
        last_id = id;
        let revision: i64 = row.try_get("revision")?;
        items.push(with_meter(&state, id, user, revision).await?);
    }
    let mut result = reply(json!(items));
    result.0["meta"]["limit"] = json!(limit);
    result.0["meta"]["nextCursor"] = if more {
        json!(cursor_sign(&state, &principal, last_id))
    } else {
        Value::Null
    };
    Ok(result)
}

pub(super) async fn get(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Path(id): Path<i64>,
) -> Result<Response, Problem> {
    principal.allow_scope("users:read")?;
    principal.allow_user(id)?;
    let row = sqlx::query(
        "SELECT data,(EXTRACT(EPOCH FROM updated_at)*1000000)::BIGINT AS revision
         FROM panel_records WHERE collection='users' AND id=$1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| Problem::new(StatusCode::NOT_FOUND, "not_found", "User not found"))?;
    let user: Value = row.try_get("data")?;
    let revision: i64 = row.try_get("revision")?;
    let mut response = reply(with_meter(&state, id, user, revision).await?).into_response();
    let tag = HeaderValue::from_str(&format!("\"{revision}\""))
        .map_err(|_| Problem::unavailable())?;
    response.headers_mut().insert(header::ETAG, tag);
    Ok(response)
}

pub(super) async fn traffic(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, Problem> {
    principal.allow_scope("traffic:read")?;
    principal.allow_user(id)?;
    let data = crate::get_user_traffic(State(state), Path(id))
        .await
        .map_err(Problem::from)?;
    Ok(reply(data.0))
}

pub(super) async fn subscription(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, Problem> {
    principal.allow_scope("subscriptions:read")?;
    principal.allow_user(id)?;
    let data = crate::user_subscriptions::service_subscription_status(&state, id)
        .await
        .map_err(Problem::from)?;
    Ok(reply(data))
}

pub(super) async fn enable(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(body): Json<grants::AccessRequest>,
) -> Result<Json<Value>, Problem> {
    grants::set_access(state, principal, id, false, headers, body).await
}

pub(super) async fn disable(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(body): Json<grants::AccessRequest>,
) -> Result<Json<Value>, Problem> {
    grants::set_access(state, principal, id, true, headers, body).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn projection_never_exposes_xray_credentials_or_telegram_contact() {
        let user = json!({"id":42,"username":"alice","xrayId":"SECRET",
            "password":"SECRET","tg":"123","subscriptionUrl":"https://secret","note":"private",
            "limit":0.0,"used":1.0,"expireAt":1_800_000_000_000_i64});
        let projected = safe_user(&user);
        assert_eq!(projected["username"], "alice");
        for field in ["xrayId", "password", "tg", "subscriptionUrl", "note"] {
            assert!(projected.get(field).is_none(), "{field} must remain hidden");
        }
    }
}
