//! One `XMesh` Sub deployment per Nexus. Outbound-only agent: no SSRF, SSH or
//! public admin listener. Panel can enqueue one fixed update, not shell input.
use crate::{ApiError, AppState, audit, auth, read_settings, require_owner};
use axum::{
    Json,
    body::Bytes,
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode, header},
};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use rand_core::{OsRng, RngCore};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::time::{SystemTime, UNIX_EPOCH};

const ENROLL_PREFIX: &str = "xmesh:sub:enroll:";
// A fresh VPS may install Docker and Compose before exchanging its one-time code.
const ENROLL_TTL_SECONDS: u64 = 3600;
const HEARTBEAT: &str = "xmesh:sub:heartbeat";
const PENDING_UPDATE: &str = "xmesh:sub:update:pending";
const CURRENT_UPDATE: &str = "xmesh:sub:update:current";
const UPDATE_STATUS: &str = "xmesh:sub:update:status";
const CREDENTIAL_KEY: &str = "sub_server_agent";
const MAX_MIRRORS: i64 = 16;
const MIRROR_ENROLL_TAG: &str = "mirror:";

const SUB_AGENT_RATE_PER_MINUTE: i64 = 30;
const SUB_AUTH_GLOBAL_PER_MINUTE: i64 = 3000;
const SUB_CLAIM_GLOBAL_PER_MINUTE: i64 = 300;
const MAX_AGENT_BODY_BYTES: usize = 4096;
const MAX_CLOCK_SKEW_SECONDS: u64 = 120;
const RATE_LUA: &str = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],90) end; return n";

async fn consume_budget(state: &AppState, key: &str, limit: i64) -> Result<(), ApiError> {
    let mut conn = state.redis.clone();
    let count: i64 = redis::cmd("EVAL")
        .arg(RATE_LUA)
        .arg(1)
        .arg(key)
        .query_async(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    if count > limit {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "XMesh Sub request rate limit exceeded.",
        ));
    }
    Ok(())
}

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

type MirrorRecord = (String, String, String, Option<String>);

async fn mirror_by_id(pool: &PgPool, id: &str) -> Result<Option<MirrorRecord>, ApiError> {
    if !valid_lower_hex(id, 32) {
        return Err(api_error("Недопустимый идентификатор зеркала."));
    }
    let row = sqlx::query_as::<_, MirrorRecord>(
        "SELECT id,name,domain,public_key FROM sub_mirrors WHERE id=$1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

fn scoped_key(mirror_id: Option<&str>, base: &str) -> String {
    match mirror_id {
        Some(id) => format!(
            "xmesh:sub:mirror:{id}:{}",
            base.strip_prefix("xmesh:sub:").unwrap_or(base)
        ),
        None => base.to_owned(),
    }
}

fn valid_lower_hex(input: &str, size: usize) -> bool {
    input.len() == size
        && input
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn agent_canonical(route: &str, timestamp: &str, nonce: &str, body: &[u8]) -> String {
    format!(
        "XMESH-SUB1\nPOST\n/api/v1/sub-server/agent/{route}\n{timestamp}\n{nonce}\n{}\n",
        hex::encode(Sha256::digest(body))
    )
}

fn unique_header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let mut values = headers.get_all(name).iter();
    let first = values.next()?.to_str().ok()?;
    if values.next().is_some() {
        return None;
    }
    Some(first)
}

async fn authorize(
    state: &AppState,
    headers: &HeaderMap,
    raw_body: &[u8],
    route: &str,
) -> Result<Option<String>, ApiError> {
    let fail = || {
        ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Недействительная подпись XMesh Sub.",
        )
    };
    // No Bearer fallback. The private Ed25519 key never leaves the Sub VPS.
    // Browser cookies and forwarded identities cannot authenticate this channel.
    if headers.contains_key(header::COOKIE)
        || headers.contains_key(header::ORIGIN)
        || headers.contains_key("sec-fetch-site")
        || headers.contains_key(header::AUTHORIZATION)
    {
        return Err(fail());
    }
    if raw_body.len() > MAX_AGENT_BODY_BYTES {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Запрос агента слишком большой.",
        ));
    }
    consume_budget(
        state,
        &format!("xmesh:sub:auth:global:{}", now() / 60),
        SUB_AUTH_GLOBAL_PER_MINUTE,
    )
    .await?;

    let timestamp = unique_header(headers, "x-xmesh-sub-timestamp")
        .filter(|s| !s.is_empty() && s.len() <= 16 && s.bytes().all(|b| b.is_ascii_digit()))
        .filter(|s| s.len() == 1 || !s.starts_with('0'))
        .ok_or_else(fail)?;
    let epoch = timestamp.parse::<u64>().map_err(|_| fail())?;
    if epoch.abs_diff(now()) > MAX_CLOCK_SKEW_SECONDS {
        return Err(fail());
    }
    let nonce = unique_header(headers, "x-xmesh-sub-nonce")
        .filter(|s| valid_lower_hex(s, 32))
        .ok_or_else(fail)?;
    let signature_hex = unique_header(headers, "x-xmesh-sub-signature")
        .filter(|s| valid_lower_hex(s, 128))
        .ok_or_else(fail)?;

    // Public key header is only a lookup selector. Authentication continues
    // to require a valid signature from that key; copying the selector grants
    // no access. Each mirror is independently revocable by deleting its row.
    let advertised = unique_header(headers, "x-xmesh-sub-public-key");
    let primary = credential(&state.pool).await?;
    let primary_key = primary.as_ref()
        .and_then(|setting| setting.get("publicKey"))
        .and_then(Value::as_str)
        .filter(|value| valid_lower_hex(value, 64));
    let (public_key, mirror_id) = if let Some(candidate) = advertised {
        if !valid_lower_hex(candidate, 64) {
            return Err(fail());
        }
        if primary_key == Some(candidate) {
            (candidate.to_owned(), None)
        } else {
            let id: Option<String> =
                sqlx::query_scalar("SELECT id FROM sub_mirrors WHERE public_key=$1")
                    .bind(candidate)
                    .fetch_optional(&state.pool)
                    .await?;
            (candidate.to_owned(), Some(id.ok_or_else(fail)?))
        }
    } else {
        // Existing primary gateway only. Mirrors always require the selector.
        (primary_key.ok_or_else(fail)?.to_owned(), None)
    };
    let public_bytes: [u8; 32] = hex::decode(&public_key)
        .map_err(|_| fail())?
        .try_into()
        .map_err(|_| fail())?;
    let verifier = VerifyingKey::from_bytes(&public_bytes).map_err(|_| fail())?;
    let signature_bytes: [u8; 64] = hex::decode(signature_hex)
        .map_err(|_| fail())?
        .try_into()
        .map_err(|_| fail())?;
    verifier
        .verify(
            agent_canonical(route, timestamp, nonce, raw_body).as_bytes(),
            &Signature::from_bytes(&signature_bytes),
        )
        .map_err(|_| fail())?;

    consume_budget(
        state,
        &format!(
            "xmesh:sub:auth:key:{}:{}",
            now() / 60,
            sha256_hex(&public_key)
        ),
        SUB_AGENT_RATE_PER_MINUTE,
    )
    .await?;
    // Atomic, expiring nonce state: even a valid intercepted signature
    // cannot be replayed, including on another agent endpoint.
    let replay_key = format!("xmesh:sub:nonce:{}:{nonce}", sha256_hex(&public_key));
    let mut conn = state.redis.clone();
    let inserted: Option<String> = redis::cmd("SET")
        .arg(&replay_key)
        .arg("1")
        .arg("NX")
        .arg("EX")
        .arg(300)
        .query_async(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    if inserted.is_none() {
        return Err(fail());
    }
    Ok(mirror_id)
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
        .arg(ENROLL_TTL_SECONDS)
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
        json!({"enrollmentToken":token,"expiresInSeconds":ENROLL_TTL_SECONDS}),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Claim {
    enrollment_token: String,
    domain: String,
    public_key: String,
}

pub async fn claim(
    State(state): State<AppState>,
    Json(body): Json<Claim>,
) -> Result<Json<Value>, ApiError> {
    if !valid_lower_hex(&body.public_key, 64)
        || hex::decode(&body.public_key)
            .ok()
            .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
            .and_then(|bytes| VerifyingKey::from_bytes(&bytes).ok())
            .is_none()
        || !is_hex(&body.enrollment_token, 64)
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
    consume_budget(
        &state,
        &format!("xmesh:sub:claim:global:{}", now() / 60),
        SUB_CLAIM_GLOBAL_PER_MINUTE,
    )
    .await?;
    // Single-use enrollment is scoped to a saved gateway identity. It cannot
    // be retargeted to an arbitrary domain, including a deleted mirror.
    let mut conn = state.redis.clone();
    let matched: Option<String> = redis::cmd("GETDEL")
        .arg(format!("{ENROLL_PREFIX}{}", sha256_hex(&body.enrollment_token)))
        .query_async(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    let binding = matched.ok_or_else(|| {
        ApiError::new(StatusCode::UNAUTHORIZED, "Код подключения истёк или уже использован.")
    })?;
    if let Some(id) = binding.strip_prefix(MIRROR_ENROLL_TAG) {
        let (_, _, domain, existing_key) = mirror_by_id(&state.pool, id)
            .await?
            .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "Зеркало удалено."))?;
        if body.domain != domain {
            return Err(ApiError::new(StatusCode::FORBIDDEN, "Домен зеркала не совпадает."));
        }
        // Reject an agent identity shared between gateways. Each VPS needs
        // its own independent Ed25519 private key.
        if credential(&state.pool).await?
            .as_ref()
            .and_then(|value| value.get("publicKey"))
            .and_then(Value::as_str) == Some(body.public_key.as_str())
        {
            return Err(ApiError::new(StatusCode::CONFLICT, "Ключ уже используется основным шлюзом."));
        }
        if existing_key.as_deref() != Some(body.public_key.as_str()) {
            let changed = sqlx::query(
                "UPDATE sub_mirrors SET public_key=$1,updated_at=NOW() WHERE id=$2 AND domain=$3",
            )
            .bind(&body.public_key)
            .bind(id)
            .bind(&body.domain)
            .execute(&state.pool)
            .await?;
            if changed.rows_affected() != 1 {
                return Err(ApiError::new(StatusCode::CONFLICT, "Зеркало больше не существует."));
            }
        }
        let _: i64 = redis::cmd("DEL")
            .arg(scoped_key(Some(id), HEARTBEAT))
            .arg(scoped_key(Some(id), PENDING_UPDATE))
            .arg(scoped_key(Some(id), CURRENT_UPDATE))
            .arg(scoped_key(Some(id), UPDATE_STATUS))
            .query_async(&mut conn)
            .await
            .map_err(|_| backend_error())?;
    } else {
        let domain = current_domain(&state).await?;
        if binding != domain || body.domain != domain {
            return Err(ApiError::new(StatusCode::FORBIDDEN, "Домен сервера не совпадает с доменом подписок."));
        }
        // Prevent reusing the public signing identity of an existing mirror.
        let mirror: Option<String> =
            sqlx::query_scalar("SELECT id FROM sub_mirrors WHERE public_key=$1")
                .bind(&body.public_key).fetch_optional(&state.pool).await?;
        if mirror.is_some() {
            return Err(ApiError::new(StatusCode::CONFLICT, "Ключ уже привязан к зеркалу."));
        }
        sqlx::query(
            "INSERT INTO app_settings (key,value) VALUES ($1,$2) \
             ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()",
        )
        .bind(CREDENTIAL_KEY)
        .bind(json!({"publicKey":body.public_key,"domain":domain}))
        .execute(&state.pool)
        .await?;
        let _: i64 = redis::cmd("DEL")
            .arg(HEARTBEAT).arg(PENDING_UPDATE).arg(CURRENT_UPDATE).arg(UPDATE_STATUS)
            .query_async(&mut conn)
            .await.map_err(|_| backend_error())?;
    }
    Ok(Json(json!({"ok":true})))
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
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let mirror_id = authorize(&state, &headers, &body, "poll").await?;
    let body: Poll =
        serde_json::from_slice(&body).map_err(|_| api_error("Недопустимый запрос агента."))?;
    if body.version.is_empty()
        || body.version.len() > 40
        || !body
            .version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        return Err(api_error("Недопустимая версия агента."));
    }
    // Authenticated agent receives non-secret edge IP policy. Untrusted
    // X-Forwarded-For headers are never used by Nexus for IP accounting.
    let edge = crate::subscription_flood::current(&state).await;
    let edge_policy = json!({
        "enabled":edge.enabled,
        "mode":edge.mode,
        "ipPerMinute":edge.ip_per_minute
    });
    let mut conn = state.redis.clone();
    let heartbeat = json!({"lastSeen":now(),"version":body.version});
    redis::cmd("SET")
        .arg(scoped_key(mirror_id.as_deref(), HEARTBEAT))
        .arg(heartbeat.to_string())
        .arg("EX")
        .arg(120)
        .query_async::<String>(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    let job: Option<String> = redis::cmd("GETDEL")
        .arg(scoped_key(mirror_id.as_deref(), PENDING_UPDATE))
        .query_async(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    let Some(job) = job.filter(|job| is_hex(job, 32)) else {
        return Ok(Json(json!({"command":"none","flood":edge_policy})));
    };
    redis::cmd("SET")
        .arg(scoped_key(mirror_id.as_deref(), CURRENT_UPDATE))
        .arg(&job)
        .arg("EX")
        .arg(3600)
        .query_async::<String>(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    Ok(Json(
        json!({"command":"update","jobId":job,"flood":edge_policy}),
    ))
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
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let mirror_id = authorize(&state, &headers, &body, "report").await?;
    let body: Report =
        serde_json::from_slice(&body).map_err(|_| api_error("Недопустимый отчёт Sub-сервера."))?;
    if !is_hex(&body.job_id, 32)
        || !matches!(body.stage.as_str(), "running" | "completed" | "failed")
        || body.detail.len() > 160
        || body.detail.bytes().any(|c| c < 0x20 || c == 0x7f)
    {
        return Err(api_error("Недопустимый отчёт Sub-сервера."));
    }
    let mut conn = state.redis.clone();
    let current: Option<String> = redis::cmd("GET")
        .arg(scoped_key(mirror_id.as_deref(), CURRENT_UPDATE))
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
        .arg(scoped_key(mirror_id.as_deref(), UPDATE_STATUS))
        .arg(payload.to_string())
        .arg("EX")
        .arg(86400)
        .query_async::<String>(&mut conn)
        .await
        .map_err(|_| backend_error())?;
    if body.stage != "running" {
        redis::cmd("DEL")
            .arg(scoped_key(mirror_id.as_deref(), CURRENT_UPDATE))
            .query_async::<i64>(&mut conn)
            .await
            .map_err(|_| backend_error())?;
    }
    Ok(Json(json!({"ok":true})))
}


#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateMirror {
    name: String,
    domain: String,
}

pub async fn create_mirror(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Json(body): Json<CreateMirror>,
) -> Result<Json<Value>, ApiError> {
    require_owner(&actor)?;
    let name = body.name.trim();
    let domain = body.domain.trim().to_ascii_lowercase();
    if name.is_empty() || name.chars().count() > 48 || name.chars().any(char::is_control) {
        return Err(api_error("Название зеркала должно содержать от 1 до 48 символов."));
    }
    if !valid_domain(&domain) || domain == current_domain(&state).await? {
        return Err(api_error("Укажите отдельный домен зеркала, отличный от основного."));
    }
    let id = random_hex()[..32].to_owned();
    // Serialize fleet-size checks, including concurrent owner tabs.
    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(215434201)")
        .execute(&mut *tx)
        .await?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sub_mirrors")
        .fetch_one(&mut *tx)
        .await?;
    if count >= MAX_MIRRORS {
        return Err(ApiError::new(StatusCode::CONFLICT, "Можно добавить не более 16 зеркал."));
    }
    let occupied: Option<String> =
        sqlx::query_scalar("SELECT id FROM sub_mirrors WHERE domain=$1")
            .bind(&domain)
            .fetch_optional(&mut *tx)
            .await?;
    if occupied.is_some() {
        return Err(ApiError::new(StatusCode::CONFLICT, "Зеркало с таким доменом уже существует."));
    }
    sqlx::query("INSERT INTO sub_mirrors(id,name,domain) VALUES($1,$2,$3)")
        .bind(&id)
        .bind(name)
        .bind(&domain)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    audit(&state.pool, &actor.username, "sub.mirror.create", None, None,
        json!({"mirrorId":id,"domain":domain})).await;
    Ok(Json(json!({"id":id,"name":name,"domain":domain,"enrolled":false,"online":false})))
}

pub async fn list_mirrors(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
) -> Result<Json<Value>, ApiError> {
    require_owner(&actor)?;
    let records: Vec<MirrorRecord> =
        sqlx::query_as("SELECT id,name,domain,public_key FROM sub_mirrors ORDER BY created_at,id")
            .fetch_all(&state.pool)
            .await?;
    let mut conn = state.redis.clone();
    let mut mirrors = Vec::with_capacity(records.len());
    for (id,name,domain,key) in records {
        let heartbeat: Option<String> = redis::cmd("GET")
            .arg(scoped_key(Some(&id), HEARTBEAT))
            .query_async(&mut conn).await.map_err(|_| backend_error())?;
        let heartbeat: Value = heartbeat.and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(Value::Null);
        let last_seen = heartbeat.get("lastSeen").and_then(Value::as_u64).unwrap_or(0);
        let update: Option<String> = redis::cmd("GET")
            .arg(scoped_key(Some(&id), UPDATE_STATUS))
            .query_async(&mut conn).await.map_err(|_| backend_error())?;
        let update: Value = update.and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(Value::Null);
        let enrolled = key.is_some();
        let online = enrolled && last_seen > 0 && now().saturating_sub(last_seen) <= 90;
        mirrors.push(json!({
            "id":id, "name":name, "domain":domain,
            "enrolled":enrolled,"online":online,"domainMatches":true,
            "lastSeen":last_seen,
            "version":heartbeat.get("version").and_then(Value::as_str).unwrap_or(""),
            "update":update
        }));
    }
    Ok(Json(json!({"mirrors":mirrors, "maxMirrors":MAX_MIRRORS})))
}

pub async fn delete_mirror(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_owner(&actor)?;
    let (_,_,domain,_) = mirror_by_id(&state.pool,&id).await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Зеркало не найдено."))?;
    let removed: Option<String> =
        sqlx::query_scalar("DELETE FROM sub_mirrors WHERE id=$1 RETURNING id")
            .bind(&id).fetch_optional(&state.pool).await?;
    if removed.is_none() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Зеркало не найдено."));
    }
    let mut conn = state.redis.clone();
    let _: i64 = redis::cmd("DEL")
        .arg(scoped_key(Some(&id), HEARTBEAT))
        .arg(scoped_key(Some(&id), PENDING_UPDATE))
        .arg(scoped_key(Some(&id), CURRENT_UPDATE))
        .arg(scoped_key(Some(&id), UPDATE_STATUS))
        .query_async(&mut conn).await.map_err(|_| backend_error())?;
    audit(&state.pool,&actor.username,"sub.mirror.delete",None,None,
        json!({"mirrorId":id,"domain":domain})).await;
    Ok(Json(json!({"ok":true})))
}

pub async fn issue_mirror_enrollment(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_owner(&actor)?;
    let (_,_,domain,_) = mirror_by_id(&state.pool,&id).await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Зеркало не найдено."))?;
    let token = random_hex();
    let mut conn = state.redis.clone();
    redis::cmd("SET")
        .arg(format!("{ENROLL_PREFIX}{}", sha256_hex(&token)))
        .arg(format!("{MIRROR_ENROLL_TAG}{id}"))
        .arg("EX").arg(ENROLL_TTL_SECONDS)
        .query_async::<String>(&mut conn).await.map_err(|_| backend_error())?;
    audit(&state.pool,&actor.username,"sub.mirror.enrollment.issue",None,None,
        json!({"mirrorId":id,"domain":domain})).await;
    Ok(Json(json!({"enrollmentToken":token,"expiresInSeconds":ENROLL_TTL_SECONDS,
        "domain":domain,"mirrorId":id})))
}

pub async fn request_mirror_update(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_owner(&actor)?;
    let (_,_,domain,key) = mirror_by_id(&state.pool,&id).await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Зеркало не найдено."))?;
    if key.is_none() {
        return Err(ApiError::new(StatusCode::CONFLICT, "Сначала подключите зеркало."));
    }
    let mut conn = state.redis.clone();
    let hb: Option<String> = redis::cmd("GET")
        .arg(scoped_key(Some(&id), HEARTBEAT))
        .query_async(&mut conn).await.map_err(|_| backend_error())?;
    let hb: Value = hb.and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or(Value::Null);
    let last = hb.get("lastSeen").and_then(Value::as_u64).unwrap_or(0);
    if last == 0 || now().saturating_sub(last) > 90 {
        return Err(ApiError::new(StatusCode::CONFLICT,"Зеркало не в сети."));
    }
    let current: Option<String> = redis::cmd("GET")
        .arg(scoped_key(Some(&id), CURRENT_UPDATE))
        .query_async(&mut conn).await.map_err(|_| backend_error())?;
    if current.is_some() {
        return Err(ApiError::new(StatusCode::CONFLICT, "Обновление зеркала уже выполняется."));
    }
    let job = random_hex()[..32].to_owned();
    let pending: Option<String> = redis::cmd("SET")
        .arg(scoped_key(Some(&id), PENDING_UPDATE))
        .arg(&job).arg("NX").arg("EX").arg(1800)
        .query_async(&mut conn).await.map_err(|_| backend_error())?;
    if pending.is_none() {
        return Err(ApiError::new(StatusCode::CONFLICT,"Обновление уже в очереди."));
    }
    let status = json!({"jobId":job,"stage":"queued","updatedAt":now()});
    redis::cmd("SET")
        .arg(scoped_key(Some(&id), UPDATE_STATUS))
        .arg(status.to_string()).arg("EX").arg(86400)
        .query_async::<String>(&mut conn).await.map_err(|_| backend_error())?;
    audit(&state.pool,&actor.username,"sub.mirror.update.request",None,None,
        json!({"mirrorId":id,"domain":domain})).await;
    Ok(Json(status))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_token_and_domain_rules() {
        assert!(is_hex(&"a".repeat(64), 64));
        assert!(!is_hex("a;command", 64));
        assert!(valid_lower_hex(&"a".repeat(64), 64));
        assert!(!valid_lower_hex(&"A".repeat(64), 64));
        assert!(valid_domain("uk.free-tier.shop"));
        assert!(!valid_domain("127.0.0.1"));
        assert!(!valid_domain("localhost"));
        assert!(!valid_domain("sub.example.com:443"));
        assert!(!valid_domain("sub.example.com@evil.test"));
    }
    #[test]
    fn agent_signature_binds_route_timestamp_nonce_and_exact_body() {
        use ed25519_dalek::{Signer, SigningKey};
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let payload = br#"{"version":"1.0.0"}"#;
        let nonce = "a".repeat(32);
        let signed = agent_canonical("poll", "1794710000", &nonce, payload);
        let sig = key.sign(signed.as_bytes());
        // Independently generated OpenSSL 3 Ed25519 interoperability vector.
        assert_eq!(
            hex::encode(key.verifying_key().to_bytes()),
            "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c"
        );
        assert_eq!(
            hex::encode(sig.to_bytes()),
            "a13c20fe26aa66f7b1465d4e0cfbcfe2a0975f350b30767095d493af881596da2932527c84b9809b74d3bcdc5286a527cc2d5aa1661b4b66744882270b562d03"
        );
        let verify = key.verifying_key();
        assert!(verify.verify(signed.as_bytes(), &sig).is_ok());
        assert!(
            verify
                .verify(
                    agent_canonical("report", "1794710000", &nonce, payload).as_bytes(),
                    &sig
                )
                .is_err()
        );
        assert!(
            verify
                .verify(
                    agent_canonical("poll", "1794710000", &nonce, b"{}").as_bytes(),
                    &sig
                )
                .is_err()
        );
        assert!(
            verify
                .verify(
                    agent_canonical("poll", "1794710001", &nonce, payload).as_bytes(),
                    &sig
                )
                .is_err()
        );
    }
}
