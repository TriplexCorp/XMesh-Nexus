//! Production service credentials: owner issuance, digest-only storage, strict Bearer middleware.
use super::{Problem, ServicePrincipal, now_ms, proof};
use crate::{ApiError, AppState, auth::AuthUser};
use axum::{
    Json,
    extract::{Extension, Path, Request, State},
    http::{HeaderMap, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use ed25519_dalek::VerifyingKey;
use rand_core::{OsRng, RngCore};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;

const ENABLED_SCOPES: &[&str] = &[
    "users:read",
    "traffic:read",
    "subscriptions:read",
    "users:write",
    "users:create",
    "users:update",
    "quotas:read",
    "quotas:write",
    "squads:read",
    "squads:members:write",
    "nodes:read",
    "telegram:read",
    "telegram:assign",
    "entitlements:grant",
];
const TOKEN_PREFIX: &str = "xmni_v1_";
const REDIS_RATE_LIMIT_PER_MINUTE: i64 = 120;
const RATE_SCRIPT: &str = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],90) end; return n";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IssueToken {
    client_name: String,
    label: String,
    mfa_code: String,
    scopes: Vec<String>,
    #[serde(default = "default_expires")]
    expires_in_days: i32,
    #[serde(default)]
    all_users: bool,
    allowed_user_ids: Option<Vec<i64>>,
    // 32-byte Ed25519 public key as lowercase hex. The private key never
    // reaches Nexus and should reside on the integration host/TPM.
    proof_public_key: Option<String>,
    max_grant_days: Option<i32>,
    max_creates_per_day: Option<i32>,
}
const fn default_expires() -> i32 {
    30
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeToken {
    mfa_code: String,
}

fn valid_name(value: &str, max: usize) -> bool {
    (3..=max).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

fn valid_token(value: &str) -> bool {
    value.len() == TOKEN_PREFIX.len() + 64
        && value.starts_with(TOKEN_PREFIX)
        && value[TOKEN_PREFIX.len()..]
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

#[expect(
    clippy::too_many_lines,
    reason = "Credential issuance performs immutable policy checks, MFA and transactional key storage"
)]
pub async fn create_token(
    State(state): State<AppState>,
    Extension(admin): Extension<AuthUser>,
    headers: HeaderMap,
    Json(body): Json<IssueToken>,
) -> Result<Response, ApiError> {
    crate::require_owner(&admin)?;
    crate::mfa::verify_integrations_step_up(&state, &admin, &headers, &body.mfa_code).await?;
    if !valid_name(&body.client_name, 64) || !valid_name(&body.label, 128) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Client and token names must use 3-64/128 alphanumeric, ._- characters",
        ));
    }
    if !(1..=90).contains(&body.expires_in_days)
        || body.scopes.is_empty()
        || body.scopes.len() > ENABLED_SCOPES.len()
        || body
            .scopes
            .iter()
            .any(|scope| !ENABLED_SCOPES.contains(&scope.as_str()))
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid expiry or scopes",
        ));
    }
    let mut scopes = body.scopes;
    scopes.sort_unstable();
    scopes.dedup();
    let proof_key = if let Some(ref input) = body.proof_public_key {
        if input.len() != 64
            || input
                .bytes()
                .any(|b| !b.is_ascii_hexdigit() || b.is_ascii_uppercase())
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Invalid proofPublicKey (32-byte Ed25519 public key, lowercase hex)",
            ));
        }
        let decoded = hex::decode(input)
            .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid proofPublicKey"))?;
        let array: [u8; 32] = decoded
            .as_slice()
            .try_into()
            .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid proofPublicKey"))?;
        VerifyingKey::from_bytes(&array).map_err(|_| {
            ApiError::new(StatusCode::BAD_REQUEST, "Invalid Ed25519 proofPublicKey")
        })?;
        Some(decoded)
    } else {
        None
    };
    if proof_key.is_none() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "All new API tokens require an Ed25519 proofPublicKey",
        ));
    }
    if body
        .max_grant_days
        .is_some_and(|v| !(1..=3650).contains(&v))
        || body
            .max_creates_per_day
            .is_some_and(|v| !(1..=1000).contains(&v))
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid operation limits",
        ));
    }
    let grant_limit = if scopes.iter().any(|s| s == "entitlements:grant") {
        Some(body.max_grant_days.unwrap_or(30))
    } else {
        None
    };
    let creates_limit = if scopes.iter().any(|s| s == "users:create") {
        Some(body.max_creates_per_day.unwrap_or(20))
    } else {
        None
    };
    let mut allowed = body.allowed_user_ids;
    if body.all_users == allowed.is_some() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Choose either allUsers=true or explicit allowedUserIds, never both",
        ));
    }
    if let Some(ids) = allowed.as_mut() {
        ids.sort_unstable();
        ids.dedup();
        if ids.is_empty() || ids.len() > 10_000 || ids.iter().any(|id| *id <= 0) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Invalid user access list",
            ));
        }
    }
    let mut raw = [0u8; 32];
    OsRng.fill_bytes(&mut raw);
    let plaintext = format!("{TOKEN_PREFIX}{}", hex::encode(raw));
    let digest = hex::encode(Sha256::digest(plaintext.as_bytes()));
    let mut tx = state.pool.begin().await?;
    let row = sqlx::query(
        "INSERT INTO integration_clients(name) VALUES($1)
         ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name
         RETURNING id, disabled",
    )
    .bind(&body.client_name)
    .fetch_one(&mut *tx)
    .await?;
    let client_id: i64 = row.try_get("id")?;
    if row.try_get::<bool, _>("disabled")? {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "Client is disabled"));
    }
    let issued = sqlx::query(
        "INSERT INTO integration_tokens
         (client_id,label,token_hash,scopes,allowed_user_ids,created_by,expires_at,
          proof_public_key,max_grant_days,max_creates_per_day)
         VALUES($1,$2,$3,$4,$5,$6,NOW()+$7::integer * INTERVAL '1 day',$8,$9,$10)
         RETURNING id,expires_at",
    )
    .bind(client_id)
    .bind(body.label)
    .bind(digest)
    .bind(&scopes)
    .bind(&allowed)
    .bind(admin.id)
    .bind(body.expires_in_days)
    .bind(&proof_key)
    .bind(grant_limit)
    .bind(creates_limit)
    .fetch_one(&mut *tx)
    .await?;
    let token_id: i64 = issued.try_get("id")?;
    tx.commit().await?;
    crate::audit(
        &state.pool,
        &admin.username,
        "integration.token_issued",
        None,
        Some(token_id),
        json!({"clientId":client_id,"scopes":scopes,"allUsers":body.all_users,"senderConstrained":proof_key.is_some(),"maxGrantDays":grant_limit,"maxCreatesPerDay":creates_limit}),
    )
    .await;
    let mut response = Json(json!({
        "token": plaintext,
        "tokenId": token_id,
        "clientId": client_id,
        "scopes": scopes,
        "senderConstrained": proof_key.is_some(),
        "maxGrantDays": grant_limit,
        "maxCreatesPerDay": creates_limit,
        "expiresInDays": body.expires_in_days,
        "shownOnce": true,
        "warning": "Store securely: this credential cannot be displayed again."
    }))
    .into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-store, private"),
    );
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        axum::http::HeaderValue::from_static("no-referrer"),
    );
    Ok(response)
}

pub async fn list_tokens(
    State(state): State<AppState>,
    Extension(admin): Extension<AuthUser>,
) -> Result<Json<Value>, ApiError> {
    crate::require_owner(&admin)?;
    let rows = sqlx::query(
        "SELECT t.id, t.client_id, c.name AS client_name, t.label, t.scopes,
                t.allowed_user_ids, (t.proof_public_key IS NOT NULL) AS sender_constrained,
                t.max_grant_days, t.max_creates_per_day, (t.expires_at <= NOW()) AS expired,
                (t.revoked_at IS NOT NULL) AS revoked
         FROM integration_tokens AS t
         JOIN integration_clients AS c ON c.id=t.client_id
         ORDER BY t.id DESC LIMIT 500",
    )
    .fetch_all(&state.pool)
    .await?;
    let entries = rows.iter().map(|r| json!({
        "id": r.try_get::<i64,_>("id").unwrap_or(0),
        "clientId": r.try_get::<i64,_>("client_id").unwrap_or(0),
        "client": r.try_get::<String,_>("client_name").unwrap_or_default(),
        "label": r.try_get::<String,_>("label").unwrap_or_default(),
        "scopes": r.try_get::<Vec<String>,_>("scopes").unwrap_or_default(),
        "allowedUserIds": r.try_get::<Option<Vec<i64>>,_>("allowed_user_ids").unwrap_or(None),
        "senderConstrained": r.try_get::<bool,_>("sender_constrained").unwrap_or(false),
        "maxGrantDays": r.try_get::<Option<i32>,_>("max_grant_days").unwrap_or(None),
        "maxCreatesPerDay": r.try_get::<Option<i32>,_>("max_creates_per_day").unwrap_or(None),
        "expired": r.try_get::<bool,_>("expired").unwrap_or(true),
        "revoked": r.try_get::<bool,_>("revoked").unwrap_or(true)
    })).collect::<Vec<_>>();
    Ok(Json(json!({"items":entries,"total":entries.len()})))
}

pub async fn revoke_token(
    State(state): State<AppState>,
    Extension(admin): Extension<AuthUser>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(body): Json<RevokeToken>,
) -> Result<Json<Value>, ApiError> {
    crate::require_owner(&admin)?;
    crate::mfa::verify_integrations_step_up(&state, &admin, &headers, &body.mfa_code).await?;
    if id <= 0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid token ID"));
    }
    let result = sqlx::query(
        "UPDATE integration_tokens SET revoked_at=COALESCE(revoked_at,NOW())
         WHERE id=$1 RETURNING client_id",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Token not found"))?;
    let client_id: i64 = result.try_get("client_id")?;
    crate::audit(
        &state.pool,
        &admin.username,
        "integration.token_revoked",
        None,
        Some(id),
        json!({"clientId":client_id}),
    )
    .await;
    Ok(Json(json!({"revoked":true,"tokenId":id})))
}

// Only validated request proofs may spend the per-token budget. A leaked
// Bearer without its signing key must not be able to exhaust this budget.
async fn throttle_token(state: &AppState, token_id: i64) -> Result<(), Problem> {
    let minute = now_ms().div_euclid(60_000);
    let mut redis = state.redis.clone();
    let count: i64 = redis::cmd("EVAL")
        .arg(RATE_SCRIPT)
        .arg(1)
        .arg(format!("xmesh:int:rl:v1:{token_id}:{minute}"))
        .query_async(&mut redis)
        .await
        .map_err(|_|Problem::unavailable())?;
    if count > REDIS_RATE_LIMIT_PER_MINUTE {
        return Err(Problem::new(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Rate limit exceeded",
        ));
    }
    let _ = sqlx::query(
        "UPDATE integration_tokens SET last_used_at=NOW()
         WHERE id=$1 AND (last_used_at IS NULL OR last_used_at<NOW()-INTERVAL '5 minutes')",
    )
    .bind(token_id)
    .execute(&state.pool)
    .await;
    Ok(())
}

pub(super) async fn require_service(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let headers = request.headers().clone();
    match authenticate(&state, &headers).await {
        Ok(principal) => {
            // Proof is checked on the exact wire body and URI before handlers
            // can perform any action. Reject stale/replayed/unsigned requests.
            let mut request = match proof::constrain(
                &state,
                request,
                &principal.token_hash,
                principal.proof_public_key.as_deref(),
                principal.token_id,
            )
            .await
            {
                Ok(request) => request,
                Err(error) => return error.into_response(),
            };
            if let Err(err) = throttle_token(&state, principal.token_id).await {
                return err.into_response();
            }
            request.extensions_mut().insert(principal);
            let mut response = next.run(request).await;
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                axum::http::HeaderValue::from_static("no-store, private"),
            );
            response.headers_mut().insert(
                header::REFERRER_POLICY,
                axum::http::HeaderValue::from_static("no-referrer"),
            );
            response
        }
        Err(err) => err.into_response(),
    }
}

#[expect(
    clippy::too_many_lines,
    reason = "Authentication enforces bearer, browser isolation, rate limits, authorization and token revocation"
)]
async fn authenticate(state: &AppState, headers: &HeaderMap) -> Result<ServicePrincipal, Problem> {
    // A browser cookie or Origin MUST NOT be enough to access this namespace,
    // nor can an integration token be mixed with an authenticated browser request.
    if headers.contains_key(header::COOKIE)
        || headers.contains_key(header::ORIGIN)
        || headers.contains_key("sec-fetch-site")
    {
        return Err(Problem::new(
            StatusCode::FORBIDDEN,
            "browser_request_forbidden",
            "Integration requests must not use browser credentials",
        ));
    }
    let mut values = headers.get_all(header::AUTHORIZATION).iter();
    let raw = values
        .next()
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(|| {
            Problem::new(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Bearer token required",
            )
        })?;
    if values.next().is_some() || !valid_token(raw) {
        return Err(Problem::new(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Invalid bearer token",
        ));
    }
    // Invalid tokens must also be rate-limited before any PostgreSQL work.
    // A per-token limiter alone would be bypassable by random credential spam.
    let minute = now_ms().div_euclid(60_000);
    let mut preflight_redis = state.redis.clone();
    let global = redis::cmd("EVAL")
        .arg(RATE_SCRIPT)
        .arg(1)
        .arg(format!("xmesh:int:rl:global:{minute}"))
        .query_async::<i64>(&mut preflight_redis)
        .await
        .map_err(|_| Problem::unavailable())?;
    if global > 4_000 {
        return Err(Problem::new(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Integration authentication rate limit exceeded",
        ));
    }
    let digest = hex::encode(Sha256::digest(raw.as_bytes()));
    let row = sqlx::query(
        "SELECT t.id, t.client_id, t.scopes, t.allowed_user_ids,
                t.proof_public_key, t.max_grant_days, t.max_creates_per_day, c.name
         FROM integration_tokens AS t
         JOIN integration_clients AS c ON c.id=t.client_id
         WHERE t.token_hash=$1 AND t.revoked_at IS NULL
           AND t.expires_at > NOW() AND NOT c.disabled",
    )
    .bind(&digest)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| Problem::unavailable())?
    .ok_or_else(|| {
        Problem::new(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Invalid bearer token",
        )
    })?;
    // Optional strict cutover after all historical bearer-only tokens have
    // been replaced. Default remains compatible to avoid silently breaking bots.
    let proof_key: Option<Vec<u8>> = row
        .try_get("proof_public_key")
        .map_err(|_| Problem::unavailable())?;
    if proof_key.is_none()
        && std::env::var("XMESH_INTEGRATION_REQUIRE_PROOF").ok().as_deref() == Some("true")
    {
        return Err(Problem::new(
            StatusCode::UNAUTHORIZED,
            "sender_proof_required",
            "Legacy bearer-only integration tokens are disabled",
        ));
    }
    let token_id: i64 = row.try_get("id").map_err(|_| Problem::unavailable())?;
    let client_id: i64 = row
        .try_get("client_id")
        .map_err(|_| Problem::unavailable())?;
    Ok(ServicePrincipal {
        token_id,
        client_id,
        name: row.try_get("name").map_err(|_| Problem::unavailable())?,
        scopes: row.try_get("scopes").map_err(|_| Problem::unavailable())?,
        allowed_user_ids: row
            .try_get("allowed_user_ids")
            .map_err(|_| Problem::unavailable())?,
        proof_public_key: proof_key,
        token_hash: digest,
        max_grant_days: row
            .try_get("max_grant_days")
            .map_err(|_| Problem::unavailable())?,
        max_creates_per_day: row
            .try_get("max_creates_per_day")
            .map_err(|_| Problem::unavailable())?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_opaque_token_format_and_explicit_principal_scope() {
        assert!(valid_token(&format!("{TOKEN_PREFIX}{}", "a".repeat(64))));
        assert!(!valid_token(&format!("{TOKEN_PREFIX}{}", "A".repeat(64))));
        assert!(!valid_token(&format!("{TOKEN_PREFIX}{}", "a".repeat(63))));
        assert!(!valid_token(&format!("{}{}", "xxxx_v1_", "a".repeat(64))));
        assert!(ENABLED_SCOPES.contains(&"entitlements:grant"));
        assert!(!ENABLED_SCOPES.contains(&"system:update"));
    }
}
