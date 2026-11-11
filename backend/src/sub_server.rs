//! One XMesh Sub deployment per Nexus. Outbound-only agent: no SSRF, SSH or
//! public admin listener. Panel can enqueue one fixed update, not shell input.
use crate::{ApiError, AppState, audit, auth, read_settings, require_owner};
use axum::{
    Json,
    extract::{Extension, State},
    http::{HeaderMap, StatusCode, header},
};
use rand_core::{OsRng, RngCore};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::time::{SystemTime, UNIX_EPOCH};
use subtle::ConstantTimeEq;

const ENROLL_PREFIX: &str = "xmesh:sub:enroll:";
const HEARTBEAT: &str = "xmesh:sub:heartbeat";
const PENDING_UPDATE: &str = "xmesh:sub:update:pending";
const CURRENT_UPDATE: &str = "xmesh:sub:update:current";
const UPDATE_STATUS: &str = "xmesh:sub:update:status";
const CREDENTIAL_KEY: &str = "sub_server_agent";

fn api_error(message: &str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, message)
}
fn backend_error() -> ApiError {
    ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "Подключение к Sub-серверу временно недоступно.",
    )
}
fn random_hex() -> String {
    let mut buf = [0u8; 32];
    let mut rng = OsRng;
    rng.fill_bytes(&mut buf);
    hex::encode(buf)
}
fn sha256_hex(text: &str) -> String {
    hex::encode(Sha256::digest(text.as_bytes()))
}
fn is_hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|ch| ch.is_ascii_hexdigit())
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn valid_domain(domain: &str) -> bool {
    domain.len() <= 253
        && domain.contains('.')
        && domain.ends_with(|c: char| c.is_ascii_alphabetic())
        && domain.split('.').all(|part| {
            !part.is_empty()
                && part.len() <= 63
                && part.starts_with(|c: char| c.is_ascii_alphanumeric())
                && part.ends_with(|c: char| c.is_ascii_alphanumeric())
                && part.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
}
async fn current_domain(state: &AppState) -> Result<String, ApiError> {
    let settings = read_settings(&state.pool).await?;
    let domain = settings
        .get("subscriptionDomain")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    if !valid_domain(&domain) {
        return Err(api_error(
            "Сначала сохраните корректный домен подписок в Subscription Studio.",
        ));
    }
    Ok(domain)
}
async fn credential(pool: &PgPool) -> Result<Option<Value>, ApiError> {
    Ok(
        sqlx::query_scalar::<_, Value>("SELECT value FROM app_settings WHERE key = $1")
            .bind(CREDENTIAL_KEY)
            .fetch_optional(pool)
            .await?,
    )
}
async fn authorize(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    let fail = || ApiError::new(StatusCode::UNAUTHORIZED, "Недействительный ключ XMesh Sub.");
    let raw = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or_else(fail)?;
    if !is_hex(raw, 64) || raw.bytes().any(|c| c.is_ascii_uppercase()) {
        return Err(fail());
    }
    let settings = credential(&state.pool).await?.ok_or_else(fail)?;
    let stored = settings
        .get("hash")
        .and_then(Value::as_str)
        .and_then(|s| hex::decode(s).ok())
        .filter(|v| v.len() == 32)
        .ok_or_else(fail)?;
    let computed: [u8; 32] = Sha256::digest(raw.as_bytes()).into();
    if !bool::from(stored.as_slice().ct_eq(computed.as_slice())) {
        return Err(fail());
    }
    Ok(())
}

pub async fn issue_enrollment(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
) -> Result<Json<Value>, ApiError> {
    require_owner(&actor)?;
    let domain = current_domain(&state).await?;
    let token = random_hex();
    let mut conn = state.redis.clone();
    redis::cmd("SET")
        .arg(format!("{ENROLL_PREFIX}{}", sha256_hex(&token)))
        .arg(&domain)
        .arg("EX")
        .arg(600)
        .query_async::<String>(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    audit(
        &state.pool,
        &actor.username,
        "sub.enrollment.issue",
        None,
        None,
        json!({"domain":domain}),
    )
    .await;
    Ok(Json(
        json!({"enrollmentToken":token,"expiresInSeconds":600}),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Claim {
    enrollment_token: String,
    domain: String,
}

pub async fn claim(
    State(state): State<AppState>,
    Json(body): Json<Claim>,
) -> Result<Json<Value>, ApiError> {
    if !is_hex(&body.enrollment_token, 64)
        || !valid_domain(&body.domain)
        || body
            .enrollment_token
            .bytes()
            .any(|b| b.is_ascii_uppercase())
    {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Код подключения недействителен.",
        ));
    }
    let domain = current_domain(&state).await?;
    if body.domain != domain {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Домен сервера не совпадает с доменом подписок.",
        ));
    }
    let mut conn = state.redis.clone();
    let matched: Option<String> = redis::cmd("GETDEL")
        .arg(format!(
            "{ENROLL_PREFIX}{}",
            sha256_hex(&body.enrollment_token)
        ))
        .query_async(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    if matched.as_deref() != Some(domain.as_str()) {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Код подключения истёк или уже использован.",
        ));
    }
    let token = random_hex();
    sqlx::query(
        "INSERT INTO app_settings (key,value) VALUES ($1,$2) \
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()",
    )
    .bind(CREDENTIAL_KEY)
    .bind(json!({"hash":sha256_hex(&token),"domain":domain}))
    .execute(&state.pool)
    .await?;
    // A prior agent may still have a heartbeat from its rotated token.
    let _: i64 = redis::cmd("DEL")
        .arg(HEARTBEAT)
        .arg(PENDING_UPDATE)
        .arg(CURRENT_UPDATE)
        .query_async(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    Ok(Json(json!({"agentToken":token})))
}

pub async fn status(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
) -> Result<Json<Value>, ApiError> {
    require_owner(&actor)?;
    let credential = credential(&state.pool).await?;
    let domain = credential
        .as_ref()
        .and_then(|data| data.get("domain"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let mut conn = state.redis.clone();
    let heartbeat: Option<String> = redis::cmd("GET")
        .arg(HEARTBEAT)
        .query_async(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    let heartbeat: Value = heartbeat
        .and_then(|h| serde_json::from_str(&h).ok())
        .unwrap_or(Value::Null);
    let last_seen = heartbeat
        .get("lastSeen")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let is_online = credential.is_some() && last_seen > 0 && now().saturating_sub(last_seen) <= 90;
    let update: Option<String> = redis::cmd("GET")
        .arg(UPDATE_STATUS)
        .query_async(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    let update: Value = update
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    let configured_domain = current_domain(&state).await.unwrap_or_default();
    Ok(Json(json!({
        "enrolled":credential.is_some(),
        "online":is_online,
        "domain":domain,
        "domainMatches":domain==configured_domain,
        "lastSeen":last_seen,
        "version": heartbeat.get("version").and_then(Value::as_str).unwrap_or(""),
        "update":update
    })))
}

pub async fn request_update(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
) -> Result<Json<Value>, ApiError> {
    require_owner(&actor)?;
    let settings = credential(&state.pool)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Сначала подключите Sub-сервер."))?;
    let domain = current_domain(&state).await?;
    if settings.get("domain").and_then(Value::as_str) != Some(domain.as_str()) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Домен подписок изменился. Подключите сервер повторно.",
        ));
    }
    let mut conn = state.redis.clone();
    let hb: Option<String> = redis::cmd("GET")
        .arg(HEARTBEAT)
        .query_async(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    let hb: Value = hb
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    let recent = hb.get("lastSeen").and_then(Value::as_u64).unwrap_or(0);
    if recent == 0 || now().saturating_sub(recent) > 90 {
        return Err(ApiError::new(StatusCode::CONFLICT, "Sub-сервер не в сети."));
    }
    let current: Option<String> = redis::cmd("GET")
        .arg(CURRENT_UPDATE)
        .query_async(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    if current.is_some() {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Обновление сервера уже выполняется.",
        ));
    }
    let job = random_hex()[..32].to_owned();
    let stored: Option<String> = redis::cmd("SET")
        .arg(PENDING_UPDATE)
        .arg(&job)
        .arg("NX")
        .arg("EX")
        .arg(1800)
        .query_async(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    if stored.is_none() {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "На сервере уже ожидает выполнения обновление.",
        ));
    }
    let status = json!({"jobId":job,"stage":"queued","updatedAt":now()});
    redis::cmd("SET")
        .arg(UPDATE_STATUS)
        .arg(status.to_string())
        .arg("EX")
        .arg(86400)
        .query_async::<String>(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    audit(
        &state.pool,
        &actor.username,
        "sub.update.request",
        None,
        None,
        json!({"domain":domain}),
    )
    .await;
    Ok(Json(status))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Poll {
    version: String,
}

pub async fn poll(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Poll>,
) -> Result<Json<Value>, ApiError> {
    authorize(&state, &headers).await?;
    if body.version.is_empty()
        || body.version.len() > 40
        || !body
            .version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        return Err(api_error("Недопустимая версия агента."));
    }
    let mut conn = state.redis.clone();
    let heartbeat = json!({"lastSeen":now(),"version":body.version});
    redis::cmd("SET")
        .arg(HEARTBEAT)
        .arg(heartbeat.to_string())
        .arg("EX")
        .arg(120)
        .query_async::<String>(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    let job: Option<String> = redis::cmd("GETDEL")
        .arg(PENDING_UPDATE)
        .query_async(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    let Some(job) = job.filter(|job| is_hex(job, 32)) else {
        return Ok(Json(json!({"command":"none"})));
    };
    redis::cmd("SET")
        .arg(CURRENT_UPDATE)
        .arg(&job)
        .arg("EX")
        .arg(3600)
        .query_async::<String>(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    Ok(Json(json!({"command":"update","jobId":job})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Report {
    job_id: String,
    stage: String,
    #[serde(default)]
    detail: String,
}

pub async fn report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Report>,
) -> Result<Json<Value>, ApiError> {
    authorize(&state, &headers).await?;
    if !is_hex(&body.job_id, 32)
        || !matches!(body.stage.as_str(), "running" | "completed" | "failed")
        || body.detail.len() > 160
        || body.detail.bytes().any(|c| c < 0x20 || c == 0x7f)
    {
        return Err(api_error("Недопустимый отчёт Sub-сервера."));
    }
    let mut conn = state.redis.clone();
    let current: Option<String> = redis::cmd("GET")
        .arg(CURRENT_UPDATE)
        .query_async(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    if current.as_deref() != Some(&body.job_id) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Неизвестное обновление.",
        ));
    }
    let payload = json!({
        "jobId":body.job_id,
        "stage":body.stage,
        "detail":body.detail,
        "updatedAt":now()
    });
    redis::cmd("SET")
        .arg(UPDATE_STATUS)
        .arg(payload.to_string())
        .arg("EX")
        .arg(86400)
        .query_async::<String>(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    if body.stage != "running" {
        redis::cmd("DEL")
            .arg(CURRENT_UPDATE)
            .query_async::<i64>(&mut conn)
            .await
            .map_err(|_| backend_error())?;
    }
    Ok(Json(json!({"ok":true})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_token_and_domain_rules() {
        assert!(is_hex(&"a".repeat(64), 64));
        assert!(!is_hex("a;command", 64));
        assert!(valid_domain("uk.free-tier.shop"));
        assert!(!valid_domain("127.0.0.1"));
        assert!(!valid_domain("localhost"));
        assert!(!valid_domain("sub.example.com:443"));
        assert!(!valid_domain("sub.example.com@evil.test"));
    }
}
