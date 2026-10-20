mod auth;
mod core;

use axum::{
    extract::{Extension, Path, Request, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri},
    middleware::{self, Next},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, patch, post},
    Json, Router,
};
use core::CoreManager;
use redis::aio::ConnectionManager;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use std::{collections::BTreeMap, env, path::PathBuf, time::Duration};
use tower_http::{
    compression::CompressionLayer,
    limit::RequestBodyLimitLayer,
    services::ServeDir,
    trace::TraceLayer,
};

const COLLECTIONS: &[&str] = &[
    "users", "nodes", "profiles", "hosts", "squads", "tpls", "subs", "admins", "tokens", "srh",
];

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub redis: ConnectionManager,
    pub core: CoreManager,
    pub cookie_secure: bool,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self { status, message: message.into() }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        tracing::error!(error = %error, "Database operation failed");
        if let sqlx::Error::Database(db_error) = &error
            && db_error.code().as_deref() == Some("23505")
        {
            return Self::new(StatusCode::CONFLICT, "Запись с такими данными уже существует.");
        }
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "Внутренняя ошибка API.")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({"error": self.message}))).into_response()
    }
}

#[derive(Debug, Deserialize)]
struct CoreUpdateRequest {
    version: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,tower_http=info,sqlx=warn")),
        )
        .json()
        .init();

    let database_url = env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?;
    let pool = PgPoolOptions::new()
        .max_connections(env::var("DB_MAX_CONNECTIONS").ok().and_then(|v| v.parse().ok()).unwrap_or(20))
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(10))
        .idle_timeout(Duration::from_secs(600))
        .max_lifetime(Duration::from_secs(1800))
        .connect(&database_url)
        .await?;

    let redis_url = env::var("REDIS_URL").map_err(|_| anyhow::anyhow!("REDIS_URL is required"))?;
    let redis_client = redis::Client::open(redis_url)?;
    let redis: ConnectionManager = redis_client.get_connection_manager().await?;
    let mut redis_probe = redis.clone();
    let redis_ping: String = redis::cmd("PING").query_async(&mut redis_probe).await?;
    anyhow::ensure!(redis_ping == "PONG", "Redis readiness probe failed");

    sqlx::migrate!("./migrations").run(&pool).await?;

    let admin_username = env::var("ADMIN_USERNAME").unwrap_or_else(|_| "admin".to_owned());
    let admin_password = env::var("ADMIN_PASSWORD")
        .map_err(|_| anyhow::anyhow!("ADMIN_PASSWORD is required; run ./install.sh"))?;
    auth::seed_bootstrap_admin(&pool, &admin_username, &admin_password).await?;

    let cookie_secure = env::var("COOKIE_SECURE")
        .map(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(true);
    let core_dir = PathBuf::from(
        env::var("CORE_DATA_DIR").unwrap_or_else(|_| "/var/lib/xmesh/core".to_owned()),
    );
    let core = CoreManager::new(pool.clone(), core_dir).await?;
    let state = AppState { pool, redis, core, cookie_secure };
    state.core.launch_startup_update().await;

    let protected = Router::new()
        .route("/bootstrap", get(bootstrap))
        .route("/settings", get(get_settings).patch(patch_settings))
        .route("/stats", get(get_stats))
        .route("/system/stats", get(get_system_stats))
        .route("/collections/{collection}", get(list_records).post(create_record))
        .route("/collections/{collection}/{id}", patch(update_record).delete(delete_record))
        .route("/core", get(get_core_status))
        .route("/core/releases", get(get_core_releases))
        .route("/core/update", post(update_core))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::require_session));

    let public = Router::new()
        .route("/health/live", get(health_live))
        .route("/health/ready", get(health_ready))
        .route("/auth/session", get(auth::session))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout));

    let static_dir = env::var("STATIC_DIR").unwrap_or_else(|_| "/app/static".to_owned());
    let app = Router::new()
        .route("/", get(panel_entry))
        .route("/index.html", get(index_redirect))
        .route("/login", get(login_page))
        .nest("/api/v1", public.merge(protected))
        .fallback_service(ServeDir::new(static_dir).append_index_html_on_directories(true))
        .layer(RequestBodyLimitLayer::new(2 * 1024 * 1024))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(middleware::from_fn(security_headers))
        .layer(middleware::from_fn(csrf_guard))
        .with_state(state);

    let address = env::var("APP_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_owned());
    let listener = tokio::net::TcpListener::bind(&address).await?;
    tracing::info!(address = %address, "XMesh Nexus API ready");
    axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await?;
    Ok(())
}

async fn panel_entry(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !auth::is_authenticated(&state, &headers).await {
        return Redirect::to("/login").into_response();
    }
    let static_dir = env::var("STATIC_DIR").unwrap_or_else(|_| "/app/static".to_owned());
    match tokio::fs::read_to_string(PathBuf::from(static_dir).join("index.html")).await {
        Ok(page) => Html(page).into_response(),
        Err(error) => {
            tracing::error!(error = %error, "Could not read panel entry page");
            (StatusCode::INTERNAL_SERVER_ERROR, "Panel assets unavailable").into_response()
        }
    }
}

async fn index_redirect() -> Redirect {
    Redirect::to("/")
}

async fn login_page(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if auth::is_authenticated(&state, &headers).await {
        return Redirect::to("/").into_response();
    }
    let static_dir = env::var("STATIC_DIR").unwrap_or_else(|_| "/app/static".to_owned());
    match tokio::fs::read_to_string(PathBuf::from(static_dir).join("login.html")).await {
        Ok(page) => Html(page).into_response(),
        Err(error) => {
            tracing::error!(error = %error, "Could not read login page");
            (StatusCode::INTERNAL_SERVER_ERROR, "Login page unavailable").into_response()
        }
    }
}

async fn csrf_guard(request: Request, next: Next) -> Response {
    let is_mutation = matches!(*request.method(), Method::POST | Method::PUT | Method::PATCH | Method::DELETE);
    if is_mutation && request.uri().path().starts_with("/api/v1/") {
        let origin = request.headers().get(header::ORIGIN).and_then(|value| value.to_str().ok());
        let host = request.headers().get(header::HOST).and_then(|value| value.to_str().ok());
        let valid = origin
            .and_then(|value| value.parse::<Uri>().ok())
            .and_then(|uri| uri.authority().map(|authority| authority.as_str().to_ascii_lowercase()))
            .zip(host.map(str::to_ascii_lowercase))
            .is_some_and(|(origin_authority, request_host)| origin_authority == request_host);
        if !valid {
            return (StatusCode::FORBIDDEN, Json(json!({"error": "Запрос отклонён проверкой источника."}))).into_response();
        }
    }
    next.run(request).await
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("Graceful shutdown requested");
}

async fn security_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(HeaderName::from_static("x-content-type-options"), HeaderValue::from_static("nosniff"));
    headers.insert(HeaderName::from_static("cache-control"), HeaderValue::from_static("no-store"));
    headers.insert(HeaderName::from_static("x-frame-options"), HeaderValue::from_static("DENY"));
    headers.insert(HeaderName::from_static("referrer-policy"), HeaderValue::from_static("same-origin"));
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    response
}

async fn health_live() -> Json<Value> {
    Json(json!({"status": "ok"}))
}

async fn health_ready(State(state): State<AppState>) -> impl IntoResponse {
    let database_ok = sqlx::query("SELECT 1").execute(&state.pool).await.is_ok();
    let mut redis = state.redis.clone();
    let redis_ok = redis::cmd("PING").query_async::<String>(&mut redis).await
        .is_ok_and(|reply| reply == "PONG");
    if database_ok && redis_ok {
        (StatusCode::OK, Json(json!({
            "status": "ready",
            "dependencies": {"postgresql": "online", "redis": "online"}
        })))
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "status": "not_ready",
                "dependencies": {
                    "postgresql": if database_ok { "online" } else { "offline" },
                    "redis": if redis_ok { "online" } else { "offline" }
                }
            })),
        )
    }
}

async fn bootstrap(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let mut collections = Map::new();
    for collection in COLLECTIONS {
        collections.insert(
            (*collection).to_owned(),
            Value::Array(load_records(&state.pool, collection).await?),
        );
    }
    let settings = read_settings(&state.pool).await?;
    Ok(Json(json!({
        "collections": collections,
        "settings": settings,
        "persistence": "postgresql"
    })))
}

async fn list_records(
    State(state): State<AppState>,
    Path(collection): Path<String>,
) -> Result<Json<Value>, ApiError> {
    validate_collection(&collection)?;
    let items = load_records(&state.pool, &collection).await?;
    let ids = items.iter().filter_map(|item| item.get("id").cloned()).collect::<Vec<_>>();
    let total = items.len();
    Ok(Json(json!({"items": items, "ids": ids, "total": total})))
}

async fn create_record(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Path(collection): Path<String>,
    Json(mut data): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    validate_collection(&collection)?;
    data.as_object_mut().ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Запись должна быть JSON-объектом."))?
        .remove("id");
    validate_record(&collection, &data)?;

    let row = sqlx::query(
        "INSERT INTO panel_records (collection, data) VALUES ($1, $2) RETURNING id, data",
    )
    .bind(&collection)
    .bind(data)
    .fetch_one(&state.pool)
    .await?;
    let result = row_to_record(&row)?;
    let record_id = result.get("id").and_then(Value::as_i64);
    audit(&state.pool, &actor.username, "create", Some(&collection), record_id, json!({})).await;
    Ok((StatusCode::CREATED, Json(result)))
}

async fn update_record(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Path((collection, id)): Path<(String, i64)>,
    Json(mut patch): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    validate_collection(&collection)?;
    let patch_object = patch.as_object_mut()
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Обновление должно быть JSON-объектом."))?;
    patch_object.remove("id");

    let existing = sqlx::query("SELECT data FROM panel_records WHERE collection = $1 AND id = $2")
        .bind(&collection)
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Запись не найдена."))?;
    let mut data: Value = existing.try_get("data")?;
    let object = data.as_object_mut()
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Повреждён формат записи."))?;
    for (key, value) in patch_object.clone() {
        object.insert(key, value);
    }
    validate_record(&collection, &data)?;

    let row = sqlx::query(
        "UPDATE panel_records SET data = $3, updated_at = NOW() \
         WHERE collection = $1 AND id = $2 RETURNING id, data",
    )
    .bind(&collection)
    .bind(id)
    .bind(data)
    .fetch_one(&state.pool)
    .await?;
    let result = row_to_record(&row)?;
    audit(&state.pool, &actor.username, "update", Some(&collection), Some(id), json!({})).await;
    Ok(Json(result))
}

async fn delete_record(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Path((collection, id)): Path<(String, i64)>,
) -> Result<Json<Value>, ApiError> {
    validate_collection(&collection)?;
    let row = sqlx::query(
        "DELETE FROM panel_records WHERE collection = $1 AND id = $2 RETURNING id, data",
    )
    .bind(&collection)
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Запись не найдена."))?;
    let result = row_to_record(&row)?;
    audit(&state.pool, &actor.username, "delete", Some(&collection), Some(id), json!({})).await;
    Ok(Json(result))
}

async fn get_settings(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(read_settings(&state.pool).await?))
}

async fn patch_settings(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Json(patch): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let object = patch.as_object()
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Настройки должны быть JSON-объектом."))?;
    for key in object.keys() {
        if !matches!(key.as_str(), "brand" | "domain" | "hooks") {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, format!("Неизвестное поле настроек: {key}")));
        }
    }
    if let Some(brand) = object.get("brand") {
        let value = brand.as_str().ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Название панели должно быть строкой."))?;
        if value.trim().is_empty() || value.chars().count() > 80 {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "Название панели должно содержать от 1 до 80 символов."));
        }
    }
    if let Some(domain) = object.get("domain") {
        let value = domain.as_str().ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Домен должен быть строкой."))?;
        if value.chars().count() > 253 || value.chars().any(char::is_whitespace) {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "Указан некорректный домен."));
        }
    }
    if let Some(hooks) = object.get("hooks") {
        let hooks = hooks.as_object().ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Вебхуки должны быть объектом."))?;
        let allowed = [
            "user.created", "user.limited", "user.expired",
            "user.expires_in_24_hours", "user.first_connected",
            "user.bandwidth_usage_threshold_reached",
        ];
        for (key, value) in hooks {
            if !allowed.contains(&key.as_str())
                || !(value.is_boolean() || value.as_i64().is_some_and(|n| n == 0 || n == 1))
            {
                return Err(ApiError::new(StatusCode::BAD_REQUEST, "Недопустимый параметр вебхука."));
            }
        }
    }

    let row = sqlx::query(
        "INSERT INTO app_settings (key, value) VALUES ('panel', $1) \
         ON CONFLICT (key) DO UPDATE \
         SET value = app_settings.value || EXCLUDED.value, updated_at = NOW() \
         RETURNING value",
    )
    .bind(patch)
    .fetch_one(&state.pool)
    .await?;
    let settings: Value = row.try_get("value")?;
    audit(&state.pool, &actor.username, "settings.update", None, None, json!({})).await;
    Ok(Json(settings))
}

async fn get_stats(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let users = load_records(&state.pool, "users").await?;
    let nodes = load_records(&state.pool, "nodes").await?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let mut by = BTreeMap::<String, usize>::new();
    for user in &users {
        *by.entry(user_status(user, now_ms).to_owned()).or_default() += 1;
    }
    let online = users.iter().filter(|user| {
        user_status(user, now_ms) == "ACTIVE" &&
            number(user, "onlineAt").is_some_and(|last| last > now_ms - 300_000)
    }).count();
    let mut node_on = Map::new();
    let mut n_on = 0usize;
    for node in &nodes {
        if node.get("disabled").and_then(Value::as_bool) != Some(true)
            && node.get("state").and_then(Value::as_str) == Some("ONLINE")
        {
            n_on += 1;
            node_on.insert(
                node.get("id").map(|id| id.to_string()).unwrap_or_default(),
                json!(0),
            );
        }
    }
    Ok(Json(json!({
        "by": by,
        "total": users.len(),
        "online": online,
        "conn": null,
        "nodeOn": node_on,
        "nOn": n_on,
        "nAll": nodes.len()
    })))
}


async fn get_system_stats(State(state): State<AppState>) -> Json<Value> {
    let cpu_before = read_cpu_ticks().await;
    tokio::time::sleep(Duration::from_millis(220)).await;
    let cpu_after = read_cpu_ticks().await;
    let cpu = match (cpu_before, cpu_after) {
        (Some(before), Some(after)) => {
            let total_delta = after.0.saturating_sub(before.0);
            let idle_delta = after.1.saturating_sub(before.1);
            if total_delta > 0 {
                Some(((total_delta.saturating_sub(idle_delta)) as f64 * 100.0 / total_delta as f64).clamp(0.0, 100.0))
            } else { None }
        }
        _ => None,
    };

    let meminfo = tokio::fs::read_to_string("/proc/meminfo").await.unwrap_or_default();
    let mem_value = |key: &str| -> u64 {
        meminfo.lines().find_map(|line| {
            let mut parts = line.split_whitespace();
            if parts.next()? != key { return None; }
            parts.next()?.parse::<u64>().ok().map(|kb| kb.saturating_mul(1024))
        }).unwrap_or(0)
    };
    let ram_total = mem_value("MemTotal:");
    let ram_available = mem_value("MemAvailable:").min(ram_total);
    let ram_used = ram_total.saturating_sub(ram_available);
    let ram_percent = if ram_total > 0 { Some(ram_used as f64 * 100.0 / ram_total as f64) } else { None };

    let disk = tokio::process::Command::new("df")
        .args(["-B1", "-P", "/"])
        .output().await.ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|output| output.lines().nth(1).map(str::to_owned))
        .and_then(|line| {
            let cols = line.split_whitespace().collect::<Vec<_>>();
            if cols.len() < 6 { return None; }
            let total = cols[1].parse::<u64>().ok()?;
            let used = cols[2].parse::<u64>().ok()?;
            let available = cols[3].parse::<u64>().ok()?;
            Some(json!({
                "totalBytes": total, "usedBytes": used, "availableBytes": available,
                "percent": if total > 0 { Some(used as f64 * 100.0 / total as f64) } else { None },
                "mount": cols[5]
            }))
        });

    let uptime_seconds = tokio::fs::read_to_string("/proc/uptime").await.ok()
        .and_then(|s| s.split_whitespace().next()?.parse::<f64>().ok())
        .map(|seconds| seconds as u64);
    let load = tokio::fs::read_to_string("/proc/loadavg").await.unwrap_or_default();
    let loads = load.split_whitespace().take(3).filter_map(|v| v.parse::<f64>().ok()).collect::<Vec<_>>();
    let process_count = match tokio::fs::read_dir("/proc").await {
        Ok(mut entries) => {
            let mut count = 0u64;
            while let Ok(Some(entry)) = entries.next_entry().await {
                if entry.file_name().to_string_lossy().parse::<u32>().is_ok() { count += 1; }
            }
            Some(count)
        }
        Err(_) => None,
    };
    let db_status = if sqlx::query("SELECT 1").execute(&state.pool).await.is_ok() { "online" } else { "offline" };
    let sampled_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_millis() as u64;

    Json(json!({
        "cpu": {"percent": cpu},
        "ram": {"totalBytes": ram_total, "usedBytes": ram_used, "availableBytes": ram_available, "percent": ram_percent},
        "disk": disk,
        "uptimeSeconds": uptime_seconds,
        "loadAverage": {"one": loads.first(), "five": loads.get(1), "fifteen": loads.get(2)},
        "processCount": process_count,
        "database": db_status,
        "sampledAt": sampled_at,
        "scope": "Ресурсы, видимые контейнеру панели; диск — корневая файловая система контейнера"
    }))
}

async fn read_cpu_ticks() -> Option<(u64, u64)> {
    let stat = tokio::fs::read_to_string("/proc/stat").await.ok()?;
    let line = stat.lines().find(|line| line.starts_with("cpu "))?;
    let values = line.split_whitespace().skip(1).take(8).filter_map(|value| value.parse::<u64>().ok()).collect::<Vec<_>>();
    if values.len() < 4 { return None; }
    let total = values.iter().copied().fold(0u64, u64::saturating_add);
    let idle = values[3].saturating_add(*values.get(4).unwrap_or(&0));
    Some((total, idle))
}

async fn get_core_status(State(state): State<AppState>) -> Json<core::CoreStatus> {
    Json(state.core.status().await)
}

async fn get_core_releases(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let releases = state.core.available_releases().await
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;
    Ok(Json(json!({"items": releases})))
}

async fn update_core(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Json(body): Json<CoreUpdateRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let target = state.core.set_desired_version(&body.version).await
        .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error))?;
    audit(&state.pool, &actor.username, "xray_core.update_requested", None, None, json!({"version": target})).await;

    let manager = state.core.clone();
    tokio::spawn(async move {
        if let Err(error) = manager.install_or_update(target).await {
            tracing::warn!(error = %error, "Requested Xray-core update failed");
        }
    });
    Ok((StatusCode::ACCEPTED, Json(json!({
        "status": "updating",
        "message": "Обновление Xray-core запущено."
    }))))
}

async fn read_settings(pool: &PgPool) -> Result<Value, ApiError> {
    Ok(sqlx::query_scalar::<_, Value>("SELECT value FROM app_settings WHERE key = 'panel'")
        .fetch_optional(pool)
        .await?
        .unwrap_or_else(|| json!({
            "brand":"XMesh Nexus",
            "domain":"",
            "hooks": {
                "user.created":0,
                "user.limited":0,
                "user.expired":0,
                "user.expires_in_24_hours":0,
                "user.first_connected":0,
                "user.bandwidth_usage_threshold_reached":0
            }
        })))
}

async fn load_records(pool: &PgPool, collection: &str) -> Result<Vec<Value>, ApiError> {
    validate_collection(collection)?;
    let rows = sqlx::query("SELECT id, data FROM panel_records WHERE collection = $1 ORDER BY id")
        .bind(collection)
        .fetch_all(pool)
        .await?;
    rows.iter().map(row_to_record).collect()
}

fn row_to_record(row: &sqlx::postgres::PgRow) -> Result<Value, ApiError> {
    let id: i64 = row.try_get("id")?;
    let mut data: Value = row.try_get("data")?;
    let object = data.as_object_mut()
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Повреждён формат записи."))?;
    object.insert("id".to_owned(), json!(id));
    Ok(data)
}

fn validate_collection(collection: &str) -> Result<(), ApiError> {
    if COLLECTIONS.contains(&collection) {
        Ok(())
    } else {
        Err(ApiError::new(StatusCode::NOT_FOUND, "Неизвестная коллекция."))
    }
}

fn validate_record(collection: &str, data: &Value) -> Result<(), ApiError> {
    let object = data.as_object()
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Запись должна быть JSON-объектом."))?;
    if collection == "users" {
        let username = object.get("username").and_then(Value::as_str)
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Имя пользователя обязательно."))?;
        if username.trim().is_empty() || username.chars().count() > 128 || username.chars().any(char::is_control) {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "Некорректное имя пользователя."));
        }
    }
    if collection == "profiles" {
        let config = object.get("config").and_then(Value::as_str)
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Конфигурация Xray обязательна."))?;
        let parsed: Value = serde_json::from_str(config)
            .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Конфигурация Xray содержит некорректный JSON."))?;
        let inbounds = parsed.get("inbounds").and_then(Value::as_array)
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "В конфигурации Xray должен быть массив inbounds."))?;
        if inbounds.is_empty() {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "В конфигурации Xray должен быть хотя бы один inbound."));
        }
        let mut tags = std::collections::HashSet::new();
        for inbound in inbounds {
            let tag = inbound.get("tag").and_then(Value::as_str)
                .filter(|tag| !tag.trim().is_empty())
                .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "У каждого inbound должен быть tag."))?;
            if !tags.insert(tag) {
                return Err(ApiError::new(StatusCode::BAD_REQUEST, "Теги inbounds должны быть уникальными."));
            }
        }
    }
    Ok(())
}

fn user_status(user: &Value, now_ms: i64) -> &'static str {
    if user.get("disabled").and_then(Value::as_bool) == Some(true) {
        return "DISABLED";
    }
    if user.get("hold").and_then(Value::as_bool) == Some(true) {
        return "ON_HOLD";
    }
    let limit = number(user, "limit").unwrap_or(0);
    let used = number(user, "used").unwrap_or(0);
    if limit > 0 && used >= limit {
        return "LIMITED";
    }
    let expire_at = number(user, "expireAt").unwrap_or(0);
    if expire_at > 0 && expire_at < now_ms {
        return "EXPIRED";
    }
    "ACTIVE"
}

fn number(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_i64)
        .or_else(|| value.get(key).and_then(Value::as_f64).map(|number| number as i64))
}

async fn audit(
    pool: &PgPool,
    actor: &str,
    action: &str,
    collection: Option<&str>,
    record_id: Option<i64>,
    detail: Value,
) {
    if let Err(error) = sqlx::query(
        "INSERT INTO panel_audit_log (actor, action, collection, record_id, detail) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(actor)
    .bind(action)
    .bind(collection)
    .bind(record_id)
    .bind(detail)
    .execute(pool)
    .await
    {
        tracing::warn!(error = %error, "Could not append audit event");
    }
}

#[cfg(test)]
mod tests {
    use super::{number, user_status};
    use serde_json::json;

    #[test]
    fn user_status_rules_match_panel_contract() {
        let now = 1_800_000_000_000_i64;
        assert_eq!(user_status(&json!({"disabled":true}), now), "DISABLED");
        assert_eq!(user_status(&json!({"hold":true}), now), "ON_HOLD");
        assert_eq!(user_status(&json!({"limit":10,"used":10}), now), "LIMITED");
        assert_eq!(user_status(&json!({"expireAt":now-1}), now), "EXPIRED");
        assert_eq!(user_status(&json!({"limit":0,"used":500}), now), "ACTIVE");
    }

    #[test]
    fn numeric_json_fields_are_read_safely() {
        assert_eq!(number(&json!({"used":12}), "used"), Some(12));
        assert_eq!(number(&json!({"used":12.5}), "used"), Some(12));
        assert_eq!(number(&json!({}), "used"), None);
    }
}
