use crate::{ApiError, AppState};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const SESSION_COOKIE: &str = "xmesh_session";
const SESSION_SECONDS: i64 = 12 * 60 * 60;

#[derive(Debug, Clone, serde::Serialize)]
pub struct AuthUser {
    pub id: i64,
    pub username: String,
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

pub async fn seed_bootstrap_admin(pool: &PgPool, username: &str, password: &str) -> anyhow::Result<()> {
    if username.trim().is_empty() || username.len() > 128 {
        anyhow::bail!("ADMIN_USERNAME must contain 1 to 128 characters");
    }
    if password.len() < 16 {
        anyhow::bail!("ADMIN_PASSWORD must be at least 16 characters; run ./install.sh to generate a secure one");
    }

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM panel_auth_users")
        .fetch_one(pool)
        .await?;
    if count > 0 {
        return Ok(());
    }

    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|error| anyhow::anyhow!("Could not hash bootstrap administrator password: {error}"))?
        .to_string();
    sqlx::query(
        "INSERT INTO panel_auth_users (username, password_hash) VALUES ($1, $2) \
         ON CONFLICT DO NOTHING",
    )
    .bind(username.trim())
    .bind(password_hash)
    .execute(pool)
    .await?;
    tracing::info!("Bootstrap administrator account check completed");
    Ok(())
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<(StatusCode, HeaderMap, Json<Value>), ApiError> {
    if body.username.len() > 128 || body.password.len() > 1024 {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Неверный логин или пароль."));
    }
    let username_key = body.username.trim().to_lowercase();
    if username_key.is_empty() {
        record_failed_login(&state, &username_key).await?;
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Неверный логин или пароль."));
    }
    let mut redis_conn = state.redis.clone();
    let redis_attempts = redis::cmd("GET")
        .arg(format!("xmesh:auth:login:{username_key}"))
        .query_async::<Option<i64>>(&mut redis_conn)
        .await
        .unwrap_or(None)
        .unwrap_or(0);
    let db_locked: bool = sqlx::query_scalar(
        "SELECT COALESCE((SELECT locked_until > NOW() FROM auth_login_limits WHERE username_key = $1), FALSE)",
    )
    .bind(&username_key)
    .fetch_one(&state.pool)
    .await?;
    let locked = redis_attempts >= 8 || db_locked;
    if locked {
        return Err(ApiError::new(StatusCode::TOO_MANY_REQUESTS, "Слишком много попыток. Повторите вход через 15 минут."));
    }
    let row = sqlx::query(
        "SELECT id, username, role, password_hash, is_active \
         FROM panel_auth_users WHERE LOWER(username) = LOWER($1) LIMIT 1",
    )
    .bind(body.username.trim())
    .fetch_optional(&state.pool)
    .await?;

    let Some(row) = row else {
        if locked {
            return Err(ApiError::new(StatusCode::TOO_MANY_REQUESTS, "Слишком много попыток. Повторите вход через 15 минут."));
        }
        record_failed_login(&state, &username_key).await?;
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Неверный логин или пароль."));
    };
    let admin_id: i64 = row.try_get("id")?;
    let username: String = row.try_get("username")?;
    let role: String = row.try_get("role")?;
    let password_hash: String = row.try_get("password_hash")?;
    let is_active: bool = row.try_get("is_active")?;

    let parsed_hash = PasswordHash::new(&password_hash)
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Не удалось проверить пароль."))?;
    let verified = Argon2::default().verify_password(body.password.as_bytes(), &parsed_hash).is_ok();
    if !is_active || !verified {
        if locked {
            return Err(ApiError::new(StatusCode::TOO_MANY_REQUESTS, "Слишком много попыток. Повторите вход через 15 минут."));
        }
        record_failed_login(&state, &username_key).await?;
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Неверный логин или пароль."));
    }
    if crate::mfa::enabled(&state,admin_id).await? {
        let challenge=crate::mfa::new_challenge(&state,admin_id).await?;
        return Ok((StatusCode::OK,HeaderMap::new(),Json(json!({
            "mfaRequired":true,"challenge":challenge
        }))));
    }
    clear_failed_login(&state,&username_key).await?;
    issue_session(&state,admin_id,&username,&role).await
}

pub(crate) async fn is_rate_limited(state:&AppState,username_key:&str)->Result<bool,ApiError>{
    let mut conn=state.redis.clone();
    let count=redis::cmd("GET").arg(format!("xmesh:auth:login:{username_key}"))
        .query_async::<Option<i64>>(&mut conn).await.unwrap_or(None).unwrap_or(0);
    let locked:bool=sqlx::query_scalar(
        "SELECT COALESCE((SELECT locked_until>NOW() FROM auth_login_limits WHERE username_key=$1),FALSE)"
    ).bind(username_key).fetch_one(&state.pool).await?;
    Ok(count>=8 || locked)
}

pub(crate) async fn clear_failed_login(state:&AppState,username_key:&str)->Result<(),ApiError>{
    sqlx::query("DELETE FROM auth_login_limits WHERE username_key = $1")
        .bind(username_key)
        .execute(&state.pool)
        .await?;
    let mut redis_conn = state.redis.clone();
    let _ = redis::cmd("DEL")
        .arg(format!("xmesh:auth:login:{username_key}"))
        .query_async::<i64>(&mut redis_conn)
        .await;

    Ok(())
}

pub(crate) async fn issue_session(
    state:&AppState,admin_id:i64,username:&str,role:&str,
)->Result<(StatusCode,HeaderMap,Json<Value>),ApiError>{
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let token_hash = hash_token(&token);
    sqlx::query("DELETE FROM panel_sessions WHERE expires_at < NOW()")
        .execute(&state.pool)
        .await?;
    sqlx::query(
        "INSERT INTO panel_sessions (token_hash, admin_id, expires_at) \
         VALUES ($1, $2, NOW() + INTERVAL '12 hours')",
    )
    .bind(token_hash)
    .bind(admin_id)
    .execute(&state.pool)
    .await?;
    sqlx::query("UPDATE panel_auth_users SET last_login_at = NOW() WHERE id = $1")
        .bind(admin_id)
        .execute(&state.pool)
        .await?;

    let mut headers = HeaderMap::new();
    headers.insert(
        header::SET_COOKIE,
        make_session_cookie(&token, state.cookie_secure)
            .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Не удалось создать сессию."))?,
    );
    Ok((
        StatusCode::OK,
        headers,
        Json(json!({"authenticated": true, "user": {"id": admin_id, "username": username, "role": role}})),
    ))
}

pub(crate) async fn record_failed_login(state: &AppState, username_key: &str) -> Result<(), ApiError> {
    // Redis provides cross-instance throttling; PostgreSQL remains the durable fallback.
    let mut redis_conn = state.redis.clone();
    let redis_key = format!("xmesh:auth:login:{username_key}");
    if let Ok(attempts) = redis::cmd("INCR")
        .arg(&redis_key)
        .query_async::<i64>(&mut redis_conn)
        .await
        && attempts == 1
    {
        let _ = redis::cmd("EXPIRE")
            .arg(&redis_key)
            .arg(900)
            .query_async::<i64>(&mut redis_conn)
            .await;
    }

    sqlx::query(
        "INSERT INTO auth_login_limits (username_key, attempts, window_started_at, locked_until) \
         VALUES ($1, 1, NOW(), NULL) \
         ON CONFLICT (username_key) DO UPDATE SET \
           attempts = CASE WHEN auth_login_limits.window_started_at < NOW() - INTERVAL '15 minutes' \
                           THEN 1 ELSE auth_login_limits.attempts + 1 END, \
           window_started_at = CASE WHEN auth_login_limits.window_started_at < NOW() - INTERVAL '15 minutes' \
                                     THEN NOW() ELSE auth_login_limits.window_started_at END, \
           locked_until = CASE WHEN (CASE WHEN auth_login_limits.window_started_at < NOW() - INTERVAL '15 minutes' \
                                          THEN 1 ELSE auth_login_limits.attempts + 1 END) >= 8 \
                               THEN NOW() + INTERVAL '15 minutes' ELSE NULL END",
    )
    .bind(username_key)
    .execute(&state.pool)
    .await?;
    Ok(())
}

pub async fn is_authenticated(state: &AppState, headers: &HeaderMap) -> bool {
    user_from_headers(state, headers).await.is_some()
}

pub async fn session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    if let Some(user) = user_from_headers(&state, &headers).await {
        Ok(Json(json!({"authenticated": true, "user": user})))
    } else {
        Ok(Json(json!({"authenticated": false})))
    }
}

pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<(StatusCode, HeaderMap, Json<Value>), ApiError> {
    if let Some(token) = cookie_token(&headers) {
        sqlx::query("DELETE FROM panel_sessions WHERE token_hash = $1")
            .bind(hash_token(&token))
            .execute(&state.pool)
            .await?;
    }
    let mut headers_out = HeaderMap::new();
    headers_out.insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&format!(
            "{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{}",
            if state.cookie_secure { "; Secure" } else { "" }
        ))
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Не удалось завершить сессию."))?,
    );
    Ok((StatusCode::OK, headers_out, Json(json!({"authenticated": false}))))
}

pub async fn require_session(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let headers = request.headers().clone();
    match user_from_headers(&state, &headers).await {
        Some(user) => {
            request.extensions_mut().insert(user);
            next.run(request).await
        }
        None => (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Сессия истекла. Войдите снова."})),
        )
            .into_response(),
    }
}

async fn user_from_headers(state: &AppState, headers: &HeaderMap) -> Option<AuthUser> {
    let token = cookie_token(headers)?;
    let row = sqlx::query(
        "SELECT a.id, a.username, a.role \
         FROM panel_sessions s \
         JOIN panel_auth_users a ON a.id = s.admin_id \
         WHERE s.token_hash = $1 AND s.expires_at > NOW() AND a.is_active = TRUE",
    )
    .bind(hash_token(&token))
    .fetch_optional(&state.pool)
    .await
    .ok()??;
    Some(AuthUser {
        id: row.try_get("id").ok()?,
        username: row.try_get("username").ok()?,
        role: row.try_get("role").ok()?,
    })
}

pub(crate) fn session_token_hash(headers:&HeaderMap)->Option<String>{
    cookie_token(headers).map(|token| hash_token(&token))
}
fn cookie_token(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    let value = raw
        .split(';')
        .map(str::trim)
        .find_map(|part| part.strip_prefix(&format!("{SESSION_COOKIE}=")))?;
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(value.to_owned())
}

fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

fn make_session_cookie(token: &str, secure: bool) -> Result<HeaderValue, axum::http::header::InvalidHeaderValue> {
    HeaderValue::from_str(&format!(
        "{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_SECONDS}{}",
        if secure { "; Secure" } else { "" }
    ))
}
