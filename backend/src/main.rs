mod admin_accounts;
mod auth;
mod client_routing;
mod core;
mod mfa;
mod node_auth;
mod node_enrollment;
mod node_geodata;
mod node_policy;
mod node_rotation;
mod node_routing;
mod node_runtime;

mod protocol_credentials;
mod security;
mod subscription_finalmask;
mod subscription_json;
mod subscription_settings;
mod subscription_transport;
mod subscription_user_agent;
mod user_subscriptions;
#[cfg(feature = "xsp-v2-experimental")]
mod xsp_v2_api;
#[cfg(feature = "xsp-v2-experimental")]
mod xsp_v2_enrollment;

#[cfg(test)]
mod xsp_v2_wire_tests;

use axum::{
    Json, Router,
    body::Bytes,
    extract::{Extension, Path, Query, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
};
use core::CoreManager;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use std::{collections::BTreeMap, env, path::PathBuf, time::Duration};
use tower_http::{
    compression::CompressionLayer, limit::RequestBodyLimitLayer, services::ServeDir,
    trace::TraceLayer,
};

// Recent verified Xray traffic, not a live TCP-session count.
const USER_ONLINE_WINDOW_MS: i64 = 45_000;

const COLLECTIONS: &[&str] = &[
    "users", "nodes", "profiles", "hosts", "squads", "tpls", "subs", "admins", "tokens", "srh",
];

/// Roles are re-read from SQL for each request; changing or disabling an admin
/// invalidates their sessions. Never trust role fields from the browser.
fn require_mutation(actor: &auth::AuthUser) -> Result<(), ApiError> {
    if matches!(actor.role.as_str(), "owner" | "admin") {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Недостаточно прав: доступ только для чтения.",
        ))
    }
}

fn require_owner(actor: &auth::AuthUser) -> Result<(), ApiError> {
    admin_accounts::require_owner(actor)
}

fn enforce_collection(
    actor: &auth::AuthUser,
    collection: &str,
    write: bool,
) -> Result<(), ApiError> {
    if matches!(collection, "admins" | "tokens") {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Используйте защищённый раздел администраторов. API-токены пока не реализованы.",
        ));
    }
    if write {
        return require_mutation(actor);
    }
    if viewer_read_only(actor) && !viewer_can_read_collection(collection) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Недостаточно прав для просмотра раздела.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod authorization_tests {
    use super::*;
    #[test]
    fn viewers_cannot_mutate_collections_or_sensitive_operations() {
        let viewer = auth::AuthUser {
            id: 3,
            username: "viewer".into(),
            role: "viewer".into(),
        };
        let admin = auth::AuthUser {
            id: 2,
            username: "admin".into(),
            role: "admin".into(),
        };
        let owner = auth::AuthUser {
            id: 1,
            username: "owner".into(),
            role: "owner".into(),
        };
        assert!(require_mutation(&viewer).is_err());
        assert!(require_mutation(&admin).is_ok());
        assert!(require_mutation(&owner).is_ok());
        assert!(require_owner(&viewer).is_err());
        assert!(require_owner(&admin).is_err());
        assert!(require_owner(&owner).is_ok());
        assert!(enforce_collection(&viewer, "users", false).is_ok());
        assert!(enforce_collection(&viewer, "users", true).is_err());
        for forbidden in [
            "profiles", "hosts", "tpls", "subs", "srh", "admins", "tokens",
        ] {
            assert!(enforce_collection(&viewer, forbidden, false).is_err());
        }
        assert!(enforce_collection(&viewer, "nodes", false).is_ok());
        assert!(enforce_collection(&viewer, "squads", false).is_ok());
        let sample = json!({"id":5,"username":"alice","used":42.0,"xrayId":"SECRET-UUID",
          "subscriptionUrl":"https://secret.example.com","profileId":9,
          "devices":[{"fingerprint":"sensitive"}],
          "squads":[2,3],"config":"{\\\"privateKey\\\":\\\"SECRET\\\"}",
          "role":"admin","extra":{"token":"secret"}});
        let safe = viewer_record("users", &sample);
        assert_eq!(safe["username"], "alice");
        assert_eq!(safe["squads"][0], 2);
        for secret in [
            "SECRET-UUID",
            "secret.example.com",
            "sensitive",
            "privateKey",
            "admin",
        ] {
            assert!(!safe.to_string().contains(secret), "viewer leak: {secret}");
        }
        assert!(
            viewer_record("profiles", &sample)
                .as_object()
                .is_some_and(serde_json::Map::is_empty)
        );
        let restricted =
            viewer_settings(&json!({"brand":"Test","subscriptionJson":{"secret":"leak"},
            "hooks":{"user.created":{"url":"https://secret.example"}}}));
        assert_eq!(restricted, json!({"brand":"Test"}));
        let unknown = auth::AuthUser {
            id: 4,
            username: "unknown".into(),
            role: "custom".into(),
        };
        assert!(viewer_read_only(&unknown));
        assert!(enforce_collection(&unknown, "profiles", false).is_err());
        assert!(enforce_collection(&admin, "users", true).is_ok());
        assert!(enforce_collection(&owner, "tokens", true).is_err());
        assert!(enforce_collection(&owner, "admins", false).is_err());
    }
}

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub redis: ConnectionManager,
    pub core: CoreManager,
    pub cookie_secure: bool,
    pub totp_key: Option<[u8; 32]>,
    pub subscription_key: [u8; 32],
    pub node_policy_signer: std::sync::Arc<node_policy::PolicySigner>,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
    pub(crate) fn safe_message(&self) -> &str {
        &self.message
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        tracing::error!(error = %error, "Database operation failed");
        if let sqlx::Error::Database(db_error) = &error
            && db_error.code().as_deref() == Some("23505")
        {
            return Self::new(
                StatusCode::CONFLICT,
                "Запись с такими данными уже существует.",
            );
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

#[derive(Debug, Deserialize)]
struct TrafficMetricsQuery {
    range: Option<String>,
    node_id: Option<i64>,
    squad_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct NodeMetricsIngestRequest {
    node_id: i64,
    cpu_percent: Option<f64>,
    cpu_steal_percent: Option<f64>,
    ram_used_bytes: Option<i64>,
    ram_total_bytes: Option<i64>,
    disk_used_bytes: Option<i64>,
    disk_total_bytes: Option<i64>,
    rx_bytes_per_sec: Option<f64>,
    tx_bytes_per_sec: Option<f64>,
    active_connections: Option<i32>,
    online_clients: Option<i32>,
    metrics: Option<Value>,
    #[serde(default, alias = "userTraffic")]
    user_traffic: Option<Vec<UserTrafficSample>>,
    #[serde(default, alias = "userInboundTraffic")]
    user_inbound_traffic: Option<Vec<UserInboundTrafficSample>>,
    #[serde(default, alias = "userStatsStatus")]
    user_stats_status: Option<String>,
    #[serde(default, alias = "userStatsAtMs")]
    user_stats_at_ms: Option<i64>,
}

/// Cumulative Xray byte counters scoped to a real panel user and the reporting node.
/// The node agent must provide these explicitly; host traffic must not be inferred.
#[derive(Debug, Deserialize, Serialize)]
struct UserTrafficSample {
    #[serde(alias = "userId")]
    user_id: i64,
    #[serde(alias = "uplinkBytes")]
    uplink_bytes: i64,
    #[serde(alias = "downlinkBytes")]
    downlink_bytes: i64,
}

#[derive(Debug, Deserialize, Serialize)]
struct UserInboundTrafficSample {
    #[serde(alias = "userId")]
    user_id: i64,
    #[serde(alias = "inboundTag")]
    inbound_tag: String,
    #[serde(alias = "uplinkBytes")]
    uplink_bytes: i64,
    #[serde(alias = "downlinkBytes")]
    downlink_bytes: i64,
}

fn protected_management_routes() -> Router<AppState> {
    Router::new()
        .route("/auth/mfa/status", get(mfa::status))
        .route("/auth/mfa/setup", post(mfa::setup))
        .route("/auth/mfa/confirm", post(mfa::confirm))
        .route("/auth/mfa/disable", post(mfa::disable))
        .route(
            "/security/policy",
            get(security::get_settings).patch(security::update_settings),
        )
        .route("/security/audit", get(security::audit_events))
        .route("/security/sessions", get(security::sessions))
        .route(
            "/security/sessions/others",
            post(security::revoke_other_sessions),
        )
        .route(
            "/security/sessions/{id}",
            axum::routing::delete(security::revoke_session),
        )
}

#[expect(
    clippy::too_many_lines,
    reason = "The declarative protected route table is kept together for endpoint auditing"
)]
fn protected_routes(state: &AppState) -> Router<AppState> {
    Router::new()
        .route("/bootstrap", get(bootstrap))
        .merge(protected_management_routes())
        .route("/settings", get(get_settings).patch(patch_settings))
        .route("/client-routing", patch(patch_client_routing))
        .route("/stats", get(get_stats))
        .route("/system/stats", get(get_system_stats))
        .route("/statistics/overview", get(get_statistics_overview))
        .route("/statistics/leaders", get(get_statistics_leaders))
        .route(
            "/statistics/period-leaders",
            get(get_statistics_period_leaders),
        )
        .route("/metrics/traffic", get(get_traffic_metrics))
        .route(
            "/metrics/traffic/bucket-detail",
            get(get_traffic_bucket_detail),
        )
        .route("/users/presence", get(get_user_presence))
        .route("/users/{id}/traffic", get(get_user_traffic))
        .route("/users/{id}/traffic/history", get(get_user_traffic_history))
        .route(
            "/users/{id}/traffic/observations",
            get(get_user_traffic_observations),
        )
        .route(
            "/nodes/{id}/metrics-key",
            post(node_auth::enroll).delete(node_auth::revoke),
        )
        .route("/nodes/{id}/runtime", get(node_runtime::status))
        .route(
            "/nodes/{id}/geodata/refresh",
            post(node_runtime::request_geodata_refresh),
        )
        .route(
            "/nodes/{id}/routing/preview",
            post(node_runtime::preview_routing),
        )
        .route(
            "/nodes/{id}/restart",
            post(node_runtime::request_restart).get(node_runtime::restart_status),
        )
        .route(
            "/nodes/{id}/xray-update",
            post(node_runtime::request_xray_update),
        )
        .route(
            "/nodes/{id}/agent-update",
            post(node_runtime::request_agent_update),
        )
        .route(
            "/nodes/xray-releases",
            get(node_runtime::available_xray_releases),
        )
        .route(
            "/users/{id}/subscription",
            get(user_subscriptions::status)
                .post(user_subscriptions::create)
                .delete(user_subscriptions::revoke),
        )
        .route(
            "/users/{id}/credentials/rotate",
            post(user_subscriptions::rotate_credentials),
        )
        .route(
            "/users/{id}/client-json",
            get(user_subscriptions::admin_client_json),
        )
        .route("/nodes/{id}/enrollment", post(node_enrollment::issue))
        .route(
            "/nodes/{id}/enrollment/reissue",
            post(node_enrollment::reissue),
        )
        .route(
            "/admins",
            get(admin_accounts::list).post(admin_accounts::create),
        )
        .route(
            "/admins/{id}",
            patch(admin_accounts::update).delete(admin_accounts::delete),
        )
        .route(
            "/nodes/{id}/rotation/next",
            post(node_rotation::rotate_next),
        )
        .route(
            "/nodes/{id}/traffic/reset",
            post(reset_node_network_traffic),
        )
        .route(
            "/collections/{collection}",
            get(list_records).post(create_record),
        )
        .route(
            "/collections/{collection}/{id}",
            patch(update_record).delete(delete_record),
        )
        .route("/core", get(get_core_status))
        .route("/core/releases", get(get_core_releases))
        .route("/core/update", post(update_core))
        .route(
            "/panel/update",
            post(request_panel_update).get(get_panel_update_status),
        )
        .route("/core/vlessenc", post(generate_vless_encryption))
        .route("/core/validate", post(validate_xray_configuration))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_session,
        ))
}

fn experimental_v2_routes(state: &AppState) -> Router<AppState> {
    let router = Router::new();
    #[cfg(feature = "xsp-v2-experimental")]
    let router = router
        .route("/api/v2/node/heartbeat", post(xsp_v2_api::heartbeat))
        .route("/api/v2/node/keys/claim", post(xsp_v2_enrollment::claim))
        .merge(
            Router::new()
                .route(
                    "/api/v2/admin/nodes/{id}/key-approval",
                    post(xsp_v2_enrollment::approve),
                )
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    auth::require_session,
                )),
        );
    let _ = state;
    router
}

fn application_router(state: AppState) -> Router {
    let protected = protected_routes(&state);
    // Experimental staging heartbeat has no control-plane side effects and is
    // ABSENT from production builds (default features). It stays 404 until
    // XSP_V2_EXPERIMENTAL_HEARTBEAT=staging-only is explicitly set.

    let public = Router::new()
        .route("/health/live", get(health_live))
        .route("/health/ready", get(health_ready))
        .route("/metrics/ingest", post(ingest_node_metrics))
        .route("/node/heartbeat", post(node_runtime::heartbeat))
        .route("/node/restart/poll", post(node_runtime::poll_restart))
        .route("/node/restart/ack", post(node_runtime::acknowledge_restart))
        .route("/node/desired-config", post(node_runtime::desired_config))
        .route("/node/enroll", post(node_enrollment::claim))
        .route("/sub/{token}", get(user_subscriptions::serve))
        .route("/portal/{token}", get(user_subscriptions::portal))
        .route("/auth/session", get(auth::session))
        .route("/auth/login", post(auth::login))
        .route("/auth/mfa/verify", post(mfa::verify_challenge))
        .route("/auth/logout", post(auth::logout));

    let static_dir = env::var("STATIC_DIR").unwrap_or_else(|_| "/app/static".to_owned());
    Router::new()
        .route("/", get(|| async { StatusCode::NOT_FOUND }))
        .route("/index.html", get(|| async { StatusCode::NOT_FOUND }))
        .route("/login", get(|| async { StatusCode::NOT_FOUND }))
        .route("/login.html", get(|| async { StatusCode::NOT_FOUND }))
        .route("/dashboard/{slug}", get(security::dashboard_entry))
        .route("/{part1}/{token}", get(user_subscriptions::portal_route))
        .route(
            "/{part1}/{part2}/{token}",
            get(user_subscriptions::portal_route),
        )
        .route(
            "/{part1}/{part2}/{part3}/{token}",
            get(user_subscriptions::portal_route),
        )
        .route(
            "/{part1}/{part2}/{part3}/{part4}/{token}",
            get(user_subscriptions::portal_route),
        )
        .route(
            "/{part1}/{part2}/{part3}/{part4}/{part5}/{token}",
            get(user_subscriptions::portal_route),
        )
        .route(
            "/{part1}/{part2}/{part3}/{part4}/{part5}/{part6}/{token}",
            get(user_subscriptions::portal_route),
        )
        .route(
            "/{part1}/{part2}/{part3}/{part4}/{part5}/{part6}/{part7}/{token}",
            get(user_subscriptions::portal_route),
        )
        .route(
            "/{part1}/{part2}/{part3}/{part4}/{part5}/{part6}/{part7}/{part8}/{token}",
            get(user_subscriptions::portal_route),
        )
        .nest(
            "/api/v1",
            public
                .merge(protected)
                .fallback(|| async { StatusCode::NOT_FOUND }),
        )
        .merge(experimental_v2_routes(&state))
        .nest_service("/flags", ServeDir::new(format!("{static_dir}/flags")))
        .fallback_service(ServeDir::new(static_dir).append_index_html_on_directories(false))
        .layer(RequestBodyLimitLayer::new(2 * 1024 * 1024))
        .layer(CompressionLayer::new())
        // Never put request URIs into telemetry: public subscription routes
        // contain bearer secrets in the path, including custom Studio paths.
        .layer(TraceLayer::new_for_http().make_span_with(
            |request: &Request| tracing::info_span!("http_request", method = %request.method()),
        ))
        .layer(middleware::from_fn(security_headers))
        .layer(middleware::from_fn(csrf_guard))
        .with_state(state)
}

#[tokio::main]
#[expect(
    clippy::too_many_lines,
    reason = "Ordered startup performs database, Redis and HTTP bootstrap checks"
)]
async fn main() -> anyhow::Result<()> {
    const STARTUP_CONNECT_ATTEMPTS: usize = 24;

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                tracing_subscriber::EnvFilter::new("info,tower_http=info,sqlx=warn")
            }),
        )
        .json()
        .init();

    let database_url =
        env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?;
    // Docker's embedded service-name DNS can briefly lag network creation
    // even after Compose marks the database container healthy. Retry readiness
    // without disclosing connection strings (which contain DB credentials).
    let pool_options = PgPoolOptions::new()
        .max_connections(
            env::var("DB_MAX_CONNECTIONS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(20),
        )
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(10))
        .idle_timeout(Duration::from_secs(600))
        .max_lifetime(Duration::from_mins(30));
    let mut db_attempt = 0;
    let pool = loop {
        match pool_options.clone().connect(&database_url).await {
            Ok(pool) => break pool,
            Err(error) => {
                db_attempt += 1;
                if db_attempt >= STARTUP_CONNECT_ATTEMPTS {
                    return Err(anyhow::anyhow!(
                        "PostgreSQL unavailable after {db_attempt} startup attempts"
                    ));
                }
                // Do not log `error`: driver diagnostics can include the URL.
                let _ = error;
                tracing::warn!(
                    attempt = db_attempt,
                    "Waiting for PostgreSQL DNS/connectivity"
                );
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    };

    let redis_url = env::var("REDIS_URL").map_err(|_| anyhow::anyhow!("REDIS_URL is required"))?;
    let redis_client = redis::Client::open(redis_url)?;
    let mut redis_attempt = 0;
    let redis: ConnectionManager = loop {
        let maybe_connection = redis_client.get_connection_manager().await;
        if let Ok(mut connection) = maybe_connection {
            let ping = redis::cmd("PING")
                .query_async::<String>(&mut connection)
                .await;
            if matches!(ping.as_deref(), Ok("PONG")) {
                break connection;
            }
        }
        redis_attempt += 1;
        if redis_attempt >= STARTUP_CONNECT_ATTEMPTS {
            anyhow::bail!("Redis unavailable after {redis_attempt} startup attempts");
        }
        tracing::warn!(
            attempt = redis_attempt,
            "Waiting for Redis DNS/connectivity"
        );
        tokio::time::sleep(Duration::from_secs(2)).await;
    };

    sqlx::migrate!("./migrations").run(&pool).await?;
    // Preserve an existing custom dashboard path on upgrades. Migrate only the
    // former hardcoded default; the database remains authoritative thereafter.
    if let Ok(from_env) = env::var("DASHBOARD_PATH") {
        let current: Option<Value> =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key='security'")
                .fetch_optional(&pool)
                .await?;
        if let Some(mut policy_json) = current
            && policy_json.get("dashboardPath").and_then(Value::as_str) == Some("/dashboard/nexus")
        {
            policy_json["dashboardPath"] = Value::String(from_env);
            sqlx::query("UPDATE app_settings SET value=$1,updated_at=NOW() WHERE key='security'")
                .bind(policy_json)
                .execute(&pool)
                .await?;
        }
    }
    // Sync the effective database path to a dedicated host-visible mirror.
    // The panel never gets write access to the host's .env or other secrets.
    let active_path = security::get_policy(&pool)
        .await
        .map_err(|e| anyhow::anyhow!("Invalid dashboard policy: {}", e.message))?
        .dashboard_path;
    if let Ok(mirror) = env::var("DASHBOARD_PATH_MIRROR") {
        tokio::fs::write(mirror, format!("{active_path}\n")).await?;
    }

    let admin_username = env::var("ADMIN_USERNAME").unwrap_or_else(|_| "admin".to_owned());
    let admin_password = env::var("ADMIN_PASSWORD")
        .map_err(|_| anyhow::anyhow!("ADMIN_PASSWORD is required; run ./install.sh"))?;
    auth::seed_bootstrap_admin(&pool, &admin_username, &admin_password).await?;

    let cookie_secure = env::var("COOKIE_SECURE").map_or(true, |value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes"
        )
    });
    let core_dir = PathBuf::from(
        env::var("CORE_DATA_DIR").unwrap_or_else(|_| "/var/lib/xmesh/core".to_owned()),
    );
    let node_policy_signer = std::sync::Arc::new(node_policy::PolicySigner::load(
        &core_dir.join("node-policy-ed25519.key"),
    )?);
    let core = CoreManager::new(pool.clone(), core_dir).await?;
    let totp_key = env::var("TOTP_ENCRYPTION_KEY")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(|raw| mfa::decode_key(&raw))
        .transpose()?;
    if totp_key.is_none() {
        tracing::warn!("TOTP_ENCRYPTION_KEY is not configured: MFA enrollment is unavailable");
    }
    // A separate long-lived 256-bit secret must be provisioned by install.sh.
    // Never silently derive new subscription encryption from the TOTP key.
    let subscription_hex = env::var("SUBSCRIPTION_ENCRYPTION_KEY").map_err(|_| {
        anyhow::anyhow!("SUBSCRIPTION_ENCRYPTION_KEY is missing; run ./install.sh --prepare-only")
    })?;
    if subscription_hex.len() != 64 {
        anyhow::bail!("SUBSCRIPTION_ENCRYPTION_KEY must be 64 hexadecimal characters");
    }
    let subscription_bytes = hex::decode(&subscription_hex)
        .map_err(|_| anyhow::anyhow!("SUBSCRIPTION_ENCRYPTION_KEY must be hexadecimal"))?;
    let subscription_key: [u8; 32] = subscription_bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("SUBSCRIPTION_ENCRYPTION_KEY length is invalid"))?;
    let state = AppState {
        pool,
        redis,
        core,
        cookie_secure,
        totp_key,
        subscription_key,
        node_policy_signer,
    };
    // Old tokens remain valid; only their encrypted display/recovery copy is
    // rewrapped. Keep the old TOTP key until this migration finishes.
    user_subscriptions::migrate_legacy_ciphertexts(&state).await?;
    state.core.launch_startup_update();

    let app = application_router(state);

    let address = env::var("APP_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_owned());
    let listener = tokio::net::TcpListener::bind(&address).await?;
    tracing::info!(address = %address, "XMesh Nexus API ready");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn csrf_guard(request: Request, next: Next) -> Response {
    let is_mutation = matches!(
        *request.method(),
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    );
    // Only cookie-less machine-to-machine endpoints bypass browser Origin validation.
    // Each endpoint enforces its own strong authentication (signed Ed25519 or
    // single-use short-lived enrollment token) before performing any mutation.
    // Never exempt a request carrying a session cookie or an Origin header.
    let path = request.uri().path();
    let machine_request = request.headers().get(header::ORIGIN).is_none()
        && request.headers().get(header::COOKIE).is_none()
        && request.headers().get("sec-fetch-site").is_none()
        && match path {
            "/api/v1/metrics/ingest"
            | "/api/v1/node/heartbeat"
            | "/api/v1/node/desired-config"
            | "/api/v1/node/restart/poll"
            | "/api/v1/node/restart/ack" => request.headers().contains_key("x-xmesh-signature"),
            "/api/v1/node/enroll" => request
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value.eq_ignore_ascii_case("application/json")),
            _ => false,
        };
    if is_mutation && request.uri().path().starts_with("/api/v1/") && !machine_request {
        // Sec-Fetch-Site stops same-site but cross-origin form and fetch attacks.
        // Older clients still have to supply a matching Origin.
        if request
            .headers()
            .get("sec-fetch-site")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|site| !matches!(site, "same-origin" | "none"))
        {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({"error": "Запрос из другого источника запрещён."})),
            )
                .into_response();
        }
        let origin = request
            .headers()
            .get(header::ORIGIN)
            .and_then(|value| value.to_str().ok());
        let host = request
            .headers()
            .get(header::HOST)
            .and_then(|value| value.to_str().ok());
        let valid = origin
            .and_then(|value| value.parse::<Uri>().ok())
            .and_then(|uri| {
                if !matches!(uri.scheme_str(), Some("https" | "http")) || uri.query().is_some() {
                    return None;
                }
                uri.authority()
                    .map(|authority| authority.as_str().to_ascii_lowercase())
            })
            .zip(host.map(str::to_ascii_lowercase))
            .is_some_and(|(origin_authority, request_host)| origin_authority == request_host);
        if !valid {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({"error": "Запрос отклонён проверкой источника."})),
            )
                .into_response();
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
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("Graceful shutdown requested");
}

async fn security_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("cache-control"),
        HeaderValue::from_static("no-store"),
    );
    headers.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https: data:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"),
    );
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
    let redis_ok = redis::cmd("PING")
        .query_async::<String>(&mut redis)
        .await
        .is_ok_and(|reply| reply == "PONG");
    if database_ok && redis_ok {
        (
            StatusCode::OK,
            Json(json!({
                "status": "ready",
                "dependencies": {"postgresql": "online", "redis": "online"}
            })),
        )
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

// Viewer responses must never include credentials or connection material.
/// Fail closed for any role which is not explicitly owner or admin.
fn viewer_read_only(actor: &auth::AuthUser) -> bool {
    !matches!(actor.role.as_str(), "owner" | "admin")
}

/// Observer is a monitoring role, not an XRAY configuration reader.
fn viewer_can_read_collection(collection: &str) -> bool {
    matches!(collection, "users" | "nodes" | "squads")
}

/// Whitelist-only public projection. Never serialize the source record into a
/// viewer response: new schema fields must be invisible by default.
fn viewer_record(collection: &str, record: &Value) -> Value {
    let fields: &[&str] = match collection {
        "users" => &[
            "id", "username", "limit", "used", "expireAt", "onlineAt", "disabled", "created",
            "status", "hwid", "squads",
        ],
        "nodes" => &[
            "id",
            "name",
            "remark",
            "flag",
            "country",
            "state",
            "disabled",
            "used",
            "limit",
            "traffic",
            "maxTraffic",
            "xrayVersion",
            "agentVersion",
            "onlineAt",
            "lastSeenAt",
        ],
        "squads" => &["id", "name", "remark", "tag"],
        _ => return json!({}),
    };
    let mut result = Map::new();
    for field in fields {
        if let Some(value) = record.get(*field) {
            // Reject arbitrary nested JSON: squad association IDs are the
            // only arrays allowed through the restricted projection.
            let safe = if *field == "squads" && collection == "users" {
                value.as_array().map(|items| {
                    Value::Array(
                        items
                            .iter()
                            .filter(|id| id.is_u64() || id.is_i64())
                            .take(100)
                            .cloned()
                            .collect(),
                    )
                })
            } else if value.is_string()
                || value.is_boolean()
                || value.is_number()
                || value.is_null()
            {
                Some(value.clone())
            } else {
                None
            };
            if let Some(safe) = safe {
                result.insert((*field).into(), safe);
            }
        }
    }
    Value::Object(result)
}

/// Only cosmetic information is necessary for an observer. In particular,
/// never include hooks, subscription config, client JSON or URLs in settings.
fn viewer_settings(settings: &Value) -> Value {
    json!({"brand":settings.get("brand").and_then(Value::as_str).unwrap_or("XMesh Nexus")})
}

async fn bootstrap(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
) -> Result<Json<Value>, ApiError> {
    let mut collections = Map::new();
    for collection in COLLECTIONS {
        // No loading or serialization of privileged collections for observers.
        if viewer_read_only(&actor) && !viewer_can_read_collection(collection) {
            collections.insert((*collection).to_owned(), Value::Array(vec![]));
            continue;
        }
        let records = if *collection == "admins" {
            if actor.role == "owner" {
                admin_accounts::accounts(&state.pool).await?
            } else {
                Vec::new()
            }
        } else if *collection == "tokens" {
            // API tokens remain unimplemented, not credentials. Never surface legacy placeholders.
            Vec::new()
        } else {
            load_records(&state.pool, collection).await?
        };
        let records = if viewer_read_only(&actor) {
            Value::Array(
                records
                    .iter()
                    .map(|r| viewer_record(collection, r))
                    .collect(),
            )
        } else {
            Value::Array(records)
        };
        collections.insert((*collection).to_owned(), records);
    }
    let mut settings = read_settings(&state.pool).await?;
    if viewer_read_only(&actor) {
        settings = viewer_settings(&settings);
    }
    Ok(Json(json!({
        "collections": collections,
        "settings": settings,
        "persistence": "postgresql"
    })))
}

async fn list_records(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Path(collection): Path<String>,
) -> Result<Json<Value>, ApiError> {
    validate_collection(&collection)?;
    enforce_collection(&actor, &collection, false)?;
    let mut items = load_records(&state.pool, &collection).await?;
    if viewer_read_only(&actor) {
        items = items
            .iter()
            .map(|item| viewer_record(&collection, item))
            .collect();
    }
    let ids = items
        .iter()
        .filter_map(|item| item.get("id").cloned())
        .collect::<Vec<_>>();
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
    enforce_collection(&actor, &collection, true)?;
    let object = data.as_object_mut().ok_or_else(|| {
        ApiError::new(StatusCode::BAD_REQUEST, "Запись должна быть JSON-объектом.")
    })?;
    object.remove("id");
    if collection == "users" {
        for field in protocol_credentials::PROTOCOL_FIELDS {
            object.remove(field);
        }
        object.remove("ssPassword");
        object.remove("ssPassword128");
    }
    // Authoritative, unpredictable, immutable per-user Xray identity. Never trust
    // a client-provided UUID for a newly created account.
    if collection == "users" {
        protocol_credentials::provision(object);
    }
    // A quota reason is only valid for an actually disabled node. Updating
    // a node must not carry a stale reason into its next saved revision.
    // Never auto-start a quota-stopped node: an operator must enable it.
    if collection == "nodes"
        && data.get("disabled").and_then(Value::as_bool) == Some(false)
        && data.get("disabledReason").and_then(Value::as_str) == Some("traffic_limit")
        && let Some(obj) = data.as_object_mut()
    {
        obj.remove("disabledReason");
        obj.remove("trafficLimitReachedAt");
    }
    validate_record(&collection, &data)?;
    if collection == "hosts" {
        validate_host_binding(&state.pool, &data).await?;
    }

    // User and initial subscription must be one atomic operation: never create
    // an account whose subscription secret could not be persisted.
    let mut tx = state.pool.begin().await?;
    let row = sqlx::query(
        "INSERT INTO panel_records (collection, data) VALUES ($1, $2) RETURNING id, data",
    )
    .bind(&collection)
    .bind(data)
    .fetch_one(&mut *tx)
    .await?;
    let result = row_to_record(&row)?;
    if collection == "users" {
        let id = result.get("id").and_then(Value::as_i64).ok_or_else(|| {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Created user has no ID")
        })?;
        user_subscriptions::provision_new_user(&state, id, &mut tx).await?;
    }
    tx.commit().await?;
    let record_id = result.get("id").and_then(Value::as_i64);
    audit(
        &state.pool,
        &actor.username,
        "create",
        Some(&collection),
        record_id,
        json!({}),
    )
    .await;
    Ok((StatusCode::CREATED, Json(result)))
}

/// Manually reset only the node-wide network accounting period. The last
/// physical interface counters remain the current baseline, preventing all
/// traffic before the reset from being counted again at the next sample.
async fn reset_node_network_traffic(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Path(node_id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    require_mutation(&actor)?;
    enforce_collection(&actor, "nodes", true)?;
    if node_id <= 0 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Некорректный ID узла.",
        ));
    }
    let mut tx = state.pool.begin().await?;
    // Serialize against the quota-cutoff transition and concurrent resets.
    let record = sqlx::query(
        "SELECT data FROM panel_records
         WHERE collection='nodes' AND id=$1 FOR UPDATE",
    )
    .bind(node_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Узел не найден."))?;
    let old: Value = record.try_get("data")?;
    let previous = sqlx::query(
        "UPDATE node_network_traffic_totals
         SET rx_bytes=0,tx_bytes=0,updated_at=NOW()
         WHERE node_id=$1
         RETURNING rx_bytes,tx_bytes,last_rx_bytes,last_tx_bytes",
    )
    .bind(node_id)
    .fetch_optional(&mut *tx)
    .await?;
    // A quota-stopped node stays disabled. A reset never starts its Xray.
    let was_quota_stopped =
        old.get("disabledReason").and_then(Value::as_str) == Some("traffic_limit");
    let row = sqlx::query(
        "UPDATE panel_records
         SET data=(data - 'disabledReason' - 'trafficLimitReachedAt')
                   || jsonb_build_object('trafficLastResetAt',
                                        to_char(NOW() AT TIME ZONE 'UTC',
                                                'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),
             updated_at=NOW()
         WHERE collection='nodes' AND id=$1 RETURNING data",
    )
    .bind(node_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    audit(
        &state.pool,
        &actor.username,
        "node_traffic_reset",
        Some("nodes"),
        Some(node_id),
        json!({"nodePreviouslyQuotaStopped":was_quota_stopped}),
    )
    .await;
    let updated: Value = row.try_get("data")?;
    Ok(Json(json!({
        "nodeId":node_id,
        "networkRxBytes":0,
        "networkTxBytes":0,
        "resetAt":updated["trafficLastResetAt"],
        "disabled":old.get("disabled").and_then(Value::as_bool)==Some(true),
        "counterPresent":previous.is_some(),
        "xrayStarted":false
    })))
}

async fn update_record(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Path((collection, id)): Path<(String, i64)>,
    Json(mut patch): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    validate_collection(&collection)?;
    enforce_collection(&actor, &collection, true)?;
    let patch_object = patch.as_object_mut().ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "Обновление должно быть JSON-объектом.",
        )
    })?;
    patch_object.remove("id");
    // User usage is a separate accounting operation, not part of editing
    // quotas, renewal or other account fields. A full-record PATCH may contain
    // the read-only effective usage (base + signed metered counters): treating
    // it as a reset would erase signed counters and double count the baseline.
    // Preserve the legacy explicit one-field usage adjustment/reset endpoint.
    if collection == "users" && patch_object.contains_key("used") && patch_object.len() != 1 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Трафик пользователя можно изменять только отдельным запросом.",
        ));
    }
    // Secrets are issued only server-side and changed via the owner-only rekey.
    if collection == "users" {
        for field in protocol_credentials::PROTOCOL_FIELDS {
            patch_object.remove(field);
        }
        patch_object.remove("ssPassword");
        patch_object.remove("ssPassword128");
    }

    let mut tx = state.pool.begin().await?;
    let existing =
        sqlx::query("SELECT data FROM panel_records WHERE collection = $1 AND id = $2 FOR UPDATE")
            .bind(&collection)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Запись не найдена."))?;
    let mut data: Value = existing.try_get("data")?;
    let object = data.as_object_mut().ok_or_else(|| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Повреждён формат записи.",
        )
    })?;
    if collection == "users"
        && let Some(existing_id) = object.get("xrayId").and_then(Value::as_str)
        && !existing_id.is_empty()
        && patch_object
            .get("xrayId")
            .is_some_and(|v| v.as_str() != Some(existing_id))
    {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Xray UUID пользователя нельзя менять через общий API.",
        ));
    }
    for (key, value) in patch_object.clone() {
        object.insert(key, value);
    }
    validate_record(&collection, &data)?;
    if collection == "hosts" {
        validate_host_binding(&state.pool, &data).await?;
    }

    // Admin traffic reset sets the new baseline without corrupting the
    // last-seen Xray monotonic counters. The next delta still counts correctly.
    if collection == "users" && patch_object.contains_key("used") {
        sqlx::query(
            "UPDATE user_node_traffic_totals SET uplink_bytes=0,downlink_bytes=0 WHERE user_id=$1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE user_inbound_traffic_totals SET uplink_bytes=0,downlink_bytes=0 WHERE user_id=$1"
        ).bind(id).execute(&mut *tx).await?;
    }
    let row = sqlx::query(
        "UPDATE panel_records SET data = $3, updated_at = NOW() \
         WHERE collection = $1 AND id = $2 RETURNING id, data",
    )
    .bind(&collection)
    .bind(id)
    .bind(data)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    let mut result = row_to_record(&row)?;
    if collection == "users" {
        // Exactly like bootstrap/collection reads: return the true effective
        // usage after an edit so a quota-only PATCH cannot appear to reset
        // the user's already accumulated authenticated traffic in the UI.
        add_metered_usage(&mut result, user_metered_bytes(&state.pool, id).await?);
    }
    audit(
        &state.pool,
        &actor.username,
        "update",
        Some(&collection),
        Some(id),
        json!({}),
    )
    .await;
    Ok(Json(result))
}

async fn delete_record(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Path((collection, id)): Path<(String, i64)>,
) -> Result<Json<Value>, ApiError> {
    validate_collection(&collection)?;
    enforce_collection(&actor, &collection, true)?;
    let mut tx = state.pool.begin().await?;
    // When deleting a node, detach it from public hosts in the same transaction.
    // Preserve host records and their other node associations.
    if collection == "nodes" {
        let hosts =
            sqlx::query("SELECT id, data FROM panel_records WHERE collection = 'hosts' FOR UPDATE")
                .fetch_all(&mut *tx)
                .await?;
        for host in hosts {
            let host_id: i64 = host.try_get("id")?;
            let mut data: Value = host.try_get("data")?;
            if let Some(nodes) = data.get_mut("nodes").and_then(Value::as_array_mut) {
                let count = nodes.len();
                nodes.retain(|v| v.as_i64() != Some(id) && v.as_str() != Some(&id.to_string()));
                if nodes.len() != count {
                    // Empty host node lists mean "all nodes": disable the host instead
                    // of accidentally exposing it on every remaining node.
                    if nodes.is_empty() {
                        data["disabled"] = Value::Bool(true);
                    }
                    sqlx::query(
                        "UPDATE panel_records SET data = $1 WHERE collection = 'hosts' AND id = $2",
                    )
                    .bind(&data)
                    .bind(host_id)
                    .execute(&mut *tx)
                    .await?;
                }
            }
        }
    }
    let row = sqlx::query(
        "DELETE FROM panel_records WHERE collection = $1 AND id = $2 RETURNING id, data",
    )
    .bind(&collection)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Запись не найдена."))?;
    let result = row_to_record(&row)?;
    if collection == "nodes" {
        sqlx::query("DELETE FROM node_metric_keys WHERE node_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM node_metric_nonces WHERE node_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM node_ip_rotation_cursors WHERE node_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    } else if collection == "users" {
        sqlx::query("DELETE FROM node_ip_rotation_cursors WHERE user_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    audit(
        &state.pool,
        &actor.username,
        "delete",
        Some(&collection),
        Some(id),
        json!({}),
    )
    .await;
    Ok(Json(result))
}

fn valid_public_hostname(value: &str) -> bool {
    if value.len() > 253 || value.is_empty() || value.contains("..") || !value.is_ascii() {
        return false;
    }
    value.split('.').all(|part| {
        !part.is_empty()
            && part.len() <= 63
            && part
                .bytes()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric())
            && part
                .bytes()
                .last()
                .is_some_and(|c| c.is_ascii_alphanumeric())
            && part.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    })
}

async fn get_settings(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
) -> Result<Json<Value>, ApiError> {
    let settings = read_settings(&state.pool).await?;
    Ok(Json(if viewer_read_only(&actor) {
        viewer_settings(&settings)
    } else {
        settings
    }))
}

fn validate_settings_keys(object: &serde_json::Map<String, Value>) -> Result<(), ApiError> {
    for key in object.keys() {
        if !matches!(
            key.as_str(),
            "brand"
                | "domain"
                | "hooks"
                | "subscriptionDomain"
                | "subscriptionPath"
                | "subscriptionBrand"
                | "subscriptionAnnouncement"
                | "subscriptionUpdateInterval"
                | "subscriptionAnnouncementRotationHours"
                | "subscriptionDescription"
                | "subscriptionDescriptionEn"
                | "subscriptionFooter"
                | "subscriptionFooterEn"
                | "subscriptionAccent"
                | "subscriptionSecondaryAccent"
                | "subscriptionLanguage"
                | "subscriptionTheme"
                | "subscriptionSyncPanelTheme"
                | "subscriptionPlacement"
                | "nodePlacement"
                | "deploymentServerB"
                | "deploymentServerC"
                | "subscriptionShowTraffic"
                | "subscriptionShowExpiry"
                | "subscriptionBackground"
                | "subscriptionCardColor"
                | "subscriptionTextColor"
                | "subscriptionLayout"
                | "subscriptionCardStyle"
                | "subscriptionFont"
                | "subscriptionRadius"
                | "subscriptionClientLayout"
                | "subscriptionHero"
                | "subscriptionHeroEn"
                | "subscriptionCta"
                | "subscriptionCtaEn"
                | "subscriptionSupportLabel"
                | "subscriptionSupportLabelEn"
                | "subscriptionLogoUrl"
                | "subscriptionSupportUrl"
                | "subscriptionShowStatus"
                | "subscriptionShowApps"
                | "subscriptionShowQr"
                | "subscriptionShowCopy"
                | "subscriptionShowSupport"
                | "subscriptionShowDevices"
                | "subscriptionJson"
                | "clientBalancers"
                | "clientRoutingProfiles"
                | "subscriptionClients"
                | "subscriptionClientLinks"
                | "subscriptionAppsTitle"
                | "subscriptionAppsTitleEn"
                | "subscriptionCustomClients"
        ) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("Неизвестное поле настроек: {key}"),
            ));
        }
    }
    Ok(())
}

fn validate_settings_identifiers(object: &serde_json::Map<String, Value>) -> Result<(), ApiError> {
    if let Some(brand) = object.get("brand") {
        let value = brand.as_str().ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "Название панели должно быть строкой.",
            )
        })?;
        if value.trim().is_empty() || value.chars().count() > 80 {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Название панели должно содержать от 1 до 80 символов.",
            ));
        }
    }
    if let Some(domain) = object.get("domain") {
        let value = domain
            .as_str()
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Домен должен быть строкой."))?;
        if value.chars().count() > 253 || value.chars().any(char::is_whitespace) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Указан некорректный домен.",
            ));
        }
    }
    if let Some(domain) = object.get("subscriptionDomain") {
        let value = domain.as_str().ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "Домен подписки должен быть строкой.",
            )
        })?;
        if !value.is_empty() && !valid_public_hostname(value) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Некорректный домен подписки. Укажите только hostname без схемы, пути и порта.",
            ));
        }
    }
    if let Some(path) = object.get("subscriptionPath") {
        let value = path.as_str().ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "Путь подписки должен быть строкой.",
            )
        })?;
        if value.len() < 2
            || value.len() > 64
            || !value.starts_with('/')
            || value.ends_with('/')
            || value.contains("//")
            || value.split('/').skip(1).count() > 8
            || value
                .split('/')
                .skip(1)
                .any(|segment| segment.is_empty() || segment == "." || segment == "..")
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_'))
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Путь должен начинаться с / и состоять из латиницы, цифр, - и _.",
            ));
        }
        if value.starts_with("/api")
            || value.starts_with("/login")
            || value.starts_with("/dashboard")
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Путь конфликтует со служебными маршрутами панели.",
            ));
        }
    }
    Ok(())
}

fn validate_settings_presentation(object: &serde_json::Map<String, Value>) -> Result<(), ApiError> {
    for (key, max_len) in [
        ("subscriptionBrand", 80),
        ("subscriptionDescription", 240),
        ("subscriptionDescriptionEn", 240),
        ("subscriptionFooter", 160),
        ("subscriptionFooterEn", 160),
        ("deploymentServerB", 253),
        ("deploymentServerC", 253),
    ] {
        if let Some(value) = object.get(key) {
            let text = value.as_str().ok_or_else(|| {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("Поле {key} должно быть текстом."),
                )
            })?;
            if text.chars().count() > max_len || text.chars().any(char::is_control) {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("Некорректное значение поля {key}."),
                ));
            }
        }
    }
    if let Some(color) = object.get("subscriptionAccent") {
        let text = color.as_str().ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "Цвет подписки должен быть строкой.",
            )
        })?;
        if text.len() != 7
            || !text.starts_with('#')
            || !text[1..].bytes().all(|c| c.is_ascii_hexdigit())
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Цвет подписки должен быть в формате #RRGGBB.",
            ));
        }
    }
    for (key, choices) in [
        ("subscriptionLanguage", &["ru", "en"][..]),
        ("subscriptionTheme", &["dark", "light"][..]),
        ("subscriptionPlacement", &["a", "b", "c"][..]),
        ("nodePlacement", &["a", "b", "c"][..]),
    ] {
        if let Some(value) = object.get(key) {
            let text = value.as_str().ok_or_else(|| {
                ApiError::new(StatusCode::BAD_REQUEST, format!("Некорректное поле {key}."))
            })?;
            if !choices.contains(&text) {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    format!("Недопустимое значение {key}."),
                ));
            }
        }
    }
    for key in ["subscriptionShowTraffic", "subscriptionShowExpiry"] {
        if let Some(value) = object.get(key)
            && !value.is_boolean()
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("Поле {key} должно быть переключателем."),
            ));
        }
    }
    Ok(())
}

fn validate_settings_announcements(
    object: &serde_json::Map<String, Value>,
) -> Result<(), ApiError> {
    if let Some(value) = object.get("subscriptionAnnouncement") {
        let message = value
            .as_str()
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Анонсы должны быть текстом."))?;
        if message.chars().count() > 4000
            || message
                .chars()
                .any(|c| c.is_control() && c != '\n' && c != '\r')
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Анонсы: максимум 4000 символов, разделитель — отдельная строка ---.",
            ));
        }
    }
    if let Some(value) = object.get("subscriptionAnnouncementRotationHours") {
        let hours = value.as_u64().ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "Период ротации анонсов должен быть целым числом часов.",
            )
        })?;
        if !(1..=720).contains(&hours) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Период ротации анонсов должен быть от 1 до 720 часов.",
            ));
        }
    }
    if let Some(value) = object.get("subscriptionUpdateInterval") {
        let hours = value.as_u64().ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "Интервал обновления должен быть целым числом.",
            )
        })?;
        if !(1..=168).contains(&hours) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Интервал обновления должен быть от 1 до 168 часов.",
            ));
        }
    }
    Ok(())
}

fn validate_settings_integrations(object: &serde_json::Map<String, Value>) -> Result<(), ApiError> {
    subscription_settings::validate(object)?;
    if let Some(groups) = object.get("clientBalancers") {
        subscription_json::validate_client_balancers(groups)
            .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error))?;
    }
    if let Some(hooks) = object.get("hooks") {
        let hooks = hooks.as_object().ok_or_else(|| {
            ApiError::new(StatusCode::BAD_REQUEST, "Вебхуки должны быть объектом.")
        })?;
        let allowed = [
            "user.created",
            "user.limited",
            "user.expired",
            "user.expires_in_24_hours",
            "user.first_connected",
            "user.bandwidth_usage_threshold_reached",
        ];
        for (key, value) in hooks {
            if !allowed.contains(&key.as_str())
                || !(value.is_boolean() || value.as_i64().is_some_and(|n| n == 0 || n == 1))
            {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "Недопустимый параметр вебхука.",
                ));
            }
        }
    }
    Ok(())
}

async fn patch_settings(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Json(patch): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    require_owner(&actor)?;
    let object = patch.as_object().ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "Настройки должны быть JSON-объектом.",
        )
    })?;
    validate_settings_keys(object)?;
    validate_settings_identifiers(object)?;
    validate_settings_presentation(object)?;
    validate_settings_announcements(object)?;
    validate_settings_integrations(object)?;

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
    audit(
        &state.pool,
        &actor.username,
        "settings.update",
        None,
        None,
        json!({}),
    )
    .await;
    Ok(Json(settings))
}

// Narrow-scoped settings endpoint: administrators may edit client routing
// without gaining control of unrelated owner-only security, branding or hooks.
async fn patch_client_routing(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    require_mutation(&actor)?;
    let object = body.as_object().ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "Ожидается объект настроек маршрутизации.",
        )
    })?;
    if object.len() != 1 || !object.contains_key("profiles") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Разрешено изменять только массив profiles.",
        ));
    }
    let profiles = object.get("profiles").unwrap();
    client_routing::validate(profiles)
        .map_err(|reason| ApiError::new(StatusCode::BAD_REQUEST, reason))?;
    let settings: Value = sqlx::query_scalar(
        "INSERT INTO app_settings(key,value) VALUES('panel',$1)
         ON CONFLICT(key) DO UPDATE
         SET value=app_settings.value || EXCLUDED.value,updated_at=NOW()
         RETURNING value",
    )
    .bind(json!({"clientRoutingProfiles":profiles}))
    .fetch_one(&state.pool)
    .await?;
    audit(
        &state.pool,
        &actor.username,
        "client-routing.update",
        None,
        None,
        json!({
            "templates":profiles.as_array().map_or(0,Vec::len)
        }),
    )
    .await;
    Ok(Json(json!({"profiles":settings["clientRoutingProfiles"]})))
}

async fn get_stats(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let users = load_records(&state.pool, "users").await?;
    let nodes = load_records(&state.pool, "nodes").await?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX);
    let mut by = BTreeMap::<String, usize>::new();
    for user in &users {
        *by.entry(user_status(user, now_ms).to_owned()).or_default() += 1;
    }
    let online = users
        .iter()
        .filter(|user| user_is_online(user, now_ms))
        .count();
    let mut node_on = Map::new();
    let mut n_on = 0usize;
    for node in &nodes {
        if node.get("disabled").and_then(Value::as_bool) != Some(true)
            && node.get("state").and_then(Value::as_str) == Some("ONLINE")
        {
            n_on += 1;
            node_on.insert(
                node.get("id").map(ToString::to_string).unwrap_or_default(),
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

async fn system_meminfo() -> (u64, u64) {
    let meminfo = tokio::fs::read_to_string("/proc/meminfo")
        .await
        .unwrap_or_default();
    let mem_value = |key: &str| -> u64 {
        meminfo
            .lines()
            .find_map(|line| {
                let mut parts = line.split_whitespace();
                if parts.next()? != key {
                    return None;
                }
                parts
                    .next()?
                    .parse::<u64>()
                    .ok()
                    .map(|kb| kb.saturating_mul(1024))
            })
            .unwrap_or(0)
    };
    (mem_value("MemTotal:"), mem_value("MemAvailable:"))
}

fn numeric_u64_to_f64(value: u64) -> f64 {
    json!(value).as_f64().unwrap_or(0.0)
}

fn numeric_i64_to_f64(value: i64) -> f64 {
    json!(value).as_f64().unwrap_or(0.0)
}

fn nonnegative_float_to_u64(value: f64) -> u64 {
    if value.is_nan() || value <= 0.0 {
        return 0;
    }
    value.trunc().to_string().parse::<u64>().unwrap_or(u64::MAX)
}

fn saturating_float_to_i64(value: f64) -> i64 {
    if value.is_nan() {
        return 0;
    }
    value
        .trunc()
        .to_string()
        .parse::<i64>()
        .unwrap_or_else(|_| {
            if value.is_sign_negative() {
                i64::MIN
            } else {
                i64::MAX
            }
        })
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
                Some(
                    (numeric_u64_to_f64(total_delta.saturating_sub(idle_delta)) * 100.0
                        / numeric_u64_to_f64(total_delta))
                    .clamp(0.0, 100.0),
                )
            } else {
                None
            }
        }
        _ => None,
    };

    let (ram_total, mem_available) = system_meminfo().await;
    let ram_available = mem_available.min(ram_total);
    let ram_used = ram_total.saturating_sub(ram_available);
    let ram_percent = if ram_total > 0 {
        Some(numeric_u64_to_f64(ram_used) * 100.0 / numeric_u64_to_f64(ram_total))
    } else {
        None
    };

    let disk = tokio::process::Command::new("df")
        .args(["-B1", "-P", "/"])
        .output()
        .await
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|output| output.lines().nth(1).map(str::to_owned))
        .and_then(|line| {
            let cols = line.split_whitespace().collect::<Vec<_>>();
            if cols.len() < 6 {
                return None;
            }
            let total = cols[1].parse::<u64>().ok()?;
            let used = cols[2].parse::<u64>().ok()?;
            let available = cols[3].parse::<u64>().ok()?;
            Some(json!({
                "totalBytes": total, "usedBytes": used, "availableBytes": available,
                "percent": if total > 0 { Some(numeric_u64_to_f64(used) * 100.0 / numeric_u64_to_f64(total)) } else { None },
                "mount": cols[5]
            }))
        });

    let uptime_seconds = tokio::fs::read_to_string("/proc/uptime")
        .await
        .ok()
        .and_then(|s| s.split_whitespace().next()?.parse::<f64>().ok())
        .map(nonnegative_float_to_u64);
    let load = tokio::fs::read_to_string("/proc/loadavg")
        .await
        .unwrap_or_default();
    let loads = load
        .split_whitespace()
        .take(3)
        .filter_map(|v| v.parse::<f64>().ok())
        .collect::<Vec<_>>();
    let process_count = match tokio::fs::read_dir("/proc").await {
        Ok(mut entries) => {
            let mut count = 0u64;
            while let Ok(Some(entry)) = entries.next_entry().await {
                if entry.file_name().to_string_lossy().parse::<u32>().is_ok() {
                    count += 1;
                }
            }
            Some(count)
        }
        Err(_) => None,
    };
    let db_status = if sqlx::query("SELECT 1").execute(&state.pool).await.is_ok() {
        "online"
    } else {
        "offline"
    };
    let sampled_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX);

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

/// Read-only dashboard overview from actual `TimescaleDB` measurements.
/// Samples older than 5 minutes are reported stale, never as live zeroes.
async fn inbound_traffic_summary(pool: &PgPool) -> Result<(i64, i64, i64), ApiError> {
    let inbound: (i64, i64, i64) = {
        let row = sqlx::query(
            "SELECT COUNT(*)::BIGINT AS entries,
                    COALESCE(SUM(uplink_bytes),0)::BIGINT AS up,
                    COALESCE(SUM(downlink_bytes),0)::BIGINT AS down
             FROM user_inbound_traffic_totals",
        )
        .fetch_one(pool)
        .await?;
        (
            row.try_get("entries")?,
            row.try_get("up")?,
            row.try_get("down")?,
        )
    };
    Ok(inbound)
}

// Distinguish delayed or missing telemetry from genuine zero usage.
const fn metric_freshness(sampled_at_ms: i64, now_ms: i64) -> &'static str {
    if sampled_at_ms > now_ms.saturating_add(30_000) {
        "invalid"
    } else if sampled_at_ms >= now_ms.saturating_sub(65_000) {
        "fresh"
    } else if sampled_at_ms >= now_ms.saturating_sub(300_000) {
        "delayed"
    } else {
        "stale"
    }
}

#[cfg(test)]
mod metric_freshness_tests {
    use super::metric_freshness;

    #[test]
    fn distinguishes_fresh_delayed_stale_and_future_samples() {
        let now = 1_800_000_000_000_i64;
        assert_eq!(metric_freshness(now, now), "fresh");
        assert_eq!(metric_freshness(now - 65_000, now), "fresh");
        assert_eq!(metric_freshness(now - 65_001, now), "delayed");
        assert_eq!(metric_freshness(now - 300_000, now), "delayed");
        assert_eq!(metric_freshness(now - 300_001, now), "stale");
        assert_eq!(metric_freshness(now + 30_001, now), "invalid");
    }
}

// Lifetime counters are not a time series: never label them as usage in a selected period.
#[derive(Debug, Deserialize)]
struct StatisticsPeriodQuery {
    range: Option<String>,
}

fn statistics_period(range: Option<&str>) -> Result<(&'static str, &'static str), ApiError> {
    match range.unwrap_or("24h") {
        "1h" => Ok(("1h", "1 hour")),
        "24h" => Ok(("24h", "24 hours")),
        "7d" => Ok(("7d", "7 days")),
        "30d" => Ok(("30d", "30 days")),
        _ => Err(ApiError::new(StatusCode::BAD_REQUEST, "Неверный период.")),
    }
}

async fn get_statistics_period_leaders(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Query(query): Query<StatisticsPeriodQuery>,
) -> Result<Json<Value>, ApiError> {
    if viewer_read_only(&actor) {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "Недостаточно прав."));
    }
    let (range, duration) = statistics_period(query.range.as_deref())?;
    // Independent signed counter families: user totals and inbound totals MUST NOT be added.
    let users = sqlx::query(
        "SELECT d.user_id,
                COALESCE(NULLIF(u.data->>'username',''),NULLIF(u.data->>'name',''),
                    'Пользователь #'||d.user_id::TEXT) AS name,
                SUM(d.uplink_bytes)::BIGINT AS up, SUM(d.downlink_bytes)::BIGINT AS down
         FROM verified_traffic_deltas d
         JOIN panel_records u ON u.collection='users' AND u.id=d.user_id
         WHERE d.source_type='user' AND d.sampled_at>=NOW()-$1::INTERVAL
         GROUP BY d.user_id,u.data
         ORDER BY SUM(d.uplink_bytes+d.downlink_bytes) DESC,d.user_id
         LIMIT 10",
    )
    .bind(duration)
    .fetch_all(&state.pool)
    .await?;
    let inbounds = sqlx::query(
        "SELECT inbound_tag,SUM(uplink_bytes)::BIGINT AS up,
                SUM(downlink_bytes)::BIGINT AS down,
                COUNT(DISTINCT user_id)::BIGINT AS users
         FROM verified_traffic_deltas
         WHERE source_type='inbound' AND sampled_at>=NOW()-$1::INTERVAL
         GROUP BY inbound_tag
         ORDER BY SUM(uplink_bytes+downlink_bytes) DESC,inbound_tag LIMIT 10",
    )
    .bind(duration)
    .fetch_all(&state.pool)
    .await?;
    let nodes = sqlx::query(
        "SELECT d.node_id,
                COALESCE(NULLIF(n.data->>'name',''),'Узел #'||d.node_id::TEXT) AS name,
                SUM(d.uplink_bytes)::BIGINT AS up,SUM(d.downlink_bytes)::BIGINT AS down
         FROM verified_traffic_deltas d
         LEFT JOIN panel_records n ON n.collection='nodes' AND n.id=d.node_id
         WHERE d.source_type='user' AND d.sampled_at>=NOW()-$1::INTERVAL
         GROUP BY d.node_id,n.data
         ORDER BY SUM(d.uplink_bytes+d.downlink_bytes) DESC,d.node_id LIMIT 10",
    )
    .bind(duration)
    .fetch_all(&state.pool)
    .await?;
    let mut top_users = Vec::with_capacity(users.len());
    for row in users {
        top_users.push(json!({
            "userId":row.try_get::<i64,_>("user_id")?,
            "name":row.try_get::<String,_>("name")?,
            "uplinkBytes":row.try_get::<i64,_>("up")?,
            "downlinkBytes":row.try_get::<i64,_>("down")?
        }));
    }
    let mut top_inbounds = Vec::with_capacity(inbounds.len());
    for row in inbounds {
        top_inbounds.push(json!({
            "inboundTag":row.try_get::<String,_>("inbound_tag")?,
            "uplinkBytes":row.try_get::<i64,_>("up")?,
            "downlinkBytes":row.try_get::<i64,_>("down")?,
            "userCount":row.try_get::<i64,_>("users")?
        }));
    }
    let mut top_nodes = Vec::with_capacity(nodes.len());
    for row in nodes {
        top_nodes.push(json!({
            "nodeId":row.try_get::<i64,_>("node_id")?,
            "name":row.try_get::<String,_>("name")?,
            "uplinkBytes":row.try_get::<i64,_>("up")?,
            "downlinkBytes":row.try_get::<i64,_>("down")?
        }));
    }
    Ok(Json(json!({
        "range":range,"source":"verified_traffic_deltas",
        "countersAreIndependent":true,
        "topUsers":top_users,"topInbounds":top_inbounds,"topNodes":top_nodes
    })))
}

async fn get_statistics_leaders(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
) -> Result<Json<Value>, ApiError> {
    if viewer_read_only(&actor) {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "Недостаточно прав."));
    }
    let users = sqlx::query(
        "SELECT t.user_id, COALESCE(NULLIF(u.data->>'username',''),NULLIF(u.data->>'name',''),'Пользователь #'||t.user_id::text) AS name,
                SUM(t.uplink_bytes)::BIGINT AS up, SUM(t.downlink_bytes)::BIGINT AS down
         FROM user_node_traffic_totals t
         JOIN panel_records u ON u.collection='users' AND u.id=t.user_id
         GROUP BY t.user_id,u.data
         ORDER BY SUM(t.uplink_bytes+t.downlink_bytes) DESC,t.user_id LIMIT 10"
    ).fetch_all(&state.pool).await?;
    let inbounds = sqlx::query(
        "SELECT inbound_tag, SUM(uplink_bytes)::BIGINT AS up, SUM(downlink_bytes)::BIGINT AS down,
                COUNT(DISTINCT user_id)::BIGINT AS users
         FROM user_inbound_traffic_totals
         GROUP BY inbound_tag
         ORDER BY SUM(uplink_bytes+downlink_bytes) DESC,inbound_tag LIMIT 10",
    )
    .fetch_all(&state.pool)
    .await?;
    let mut top_users = Vec::with_capacity(users.len());
    for row in users {
        top_users.push(json!({
            "userId":row.try_get::<i64,_>("user_id")?,
            "name":row.try_get::<String,_>("name")?,
            "uplinkBytes":row.try_get::<i64,_>("up")?,
            "downlinkBytes":row.try_get::<i64,_>("down")?
        }));
    }
    let mut top_inbounds = Vec::with_capacity(inbounds.len());
    for row in inbounds {
        top_inbounds.push(json!({
            "inboundTag":row.try_get::<String,_>("inbound_tag")?,
            "uplinkBytes":row.try_get::<i64,_>("up")?,
            "downlinkBytes":row.try_get::<i64,_>("down")?,
            "userCount":row.try_get::<i64,_>("users")?
        }));
    }
    Ok(Json(json!({
        "period":"lifetime_since_first_verified_sample",
        "usersSource":"user_node_traffic_totals",
        "inboundsSource":"user_inbound_traffic_totals",
        "countersAreIndependent":true,
        "topUsers":top_users,
        "topInbounds":top_inbounds
    })))
}

async fn get_statistics_overview(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
) -> Result<Json<Value>, ApiError> {
    let now_ms: i64 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX);
    let records = load_records(&state.pool, "nodes").await?;
    let mut nodes = Vec::with_capacity(records.len());
    for node in records {
        let id = node.get("id").and_then(Value::as_i64).unwrap_or(0);
        if id <= 0 {
            continue;
        }
        let sample = sqlx::query(
            "SELECT cpu_percent, ram_used_bytes, ram_total_bytes, disk_used_bytes, disk_total_bytes,
                    rx_bytes_per_sec,tx_bytes_per_sec,active_connections,online_clients,metrics,
                    (EXTRACT(EPOCH FROM sampled_at)*1000)::BIGINT AS sampled_at_ms
             FROM server_metric_samples WHERE node_id=$1 ORDER BY sampled_at DESC LIMIT 1"
        ).bind(id.to_string()).fetch_optional(&state.pool).await?;
        let current = if let Some(row) = sample {
            let metric: Value = row.try_get("metrics")?;
            let sampled_at: i64 = row.try_get("sampled_at_ms")?;
            Some(json!({
                "cpuPercent":row.try_get::<Option<f64>,_>("cpu_percent")?,
                "cpuStealPercent":metric.get("cpuStealPercent"),
                "ramUsedBytes":row.try_get::<Option<i64>,_>("ram_used_bytes")?,
                "ramTotalBytes":row.try_get::<Option<i64>,_>("ram_total_bytes")?,
                "diskUsedBytes":row.try_get::<Option<i64>,_>("disk_used_bytes")?,
                "diskTotalBytes":row.try_get::<Option<i64>,_>("disk_total_bytes")?,
                "rxBytesPerSec":row.try_get::<Option<f64>,_>("rx_bytes_per_sec")?,
                "txBytesPerSec":row.try_get::<Option<f64>,_>("tx_bytes_per_sec")?,
                "activeConnections":row.try_get::<Option<i32>,_>("active_connections")?,
                "onlineClients":row.try_get::<Option<i32>,_>("online_clients")?,
                "userStatsStatus":metric.get("userStatsStatus"),
                "userStatsAtMs":metric.get("userStatsAtMs"),
                "sampledAt":sampled_at,
                "freshness":metric_freshness(sampled_at, now_ms),
                "stale":now_ms > sampled_at.saturating_add(300_000)
            }))
        } else {
            None
        };
        let traffic = sqlx::query(
            "SELECT rx_bytes, tx_bytes, observations,
                    (EXTRACT(EPOCH FROM updated_at)*1000)::BIGINT AS updated_at_ms
             FROM node_network_traffic_totals WHERE node_id=$1",
        )
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
        let (network_rx, network_tx, network_samples, network_updated) = if let Some(t) = traffic {
            (
                Some(t.try_get::<i64, _>("rx_bytes")?),
                Some(t.try_get::<i64, _>("tx_bytes")?),
                Some(t.try_get::<i64, _>("observations")?),
                Some(t.try_get::<i64, _>("updated_at_ms")?),
            )
        } else {
            (None, None, None, None)
        };
        let telemetry_state = current
            .as_ref()
            .and_then(|value| value.get("freshness"))
            .and_then(Value::as_str)
            .unwrap_or("never_received");
        nodes.push(json!({
            "networkRxBytes":network_rx,
            "networkTxBytes":network_tx,
            "networkObservations":network_samples,
            "networkUpdatedAt":network_updated,
            "networkTrafficSource":"interface_counters_since_first_sample",
            "id":id,
            "name":node.get("name").and_then(Value::as_str).unwrap_or("Узел"),
            "hosting":if viewer_read_only(&actor){Value::Null}
                else{node.get("hosting").cloned().unwrap_or(Value::Null)},
            "flag":node.get("flag"),
            "disabled":node.get("disabled"),
            "latest":current,
            "telemetryState":telemetry_state
        }));
    }
    let users: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM panel_records WHERE collection='users'")
            .fetch_one(&state.pool)
            .await?;
    let inbound = inbound_traffic_summary(&state.pool).await?;
    let total_nodes = nodes.len();
    Ok(Json(json!({
        "nodes":nodes,
        "totalNodes":total_nodes,
        "totalUsers":users,
        "inboundTraffic":{"counters":inbound.0,"uplinkBytes":inbound.1,"downlinkBytes":inbound.2},
        "source":"signed_node_metrics",
        "staleAfterSeconds":300
    })))
}

fn prepare_node_metrics(
    body: &NodeMetricsIngestRequest,
    mut metrics: Value,
) -> Result<Value, ApiError> {
    if let Some(status) = body.user_stats_status.as_deref() {
        if !matches!(status, "verified" | "direct" | "unavailable") {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Некорректный статус персонального учёта.",
            ));
        }
        if let Some(map) = metrics.as_object_mut() {
            map.insert("userStatsStatus".into(), json!(status));
            if let Some(at) = body.user_stats_at_ms {
                if at < 0 {
                    return Err(ApiError::new(
                        StatusCode::BAD_REQUEST,
                        "Некорректное время пользовательских счётчиков.",
                    ));
                }
                map.insert("userStatsAtMs".into(), json!(at));
            }
        }
    }
    if let Some(steal) = body.cpu_steal_percent {
        if !steal.is_finite() || !(0.0..=100.0).contains(&steal) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Некорректное значение CPU steal time.",
            ));
        }
        if let Some(map) = metrics.as_object_mut() {
            map.insert("cpuStealPercent".into(), json!(steal));
        }
    }
    if !metrics.is_object()
        || serde_json::to_vec(&metrics).map_or(usize::MAX, |v| v.len()) > 32 * 1024
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "metrics должен быть JSON-объектом не больше 32 КиБ.",
        ));
    }
    if body
        .cpu_percent
        .is_some_and(|value| !value.is_finite() || !(0.0..=100.0).contains(&value))
        || body
            .cpu_steal_percent
            .is_some_and(|value| !value.is_finite() || !(0.0..=100.0).contains(&value))
        || body.ram_used_bytes.is_some_and(|value| value < 0)
        || body.ram_total_bytes.is_some_and(|value| value < 0)
        || body.disk_used_bytes.is_some_and(|value| value < 0)
        || body.disk_total_bytes.is_some_and(|value| value < 0)
        || body
            .rx_bytes_per_sec
            .is_some_and(|value| !value.is_finite() || value < 0.0)
        || body
            .tx_bytes_per_sec
            .is_some_and(|value| !value.is_finite() || value < 0.0)
        || body.active_connections.is_some_and(|value| value < 0)
        || body.online_clients.is_some_and(|value| value < 0)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Одно или несколько значений метрик выходят за допустимые пределы.",
        ));
    }

    Ok(metrics)
}

fn validate_user_traffic_samples(user_traffic: &[UserTrafficSample]) -> Result<(), ApiError> {
    if user_traffic.len() > 2048 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Не более 2048 пользователей за один пакет метрик.",
        ));
    }
    let mut seen_users = std::collections::HashSet::new();
    for sample in user_traffic {
        if sample.user_id <= 0
            || sample.uplink_bytes < 0
            || sample.downlink_bytes < 0
            || !seen_users.insert(sample.user_id)
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Некорректная или дублирующаяся запись userTraffic.",
            ));
        }
    }

    Ok(())
}

fn validate_inbound_traffic_samples(
    inbound_samples: &[UserInboundTrafficSample],
) -> Result<(), ApiError> {
    if inbound_samples.len() > 4096 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Не более 4096 inbound-счётчиков за один пакет.",
        ));
    }
    let mut inbound_seen = std::collections::HashSet::new();
    for sample in inbound_samples {
        if sample.user_id <= 0
            || sample.uplink_bytes < 0
            || sample.downlink_bytes < 0
            || sample.inbound_tag.is_empty()
            || sample.inbound_tag.len() > 128
            || sample.inbound_tag.chars().any(char::is_control)
            || !inbound_seen.insert((sample.user_id, sample.inbound_tag.as_str()))
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Некорректная или дублирующаяся запись userInboundTraffic.",
            ));
        }
    }

    Ok(())
}

fn parse_node_network_sample(metrics: &Value) -> Result<Option<(i64, i64, String)>, ApiError> {
    let network_sample = match (
        metrics.get("rxTotalBytes"),
        metrics.get("txTotalBytes"),
        metrics.get("interface"),
    ) {
        (None, None, _) => None,
        (Some(rx), Some(tx), Some(interface)) => {
            let rx = rx.as_i64().filter(|n| *n >= 0).ok_or_else(|| {
                ApiError::new(StatusCode::BAD_REQUEST, "Недопустимый rxTotalBytes")
            })?;
            let tx = tx.as_i64().filter(|n| *n >= 0).ok_or_else(|| {
                ApiError::new(StatusCode::BAD_REQUEST, "Недопустимый txTotalBytes")
            })?;
            let interface = interface
                .as_str()
                .filter(|name| {
                    !name.is_empty()
                        && name.len() <= 64
                        && name
                            .bytes()
                            .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c))
                })
                .ok_or_else(|| {
                    ApiError::new(StatusCode::BAD_REQUEST, "Недопустимый сетевой интерфейс")
                })?;
            Some((rx, tx, interface.to_owned()))
        }
        _ => {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Счётчики RX/TX ноды должны передаваться вместе с интерфейсом",
            ));
        }
    };
    Ok(network_sample)
}

async fn persist_node_network_counters(
    conn: &mut sqlx::PgConnection,
    node_id: i64,
    network_sample: Option<(i64, i64, String)>,
) -> Result<(), ApiError> {
    if let Some((rx, tx, interface)) = network_sample {
        // The first sample is a baseline, not historical traffic. A reboot or
        // switch to another NIC resets the baseline without a negative delta.
        sqlx::query(
            "INSERT INTO node_network_traffic_totals AS totals (
                 node_id,interface_name,last_rx_bytes,last_tx_bytes,
                 rx_bytes,tx_bytes,observations,updated_at
             ) VALUES ($1,$2,$3,$4,0,0,1,NOW())
             ON CONFLICT (node_id) DO UPDATE SET
               rx_bytes=totals.rx_bytes+
                 CASE WHEN totals.interface_name=EXCLUDED.interface_name
                   THEN GREATEST(EXCLUDED.last_rx_bytes-totals.last_rx_bytes,0)
                   ELSE 0 END,
               tx_bytes=totals.tx_bytes+
                 CASE WHEN totals.interface_name=EXCLUDED.interface_name
                   THEN GREATEST(EXCLUDED.last_tx_bytes-totals.last_tx_bytes,0)
                   ELSE 0 END,
               interface_name=EXCLUDED.interface_name,
               last_rx_bytes=EXCLUDED.last_rx_bytes,
               last_tx_bytes=EXCLUDED.last_tx_bytes,
               observations=totals.observations+1,
               updated_at=NOW()",
        )
        .bind(node_id)
        .bind(interface)
        .bind(rx)
        .bind(tx)
        .execute(&mut *conn)
        .await?;
    }

    Ok(())
}

async fn enforce_node_traffic_limit(
    conn: &mut sqlx::PgConnection,
    node_id: i64,
) -> Result<(), ApiError> {
    let cutoff = sqlx::query(
        "UPDATE panel_records AS node SET
           data=jsonb_set(
             jsonb_set(
               jsonb_set(data,'{disabled}','true'::jsonb,true),
               '{disabledReason}',to_jsonb('traffic_limit'::text),true),
             '{trafficLimitReachedAt}',to_jsonb(NOW()::text),true),
           updated_at=NOW()
         WHERE collection='nodes' AND id=$1
           AND COALESCE((data->>'disabled')::boolean,false)=false
           AND jsonb_typeof(data->'limit')='number'
           AND (data->>'limit')::numeric>0
           AND EXISTS (
             SELECT 1 FROM node_network_traffic_totals t
             WHERE t.node_id=$1
               AND (t.rx_bytes::numeric+t.tx_bytes::numeric)
                   * CASE
                       WHEN jsonb_typeof(data->'mult')='number'
                         AND (data->>'mult')::numeric > 0
                         AND (data->>'mult')::numeric <= 1000
                       THEN (data->>'mult')::numeric
                       ELSE 1
                     END
                   >= (data->>'limit')::numeric*1073741824
           )
         RETURNING data->>'name' AS node_name,
           (data->>'limit')::numeric AS limit_gb",
    )
    .bind(node_id)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(row) = cutoff {
        tracing::error!(node_id=node_id,
          name=?row.try_get::<Option<String>,_>("node_name")?,
          "NODE TRAFFIC LIMIT EXHAUSTED: automatic Xray shutdown required");
    }

    Ok(())
}

// Called before cumulative UPSERTs in the same signed-telemetry transaction.
// Capture only forward movement of both counters; a reset establishes a new baseline.
async fn persist_verified_traffic_deltas(
    conn: &mut sqlx::PgConnection,
    node_id: i64,
    samples: &Value,
    sampled_at: i64,
    inbound: bool,
) -> Result<(), ApiError> {
    let sql = if inbound {
        "INSERT INTO verified_traffic_deltas
             (sampled_at,node_id,user_id,source_type,inbound_tag,uplink_bytes,downlink_bytes)
         SELECT to_timestamp($3::DOUBLE PRECISION/1000),$1,s.user_id,'inbound',s.inbound_tag,
                s.uplink_bytes-t.last_uplink_bytes,
                s.downlink_bytes-t.last_downlink_bytes
         FROM jsonb_to_recordset($2::jsonb)
              AS s(user_id BIGINT,inbound_tag TEXT,uplink_bytes BIGINT,downlink_bytes BIGINT)
         JOIN user_inbound_traffic_totals t
           ON t.node_id=$1 AND t.user_id=s.user_id AND t.inbound_tag=s.inbound_tag
         WHERE s.uplink_bytes>=t.last_uplink_bytes
           AND s.downlink_bytes>=t.last_downlink_bytes
           AND (s.uplink_bytes>t.last_uplink_bytes OR s.downlink_bytes>t.last_downlink_bytes)"
    } else {
        "INSERT INTO verified_traffic_deltas
             (sampled_at,node_id,user_id,source_type,inbound_tag,uplink_bytes,downlink_bytes)
         SELECT to_timestamp($3::DOUBLE PRECISION/1000),$1,s.user_id,'user','',
                s.uplink_bytes-t.last_uplink_bytes,
                s.downlink_bytes-t.last_downlink_bytes
         FROM jsonb_to_recordset($2::jsonb)
              AS s(user_id BIGINT,uplink_bytes BIGINT,downlink_bytes BIGINT)
         JOIN user_node_traffic_totals t ON t.node_id=$1 AND t.user_id=s.user_id
         WHERE s.uplink_bytes>=t.last_uplink_bytes
           AND s.downlink_bytes>=t.last_downlink_bytes
           AND (s.uplink_bytes>t.last_uplink_bytes OR s.downlink_bytes>t.last_downlink_bytes)"
    };
    sqlx::query(sql)
        .bind(node_id)
        .bind(samples)
        .bind(sampled_at)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn persist_user_traffic(
    conn: &mut sqlx::PgConnection,
    node_id: i64,
    user_traffic: &[UserTrafficSample],
    sampled_at: i64,
    source_ms: i64,
) -> Result<(), ApiError> {
    if !user_traffic.is_empty() {
        // One atomic UPSERT for the full node batch. Initial samples establish a
        // baseline instead of spuriously counting traffic from before collection.
        // Counter resets start a new baseline, never subtract or fabricate usage.
        let serialized = serde_json::to_value(user_traffic)
            .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Некорректный userTraffic."))?;
        // Only a positive delta from an authenticated per-user Xray counter
        // constitutes activity. Repeated idle samples must NOT refresh onlineAt.
        // Preserve the last activity timestamp across node restarts and resets.
        sqlx::query(
            "UPDATE panel_records AS u
             SET data=jsonb_set(
                   u.data,'{onlineAt}',
                   to_jsonb(GREATEST(
                     CASE WHEN (u.data->>'onlineAt') ~ '^[0-9]{1,16}$'
                       THEN (u.data->>'onlineAt')::BIGINT ELSE 0 END,
                     LEAST($3::BIGINT,$4::BIGINT))),true),
                 updated_at=NOW()
             FROM jsonb_to_recordset($2::jsonb)
                  AS sample(user_id BIGINT,uplink_bytes BIGINT,downlink_bytes BIGINT)
             LEFT JOIN user_node_traffic_totals AS previous
                  ON previous.node_id=$1 AND previous.user_id=sample.user_id
             WHERE u.collection='users' AND u.id=sample.user_id
               AND previous.user_id IS NOT NULL
               AND sample.uplink_bytes >= previous.last_uplink_bytes
               AND sample.downlink_bytes >= previous.last_downlink_bytes
               AND (sample.uplink_bytes>previous.last_uplink_bytes
                    OR sample.downlink_bytes>previous.last_downlink_bytes)",
        )
        .bind(node_id)
        .bind(&serialized)
        .bind(sampled_at)
        .bind(source_ms)
        .execute(&mut *conn)
        .await?;
        persist_verified_traffic_deltas(conn, node_id, &serialized, sampled_at, false).await?;
        sqlx::query(
            "INSERT INTO user_node_traffic_totals AS totals (
                node_id, user_id, last_uplink_bytes, last_downlink_bytes,
                uplink_bytes, downlink_bytes, observations, updated_at
            )
            SELECT $1, metrics.user_id, metrics.uplink_bytes, metrics.downlink_bytes,
                   0, 0, 1, NOW()
            FROM jsonb_to_recordset($2::jsonb)
                 AS metrics(user_id BIGINT, uplink_bytes BIGINT, downlink_bytes BIGINT)
            JOIN panel_records u ON u.collection = 'users' AND u.id = metrics.user_id
            ON CONFLICT (node_id, user_id) DO UPDATE SET
                uplink_bytes = totals.uplink_bytes +
                    CASE WHEN EXCLUDED.last_uplink_bytes >= totals.last_uplink_bytes
                           AND EXCLUDED.last_downlink_bytes >= totals.last_downlink_bytes
                      THEN EXCLUDED.last_uplink_bytes - totals.last_uplink_bytes ELSE 0 END,
                downlink_bytes = totals.downlink_bytes +
                    CASE WHEN EXCLUDED.last_uplink_bytes >= totals.last_uplink_bytes
                           AND EXCLUDED.last_downlink_bytes >= totals.last_downlink_bytes
                      THEN EXCLUDED.last_downlink_bytes - totals.last_downlink_bytes ELSE 0 END,
                last_uplink_bytes = EXCLUDED.last_uplink_bytes,
                last_downlink_bytes = EXCLUDED.last_downlink_bytes,
                observations = totals.observations + 1,
                updated_at = NOW()",
        )
        .bind(node_id)
        .bind(serialized)
        .execute(&mut *conn)
        .await?;
    }

    Ok(())
}

async fn persist_inbound_traffic(
    conn: &mut sqlx::PgConnection,
    node_id: i64,
    inbound_samples: &[UserInboundTrafficSample],
    sampled_at: i64,
) -> Result<(), ApiError> {
    if !inbound_samples.is_empty() {
        // An inbound's aggregate traffic MUST NEVER be interpreted as per-user traffic.
        // Signed node agents report cumulative counters scoped to a real user+inbound.
        let serialized = serde_json::to_value(inbound_samples).map_err(|_| {
            ApiError::new(StatusCode::BAD_REQUEST, "Некорректный userInboundTraffic.")
        })?;
        persist_verified_traffic_deltas(conn, node_id, &serialized, sampled_at, true).await?;
        sqlx::query(
            "INSERT INTO user_inbound_traffic_totals AS totals (
                node_id,user_id,inbound_tag,last_uplink_bytes,last_downlink_bytes,
                uplink_bytes,downlink_bytes,observations,updated_at
            )
            SELECT $1,s.user_id,s.inbound_tag,s.uplink_bytes,s.downlink_bytes,0,0,1,NOW()
            FROM jsonb_to_recordset($2::jsonb)
                AS s(user_id BIGINT,inbound_tag TEXT,uplink_bytes BIGINT,downlink_bytes BIGINT)
            JOIN panel_records u ON u.collection='users' AND u.id=s.user_id
            ON CONFLICT(node_id,user_id,inbound_tag) DO UPDATE SET
                uplink_bytes=totals.uplink_bytes+
                    CASE WHEN EXCLUDED.last_uplink_bytes >= totals.last_uplink_bytes
                           AND EXCLUDED.last_downlink_bytes >= totals.last_downlink_bytes
                      THEN EXCLUDED.last_uplink_bytes-totals.last_uplink_bytes ELSE 0 END,
                downlink_bytes=totals.downlink_bytes+
                    CASE WHEN EXCLUDED.last_uplink_bytes >= totals.last_uplink_bytes
                           AND EXCLUDED.last_downlink_bytes >= totals.last_downlink_bytes
                      THEN EXCLUDED.last_downlink_bytes-totals.last_downlink_bytes ELSE 0 END,
                last_uplink_bytes=EXCLUDED.last_uplink_bytes,
                last_downlink_bytes=EXCLUDED.last_downlink_bytes,
                observations=totals.observations+1,
                updated_at=NOW()",
        )
        .bind(node_id)
        .bind(serialized)
        .execute(&mut *conn)
        .await?;
    }

    Ok(())
}

async fn accept_node_user_stats(
    conn: &mut sqlx::PgConnection,
    body: &NodeMetricsIngestRequest,
) -> Result<(i64, bool), ApiError> {
    let server_now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX);
    let source_ms = body.user_stats_at_ms.unwrap_or(0);
    let source_valid = matches!(
        body.user_stats_status.as_deref(),
        Some("verified" | "direct")
    ) && source_ms > 0
        && source_ms >= server_now_ms.saturating_sub(45_000)
        && source_ms <= server_now_ms.saturating_add(15_000);
    // Reject duplicate or out-of-order producer timestamps under the node lock.
    let latest_source_ms: Option<i64> = if source_valid {
        sqlx::query_scalar(
            "SELECT MAX((metrics->>'userStatsAtMs')::BIGINT)
             FROM server_metric_samples
             WHERE node_id=$1 AND sampled_at > NOW()-INTERVAL '2 minutes'
               AND metrics->>'userStatsAccepted'='true'
               AND (metrics->>'userStatsAtMs') ~ '^[0-9]{1,16}$'",
        )
        .bind(body.node_id.to_string())
        .fetch_one(&mut *conn)
        .await?
    } else {
        None
    };
    let accept_user_stats = source_valid && latest_source_ms.is_none_or(|last| source_ms > last);
    Ok((source_ms, accept_user_stats))
}

async fn persist_node_metric_sample(
    conn: &mut sqlx::PgConnection,
    body: &NodeMetricsIngestRequest,
    metrics: Value,
) -> Result<i64, ApiError> {
    let node_id = body.node_id.to_string();
    let sampled_at: i64 = sqlx::query_scalar(
        "INSERT INTO server_metric_samples (
            sampled_at, node_id, cpu_percent,
            ram_used_bytes, ram_total_bytes, disk_used_bytes, disk_total_bytes,
            rx_bytes_per_sec, tx_bytes_per_sec, active_connections, online_clients, metrics
         ) VALUES (
            NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
         )
         RETURNING (EXTRACT(EPOCH FROM sampled_at) * 1000)::BIGINT",
    )
    .bind(&node_id)
    .bind(body.cpu_percent)
    .bind(body.ram_used_bytes)
    .bind(body.ram_total_bytes)
    .bind(body.disk_used_bytes)
    .bind(body.disk_total_bytes)
    .bind(body.rx_bytes_per_sec)
    .bind(body.tx_bytes_per_sec)
    .bind(body.active_connections)
    .bind(body.online_clients)
    .bind(metrics)
    .fetch_one(&mut *conn)
    .await?;

    Ok(sampled_at)
}

async fn ingest_node_metrics(
    State(state): State<AppState>,
    headers: HeaderMap,
    raw_body: Bytes,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let mut body: NodeMetricsIngestRequest = serde_json::from_slice(&raw_body)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Некорректный JSON метрик."))?;
    if body.node_id <= 0 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "node_id должен быть положительным числом.",
        ));
    }
    // The node must authenticate before untrusted samples are recorded.
    // Telemetry requires a registered Ed25519 identity.
    node_auth::authenticate(&state, &headers, body.node_id, &raw_body).await?;

    let mut metrics =
        prepare_node_metrics(&body, body.metrics.clone().unwrap_or_else(|| json!({})))?;
    let mut user_traffic = body.user_traffic.take().unwrap_or_default();
    validate_user_traffic_samples(&user_traffic)?;
    let mut inbound_samples = body.user_inbound_traffic.take().unwrap_or_default();
    validate_inbound_traffic_samples(&inbound_samples)?;
    // Node-wide traffic accounting is separate from authenticated per-user
    // Xray counters. Require both monotonic NIC counters and an interface ID.
    // Older metrics agents simply omit these fields until upgraded.
    let network_sample = parse_node_network_sample(&metrics)?;
    // Serialize telemetry for this node. A delayed/duplicated Xray snapshot
    // must never roll back the baseline and turn the next idle poll into activity.
    // Keep the server sample, counters and onlineAt update in one transaction.
    let mut telemetry_tx = state.pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(body.node_id)
        .execute(&mut *telemetry_tx)
        .await?;
    let (source_ms, accept_user_stats) = accept_node_user_stats(&mut telemetry_tx, &body).await?;
    if !accept_user_stats {
        // Do not modify traffic baselines or onlineAt on stale/replayed data.
        user_traffic.clear();
        inbound_samples.clear();
    }
    metrics
        .as_object_mut()
        .expect("validated metrics object")
        .insert("userStatsAccepted".into(), json!(accept_user_stats));

    let sampled_at = persist_node_metric_sample(&mut telemetry_tx, &body, metrics).await?;

    persist_node_network_counters(&mut telemetry_tx, body.node_id, network_sample).await?;
    // Enforce an exhausted node bandwidth quota in the control plane.
    // This is independent of per-user Xray statistics and is decided on the
    // authenticated, cumulative RX+TX counters persisted above.
    // The conditional UPDATE makes the critical event idempotent.
    enforce_node_traffic_limit(&mut telemetry_tx, body.node_id).await?;

    persist_user_traffic(
        &mut telemetry_tx,
        body.node_id,
        &user_traffic,
        sampled_at,
        source_ms,
    )
    .await?;

    persist_inbound_traffic(
        &mut telemetry_tx,
        body.node_id,
        &inbound_samples,
        sampled_at,
    )
    .await?;

    // Commit source watermark, traffic accounting, and presence in one transaction.
    telemetry_tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": "accepted",
            "nodeId": body.node_id,
            "sampledAt": sampled_at,
            "userTrafficSamples": user_traffic.len(),
            "userInboundTrafficSamples": inbound_samples.len()
        })),
    ))
}

/// Authenticated, read-only user presence. No secrets or subscription tokens.
async fn get_user_presence(
    State(state): State<AppState>,
) -> Result<(HeaderMap, Json<Value>), ApiError> {
    let rows = sqlx::query(
        "SELECT id,
            CASE WHEN (data->>'onlineAt') ~ '^[0-9]{1,16}$'
                 THEN (data->>'onlineAt')::BIGINT ELSE 0 END AS online_at
         FROM panel_records WHERE collection='users'",
    )
    .fetch_all(&state.pool)
    .await?;
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        items.push(json!({
            "id":row.try_get::<i64,_>("id")?,
            "onlineAt":row.try_get::<i64,_>("online_at")?
        }));
    }
    let server_now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX);
    // Presence is operationally sensitive and must not be cached by browsers
    // or intermediaries: an old response could resurrect an offline badge.
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    headers.insert(header::VARY, HeaderValue::from_static("Cookie"));
    Ok((
        headers,
        Json(json!({
            "items":items,"serverNowMs":server_now_ms,
            "onlineWindowMs":USER_ONLINE_WINDOW_MS
        })),
    ))
}

/// Real per-user, per-node traffic collected from authenticated Xray node counters.
/// Without actual per-user counter reports this returns an empty server list.
async fn user_traffic_collectors(pool: &PgPool) -> Result<Vec<Value>, ApiError> {
    // Distinguish a truly idle user from an unreachable Xray StatsService.
    // The last signed sample on each node is advisory; it is never counted as usage.
    let collector_rows = sqlx::query(
        "SELECT n.id AS node_id,
                COALESCE(NULLIF(n.data->>'name',''),'Узел #'||n.id::text) AS node_name,
                last_sample.status,
                last_sample.sampled_at_ms
         FROM panel_records n
         LEFT JOIN LATERAL (
             SELECT sm.metrics->>'userStatsStatus' AS status,
                    (EXTRACT(EPOCH FROM sm.sampled_at)*1000)::BIGINT AS sampled_at_ms
             FROM server_metric_samples sm
             WHERE sm.node_id=n.id::text
             ORDER BY sm.sampled_at DESC LIMIT 1
         ) last_sample ON TRUE
         WHERE n.collection='nodes' ORDER BY n.id",
    )
    .fetch_all(pool)
    .await?;
    let mut collectors = Vec::with_capacity(collector_rows.len());
    for row in collector_rows {
        collectors.push(json!({
            "nodeId":row.try_get::<i64,_>("node_id")?,
            "name":row.try_get::<String,_>("node_name")?,
            "status":row.try_get::<Option<String>,_>("status")?,
            "sampledAtMs":row.try_get::<Option<i64>,_>("sampled_at_ms")?
        }));
    }
    Ok(collectors)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserTrafficHistoryQuery {
    range: Option<String>,
    inbound_tag: Option<String>,
    node_id: Option<i64>,
}

async fn get_user_traffic_observations(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Path(user_id): Path<i64>,
    Query(query): Query<UserTrafficHistoryQuery>,
) -> Result<Json<Value>, ApiError> {
    if viewer_read_only(&actor) {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "Недостаточно прав."));
    }
    if user_id <= 0
        || query.node_id.is_some_and(|id| id <= 0)
        || query
            .inbound_tag
            .as_ref()
            .is_some_and(|tag| tag.is_empty() || tag.len() > 128)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Некорректный фильтр истории.",
        ));
    }
    let (range, duration) = statistics_period(query.range.as_deref())?;
    let source_type = if query.inbound_tag.is_some() {
        "inbound"
    } else {
        "user"
    };
    let rows = sqlx::query(
        "SELECT (EXTRACT(EPOCH FROM sampled_at)*1000)::BIGINT AS sampled_at_ms,
                node_id,inbound_tag,uplink_bytes,downlink_bytes
         FROM verified_traffic_deltas
         WHERE user_id=$1 AND source_type=$2 AND sampled_at>=NOW()-$3::INTERVAL
           AND ($4::BIGINT IS NULL OR node_id=$4)
           AND ($5::TEXT IS NULL OR inbound_tag=$5)
         ORDER BY sampled_at DESC,node_id ASC,inbound_tag ASC LIMIT 501",
    )
    .bind(user_id)
    .bind(source_type)
    .bind(duration)
    .bind(query.node_id)
    .bind(&query.inbound_tag)
    .fetch_all(&state.pool)
    .await?;
    let truncated = rows.len() > 500;
    let mut observations = Vec::with_capacity(rows.len().min(500));
    for row in rows.into_iter().take(500) {
        observations.push(json!({
            "sampledAtMs":row.try_get::<i64,_>("sampled_at_ms")?,
            "nodeId":row.try_get::<i64,_>("node_id")?,
            "inboundTag":row.try_get::<String,_>("inbound_tag")?,
            "uplinkBytes":row.try_get::<i64,_>("uplink_bytes")?,
            "downlinkBytes":row.try_get::<i64,_>("downlink_bytes")?
        }));
    }
    Ok(Json(json!({
        "userId":user_id,"range":range,"sourceType":source_type,
        "source":"verified_traffic_deltas",
        "observations":observations,"truncated":truncated
    })))
}

async fn get_user_traffic_history(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Path(user_id): Path<i64>,
    Query(query): Query<UserTrafficHistoryQuery>,
) -> Result<Json<Value>, ApiError> {
    if viewer_read_only(&actor) {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "Недостаточно прав."));
    }
    if user_id <= 0
        || query.node_id.is_some_and(|id| id <= 0)
        || query
            .inbound_tag
            .as_ref()
            .is_some_and(|tag| tag.is_empty() || tag.len() > 128)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Некорректный фильтр истории.",
        ));
    }
    let (period, bucket, duration) = match query.range.as_deref().unwrap_or("24h") {
        "1h" => ("1h", "1 minute", "1 hour"),
        "24h" => ("24h", "15 minutes", "24 hours"),
        "7d" => ("7d", "1 hour", "7 days"),
        "30d" => ("30d", "6 hours", "30 days"),
        _ => return Err(ApiError::new(StatusCode::BAD_REQUEST, "Неверный период.")),
    };
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM panel_records WHERE collection='users' AND id=$1)",
    )
    .bind(user_id)
    .fetch_one(&state.pool)
    .await?;
    if !exists {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "Пользователь не найден.",
        ));
    }
    let source = if query.inbound_tag.is_some() {
        "inbound"
    } else {
        "user"
    };
    let rows = sqlx::query(
        "SELECT (EXTRACT(EPOCH FROM time_bucket($1::INTERVAL,sampled_at))*1000)::BIGINT AS bucket_ms,
                node_id,inbound_tag,
                SUM(uplink_bytes)::BIGINT AS up,SUM(downlink_bytes)::BIGINT AS down,
                COUNT(*)::BIGINT AS samples
         FROM verified_traffic_deltas
         WHERE user_id=$2 AND source_type=$3
           AND sampled_at>=NOW()-$4::INTERVAL
           AND ($5::BIGINT IS NULL OR node_id=$5)
           AND ($6::TEXT IS NULL OR inbound_tag=$6)
         GROUP BY time_bucket($1::INTERVAL,sampled_at),node_id,inbound_tag
         ORDER BY bucket_ms ASC,node_id ASC,inbound_tag ASC LIMIT 5000"
    )
    .bind(bucket)
    .bind(user_id)
    .bind(source)
    .bind(duration)
    .bind(query.node_id)
    .bind(&query.inbound_tag)
    .fetch_all(&state.pool).await?;
    let mut points = Vec::with_capacity(rows.len());
    for row in rows {
        points.push(json!({
            "bucketMs":row.try_get::<i64,_>("bucket_ms")?,
            "nodeId":row.try_get::<i64,_>("node_id")?,
            "inboundTag":row.try_get::<String,_>("inbound_tag")?,
            "uplinkBytes":row.try_get::<i64,_>("up")?,
            "downlinkBytes":row.try_get::<i64,_>("down")?,
            "sampleCount":row.try_get::<i64,_>("samples")?
        }));
    }
    let truncated = points.len() == 5000;
    Ok(Json(
        json!({"userId":user_id,"range":period,"sourceType":source,
        "source":"verified_traffic_deltas","inboundFilter":query.inbound_tag,
        "nodeFilter":query.node_id,"points":points,"truncated":truncated}),
    ))
}

async fn get_user_traffic(
    State(state): State<AppState>,
    Path(user_id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    if user_id <= 0 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Некорректный ID пользователя.",
        ));
    }
    let user_data: Value =
        sqlx::query_scalar("SELECT data FROM panel_records WHERE collection='users' AND id=$1")
            .bind(user_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Пользователь не найден."))?;
    let base_usage = user_data
        .get("used")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value >= 0.0)
        .unwrap_or(0.0);
    let rows = sqlx::query(
        "SELECT totals.node_id,
                COALESCE(
                  NULLIF(node.data->>'remark', ''),
                  NULLIF(node.data->>'name', ''),
                  NULLIF(node.data->>'tag', ''),
                  'Узел #' || totals.node_id::text
                ) AS node_name,
                totals.uplink_bytes,
                totals.downlink_bytes,
                totals.observations,
                (EXTRACT(EPOCH FROM totals.updated_at) * 1000)::BIGINT AS updated_at_ms
         FROM user_node_traffic_totals totals
         LEFT JOIN panel_records node
           ON node.collection = 'nodes' AND node.id = totals.node_id
         WHERE totals.user_id = $1
         ORDER BY (totals.uplink_bytes + totals.downlink_bytes) DESC, totals.node_id",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await?;
    let mut servers = Vec::with_capacity(rows.len());
    let mut uplink = 0_i64;
    let mut downlink = 0_i64;
    for row in rows {
        let up: i64 = row.try_get("uplink_bytes")?;
        let down: i64 = row.try_get("downlink_bytes")?;
        uplink = uplink.saturating_add(up);
        downlink = downlink.saturating_add(down);
        servers.push(json!({
            "nodeId": row.try_get::<i64, _>("node_id")?,
            "name": row.try_get::<String, _>("node_name")?,
            "uplinkBytes": up,
            "downlinkBytes": down,
            "observations": row.try_get::<i64, _>("observations")?,
            "updatedAtMs": row.try_get::<i64, _>("updated_at_ms")?
        }));
    }
    let inbound_rows = sqlx::query(
        "SELECT t.node_id,t.inbound_tag,t.uplink_bytes,t.downlink_bytes,t.observations,
                COALESCE(NULLIF(n.data->>'name',''),'Узел #'||t.node_id::text) AS node_name
         FROM user_inbound_traffic_totals t
         LEFT JOIN panel_records n ON n.collection='nodes' AND n.id=t.node_id
         WHERE t.user_id=$1 ORDER BY (t.uplink_bytes+t.downlink_bytes) DESC,t.inbound_tag",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await?;
    let mut inbound_totals = Vec::with_capacity(inbound_rows.len());
    for r in inbound_rows {
        inbound_totals.push(json!({
            "nodeId":r.try_get::<i64,_>("node_id")?,
            "nodeName":r.try_get::<String,_>("node_name")?,
            "inboundTag":r.try_get::<String,_>("inbound_tag")?,
            "uplinkBytes":r.try_get::<i64,_>("uplink_bytes")?,
            "downlinkBytes":r.try_get::<i64,_>("downlink_bytes")?,
            "observations":r.try_get::<i64,_>("observations")?
        }));
    }
    let collectors = user_traffic_collectors(&state.pool).await?;
    Ok(Json(json!({
        "collectors":collectors,
        "userId": user_id,
        "dataSource": "user_node_traffic_totals",
        "accounting": "monotonic_counter_deltas",
        "sampleCount": servers.len(),
        "totalUplinkBytes": uplink,
        "totalDownlinkBytes": downlink,
        "effectiveUsedGb": base_usage+(numeric_i64_to_f64(uplink.saturating_add(downlink)) / 1_073_741_824.0),
        "meteredUsedGb": numeric_i64_to_f64(uplink.saturating_add(downlink)) / 1_073_741_824.0,
        "servers": servers,
        "inbounds": inbound_totals,
        "inboundAccounting": "independent_signed_user_inbound_counters"
    })))
}

fn aggregate_traffic_metric_rows(
    rows: &[sqlx::postgres::PgRow],
) -> Result<(Vec<Value>, i64, i64), ApiError> {
    let mut points = Vec::with_capacity(rows.len());
    let mut total_samples = 0_i64;
    let mut latest_node_count = 0_i64;

    for row in rows {
        let bucket_ms: i64 = row.try_get("bucket_ms")?;
        let rx: f64 = row.try_get("rx_bytes_per_sec")?;
        let tx: f64 = row.try_get("tx_bytes_per_sec")?;
        let node_count: i64 = row.try_get("node_count")?;
        let sample_count: i64 = row.try_get("sample_count")?;
        total_samples = total_samples.saturating_add(sample_count);
        latest_node_count = node_count;
        points.push(json!({
            "bucketMs": bucket_ms,
            "rxBytesPerSec": rx,
            "txBytesPerSec": tx,
            "nodeCount": node_count,
            "sampleCount": sample_count
        }));
    }

    Ok((points, total_samples, latest_node_count))
}

fn traffic_metrics_range(range: Option<&str>) -> Result<(&'static str, i64), ApiError> {
    Ok(match range.unwrap_or("1h") {
        "live" => ("live", 5_i64),
        "5m" => ("5m", 10_i64),
        "15m" => ("15m", 30_i64),
        "30m" => ("30m", 30_i64),
        "1h" => ("1h", 60_i64),
        "3h" => ("3h", 180_i64),
        "6h" => ("6h", 300_i64),
        "12h" => ("12h", 600_i64),
        "24h" => ("24h", 900_i64),
        "7d" => ("7d", 3600_i64),
        "30d" => ("30d", 21_600_i64),
        _ => {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Недопустимый период статистики.",
            ));
        }
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrafficBucketDetailQuery {
    range: String,
    bucket_ms: i64,
}

async fn get_traffic_bucket_detail(
    State(state): State<AppState>,
    Query(query): Query<TrafficBucketDetailQuery>,
) -> Result<Json<Value>, ApiError> {
    let (range, interval_seconds) = traffic_metrics_range(Some(&query.range))?;
    let step_ms = interval_seconds.saturating_mul(1000);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX);
    let window_ms: i64 = match range {
        "live" => 60_000,
        "5m" => 300_000,
        "15m" => 900_000,
        "30m" => 1_800_000,
        "1h" => 3_600_000,
        "3h" => 10_800_000,
        "6h" => 21_600_000,
        "12h" => 43_200_000,
        "24h" => 86_400_000,
        "7d" => 604_800_000,
        _ => 2_592_000_000,
    };
    if query.bucket_ms <= 0
        || query.bucket_ms > now_ms.saturating_add(step_ms)
        || query.bucket_ms < now_ms.saturating_sub(window_ms.saturating_add(step_ms))
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Интервал вне выбранного периода.",
        ));
    }
    let rows = sqlx::query(
        "SELECT n.id, n.data->>'name' AS name,
                AVG(s.rx_bytes_per_sec) AS rx,
                AVG(s.tx_bytes_per_sec) AS tx,
                COUNT(s.node_id)::BIGINT AS samples,
                (EXTRACT(EPOCH FROM MAX(s.sampled_at))*1000)::BIGINT AS last_ms
         FROM server_metric_samples s
         JOIN panel_records n ON n.collection = 'nodes' AND n.id::text = s.node_id
         WHERE s.sampled_at >= to_timestamp($1::DOUBLE PRECISION / 1000.0)
           AND s.sampled_at < to_timestamp(($1::DOUBLE PRECISION + $2::DOUBLE PRECISION) / 1000.0)
         GROUP BY n.id, n.data->>'name'
         ORDER BY rx DESC NULLS LAST, n.id ASC
         LIMIT 500",
    )
    .bind(query.bucket_ms)
    .bind(step_ms)
    .fetch_all(&state.pool)
    .await?;
    let mut nodes = Vec::with_capacity(rows.len());
    for row in rows {
        nodes.push(json!({
            "id": row.try_get::<i64, _>("id")?,
            "name": row.try_get::<Option<String>, _>("name")?,
            "rxBytesPerSec": row.try_get::<Option<f64>, _>("rx")?,
            "txBytesPerSec": row.try_get::<Option<f64>, _>("tx")?,
            "sampleCount": row.try_get::<i64, _>("samples")?,
            "lastSampleMs": row.try_get::<Option<i64>, _>("last_ms")?
        }));
    }
    Ok(Json(
        json!({"range":range,"bucketMs":query.bucket_ms,"intervalSeconds":interval_seconds,
        "source":"server_metric_samples","nodes":nodes,"truncated":nodes.len()==500}),
    ))
}

async fn get_traffic_metrics(
    State(state): State<AppState>,
    Query(query): Query<TrafficMetricsQuery>,
) -> Result<Json<Value>, ApiError> {
    let (range, interval_seconds) = traffic_metrics_range(query.range.as_deref())?;

    if query.node_id.is_some_and(|id| id <= 0) || query.squad_id.is_some_and(|id| id <= 0) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "ID узла и сквада должны быть положительными числами.",
        ));
    }

    // Node identifiers in the hypertable are text versions of panel_records.id.
    // A squad includes nodes whose assigned Xray profile has at least one inbound
    // tag in common with that squad's inbound list.
    let rows = sqlx::query(
        "WITH selected_nodes AS (
            SELECT n.id::text AS node_id
            FROM panel_records n
            LEFT JOIN panel_records p
              ON p.collection = 'profiles'
             AND p.id::text = n.data->>'profileId'
            WHERE n.collection = 'nodes'
              AND ($1::BIGINT IS NULL OR n.id = $1)
              AND (
                $2::BIGINT IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM panel_records sq
                    WHERE sq.collection = 'squads'
                      AND sq.id = $2
                      AND EXISTS (
                          SELECT 1
                          FROM jsonb_array_elements_text(
                              CASE
                                WHEN jsonb_typeof(sq.data->'inb') = 'array' THEN sq.data->'inb'
                                ELSE '[]'::jsonb
                              END
                          ) AS squad_tag(tag)
                          WHERE EXISTS (
                              SELECT 1
                              FROM jsonb_array_elements(
                                  CASE
                                    WHEN p.data->>'config' IS NOT NULL
                                      THEN COALESCE((p.data->>'config')::jsonb->'inbounds', '[]'::jsonb)
                                    ELSE '[]'::jsonb
                                  END
                              ) AS profile_inbound(item)
                              WHERE profile_inbound.item->>'tag' = squad_tag.tag
                          )
                      )
                )
              )
        ),
        per_node_bucket AS (
            SELECT
                time_bucket(CASE $3::text WHEN 'live' THEN INTERVAL '5 seconds' WHEN '5m' THEN INTERVAL '10 seconds' WHEN '15m' THEN INTERVAL '30 seconds' WHEN '30m' THEN INTERVAL '30 seconds' WHEN '1h' THEN INTERVAL '1 minute' WHEN '3h' THEN INTERVAL '3 minutes' WHEN '6h' THEN INTERVAL '5 minutes' WHEN '12h' THEN INTERVAL '10 minutes' WHEN '24h' THEN INTERVAL '15 minutes' WHEN '7d' THEN INTERVAL '1 hour' ELSE INTERVAL '6 hours' END, s.sampled_at) AS bucket,
                s.node_id,
                AVG(s.rx_bytes_per_sec) AS rx_bytes_per_sec,
                AVG(s.tx_bytes_per_sec) AS tx_bytes_per_sec,
                COUNT(*)::BIGINT AS sample_count
            FROM server_metric_samples s
            WHERE s.sampled_at >= NOW() - CASE $3::text WHEN 'live' THEN INTERVAL '1 minute' WHEN '5m' THEN INTERVAL '5 minutes' WHEN '15m' THEN INTERVAL '15 minutes' WHEN '30m' THEN INTERVAL '30 minutes' WHEN '1h' THEN INTERVAL '1 hour' WHEN '3h' THEN INTERVAL '3 hours' WHEN '6h' THEN INTERVAL '6 hours' WHEN '12h' THEN INTERVAL '12 hours' WHEN '24h' THEN INTERVAL '24 hours' WHEN '7d' THEN INTERVAL '7 days' ELSE INTERVAL '30 days' END
              AND s.node_id IN (SELECT node_id FROM selected_nodes)
            GROUP BY 1, 2
        )
        SELECT
            (EXTRACT(EPOCH FROM bucket) * 1000)::BIGINT AS bucket_ms,
            COALESCE(SUM(rx_bytes_per_sec), 0)::DOUBLE PRECISION AS rx_bytes_per_sec,
            COALESCE(SUM(tx_bytes_per_sec), 0)::DOUBLE PRECISION AS tx_bytes_per_sec,
            COUNT(DISTINCT node_id)::BIGINT AS node_count,
            COALESCE(SUM(sample_count), 0)::BIGINT AS sample_count
        FROM per_node_bucket
        GROUP BY bucket
        ORDER BY bucket ASC"
    )
    .bind(query.node_id)
    .bind(query.squad_id)
    .bind(range)
    .fetch_all(&state.pool)
    .await?;

    let (points, total_samples, latest_node_count) = aggregate_traffic_metric_rows(&rows)?;

    Ok(Json(json!({
        "range": range,
        "intervalSeconds": interval_seconds,
        "nodeId": query.node_id,
        "squadId": query.squad_id,
        "dataSource": "server_metric_samples",
        "sampleCount": total_samples,
        "latestNodeCount": latest_node_count,
        "points": points
    })))
}

async fn read_cpu_ticks() -> Option<(u64, u64)> {
    let stat = tokio::fs::read_to_string("/proc/stat").await.ok()?;
    let line = stat.lines().find(|line| line.starts_with("cpu "))?;
    let values = line
        .split_whitespace()
        .skip(1)
        .take(8)
        .filter_map(|value| value.parse::<u64>().ok())
        .collect::<Vec<_>>();
    if values.len() < 4 {
        return None;
    }
    let total = values.iter().copied().fold(0u64, u64::saturating_add);
    let idle = values[3].saturating_add(*values.get(4).unwrap_or(&0));
    Some((total, idle))
}

async fn get_core_status(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
) -> Json<Value> {
    let status = state.core.status().await;
    if viewer_read_only(&actor) {
        Json(
            json!({"status":status.status,"installed_version":status.installed_version,
          "latest_version":status.latest_version,"runtime":status.runtime}),
        )
    } else {
        Json(serde_json::to_value(status).unwrap_or_else(|_| json!({})))
    }
}

async fn get_core_releases(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let releases = state
        .core
        .available_releases()
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_GATEWAY, error))?;
    Ok(Json(json!({"items": releases})))
}

#[derive(Debug, Deserialize)]
struct CoreValidationRequest {
    config: String,
}

async fn validate_xray_configuration(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Json(body): Json<CoreValidationRequest>,
) -> Result<Json<Value>, ApiError> {
    require_mutation(&actor)?;
    if body.config.len() > 512 * 1024 {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Конфигурация слишком большая.",
        ));
    }
    // Syntax errors are mapped precisely by the browser JSON parser; never claim
    // that Xray reports a line when it only reports a semantic error.
    let _: Value = serde_json::from_str(&body.config).map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "Некорректный JSON. Исправьте синтаксис в редакторе.",
        )
    })?;
    let (valid, stdout, stderr) = state
        .core
        .validate_json(&body.config)
        .await
        .map_err(|msg| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, msg))?;
    Ok(Json(json!({
        "valid": valid, "engine": "xray-core",
        "stdout": stdout, "stderr": stderr,
        "message": if valid { "Конфигурация принята установленным Xray-core." } else { "Xray-core отклонил конфигурацию." }
    })))
}

async fn generate_vless_encryption(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
) -> Result<Json<Value>, ApiError> {
    require_mutation(&actor)?;
    let generated = state
        .core
        .generate_vless_encryption()
        .await
        .map_err(|error| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, error))?;

    // Audit the action but never persist or log the secret encryption/decryption values.
    audit(
        &state.pool,
        &actor.username,
        "xray_core.vlessenc_generated",
        None,
        None,
        json!({"methods": ["x25519", "mlkem768"]}),
    )
    .await;

    Ok(Json(generated))
}

async fn update_core(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Json(body): Json<CoreUpdateRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    require_owner(&actor)?;
    let target = state
        .core
        .set_desired_version(&body.version)
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error))?;
    audit(
        &state.pool,
        &actor.username,
        "xray_core.update_requested",
        None,
        None,
        json!({"version": target}),
    )
    .await;

    let manager = state.core.clone();
    tokio::spawn(async move {
        if let Err(error) = manager.install_or_update(target).await {
            tracing::warn!(error = %error, "Requested Xray-core update failed");
        }
    });
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({
            "status": "updating",
            "message": "Обновление Xray-core запущено."
        })),
    ))
}

/// Only an authenticated owner may request an upgrade. The application never
/// executes shell commands or receives the Docker socket: a root-owned systemd
/// worker watches one fixed-value request file and performs a DB backup first.
async fn request_panel_update(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    require_owner(&actor)?;
    let request_file = env::var("PANEL_UPDATE_REQUEST").map_err(|_| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Web-обновления недоступны: настройте host systemd worker через install.sh.",
        )
    })?;
    let status_file = env::var("PANEL_UPDATE_STATUS").map_err(|_| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Web-обновления недоступны: нет файла состояния.",
        )
    })?;
    let status = tokio::fs::read_to_string(&status_file).await.map_err(|_| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Хостовый updater не инициализирован.",
        )
    })?;
    if status.trim() == "running" {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Обновление уже выполняется.",
        ));
    }
    // An accepted request is not proof that the host systemd worker ran.
    // Keep pending requests visible and reject duplicate button presses.
    let pending = tokio::fs::read_to_string(&request_file)
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "Не удалось проверить очередь обновления на хосте.",
            )
        })?;
    if pending.trim() == "update" {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Обновление уже находится в очереди. Проверьте systemd updater.",
        ));
    }
    tokio::fs::write(&request_file, b"update\n")
        .await
        .map_err(|error| {
            tracing::error!(%error,"Panel update request could not be written");
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "Не удалось передать запрос хостовому updater.",
            )
        })?;
    audit(
        &state.pool,
        &actor.username,
        "panel.update_requested",
        None,
        None,
        json!({"source":"owner_web"}),
    )
    .await;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({
            "status":"queued",
            "message":"Запрос передан в системный updater. БД будет скопирована до обновления."
        })),
    ))
}

async fn get_panel_update_status(
    Extension(actor): Extension<auth::AuthUser>,
) -> Result<Json<Value>, ApiError> {
    require_owner(&actor)?;
    let state = match env::var("PANEL_UPDATE_STATUS") {
        Ok(path) => tokio::fs::read_to_string(path)
            .await
            .unwrap_or_else(|_| "unavailable".into()),
        Err(_) => "unavailable".into(),
    };
    let status = match state.trim() {
        "running" => "running",
        "success" => "success",
        "failed" => "failed",
        "idle" => "idle",
        _ => "unavailable",
    };
    // The root-owned watcher clears the request before it sets "running".
    // Until then report queued, never stale "success" or "idle".
    let pending = match env::var("PANEL_UPDATE_REQUEST") {
        Ok(path) => match tokio::fs::read_to_string(path).await {
            Ok(pending) => pending,
            Err(_) => return Ok(Json(json!({"status":"unavailable"}))),
        },
        Err(_) => return Ok(Json(json!({"status":"unavailable"}))),
    };
    let status = if pending.trim() == "update" && status != "running" {
        "queued"
    } else {
        status
    };
    Ok(Json(json!({"status":status})))
}

async fn read_settings(pool: &PgPool) -> Result<Value, ApiError> {
    Ok(
        sqlx::query_scalar::<_, Value>("SELECT value FROM app_settings WHERE key = 'panel'")
            .fetch_optional(pool)
            .await?
            .unwrap_or_else(|| {
                json!({
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
                })
            }),
    )
}

// Panel quotas are expressed in GiB; signed node counters are bytes.
// Keep the manually configured baseline in panel_records and overlay actual,
// monotonic signed user counters on reads. Never use node-wide RX/TX here.
pub(crate) fn add_metered_usage(user: &mut Value, bytes: i64) {
    let base = user
        .get("used")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .max(0.0);
    let measured = numeric_i64_to_f64(bytes.max(0)) / 1_073_741_824.0;
    if let Some(object) = user.as_object_mut() {
        object.insert("used".into(), json!(base + measured));
        object.insert("meteredUsedGb".into(), json!(measured));
    }
}

pub(crate) async fn user_metered_bytes(pool: &PgPool, user_id: i64) -> Result<i64, ApiError> {
    let bytes: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(uplink_bytes + downlink_bytes),0)::BIGINT
         FROM user_node_traffic_totals WHERE user_id=$1",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(bytes.max(0))
}

// Stable SS2022 keys are provisioned before both public subscriptions and
// managed node policies; never regenerate them on each client download.
pub(crate) async fn ensure_ss2022_user_keys(
    pool: &PgPool,
    user_id: Option<i64>,
) -> Result<(), ApiError> {
    // Backfill older accounts before either the Xray node policy or JSON
    // subscription reads them. INSERT-time provisioning handles new users.
    // Updates are conditional so concurrent readers never rotate a key.
    use aes_gcm::aead::rand_core::RngCore as _;
    use base64::Engine as _;
    let legacy = sqlx::query(
        "SELECT id, data FROM panel_records WHERE collection='users'
         AND ($1::BIGINT IS NULL OR id=$1)
         AND (NOT (data ? 'ssPassword') OR NOT (data ? 'ssPassword128'))",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    for row in legacy {
        let id: i64 = row.try_get("id")?;
        let data: Value = row.try_get("data")?;
        let mut patch = serde_json::Map::new();
        if data.get("ssPassword").is_none() {
            let mut key = [0u8; 32];
            aes_gcm::aead::OsRng.fill_bytes(&mut key);
            patch.insert(
                "ssPassword".into(),
                json!(base64::engine::general_purpose::STANDARD.encode(key)),
            );
        }
        if data.get("ssPassword128").is_none() {
            let mut key = [0u8; 16];
            aes_gcm::aead::OsRng.fill_bytes(&mut key);
            patch.insert(
                "ssPassword128".into(),
                json!(base64::engine::general_purpose::STANDARD.encode(key)),
            );
        }
        if !patch.is_empty() {
            // Conditional JSONB update preserves existing keys if another
            // process supplied them first. Never replace an issued key.
            sqlx::query(
                "UPDATE panel_records SET
                   data = data || (
                     SELECT COALESCE(jsonb_object_agg(k.key, k.value), '{}'::jsonb)
                     FROM jsonb_each($2::jsonb) AS k(key, value)
                     WHERE NOT (panel_records.data ? k.key)
                   ),
                   updated_at = NOW()
                 WHERE collection='users' AND id=$1",
            )
            .bind(id)
            .bind(Value::Object(patch))
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

async fn load_records(pool: &PgPool, collection: &str) -> Result<Vec<Value>, ApiError> {
    validate_collection(collection)?;
    if collection == "users" {
        ensure_ss2022_user_keys(pool, None).await?;
    }
    let rows = sqlx::query("SELECT id, data FROM panel_records WHERE collection = $1 ORDER BY id")
        .bind(collection)
        .fetch_all(pool)
        .await?;
    let mut records = rows
        .iter()
        .map(row_to_record)
        .collect::<Result<Vec<_>, _>>()?;
    if collection == "users" && !records.is_empty() {
        // One grouped query, not one SQL request per user.
        let totals = sqlx::query(
            "SELECT user_id, COALESCE(SUM(uplink_bytes+downlink_bytes),0)::BIGINT AS bytes
             FROM user_node_traffic_totals GROUP BY user_id",
        )
        .fetch_all(pool)
        .await?;
        let traffic = totals
            .into_iter()
            .filter_map(|row| {
                Some((
                    row.try_get::<i64, _>("user_id").ok()?,
                    row.try_get::<i64, _>("bytes").ok()?,
                ))
            })
            .collect::<std::collections::HashMap<_, _>>();
        for user in &mut records {
            if let Some(id) = user.get("id").and_then(Value::as_i64) {
                add_metered_usage(user, *traffic.get(&id).unwrap_or(&0));
            }
        }
    }
    Ok(records)
}

fn row_to_record(row: &sqlx::postgres::PgRow) -> Result<Value, ApiError> {
    let id: i64 = row.try_get("id")?;
    let mut data: Value = row.try_get("data")?;
    let object = data.as_object_mut().ok_or_else(|| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Повреждён формат записи.",
        )
    })?;
    object.insert("id".to_owned(), json!(id));
    Ok(data)
}

fn validate_collection(collection: &str) -> Result<(), ApiError> {
    if COLLECTIONS.contains(&collection) {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "Неизвестная коллекция.",
        ))
    }
}

// A public Host is not a standalone Xray profile. Its inbound must come from
// the selected profile, and each assigned node must actually run that profile.
fn validate_public_host_endpoint(host: &Value) -> Result<(), ApiError> {
    let bad = |message: &'static str| ApiError::new(StatusCode::BAD_REQUEST, message);
    let address = host
        .get("address")
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 253
                && !value
                    .chars()
                    .any(|ch| ch.is_control() || ch.is_whitespace() || "/@?#\\".contains(ch))
        })
        .ok_or_else(|| bad("Некорректный публичный адрес хоста."))?;
    if address == "localhost" || address == "0.0.0.0" || address.starts_with("127.") {
        return Err(bad("Для подписки нужен публичный адрес ноды."));
    }
    let port = host.get("port").and_then(Value::as_u64).unwrap_or(0);
    if !(1..=65535).contains(&port) {
        return Err(bad("Укажите публичный порт 1–65535."));
    }
    Ok(())
}

// Keep the host save gate consistent with user_subscriptions::proxy_outbound.
fn subscription_host_protocol_supported(inbound: &Value) -> bool {
    matches!(
        inbound.get("protocol").and_then(Value::as_str),
        Some("vless" | "vmess" | "trojan" | "shadowsocks" | "hysteria" | "masque")
    )
}

#[cfg(test)]
mod subscription_host_protocol_tests {
    use super::*;

    #[test]
    fn all_exportable_inbounds_can_be_used_by_hosts() {
        for protocol in [
            "vless",
            "vmess",
            "trojan",
            "shadowsocks",
            "hysteria",
            "masque",
        ] {
            let inbound = json!({"tag":"test","protocol":protocol});
            assert!(subscription_host_protocol_supported(&inbound), "{protocol}");
        }
        for protocol in ["socks", "http", "wireguard", "unknown"] {
            assert!(
                !subscription_host_protocol_supported(&json!({"protocol":protocol})),
                "{protocol}"
            );
        }
        assert!(!subscription_host_protocol_supported(&json!({})));
    }
}

async fn validate_host_binding(pool: &PgPool, host: &Value) -> Result<(), ApiError> {
    // Disabled hosts are allowed to remain drafts and can always be switched off.
    // Re-enabling them validates the full runtime profile/node relationship.
    if host.get("disabled").and_then(Value::as_bool) == Some(true) {
        return Ok(());
    }
    let bad = |message: &'static str| ApiError::new(StatusCode::BAD_REQUEST, message);
    let profile_id = host
        .get("profileId")
        .and_then(Value::as_i64)
        .filter(|id| *id > 0)
        .ok_or_else(|| bad("Хосту необходимо назначить XRAY STUDIO профиль."))?;
    let tag = host
        .get("tag")
        .and_then(Value::as_str)
        .filter(|tag| !tag.is_empty() && tag.len() <= 150)
        .ok_or_else(|| bad("Выберите inbound из XRAY STUDIO."))?;
    validate_public_host_endpoint(host)?;
    let nodes = host
        .get("nodes")
        .and_then(Value::as_array)
        .filter(|nodes| !nodes.is_empty() && nodes.len() <= 64)
        .ok_or_else(|| bad("Привяжите хост к одной или нескольким нодам."))?;
    let profiles = load_records(pool, "profiles").await?;
    let profile = profiles
        .iter()
        .find(|profile| profile.get("id").and_then(Value::as_i64) == Some(profile_id))
        .ok_or_else(|| bad("Выбранный XRAY STUDIO профиль отсутствует."))?;
    let config = profile
        .get("config")
        .and_then(Value::as_str)
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .ok_or_else(|| bad("Сохранённая конфигурация XRAY STUDIO недействительна."))?;
    let inbound = config
        .get("inbounds")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|inbound| inbound.get("tag").and_then(Value::as_str) == Some(tag))
        })
        .ok_or_else(|| bad("Выбранный inbound отсутствует в XRAY STUDIO профиле."))?;
    if !subscription_host_protocol_supported(inbound) {
        return Err(bad(
            "Выбранный inbound не поддерживается генератором JSON-подписок.",
        ));
    }
    let all_nodes = load_records(pool, "nodes").await?;
    for node_id in nodes {
        let id = node_id
            .as_i64()
            .ok_or_else(|| bad("Некорректная привязка ноды."))?;
        let node = all_nodes
            .iter()
            .find(|node| node.get("id").and_then(Value::as_i64) == Some(id))
            .ok_or_else(|| bad("Одна из привязанных нод не найдена."))?;
        if node.get("disabled").and_then(Value::as_bool) == Some(true)
            || node.get("profileId").and_then(Value::as_i64) != Some(profile_id)
        {
            return Err(bad(
                "Профиль привязанной ноды не совпадает с XRAY-профилем хоста. Обновите профиль в разделе «Узлы».",
            ));
        }
    }
    let reality = inbound
        .get("streamSettings")
        .and_then(|v| v.get("realitySettings"));
    if inbound
        .get("streamSettings")
        .and_then(|v| v.get("security"))
        .and_then(Value::as_str)
        == Some("reality")
    {
        let key = host
            .get("publicKey")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .or_else(|| inbound.get("publicKey").and_then(Value::as_str))
            .or_else(|| {
                reality
                    .and_then(|v| v.get("publicKey"))
                    .and_then(Value::as_str)
            });
        if key.is_none() {
            return Err(bad(
                "Отсутствует REALITY publicKey. Добавьте публичный ключ в расширенных настройках хоста.",
            ));
        }
    }
    Ok(())
}

fn validate_node_address(data: &Value) -> Result<(), ApiError> {
    use std::net::IpAddr;
    let addr = data.get("addr").and_then(Value::as_str).ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "Укажите адрес ноды: IPv4, IPv6 или домен.",
        )
    })?;
    if addr.is_empty() || addr != addr.trim() || addr.chars().any(char::is_whitespace) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Адрес ноды не должен содержать пробелы.",
        ));
    }
    if addr.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    // ASCII DNS hostnames only; internationalized domains must use IDNA A-labels.
    // Reject numeric dotted strings that look like invalid IPv4 addresses.
    if addr.len() > 253
        || !addr.is_ascii()
        || addr.contains(':')
        || addr.contains('/')
        || addr.contains('@')
        || addr.contains('[')
        || addr.contains(']')
        || addr.contains("..")
        || addr.chars().all(|c| c.is_ascii_digit() || c == '.')
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Некорректный адрес ноды. Используйте IPv4, IPv6 без скобок или DNS-домен без порта.",
        ));
    }
    let valid = addr.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    });
    if !valid {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Некорректное доменное имя ноды.",
        ));
    }
    Ok(())
}

fn validate_reality_settings(inbound: &Value) -> Result<(), ApiError> {
    // Defense in depth: browser credential managers may have filled
    // unrelated Studio password/username inputs into REALITY secrets.
    // Validate even dormant realitySettings with security="none".
    if let Some(reality) = inbound
        .get("streamSettings")
        .and_then(|stream| stream.get("realitySettings"))
    {
        if !reality.is_object() {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "REALITY: realitySettings должен быть объектом.",
            ));
        }
        if let Some(private_key) = reality.get("privateKey") {
            let valid = private_key.as_str().is_some_and(|key| {
                key.is_empty()
                    || (key.len() == 43
                        && key
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
            });
            if !valid {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "REALITY: privateKey должен быть X25519 base64url (43 символа). Проверьте автозаполнение браузера.",
                ));
            }
        }
        if let Some(ids) = reality.get("shortIds") {
            let ids = ids.as_array().ok_or_else(|| {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "REALITY: shortIds должен быть массивом.",
                )
            })?;
            let mut seen = std::collections::HashSet::new();
            for short_id in ids {
                let valid = short_id.as_str().is_some_and(|id| {
                    id.len() <= 16
                        && id.len() % 2 == 0
                        && id.bytes().all(|b| b.is_ascii_hexdigit())
                        && seen.insert(id.to_ascii_lowercase())
                });
                if !valid {
                    return Err(ApiError::new(
                        StatusCode::BAD_REQUEST,
                        "REALITY: Short ID должен быть уникальной HEX-строкой чётной длины, максимум 16 символов.",
                    ));
                }
            }
        }
    }
    Ok(())
}

#[expect(
    clippy::too_many_lines,
    reason = "Centralized collection validation rejects incomplete node and TLS settings"
)]
fn validate_record(collection: &str, data: &Value) -> Result<(), ApiError> {
    let object = data.as_object().ok_or_else(|| {
        ApiError::new(StatusCode::BAD_REQUEST, "Запись должна быть JSON-объектом.")
    })?;
    if collection == "nodes" {
        validate_node_address(data)?;
        if object.get("tlsAutoProvision").and_then(Value::as_bool) == Some(true)
            && object.get("tlsManualProvision").and_then(Value::as_bool) == Some(true)
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Choose either managed TLS or externally provisioned certificates.",
            ));
        }
        if object.get("tlsAutoProvision").and_then(Value::as_bool) == Some(true) {
            let domain = object
                .get("tlsDomain")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            let email = object
                .get("tlsAcmeEmail")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            let valid_domain = domain.len() <= 253
                && domain.contains('.')
                && domain.split('.').all(|part| {
                    !part.is_empty()
                        && part.len() <= 63
                        && !part.starts_with('-')
                        && !part.ends_with('-')
                        && part
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                });
            let valid_email = email.len() <= 254
                && !email.contains(char::is_whitespace)
                && email.split_once('@').is_some_and(|(user, host)| {
                    !user.is_empty()
                        && host.contains('.')
                        && host.len() <= 253
                        && host
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-'))
                });
            if !valid_domain || !valid_email {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "Managed TLS requires a valid node domain and ACME email.",
                ));
            }
        }
        node_rotation::validate_node(data)?;
        node_routing::validate_saved(data)?;
        if let Some(hosting) = object.get("hosting") {
            let value = hosting.as_str().ok_or_else(|| {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "Название хостинга должно быть строкой.",
                )
            })?;
            if value.chars().count() > 100 || value.chars().any(char::is_control) {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "Название хостинга не должно превышать 100 символов или содержать управляющие символы.",
                ));
            }
        }
    }
    if collection == "users" {
        let username = object
            .get("username")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                ApiError::new(StatusCode::BAD_REQUEST, "Имя пользователя обязательно.")
            })?;
        if username.trim().is_empty()
            || username.chars().count() > 128
            || username.chars().any(char::is_control)
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Некорректное имя пользователя.",
            ));
        }
    }
    if collection == "profiles" {
        let config = object
            .get("config")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                ApiError::new(StatusCode::BAD_REQUEST, "Конфигурация Xray обязательна.")
            })?;
        let parsed: Value = serde_json::from_str(config).map_err(|_| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "Конфигурация Xray содержит некорректный JSON.",
            )
        })?;
        let inbounds = parsed
            .get("inbounds")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "В конфигурации Xray должен быть массив inbounds.",
                )
            })?;
        if inbounds.is_empty() {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "В конфигурации Xray должен быть хотя бы один inbound.",
            ));
        }
        let mut tags = std::collections::HashSet::new();
        for inbound in inbounds {
            let tag = inbound
                .get("tag")
                .and_then(Value::as_str)
                .filter(|tag| !tag.trim().is_empty())
                .ok_or_else(|| {
                    ApiError::new(
                        StatusCode::BAD_REQUEST,
                        "У каждого inbound должен быть tag.",
                    )
                })?;
            if !tags.insert(tag) {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "Теги inbounds должны быть уникальными.",
                ));
            }
            validate_reality_settings(inbound)?;
            // Syntax-only validation at save time. Physical certificate readiness
            // is evaluated by the assigned node, not by the panel host.
            if inbound
                .get("streamSettings")
                .and_then(|v| v.get("security"))
                .and_then(Value::as_str)
                == Some("tls")
            {
                let tls = inbound
                    .get("streamSettings")
                    .and_then(|v| v.get("tlsSettings"));
                if let Some(certs) = tls
                    .and_then(|v| v.get("certificates"))
                    .and_then(Value::as_array)
                {
                    for cert in certs {
                        let file = cert
                            .get("certificateFile")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .trim();
                        let key = cert
                            .get("keyFile")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .trim();
                        if file.is_empty() != key.is_empty() {
                            return Err(ApiError::new(
                                StatusCode::BAD_REQUEST,
                                "TLS certificateFile и keyFile должны быть указаны вместе.",
                            ));
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod reality_profile_autofill_validation_tests {
    use super::*;

    fn profile(key: &str, short_id: &str, security: &str) -> Value {
        let config = json!({"inbounds":[{"tag":"main","protocol":"vless","port":443,
            "streamSettings":{"network":"xhttp","security":security,
                "realitySettings":{"privateKey":key,"shortIds":[short_id]}}}]});
        json!({"name":"test","config":config.to_string()})
    }

    #[test]
    fn rejects_autofilled_login_and_credential_even_while_inactive() {
        let contaminated = profile(&"a".repeat(256), "Triplex", "none");
        assert!(validate_record("profiles", &contaminated).is_err());
        assert!(
            validate_record("profiles", &profile(&"a".repeat(256), "abcdef12", "none")).is_err()
        );
        assert!(validate_record("profiles", &profile(&"A".repeat(43), "Triplex", "none")).is_err());
    }

    #[test]
    fn rejects_incomplete_tls_certificate_pair() {
        let config = json!({"inbounds":[{
            "tag":"tls-in",
            "protocol":"trojan",
            "port":443,
            "streamSettings":{"network":"raw","security":"tls",
                "tlsSettings":{"certificates":[{"certificateFile":"/etc/ssl/cert.pem"}]}}
        }]});
        let profile = json!({"name":"incomplete TLS","config":config.to_string()});
        assert!(validate_record("profiles", &profile).is_err());
    }

    #[test]
    fn accepts_canonical_x25519_and_hex_short_id() {
        let valid = profile(&"A".repeat(43), "0123456789abcdef", "reality");
        assert!(validate_record("profiles", &valid).is_ok());
    }
}

/// An online badge means verified traffic within the recent activity window.
fn user_is_online(user: &Value, now_ms: i64) -> bool {
    user_status(user, now_ms) == "ACTIVE"
        && number(user, "onlineAt")
            .is_some_and(|last| last > 0 && last <= now_ms && last > now_ms - USER_ONLINE_WINDOW_MS)
}

fn user_status(user: &Value, now_ms: i64) -> &'static str {
    if user.get("disabled").and_then(Value::as_bool) == Some(true) {
        return "DISABLED";
    }
    if user.get("hold").and_then(Value::as_bool) == Some(true) {
        return "ON_HOLD";
    }
    let limit = user.get("limit").and_then(Value::as_f64).unwrap_or(0.0);
    let consumed = user.get("used").and_then(Value::as_f64).unwrap_or(0.0);
    if limit > 0.0 && consumed >= limit {
        return "LIMITED";
    }
    let expire_at = number(user, "expireAt").unwrap_or(0);
    if expire_at > 0 && expire_at < now_ms {
        return "EXPIRED";
    }
    "ACTIVE"
}

fn number(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_i64).or_else(|| {
        value
            .get(key)
            .and_then(Value::as_f64)
            .map(saturating_float_to_i64)
    })
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
    use super::{USER_ONLINE_WINDOW_MS, number, user_is_online, user_status};
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
    fn online_requires_recent_nonfuture_verified_activity() {
        let now = 1_800_000_000_000_i64;
        assert!(user_is_online(&json!({"onlineAt":now-1}), now));
        assert!(user_is_online(
            &json!({"onlineAt":now-USER_ONLINE_WINDOW_MS+1}),
            now
        ));
        assert!(!user_is_online(
            &json!({"onlineAt":now-USER_ONLINE_WINDOW_MS}),
            now
        ));
        assert!(!user_is_online(&json!({"onlineAt":now+1}), now));
        assert!(!user_is_online(
            &json!({"onlineAt":now-1,"disabled":true}),
            now
        ));
        assert!(!user_is_online(&json!({"onlineAt":now-1,"hold":true}), now));
        assert!(!user_is_online(
            &json!({"onlineAt":now-1,"limit":1,"used":1}),
            now
        ));
        assert!(!user_is_online(&json!({"onlineAt":0}), now));
        assert!(!user_is_online(&json!({}), now));
    }

    #[test]
    fn studio_subscription_routes_do_not_conflict_with_dashboard_or_flag_assets() {
        use super::AppState;
        use axum::{Router, http::StatusCode, routing::get};
        use tower_http::services::ServeDir;
        let mut app = Router::<AppState>::new()
            .route("/dashboard/{slug}", get(|| async { StatusCode::OK }))
            .nest_service("/flags", ServeDir::new("/app/static/flags"));
        for count in 1..=8 {
            let mut path = String::new();
            for index in 1..=count {
                let _ = std::fmt::Write::write_fmt(&mut path, format_args!("/{{part{index}}}"));
            }
            path.push_str("/{token}");
            app = app.route(&path, get(|| async { StatusCode::OK }));
        }
        // Building this router must not panic at runtime due to path conflicts.
        drop(app);
    }

    #[test]
    fn metered_usage_is_added_in_gib_not_raw_bytes() {
        let mut user = json!({"id":21,"used":0.0,"limit":2});
        super::add_metered_usage(&mut user, 1_073_741_824);
        assert_eq!(user["used"], 1.0);
        assert_eq!(user["meteredUsedGb"], 1.0);
        assert_eq!(super::user_status(&user, 1_800_000_000_000), "ACTIVE");
        super::add_metered_usage(&mut user, 1_073_741_824);
        assert_eq!(user["used"], 2.0);
        assert_eq!(super::user_status(&user, 1_800_000_000_000), "LIMITED");
    }
    #[test]
    fn numeric_json_fields_are_read_safely() {
        assert_eq!(number(&json!({"used":12}), "used"), Some(12));
        assert_eq!(number(&json!({"used":12.5}), "used"), Some(12));
        assert_eq!(number(&json!({}), "used"), None);
    }
}
