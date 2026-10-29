use crate::{ApiError, AppState, node_auth};
use axum::{
    Extension, Json,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::Digest;
use sqlx::Row;

// Stable error codes only: never send profile JSON, secrets or raw database
// errors to the UI. The real root cause is recorded as a bounded stage.
fn profile_compile_error_code(error: &ApiError) -> &'static str {
    let message = error.safe_message();
    if message.starts_with("Set a valid local Xray port") {
        "invalid_local_port"
    } else if message.starts_with("Assign an XRAY STUDIO profile") {
        "missing_profile_assignment"
    } else if message.starts_with("Assigned XRAY STUDIO profile was not found") {
        "profile_not_found"
    } else if message.starts_with("Profile has no Xray JSON") {
        "missing_profile_json"
    } else if message.starts_with("Invalid profile JSON") {
        "invalid_profile_json"
    } else if message.starts_with("Profile has no inbounds") {
        "missing_inbounds"
    } else if message.starts_with("Automatic local-port mapping") {
        "unsupported_inbound_count"
    } else if message.starts_with("Invalid inbound") {
        "invalid_inbound"
    } else if message.starts_with("Proxy inbound has no tag") {
        "missing_inbound_tag"
    } else if message.starts_with("Proxy inbound settings missing") {
        "invalid_inbound_settings"
    } else if message.starts_with("XRAY STUDIO profile already defines an API") {
        "conflicting_stats_api"
    } else if message.starts_with("Choose either managed ACME TLS") {
        "conflicting_tls_modes"
    } else if message.starts_with("Managed TLS requires") {
        "managed_tls_validation"
    } else if message.starts_with("TLS node needs managed ACME") {
        "tls_mode_required"
    } else if message.starts_with("Node disabled") {
        "node_disabled"
    } else if message.starts_with("GeoData") {
        "geodata_validation"
    } else if message.starts_with("Routing") {
        "routing_validation"
    } else if message.starts_with("Failed to encode node profile") {
        "serialization"
    } else {
        "compile_failed"
    }
}

// Only a fresh node attestation matching the panel's own expected digest
// proves that the assigned Xray configuration has been applied.
fn profile_application_status(
    fresh: bool,
    running: bool,
    applied: Option<&str>,
    desired: Option<&str>,
) -> &'static str {
    if !fresh {
        return "unknown";
    }
    if !running {
        return "stopped";
    }
    match (applied, desired) {
        (Some(actual), Some(expected)) if actual == expected => "applied",
        (Some(_), Some(_)) => "pending",
        _ => "unknown",
    }
}

#[cfg(test)]
mod profile_application_tests {
    use super::profile_application_status as status;
    #[test]
    fn known_profile_compilation_errors_have_safe_codes() {
        let invalid = super::ApiError::new(
            axum::http::StatusCode::CONFLICT,
            "Set a valid local Xray port on the node.",
        );
        assert_eq!(
            super::profile_compile_error_code(&invalid),
            "invalid_local_port"
        );
        let config = super::ApiError::new(
            axum::http::StatusCode::CONFLICT,
            "XRAY STUDIO profile already defines an API. Remove it.",
        );
        assert_eq!(
            super::profile_compile_error_code(&config),
            "conflicting_stats_api"
        );
        let unknown = super::ApiError::new(
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "database secret is redacted",
        );
        assert_eq!(
            super::profile_compile_error_code(&unknown),
            "compile_failed"
        );
    }
    #[test]
    fn never_claims_application_without_current_matching_digest() {
        let digest = "a".repeat(64);
        let old = "b".repeat(64);
        assert_eq!(status(false, true, Some(&digest), Some(&digest)), "unknown");
        assert_eq!(status(true, false, Some(&digest), Some(&digest)), "stopped");
        assert_eq!(status(true, true, Some(&digest), None), "unknown");
        assert_eq!(status(true, true, None, Some(&digest)), "unknown");
        assert_eq!(status(true, true, Some(&old), Some(&digest)), "pending");
        assert_eq!(status(true, true, Some(&digest), Some(&digest)), "applied");
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Heartbeat {
    node_id: i64,
    version: String,
    router_running: bool,
    xray_running: bool,
    #[serde(default)]
    xray_version: Option<String>,
    #[serde(default, rename = "geoData")]
    geo_data: Option<Value>,
    #[serde(default, rename = "tlsStatus")]
    tls_status: Option<Value>,
    #[serde(default, rename = "appliedRevision")]
    applied_revision: Option<String>,
    #[serde(default, rename = "profileCheck")]
    profile_check: Option<String>,
}

fn validate_heartbeat_report(report: &Heartbeat) -> Result<(), ApiError> {
    if report.node_id <= 0
        || report.version.is_empty()
        || report.version.len() > 80
        || !report
            .version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-+_".contains(&b))
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid node identity or version.",
        ));
    }
    if report.xray_version.as_ref().is_some_and(|v| {
        v.len() > 40
            || !v
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".-+_".contains(&b))
    }) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid Xray version.",
        ));
    }
    if report.tls_status.as_ref().is_some_and(|data| {
        serde_json::to_vec(data).is_ok_and(|bytes| bytes.len() > 2048)
            || !data.is_object()
            || data.as_object().is_some_and(|obj| {
                obj.keys().any(|k| {
                    !matches!(
                        k.as_str(),
                        "state"
                            | "domain"
                            | "issuer"
                            | "notBefore"
                            | "notAfter"
                            | "daysRemaining"
                            | "autoRenew"
                            | "lastError"
                    )
                })
            })
    }) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid TLS telemetry.",
        ));
    }
    if report.geo_data.as_ref().is_some_and(|data| {
        serde_json::to_vec(data).is_ok_and(|bytes| bytes.len() > 5000) || !data.is_object()
    }) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid GeoData telemetry.",
        ));
    }
    if report.applied_revision.as_ref().is_some_and(|r| {
        r.len() != 64
            || !r
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    }) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid applied profile revision.",
        ));
    }
    if report.profile_check.as_ref().is_some_and(|status| {
        !matches!(
            status.as_str(),
            "verified"
                | "policy_missing"
                | "active_config_missing"
                | "guard_unavailable"
                | "policy_invalid"
                | "revision_invalid"
                | "policy_hash_mismatch"
                | "active_config_invalid"
                | "active_config_mismatch"
                | "xray_stopped"
                | "mount_mismatch"
                | "container_unavailable"
                | "helper_missing"
                | "helper_error"
        )
    }) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid profile check status.",
        ));
    }
    Ok(())
}

pub async fn heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let report: Heartbeat = serde_json::from_slice(&body)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid node heartbeat JSON."))?;
    validate_heartbeat_report(&report)?;
    node_auth::authenticate_for(
        &state,
        &headers,
        report.node_id,
        &body,
        "/api/v1/node/heartbeat",
    )
    .await?;
    // A standalone Go edge router still reports its historical 0.1.0 heartbeat.
    // It does not supervise Xray. Never let that report replace an authoritative
    // control agent's version, Xray health, desired revision or TLS state.
    // Legacy router-only nodes can still report health until a control agent
    // takes ownership of the record.
    if report.version == "0.1.0" {
        sqlx::query(
            "INSERT INTO node_runtime_heartbeats
             (node_id,version,router_running,xray_running,received_at)
             VALUES($1,$2,$3,FALSE,NOW())
             ON CONFLICT(node_id) DO UPDATE SET
                 router_running=EXCLUDED.router_running,
                 received_at=NOW()
             WHERE node_runtime_heartbeats.version='0.1.0'",
        )
        .bind(report.node_id)
        .bind(&report.version)
        .bind(report.router_running)
        .execute(&state.pool)
        .await?;
        return Ok(Json(json!({"accepted":true,"reconcileDesired":false})));
    }
    sqlx::query(
        "INSERT INTO node_runtime_heartbeats(node_id,version,router_running,xray_running,xray_version,geo_data,applied_revision,profile_check,tls_status,received_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT(node_id) DO UPDATE
         SET version=EXCLUDED.version,router_running=EXCLUDED.router_running,
         xray_running=EXCLUDED.xray_running,xray_version=EXCLUDED.xray_version,
         geo_data=EXCLUDED.geo_data,applied_revision=EXCLUDED.applied_revision,profile_check=EXCLUDED.profile_check,tls_status=EXCLUDED.tls_status,received_at=NOW()"
    ).bind(report.node_id).bind(&report.version).bind(report.router_running)
    .bind(report.xray_running).bind(&report.xray_version)
    .bind(&report.geo_data).bind(if report.xray_running {report.applied_revision.as_deref()} else {None})
    .bind(report.profile_check.as_deref()).bind(&report.tls_status).execute(&state.pool).await?;
    // A self-upgrade can replace its own running worker before its ACK is sent.
    // A fresh, authenticated heartbeat with the exact requested version is
    // stronger evidence of success than the lost acknowledgement.
    sqlx::query(
        "UPDATE node_restart_commands AS c SET state='succeeded',
         result='Версия агента подтверждена подписанным heartbeat',
         finished_at=NOW()
         WHERE c.node_id=$1 AND c.action='update_agent'
           AND c.state IN ('pending','claimed','failed')
           AND c.target_version=$2
           AND c.requested_at <= NOW()
           AND c.requested_at > NOW()-INTERVAL '15 minutes'
           AND EXISTS (SELECT 1 FROM node_runtime_heartbeats h
                       WHERE h.node_id=c.node_id AND h.version=c.target_version
                         AND h.received_at >= c.requested_at)",
    )
    .bind(report.node_id)
    .bind(&report.version)
    .execute(&state.pool)
    .await?;
    // The desired-revision table may be empty after a migration even when a
    // node already has a valid signed policy. Ask the node to fetch desired
    // config again; never trust its reported revision as desired state.
    let needs_reconcile = report.xray_running
        && report.applied_revision.is_some()
        && sqlx::query_scalar::<_, i64>(
            "SELECT 1::BIGINT FROM node_desired_revisions WHERE node_id=$1",
        )
        .bind(report.node_id)
        .fetch_optional(&state.pool)
        .await?
        .is_none();
    Ok(Json(
        json!({"accepted":true,"reconcileDesired":needs_reconcile}),
    ))
}

pub async fn status(
    State(state): State<AppState>,
    Path(node_id): Path<i64>,
    Extension(actor): Extension<crate::auth::AuthUser>,
) -> Result<Json<Value>, ApiError> {
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM panel_records WHERE collection='nodes' AND id=$1",
    )
    .bind(node_id)
    .fetch_optional(&state.pool)
    .await?;
    if exists.is_none() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Node not found."));
    }
    let record = sqlx::query(
        "SELECT version,router_running,xray_running,xray_version,geo_data,tls_status,applied_revision,profile_check,
                (EXTRACT(EPOCH FROM received_at)*1000)::BIGINT AS received_ms,
                received_at > NOW() - INTERVAL '65 seconds' AS fresh
         FROM node_runtime_heartbeats WHERE node_id=$1"
    ).bind(node_id).fetch_optional(&state.pool).await?;
    // The last-issued table is useful for delivery bookkeeping, but it can
    // be absent after a migration or stale after editing a profile. Only the
    // current authoritative compiler may decide whether a node is up to date.
    match record {
        Some(row) => {
            let fresh: bool = row.try_get("fresh")?;
            let applied: Option<String> = row.try_get("applied_revision")?;
            // Recompile read-only using the exact same compiler as the
            // authenticated desired-config endpoint. A stale issued record
            // must never make an outdated node look current.
            let (expected, desired_source, compile_error) = if fresh {
                match compile_node_profile(&state, node_id).await {
                    Ok(compiled) => (Some(compiled.revision), "current", None),
                    Err(error) => {
                        let reason = profile_compile_error_code(&error);
                        if reason == "missing_profile_assignment" {
                            (None, "awaiting_profile", None)
                        } else {
                            tracing::warn!(
                                node_id,
                                stage = reason,
                                "Cannot compile current desired node profile"
                            );
                            (None, "invalid_configuration", Some(reason))
                        }
                    }
                }
            } else {
                (None, "unavailable", None)
            };
            let application_status = profile_application_status(
                fresh,
                row.try_get::<bool, _>("xray_running")?,
                applied.as_deref(),
                expected.as_deref(),
            );
            Ok(Json(json!({
                "profileApplicationStatus":application_status,
                "desiredRevisionSource":desired_source,
                "profileCompileError":if crate::viewer_read_only(&actor) {None} else {compile_error},
                "profileCheck":row.try_get::<Option<String>,_>("profile_check")?,
                "appliedRevision":applied,
                "desiredRevision":expected,
                "nodeId":node_id,
                "connected":fresh,
                "version":row.try_get::<String,_>("version")?,
                "routerRunning":row.try_get::<bool,_>("router_running")?,
                "xrayRunning":row.try_get::<bool,_>("xray_running")?,
                "xrayVersion":row.try_get::<Option<String>,_>("xray_version")?,
                // GeoData reports may include custom source URLs. Observers
                // only receive operational status, never source metadata.
                "tlsStatus":row.try_get::<Option<Value>,_>("tls_status")?.unwrap_or(Value::Null),
                "geoData":if crate::viewer_read_only(&actor){Value::Null}
                    else{row.try_get::<Option<Value>,_>("geo_data")?
                        .unwrap_or(Value::Null)},
                "lastSeenAt":row.try_get::<i64,_>("received_ms")?
            })))
        }
        None => Ok(Json(
            json!({"nodeId":node_id,"connected":false,"lastSeenAt":null}),
        )),
    }
}

/// Ask the autonomous node reconciler to bypass the `GeoData` refresh interval.
///
/// No remote shell actions, arbitrary URLs or Xray restarts are enqueued.
/// The per-node signed manifest carries a monotonic revision. The node
/// verifies it via the existing policy guard, downloads and tests the assets
/// during its next scheduled desired-config reconciliation.
pub async fn request_geodata_refresh(
    State(state): State<AppState>,
    axum::extract::Extension(actor): axum::extract::Extension<crate::auth::AuthUser>,
    Path(node_id): Path<i64>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    crate::require_mutation(&actor)?;
    if node_id <= 0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid node ID."));
    }
    let node = sqlx::query_scalar::<_, Value>(
        "SELECT data FROM panel_records WHERE collection='nodes' AND id=$1",
    )
    .bind(node_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Node not found."))?;
    if node.get("disabled").and_then(Value::as_bool) == Some(true) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Отключённый узел не принимает новые команды GeoData.",
        ));
    }
    if node.get("geoEnabled").and_then(Value::as_bool) != Some(true) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Сначала включите GeoData в настройках узла.",
        ));
    }
    let previous = node
        .get("geoRefreshRevision")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let next = sqlx::query_scalar::<_, i64>(
        "UPDATE panel_records SET
           data=jsonb_set(data,'{geoRefreshRevision}',
             to_jsonb(GREATEST($2::BIGINT,
               COALESCE((data->>'geoRefreshRevision')::BIGINT,0)+1)),true),
           updated_at=NOW()
         WHERE collection='nodes' AND id=$1
           AND data->>'geoEnabled'='true'
           AND COALESCE((data->>'disabled')::boolean,false)=false
           AND COALESCE((data->>'geoRefreshRevision')::BIGINT,0) <= $3
         RETURNING (data->>'geoRefreshRevision')::BIGINT",
    )
    .bind(node_id)
    .bind(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .try_into()
            .unwrap_or(i64::MAX),
    )
    .bind(previous)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "Настройки узла изменились. Обновите данные и повторите.",
        )
    })?;
    crate::audit(
        &state.pool,
        &actor.username,
        "node.geodata.refresh.requested",
        Some("nodes"),
        Some(node_id),
        json!({"revision":next}),
    )
    .await;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({
            "nodeId":node_id, "refreshRevision":next, "state":"requested",
            "message":"Нода получит запрос на обновление GeoData при следующей синхронизации."
        })),
    ))
}

// A metrics agent is read-only; restarts need a separate, signed control agent.
// Requests are queued, claimed by exactly one authenticated node, and acknowledged
// only after systemd reports a confirmed result. No shell commands are accepted.
pub async fn request_restart(
    State(state): State<AppState>,
    axum::extract::Extension(actor): axum::extract::Extension<crate::auth::AuthUser>,
    Path(node_id): Path<i64>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    crate::require_mutation(&actor)?;
    if node_id <= 0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid node ID"));
    }
    let node = sqlx::query_scalar::<_, Value>(
        "SELECT data FROM panel_records WHERE collection='nodes' AND id=$1",
    )
    .bind(node_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Node not found"))?;
    if node.get("disabled").and_then(Value::as_bool) == Some(true) {
        return Err(ApiError::new(StatusCode::CONFLICT, "Node is disabled."));
    }
    let active=sqlx::query_scalar::<_,bool>(
        "SELECT EXISTS(SELECT 1 FROM node_runtime_heartbeats
         WHERE node_id=$1 AND received_at > NOW()-INTERVAL '90 seconds'
           AND (version LIKE 'control-v1%' OR version LIKE 'control-v2%' OR version LIKE 'control-v3%' OR version LIKE 'control-v4%' OR version LIKE 'control-v5%'))"
    ).bind(node_id).fetch_one(&state.pool).await?;
    if !active {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "У ноды нет подключённого управляющего агента. Агент метрик не умеет перезапускать Xray. Установите новую версию агента через «Подключить ноду и метрики».",
        ));
    }
    // A stale command must fail visibly; it must NEVER be executed later.
    sqlx::query(
        "UPDATE node_restart_commands SET state='failed',
         result='Управляющий агент не подтвердил выполнение вовремя',finished_at=NOW()
         WHERE node_id=$1 AND state IN ('pending','claimed')
           AND ((action='update_agent' AND requested_at<NOW()-INTERVAL '15 minutes') OR (action<>'update_agent' AND requested_at<NOW()-INTERVAL '180 seconds'))",
    )
    .bind(node_id)
    .execute(&state.pool)
    .await?;
    let row = sqlx::query_scalar::<_, i64>(
        "INSERT INTO node_restart_commands(node_id,requested_by)
         VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
    )
    .bind(node_id)
    .bind(&actor.username)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "Узел уже выполняет команду управления.",
        )
    })?;
    crate::audit(
        &state.pool,
        &actor.username,
        "node.restart.requested",
        Some("nodes"),
        Some(node_id),
        json!({"commandId":row}),
    )
    .await;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({"id":row,"nodeId":node_id,"state":"pending"})),
    ))
}

// Only an authenticated administrator can queue a fixed managed-container update.
// The node never receives an arbitrary command, image URL, or shell snippet.
pub async fn available_xray_releases(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let releases = state
        .core
        .all_node_releases()
        .await
        .map_err(|msg| ApiError::new(StatusCode::BAD_GATEWAY, msg))?;
    Ok(Json(json!({"items":releases})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct XrayVersionRequest {
    version: String,
}

pub async fn request_xray_update(
    State(state): State<AppState>,
    axum::extract::Extension(actor): axum::extract::Extension<crate::auth::AuthUser>,
    Path(node_id): Path<i64>,
    Json(body): Json<XrayVersionRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    crate::require_mutation(&actor)?;
    if node_id <= 0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid node ID"));
    }
    let target = body.version.trim();
    if target.len() > 64
        || target.is_empty()
        || !target
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._+-".contains(&c))
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Некорректная версия Xray",
        ));
    }
    let releases = state
        .core
        .all_node_releases()
        .await
        .map_err(|msg| ApiError::new(StatusCode::BAD_GATEWAY, msg))?;
    if !releases.iter().any(|r| r.version == target) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Выбранная версия отсутствует среди официальных релизов Xray",
        ));
    }
    let node = sqlx::query_scalar::<_, Value>(
        "SELECT data FROM panel_records WHERE collection='nodes' AND id=$1",
    )
    .bind(node_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Node not found"))?;
    if node.get("disabled").and_then(Value::as_bool) == Some(true) {
        return Err(ApiError::new(StatusCode::CONFLICT, "Node is disabled."));
    }
    let active = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM node_runtime_heartbeats
         WHERE node_id=$1 AND received_at>NOW()-INTERVAL '90 seconds'
           AND (version LIKE 'control-v3.%' OR version LIKE 'control-v4.%' OR version LIKE 'control-v5.%'))",
    )
    .bind(node_id)
    .fetch_one(&state.pool)
    .await?;
    if !active {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Для выбора версии требуется активный управляющий агент control-v3/v4/v5 на узле.",
        ));
    }
    // Claiming an update is exclusive with a pending restart.
    sqlx::query(
        "UPDATE node_restart_commands SET state='failed',
         result='Command expired before delivery',finished_at=NOW()
         WHERE node_id=$1 AND state IN ('pending','claimed')
           AND ((action='update_agent' AND requested_at<NOW()-INTERVAL '15 minutes') OR (action<>'update_agent' AND requested_at<NOW()-INTERVAL '180 seconds'))",
    )
    .bind(node_id)
    .execute(&state.pool)
    .await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO node_restart_commands(node_id,action,requested_by,target_version)
         VALUES($1,'update_xray',$2,$3) ON CONFLICT DO NOTHING RETURNING id",
    )
    .bind(node_id)
    .bind(&actor.username)
    .bind(target)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "Узел уже выполняет команду управления.",
        )
    })?;
    crate::audit(
        &state.pool,
        &actor.username,
        "node.xray.update.requested",
        Some("nodes"),
        Some(node_id),
        json!({"commandId":id,"targetVersion":target}),
    )
    .await;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({"id":id,"nodeId":node_id,
        "action":"update_xray","targetVersion":target,"state":"pending"})),
    ))
}

// Remote agent upgrades are a fixed local action, never a command string or URL.
// Only v4+ nodes understand this action. Older nodes need one bootstrap upgrade.
pub const CONTROL_AGENT_VERSION: &str = "control-v5.1.3";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentUpdateRequest {}

pub async fn request_agent_update(
    State(state): State<AppState>,
    axum::extract::Extension(actor): axum::extract::Extension<crate::auth::AuthUser>,
    Path(node_id): Path<i64>,
    Json(_body): Json<AgentUpdateRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    crate::require_mutation(&actor)?;
    if node_id <= 0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid node ID"));
    }
    let node = sqlx::query_scalar::<_, Value>(
        "SELECT data FROM panel_records WHERE collection='nodes' AND id=$1",
    )
    .bind(node_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Node not found"))?;
    if node.get("disabled").and_then(Value::as_bool) == Some(true) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Отключённая нода не принимает команды. Сначала восстановите работу узла.",
        ));
    }
    let active: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM node_runtime_heartbeats
          WHERE node_id=$1 AND received_at>NOW()-INTERVAL '65 seconds'
            AND (version LIKE 'control-v4.%' OR version LIKE 'control-v5.%'))",
    )
    .bind(node_id)
    .fetch_one(&state.pool)
    .await?;
    if !active {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "На ноде нет активного агента с поддержкой самообновления (control-v4+). Старый агент нужно один раз обновить штатным скриптом по SSH.",
        ));
    }
    sqlx::query(
        "UPDATE node_restart_commands SET state='failed',
         result='Command expired before delivery',finished_at=NOW()
         WHERE node_id=$1 AND state IN ('pending','claimed')
           AND ((action='update_agent' AND requested_at<NOW()-INTERVAL '15 minutes') OR (action<>'update_agent' AND requested_at<NOW()-INTERVAL '180 seconds'))",
    )
    .bind(node_id)
    .execute(&state.pool)
    .await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO node_restart_commands(node_id,action,requested_by,target_version)
         VALUES($1,'update_agent',$2,$3) ON CONFLICT DO NOTHING RETURNING id",
    )
    .bind(node_id)
    .bind(&actor.username)
    .bind(CONTROL_AGENT_VERSION)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "Узел уже выполняет другую команду управления.",
        )
    })?;
    crate::audit(
        &state.pool,
        &actor.username,
        "node.agent.update.requested",
        Some("nodes"),
        Some(node_id),
        json!({"commandId":id,"targetVersion":CONTROL_AGENT_VERSION}),
    )
    .await;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({
           "id":id,"nodeId":node_id,"action":"update_agent",
           "targetVersion":CONTROL_AGENT_VERSION,"state":"pending"
        })),
    ))
}

pub async fn restart_status(
    State(state): State<AppState>,
    Path(node_id): Path<i64>,
    Extension(actor): Extension<crate::auth::AuthUser>,
) -> Result<Json<Value>, ApiError> {
    // This GET also expires pending commands in the database; observers must
    // not cause any state changes or inspect command history.
    crate::require_mutation(&actor)?;
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM panel_records WHERE collection='nodes' AND id=$1",
    )
    .bind(node_id)
    .fetch_optional(&state.pool)
    .await?;
    if exists.is_none() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Node not found"));
    }
    sqlx::query(
        "UPDATE node_restart_commands SET state='failed',
         result='Управляющий агент не подтвердил выполнение вовремя',finished_at=NOW()
         WHERE node_id=$1 AND state IN ('pending','claimed')
           AND ((action='update_agent' AND requested_at<NOW()-INTERVAL '15 minutes') OR (action<>'update_agent' AND requested_at<NOW()-INTERVAL '180 seconds'))",
    )
    .bind(node_id)
    .execute(&state.pool)
    .await?;
    let item = sqlx::query(
        "SELECT id,action,target_version,state,result,requested_by,
          (EXTRACT(EPOCH FROM requested_at)*1000)::BIGINT AS requested_ms,
          (EXTRACT(EPOCH FROM finished_at)*1000)::BIGINT AS finished_ms
         FROM node_restart_commands WHERE node_id=$1 ORDER BY id DESC LIMIT 1",
    )
    .bind(node_id)
    .fetch_optional(&state.pool)
    .await?;
    Ok(Json(match item {
        Some(row) => json!({
            "id":row.try_get::<i64,_>("id")?,
            "action":row.try_get::<String,_>("action")?,
            "targetVersion":row.try_get::<Option<String>,_>("target_version")?,
            "nodeId":node_id,
            "state":row.try_get::<String,_>("state")?,
            "result":row.try_get::<String,_>("result")?,
            "requestedBy":row.try_get::<String,_>("requested_by")?,
            "requestedAt":row.try_get::<i64,_>("requested_ms")?,
            "finishedAt":row.try_get::<Option<i64>,_>("finished_ms")?
        }),
        None => json!({"nodeId":node_id,"state":"none"}),
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NodeCommandPoll {
    node_id: i64,
}

pub async fn poll_restart(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let request: NodeCommandPoll = serde_json::from_slice(&body)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid command poll."))?;
    if request.node_id <= 0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid node ID"));
    }
    node_auth::authenticate_for(
        &state,
        &headers,
        request.node_id,
        &body,
        "/api/v1/node/restart/poll",
    )
    .await?;
    // Quota/manual disable is authoritative. A node is not merely hidden in
    // the UI: the signed control agent MUST stop Xray before processing any
    // restart/update command. Repeat the directive until it is enforced.
    let disabled = sqlx::query_scalar::<_, bool>(
        "SELECT COALESCE((data->>'disabled')::boolean,false)
         FROM panel_records WHERE collection='nodes' AND id=$1",
    )
    .bind(request.node_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Node not found"))?;
    if disabled {
        return Ok(Json(json!({"command":null,"enforceStop":true})));
    }

    sqlx::query(
        "UPDATE node_restart_commands SET state='failed',
         result='Command expired before delivery',finished_at=NOW()
         WHERE node_id=$1 AND state='pending'
           AND ((action='update_agent' AND requested_at<NOW()-INTERVAL '15 minutes') OR (action<>'update_agent' AND requested_at<NOW()-INTERVAL '180 seconds'))",
    )
    .bind(request.node_id)
    .execute(&state.pool)
    .await?;
    let row = sqlx::query(
        "UPDATE node_restart_commands SET state='claimed',claimed_at=NOW()
         WHERE id=(SELECT id FROM node_restart_commands WHERE node_id=$1
           AND state='pending' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
         RETURNING id,action,target_version",
    )
    .bind(request.node_id)
    .fetch_optional(&state.pool)
    .await?;
    let command = match row {
        Some(row) => Some(json!({"id":row.try_get::<i64,_>("id")?,
            "action":row.try_get::<String,_>("action")?,
            "targetVersion":row.try_get::<Option<String>,_>("target_version")?})),
        None => None,
    };
    Ok(Json(json!({"command":command,"enforceStop":false})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NodeCommandAck {
    node_id: i64,
    command_id: i64,
    success: bool,
    detail: String,
}

pub async fn acknowledge_restart(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let report: NodeCommandAck = serde_json::from_slice(&body)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid command acknowledgement."))?;
    if report.node_id <= 0
        || report.command_id <= 0
        || report.detail.len() > 256
        || report.detail.chars().any(char::is_control)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid command details.",
        ));
    }
    node_auth::authenticate_for(
        &state,
        &headers,
        report.node_id,
        &body,
        "/api/v1/node/restart/ack",
    )
    .await?;
    let state_name = if report.success {
        "succeeded"
    } else {
        "failed"
    };
    let done = sqlx::query_scalar::<_, i64>(
        "UPDATE node_restart_commands SET state=$3,result=$4,finished_at=NOW()
         WHERE node_id=$1 AND id=$2 AND state='claimed' RETURNING id",
    )
    .bind(report.node_id)
    .bind(report.command_id)
    .bind(state_name)
    .bind(&report.detail)
    .fetch_optional(&state.pool)
    .await?;
    if done.is_none() {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Restart command is no longer pending acknowledgement.",
        ));
    }
    Ok(Json(json!({"accepted":true})))
}

// Populate Xray proxy inbound accounts from authoritative panel users and squads.
// XRAY STUDIO owns transports/security; panel users own runtime UUID authorization.
fn configure_private_xray_stats(config: &mut Value) -> Result<(), ApiError> {
    // Keep Xray StatsService private to the node: no public API listeners.
    if config.get("api").is_some_and(|api| !api.is_null()) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "XRAY STUDIO profile already defines an API. Remove the conflicting API or use the dedicated node telemetry configuration.",
        ));
    }
    // Xray StatsService does not accept api.listen. It must be routed via
    // a private dokodemo-door inbound to an API-tagged outbound.
    config["api"] = json!({"tag":"xmesh_stats_api","services":["StatsService"]});
    config["stats"] = json!({});
    let inbounds = config
        .get_mut("inbounds")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Missing inbound array"))?;
    inbounds.push(json!({
        "tag":"xmesh_stats_in","listen":"127.0.0.1","port":10085,
        "protocol":"dokodemo-door",
        "settings":{"address":"127.0.0.1","port":10085,"network":"tcp"}
    }));
    let object = config
        .as_object_mut()
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Invalid Xray profile JSON"))?;
    let routing = object.entry("routing").or_insert_with(|| json!({}));
    let ro = routing
        .as_object_mut()
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Invalid routing field"))?;
    let rules = ro.entry("rules").or_insert_with(|| json!([]));
    let rules = rules
        .as_array_mut()
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Invalid routing.rules"))?;
    rules.insert(
        0,
        json!({"type":"field","inboundTag":["xmesh_stats_in"],"outboundTag":"xmesh_stats_api"}),
    );
    let policy = object.entry("policy").or_insert_with(|| json!({}));
    let po = policy
        .as_object_mut()
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Invalid policy field"))?;
    let levels = po.entry("levels").or_insert_with(|| json!({}));
    let lo = levels
        .as_object_mut()
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Invalid policy.levels"))?;
    let level = lo.entry("0").or_insert_with(|| json!({}));
    let lvl = level
        .as_object_mut()
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Invalid policy level 0"))?;
    lvl.insert("statsUserUplink".into(), json!(true));
    lvl.insert("statsUserDownlink".into(), json!(true));
    Ok(())
}

fn proxy_user_client_entry(
    user: &Value,
    uuid: &uuid::Uuid,
    tag: &str,
    protocol: &str,
    ss_method: &str,
) -> Option<Value> {
    let record_id = user.get("id").and_then(Value::as_i64).unwrap_or(0);
    let encoded_tag = tag
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect::<String>();
    let email = format!("xmesh-u{record_id}--{encoded_tag}");
    let entry = match protocol {
        "vless" => json!({"id":uuid.to_string(),"level":0,"email":email}),
        "vmess" => {
            json!({"id":crate::protocol_credentials::for_protocol(user, "vmess", "")?,"level":0,"email":email})
        }
        "trojan" => {
            json!({"password":crate::protocol_credentials::for_protocol(user, "trojan", "")?,"level":0,"email":email})
        }
        "hysteria" => {
            json!({"auth":crate::protocol_credentials::for_protocol(user, "hysteria", "")?,"level":0,"email":email})
        }
        "masque" => {
            json!({"pass":crate::protocol_credentials::for_protocol(user, "masque", "")?,"level":0,"email":email})
        }
        "shadowsocks" => {
            // SS2022 passwords must be valid PSKs; never use a plain UUID
            // as a 2022 cipher key. Require an explicit per-user key.
            let password = if ss_method.starts_with("2022-") {
                let field = if ss_method == "2022-blake3-aes-128-gcm" {
                    "ssPassword128"
                } else {
                    "ssPassword"
                };
                user.get(field).and_then(Value::as_str).unwrap_or("")
            } else {
                crate::protocol_credentials::for_protocol(user, "shadowsocks", ss_method)?
            };
            if password.is_empty() {
                return None;
            }
            if ss_method.starts_with("2022-") {
                // Xray forbids method in SS2022 per-user entries.
                use base64::Engine as _;
                let decoded = base64::engine::general_purpose::STANDARD
                    .decode(password)
                    .ok();
                let length = if ss_method == "2022-blake3-aes-128-gcm" {
                    16
                } else {
                    32
                };
                if decoded.as_ref().is_none_or(|v| v.len() != length) {
                    return None;
                }
                json!({"password":password,"level":0,"email":email})
            } else {
                json!({"password":password,"method":ss_method,"level":0,"email":email})
            }
        }
        _ => return None,
    };
    Some(entry)
}

fn allowed_inbound_squads(squads: &[Value], tag: &str) -> std::collections::HashSet<i64> {
    let mut allowed = std::collections::HashSet::new();
    for squad in squads {
        let selected = squad
            .get("inb")
            .and_then(Value::as_array)
            .is_some_and(|tags| tags.iter().any(|item| item.as_str() == Some(tag)));
        if selected && let Some(id) = squad.get("id").and_then(Value::as_i64) {
            allowed.insert(id);
        }
    }
    allowed
}

fn quota_gib_to_bytes(gib: f64) -> i64 {
    let bytes = (gib * 1_073_741_824.0).floor();
    if bytes.is_nan() || bytes <= 0.0 {
        return 0;
    }
    if bytes.is_infinite() {
        return i64::MAX;
    }
    bytes.to_string().parse::<i64>().unwrap_or(i64::MAX)
}

fn provision_proxy_users(
    config: &mut Value,
    users: &[Value],
    squads: &[Value],
    now_ms: i64,
) -> Result<(), ApiError> {
    let inbounds = config
        .get_mut("inbounds")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Profile has no inbounds."))?;
    for inbound in inbounds {
        let protocol = inbound
            .get("protocol")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        if ![
            "vless",
            "vmess",
            "trojan",
            "shadowsocks",
            "hysteria",
            "masque",
        ]
        .contains(&protocol.as_str())
        {
            continue;
        }
        let ss_method = inbound
            .get("settings")
            .and_then(|v| v.get("method"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        if protocol == "shadowsocks" && ss_method.is_empty() {
            continue;
        }
        let tag = inbound.get("tag").and_then(Value::as_str).unwrap_or("");
        if tag.is_empty() {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "Proxy inbound has no tag.",
            ));
        }
        let allowed = allowed_inbound_squads(squads, tag);
        let mut entries = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for user in users {
            if crate::user_status(user, now_ms) != "ACTIVE" {
                continue;
            }
            let authorized = user
                .get("squads")
                .and_then(Value::as_array)
                .is_some_and(|ids| {
                    ids.iter()
                        .any(|id| id.as_i64().is_some_and(|id| allowed.contains(&id)))
                });
            if !authorized {
                continue;
            }
            let Some(id) = user.get("xrayId").and_then(Value::as_str) else {
                continue;
            };
            let Ok(uuid) = uuid::Uuid::parse_str(id) else {
                continue;
            };
            if !seen.insert(uuid) {
                continue;
            }
            if let Some(entry) = proxy_user_client_entry(user, &uuid, tag, &protocol, &ss_method) {
                entries.push(entry);
            }
        }
        let settings = inbound
            .get_mut("settings")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                ApiError::new(StatusCode::CONFLICT, "Proxy inbound settings missing.")
            })?;
        if protocol == "vless" {
            // Server VLESS uses clients; never insert outbound vnext users.
            if settings
                .get("decryption")
                .and_then(Value::as_str)
                .is_none_or(|s| s.trim().is_empty())
            {
                settings.insert("decryption".to_owned(), json!("none"));
            }
            settings.remove("users");
            settings.insert("clients".to_owned(), Value::Array(entries));
        } else {
            settings.remove("clients");
            settings.insert("users".to_owned(), Value::Array(entries));
        }
    }
    configure_private_xray_stats(config)?;
    Ok(())
}

// Offline policy is deliberately conservative: every active node receives at
// most its fraction of the currently unspent global user allowance (capped to
// 64 MiB per node) for a disconnected period. This is NOT a replacement for a
// centrally reserved multi-node quota ledger.
fn build_offline_policy(
    config: &Value,
    users: &[Value],
    node_id: i64,
    now_ms: i64,
    digest: &str,
    active_nodes: i64,
) -> Value {
    // The authoritative provisioner now supports VLESS clients and
    // users arrays for VMess, Trojan, Shadowsocks, Hysteria and MASQUE.
    // Build offline allowances from the actual provisioned runtime accounts,
    // including non-UUID credentials (Shadowsocks 2022).
    let accounts: Vec<&Value> = config
        .get("inbounds")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|inbound| {
            ["clients", "users"].into_iter().flat_map(move |field| {
                inbound
                    .get("settings")
                    .and_then(|v| v.get(field))
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
            })
        })
        .collect();
    let allowed_uuids: std::collections::HashSet<String> = accounts
        .iter()
        .flat_map(|account| {
            ["id", "password", "auth", "pass"]
                .into_iter()
                .filter_map(|key| account.get(key).and_then(Value::as_str))
        })
        .filter_map(|secret| uuid::Uuid::parse_str(secret).ok().map(|id| id.to_string()))
        .collect();
    let allowed_user_ids: std::collections::HashSet<i64> = accounts
        .iter()
        .filter_map(|account| account.get("email").and_then(Value::as_str))
        .filter_map(|email| email.strip_prefix("xmesh-u"))
        .filter_map(|rest| {
            rest.split_once("--")
                .and_then(|(id, _)| id.parse::<i64>().ok())
        })
        .filter(|id| *id > 0)
        .collect();
    let mut user_policies = Vec::new();
    for user in users {
        let Some(uuid) = user
            .get("xrayId")
            .and_then(Value::as_str)
            .and_then(|id| uuid::Uuid::parse_str(id).ok())
        else {
            continue;
        };
        let Some(user_id) = user.get("id").and_then(Value::as_i64).filter(|id| *id > 0) else {
            continue;
        };
        if !allowed_uuids.contains(&uuid.to_string()) && !allowed_user_ids.contains(&user_id) {
            continue;
        }
        let expires = crate::number(user, "expireAt").unwrap_or(0).max(0);
        let limit_gb = user.get("limit").and_then(Value::as_f64).unwrap_or(0.0);
        let used_gb = user
            .get("used")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            .max(0.0);
        // Floor each quota to bytes without a lossy float/integer cast.
        let used_bytes = quota_gib_to_bytes(used_gb);
        let limit_bytes = quota_gib_to_bytes(limit_gb.max(0.0));
        let remaining = if limit_gb.is_finite() && limit_gb > 0.0 {
            let remaining_gb = (limit_gb - used_gb).max(0.0);
            Some(quota_gib_to_bytes(remaining_gb))
        } else {
            None
        };
        let offline_budget =
            remaining.map(|bytes| (bytes / active_nodes.max(1)).min(64 * 1024 * 1024));
        user_policies.push(json!({
            "userId":user_id,"xrayId":uuid.to_string(),
            "expireAtMs":expires,"panelUsedBytes":used_bytes,
            "limitBytes":limit_bytes,"offlineBudgetBytes":offline_budget
        }));
    }
    user_policies.sort_by_key(|item| item.get("userId").and_then(Value::as_i64).unwrap_or(0));
    json!({
        "version":1,"nodeId":node_id,"issuedAtMs":now_ms,
        "validUntilMs":now_ms.saturating_add(7*24*60*60*1000),
        "configSha256":digest,"users":user_policies
    })
}

/// Validate an *unsaved* routing edit using the same `GeoData` and outbound
/// compiler used for signed desired-config. Never return Xray secrets.
fn preview_routing_counts(node: &Value) -> (usize, usize) {
    let rule_count = node
        .get("routingRules")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|r| r.get("enabled").and_then(Value::as_bool) != Some(false))
        .count();
    let exit_count = node
        .get("routingRules")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|r| {
            r.get("enabled").and_then(Value::as_bool) != Some(false)
                && r.get("target").and_then(Value::as_str) == Some("node")
        })
        .filter_map(|r| r.get("nodeId").and_then(Value::as_i64))
        .collect::<std::collections::HashSet<_>>()
        .len();
    (rule_count, exit_count)
}

pub async fn preview_routing(
    State(state): State<AppState>,
    Path(node_id): Path<i64>,
    axum::extract::Extension(actor): axum::extract::Extension<crate::auth::AuthUser>,
    Json(patch): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    crate::require_mutation(&actor)?;
    let patch = patch.as_object().ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "Routing preview expects a JSON object.",
        )
    })?;
    let valid_keys = [
        "routingEnabled",
        "routingRules",
        "routingRelays",
        "routingDomainStrategy",
        "routingSniffing",
        "routingJson",
        "geoEnabled",
        "geoBlockAds",
        "geoCustomRules",
    ];
    if patch.keys().any(|key| !valid_keys.contains(&key.as_str())) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Routing preview received an unrelated node field.",
        ));
    }
    let mut node = sqlx::query_scalar::<_, Value>(
        "SELECT data FROM panel_records WHERE collection='nodes' AND id=$1",
    )
    .bind(node_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Node not found."))?;
    let obj = node
        .as_object_mut()
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Invalid node record."))?;
    for (key, value) in patch {
        obj.insert(key.clone(), value.clone());
    }
    crate::node_routing::validate_saved(&node)?;
    let profile_id = node
        .get("profileId")
        .and_then(Value::as_i64)
        .or_else(|| {
            node.get("profileId")
                .and_then(Value::as_str)
                .and_then(|s| s.parse::<i64>().ok())
        })
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::CONFLICT,
                "Assign XRAY STUDIO profile to the source node first.",
            )
        })?;
    let profile = sqlx::query_scalar::<_, Value>(
        "SELECT data FROM panel_records WHERE collection='profiles' AND id=$1",
    )
    .bind(profile_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "Source XRAY STUDIO profile was not found.",
        )
    })?;
    let source = profile
        .get("config")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Source profile has no Xray JSON."))?;
    let mut config: Value = serde_json::from_str(source).map_err(|_| {
        ApiError::new(
            StatusCode::CONFLICT,
            "Source profile contains invalid Xray JSON.",
        )
    })?;
    // Preview uses the same MASQUE and per-node TLS compilation guards.
    ensure_masque_address(&mut config)?;
    configure_node_managed_tls(&node, &mut config)?;
    // Identical stats-first ordering to live signed policy provisioning.
    let users = crate::load_records(&state.pool, "users").await?;
    let squads = crate::load_records(&state.pool, "squads").await?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX);
    provision_proxy_users(&mut config, &users, &squads, now)?;
    let geo = crate::node_geodata::apply(&node, &mut config)?;
    let nodes = crate::load_records(&state.pool, "nodes").await?;
    let hosts = crate::load_records(&state.pool, "hosts").await?;
    crate::node_routing::apply(&node, &mut config, &nodes, &hosts)?;
    let (rule_count, exit_count) = preview_routing_counts(&node);
    Ok(Json(json!({
        "valid":true,
        "rules":if node.get("routingEnabled").and_then(Value::as_bool)==Some(true){rule_count}else{0},
        "exitNodes":exit_count,
        "usesGeoData":geo.is_some(),
        "previewOnly":true
    })))
}

// Compile the exact node configuration from current Control Plane state.
// This is shared by desired-config and the read-only runtime reconciliation
// fallback. The fallback never trusts a revision claimed by the node as
// the desired revision and never mutates Xray or authorization state.
struct CompiledNodeProfile {
    profile_id: i64,
    port: u64,
    config: Value,
    geo_data: Option<Value>,
    users: Vec<Value>,
    tls_provision: Option<Value>,
    now_ms: i64,
    active_nodes: i64,
    revision: String,
}
// A newly enrolled node is allowed to exist without a profile. Treat this
// as a provisioning state, not a broken managed Xray configuration.
fn node_awaits_profile(node: &Value) -> bool {
    match node.get("profileId") {
        None | Some(Value::Null) => true,
        Some(Value::String(value)) => value.trim().is_empty() || value.trim() == "0",
        Some(Value::Number(value)) => value.as_i64() == Some(0),
        _ => false,
    }
}

fn node_xray_local_port(node: &Value) -> Result<u64, ApiError> {
    // Legacy form submissions may persist positive numeric ports as strings.
    // Never silently fall back to the public node port: it is not Xray's port.
    let port = node
        .get("xrayLocalPort")
        .and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
        })
        .filter(|p| *p > 0 && *p <= 65535)
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::CONFLICT,
                "Set a valid local Xray port on the node.",
            )
        })?;
    Ok(port)
}

/// A managed node has one public TCP backend and one public UDP backend.
/// The second inbound uses the next loopback port; `StatsService` reserves 10085.
fn managed_tcp_hysteria_pair(inbounds: &[Value]) -> bool {
    if inbounds.len() != 2 {
        return false;
    }
    let is_hysteria = |inbound: &Value| {
        inbound.get("protocol").and_then(Value::as_str) == Some("hysteria")
            && inbound
                .pointer("/streamSettings/network")
                .and_then(Value::as_str)
                == Some("hysteria")
            && inbound
                .pointer("/streamSettings/security")
                .and_then(Value::as_str)
                == Some("tls")
    };
    let is_tcp = |inbound: &Value| {
        let protocol = inbound
            .get("protocol")
            .and_then(Value::as_str)
            .unwrap_or("");
        let network = inbound
            .pointer("/streamSettings/network")
            .and_then(Value::as_str)
            .unwrap_or("raw");
        let h3 = inbound
            .pointer("/streamSettings/tlsSettings/alpn")
            .and_then(Value::as_array)
            .is_some_and(|alpn| alpn.iter().any(|value| value.as_str() == Some("h3")));
        matches!(protocol, "vless" | "vmess" | "trojan" | "shadowsocks")
            && matches!(
                network,
                "raw" | "tcp" | "xhttp" | "grpc" | "ws" | "httpupgrade"
            )
            && !(network == "xhttp" && h3)
    };
    (is_hysteria(&inbounds[0]) && is_tcp(&inbounds[1]))
        || (is_tcp(&inbounds[0]) && is_hysteria(&inbounds[1]))
}

fn configure_local_xray_inbound(config: &mut Value, port: u64) -> Result<(), ApiError> {
    let inbounds = config
        .get_mut("inbounds")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Profile has no inbounds."))?;
    if inbounds.is_empty()
        || inbounds.len() > 2
        || (inbounds.len() == 2 && !managed_tcp_hysteria_pair(inbounds))
    {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Managed profiles support one inbound or a TCP proxy + Hysteria2 pair without competing UDP/QUIC transports.",
        ));
    }
    if port == 10085 || (inbounds.len() == 2 && (port >= 65535 || port + 1 == 10085)) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Managed Xray local ports must not collide with StatsService or exceed 65535.",
        ));
    }
    for (index, inbound) in inbounds.iter_mut().enumerate() {
        let object = inbound
            .as_object_mut()
            .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Invalid inbound."))?;
        // The first listener preserves xrayLocalPort for existing deployments.
        // The second uses xrayLocalPort + 1; both remain private to the edge.
        object.insert("listen".to_owned(), json!("127.0.0.1"));
        object.insert("port".to_owned(), json!(port + index as u64));
    }
    Ok(())
}

fn ensure_masque_address(config: &mut Value) -> Result<(), ApiError> {
    let inbounds = config
        .get_mut("inbounds")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Profile has no inbounds."))?;
    for inbound in inbounds {
        // The managed edge router can forward TCP and UDP concurrently for
        // mixed XHTTP ALPN; MASQUE still has its own transport constraints.
        let stream = inbound.get("streamSettings");
        let network = stream
            .and_then(|v| v.get("network"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let alpn = stream
            .and_then(|v| v.get("tlsSettings"))
            .and_then(|v| v.get("alpn"))
            .and_then(Value::as_array);
        if matches!(network, "masque" | "xhttp")
            && network == "masque"
            && alpn.is_none_or(|a| a.len() != 1 || !matches!(a[0].as_str(), Some("h3" | "h2")))
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "Node-managed MASQUE requires ALPN h3 or h2 explicitly.",
            ));
        }
        if inbound.get("protocol").and_then(Value::as_str) != Some("masque") {
            continue;
        }
        let stream = inbound.get("streamSettings");
        if stream
            .and_then(|v| v.get("network"))
            .and_then(Value::as_str)
            != Some("masque")
            || stream
                .and_then(|v| v.get("security"))
                .and_then(Value::as_str)
                != Some("tls")
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "MASQUE requires masque transport and TLS.",
            ));
        }
        let settings = inbound
            .get_mut("settings")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                ApiError::new(StatusCode::CONFLICT, "MASQUE settings must be an object.")
            })?;
        // Backward compatibility for saved composer profiles created before
        // the required tunnel address was generated. Individual overrides win.
        if !settings.contains_key("address") {
            settings.insert("address".to_owned(), json!(["10.129.0.1/24"]));
        }
        if settings
            .get("address")
            .and_then(Value::as_array)
            .is_none_or(|a| a.is_empty() || a.iter().any(|v| v.as_str().is_none_or(str::is_empty)))
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "MASQUE requires non-empty address ranges.",
            ));
        }
    }
    Ok(())
}

#[expect(
    clippy::too_many_lines,
    reason = "TLS mode validation and certificate injection are one atomic operation"
)]
fn configure_node_managed_tls(node: &Value, config: &mut Value) -> Result<Option<Value>, ApiError> {
    if node.get("tlsAutoProvision").and_then(Value::as_bool) == Some(true)
        && node.get("tlsManualProvision").and_then(Value::as_bool) == Some(true)
    {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Choose either managed ACME TLS or an external certificate, not both.",
        ));
    }
    if node.get("tlsAutoProvision").and_then(Value::as_bool) != Some(true) {
        // Legacy records without the new field retain their existing manual
        // provisioning contract. New records must choose explicitly.
        if node.get("tlsAutoProvision").and_then(Value::as_bool) == Some(false)
            && node.get("tlsManualProvision").and_then(Value::as_bool) != Some(true)
            && config
                .get("inbounds")
                .and_then(Value::as_array)
                .is_some_and(|items| {
                    items.iter().any(|ib| {
                        ib.get("streamSettings")
                            .and_then(|s| s.get("security"))
                            .and_then(Value::as_str)
                            == Some("tls")
                    })
                })
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "TLS node needs managed ACME settings or explicit externally provisioned certificates.",
            ));
        }
        return Ok(None);
    }
    let domain = node
        .get("tlsDomain")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let email = node
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
            StatusCode::CONFLICT,
            "Managed TLS requires a valid node TLS domain and ACME email.",
        ));
    }
    let inbounds = config
        .get_mut("inbounds")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Profile has no inbounds."))?;
    let mut updated = false;
    for inbound in inbounds {
        let Some(stream) = inbound
            .get_mut("streamSettings")
            .and_then(Value::as_object_mut)
        else {
            continue;
        };
        if stream.get("security").and_then(Value::as_str) != Some("tls") {
            continue;
        }
        let tls = stream.entry("tlsSettings").or_insert_with(|| json!({}));
        let tls = tls
            .as_object_mut()
            .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Invalid TLS settings."))?;
        tls.insert(
            "certificates".to_owned(),
            json!([{
                "certificateFile":format!("/etc/letsencrypt/live/{domain}/fullchain.pem"),
                "keyFile":format!("/etc/letsencrypt/live/{domain}/privkey.pem")
            }]),
        );
        updated = true;
    }
    if !updated {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Managed TLS requires an assigned TLS inbound.",
        ));
    }
    Ok(Some(
        json!({"domain":domain,"email":email,"provider":"letsencrypt-http01"}),
    ))
}

async fn compile_node_profile(
    state: &AppState,
    node_id: i64,
) -> Result<CompiledNodeProfile, ApiError> {
    let node = sqlx::query_scalar::<_, Value>(
        "SELECT data FROM panel_records WHERE collection='nodes' AND id=$1",
    )
    .bind(node_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Node not found."))?;
    if node.get("disabled").and_then(Value::as_bool) == Some(true) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Node disabled: Xray configuration updates blocked.",
        ));
    }
    let port = node_xray_local_port(&node)?;
    let profile_id = node
        .get("profileId")
        .and_then(Value::as_i64)
        .or_else(|| {
            node.get("profileId")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<i64>().ok())
        })
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Assign an XRAY STUDIO profile."))?;
    let profile = sqlx::query_scalar::<_, Value>(
        "SELECT data FROM panel_records WHERE collection='profiles' AND id=$1",
    )
    .bind(profile_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "Assigned XRAY STUDIO profile was not found.",
        )
    })?;
    let mut config: Value = match profile.get("config") {
        Some(Value::String(source)) => serde_json::from_str(source)
            .map_err(|_| ApiError::new(StatusCode::CONFLICT, "Invalid profile JSON."))?,
        Some(value @ Value::Object(_)) => value.clone(),
        _ => {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "Profile has no Xray JSON.",
            ));
        }
    };
    configure_local_xray_inbound(&mut config, port)?;
    ensure_masque_address(&mut config)?;
    let tls_provision = configure_node_managed_tls(&node, &mut config)?;
    let users = crate::load_records(&state.pool, "users").await?;
    let squads = crate::load_records(&state.pool, "squads").await?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX);
    provision_proxy_users(&mut config, &users, &squads, now)?;
    // Keep the source XRAY STUDIO profile immutable: every source node gets
    // its own GeoData assets and its own validated routing/exit graph.
    let nodes = crate::load_records(&state.pool, "nodes").await?;
    let hosts = crate::load_records(&state.pool, "hosts").await?;
    let geo_data = crate::node_geodata::apply(&node, &mut config)?;
    crate::node_routing::apply(&node, &mut config, &nodes, &hosts)?;
    let digest = hex::encode(sha2::Sha256::digest(serde_json::to_vec(&config).map_err(
        |_| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to encode node profile.",
            )
        },
    )?));

    // Conserve offline allowances across all currently enabled nodes. Large
    // deployments should replace this bound with server-side reserved leases.
    let active_nodes = nodes
        .iter()
        .filter(|node| node.get("disabled").and_then(Value::as_bool) != Some(true))
        .count()
        .max(1)
        .try_into()
        .unwrap_or(i64::MAX);
    Ok(CompiledNodeProfile {
        profile_id,
        port,
        config,
        geo_data,
        users,
        tls_provision,
        now_ms: now,
        active_nodes,
        revision: digest,
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DesiredConfigRequest {
    node_id: i64,
}

/// Authenticated, outbound-only desired Xray configuration retrieval.
/// The node signs the request with its registered Ed25519 identity.
/// Inbounds are bound to loopback so the edge router alone owns public TCP ports.
pub async fn desired_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let request: DesiredConfigRequest = serde_json::from_slice(&body).map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid node configuration request.",
        )
    })?;
    if request.node_id <= 0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid node ID."));
    }
    node_auth::authenticate_for(
        &state,
        &headers,
        request.node_id,
        &body,
        "/api/v1/node/desired-config",
    )
    .await?;
    // Enrollment precedes profile authoring. Authenticated nodes without a
    // profile receive a non-successful-to-apply but healthy pending response.
    // Never sign or issue a policy while no Xray configuration exists.
    let node = sqlx::query_scalar::<_, Value>(
        "SELECT data FROM panel_records WHERE collection='nodes' AND id=$1",
    )
    .bind(request.node_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Node not found."))?;
    if node.get("disabled").and_then(Value::as_bool) == Some(true) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Node disabled: Xray configuration updates blocked.",
        ));
    }
    if node_awaits_profile(&node) {
        return Ok((
            StatusCode::ACCEPTED,
            Json(json!({
                "status":"awaiting_profile",
                "nodeId":request.node_id,
                "message":"Node enrolled. Assign an XRAY STUDIO profile to provision Xray."
            })),
        ));
    }
    let CompiledNodeProfile {
        profile_id,
        port,
        config,
        geo_data,
        users,
        tls_provision,
        now_ms: now,
        active_nodes,
        revision: digest,
    } = compile_node_profile(&state, request.node_id).await?;
    let mut policy =
        build_offline_policy(&config, &users, request.node_id, now, &digest, active_nodes);
    if let Some(tls) = tls_provision {
        policy["tlsProvision"] = tls;
    }
    // Metadata is covered by the existing Ed25519 node-policy signature.
    if let Some(manifest) = geo_data {
        policy["geoData"] = manifest;
    }
    let signature = state.node_policy_signer.sign(&policy).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Node policy signing failed.",
        )
    })?;
    sqlx::query(
        "INSERT INTO node_desired_revisions(node_id,profile_id,revision,served_at)
         VALUES($1,$2,$3,NOW()) ON CONFLICT(node_id) DO UPDATE
         SET profile_id=EXCLUDED.profile_id,revision=EXCLUDED.revision,served_at=NOW()",
    )
    .bind(request.node_id)
    .bind(profile_id)
    .bind(&digest)
    .execute(&state.pool)
    .await?;
    Ok((
        StatusCode::OK,
        Json(json!({
            "nodeId":request.node_id,"profileId":profile_id,
            "listen":"127.0.0.1","port":port,"revision":digest,"config":config,
            "policy":policy,"policySignature":signature,
            "policyPublicKey":state.node_policy_signer.public_key()
        })),
    ))
}

#[cfg(test)]
mod provision_tests {
    use super::*;
    #[test]
    fn profile_assignment_is_optional_until_provisioning() {
        for node in [
            json!({}),
            json!({"profileId":null}),
            json!({"profileId":""}),
            json!({"profileId":"  "}),
            json!({"profileId":0}),
            json!({"profileId":"0"}),
        ] {
            assert!(node_awaits_profile(&node), "{node:?}");
        }
        for node in [
            json!({"profileId":1}),
            json!({"profileId":"1"}),
            json!({"profileId":-1}),
            json!({"profileId":"invalid"}),
        ] {
            assert!(!node_awaits_profile(&node), "{node:?}");
        }
    }
    #[test]
    fn managed_tls_rejects_conflicting_provisioning_modes() {
        let node = json!({"tlsAutoProvision": true, "tlsManualProvision": true});
        let mut config = json!({"inbounds": [{
            "streamSettings": {"security": "tls", "tlsSettings": {}}
        }]});
        let failure = configure_node_managed_tls(&node, &mut config).unwrap_err();
        assert_eq!(
            profile_compile_error_code(&failure),
            "conflicting_tls_modes"
        );
    }
    #[test]
    fn node_desired_config_uses_local_xray_port_not_public_port() {
        let node = json!({"xrayLocalPort": "5000", "port": 443});
        let local_port = node_xray_local_port(&node).unwrap();
        assert_eq!(local_port, 5000);
        let mut config = json!({
            "inbounds": [{"protocol": "vless", "listen": "0.0.0.0", "port": 443}]
        });
        configure_local_xray_inbound(&mut config, local_port).unwrap();
        assert_eq!(config["inbounds"][0]["listen"], "127.0.0.1");
        assert_eq!(config["inbounds"][0]["port"], 5000);
    }
    #[test]
    fn managed_tcp_hysteria_pair_receives_distinct_private_ports() {
        for swap in [false, true] {
            let vless = json!({
                "tag":"vless-main","protocol":"vless","listen":"0.0.0.0","port":443,
                "streamSettings":{"network":"xhttp","security":"tls",
                    "tlsSettings":{"alpn":["h2","http/1.1"]}}
            });
            let hysteria = json!({
                "tag":"hysteria-main","protocol":"hysteria","listen":"0.0.0.0","port":443,
                "streamSettings":{"network":"hysteria","security":"tls",
                    "tlsSettings":{"alpn":["h3"]}}
            });
            let mut config = if swap {
                json!({"inbounds":[hysteria,vless]})
            } else {
                json!({"inbounds":[vless,hysteria]})
            };
            configure_local_xray_inbound(&mut config, 5000).unwrap();
            assert_eq!(config["inbounds"][0]["port"], 5000);
            assert_eq!(config["inbounds"][1]["port"], 5001);
            for entry in config["inbounds"].as_array().unwrap() {
                assert_eq!(entry["listen"], "127.0.0.1");
            }
        }
    }
    #[test]
    fn managed_pair_rejects_competing_quic_and_reserved_ports() {
        let tcp = json!({"protocol":"vless","streamSettings":{"network":"xhttp",
            "tlsSettings":{"alpn":["h2","h3"]}}});
        let udp = json!({"protocol":"hysteria","streamSettings":{
            "network":"hysteria","security":"tls"}});
        let mut config = json!({"inbounds":[tcp,udp]});
        assert!(configure_local_xray_inbound(&mut config, 5000).is_err());
        config["inbounds"][0]["streamSettings"]["tlsSettings"]["alpn"] = json!(["h2"]);
        for port in [10084, 10085, 65535] {
            assert!(configure_local_xray_inbound(&mut config, port).is_err());
        }
        configure_local_xray_inbound(&mut config, 10086).unwrap();
    }
    #[test]
    fn hysteria_desired_config_uses_edited_local_port_without_tcp_hardcode() {
        let node = json!({"xrayLocalPort": 13456, "port": 443});
        let port = node_xray_local_port(&node).unwrap();
        let mut config = json!({
            "inbounds": [{
                "tag": "hysteria-main", "protocol": "hysteria", "listen": "127.0.0.1",
                "port": 5000, "settings": {"version": 2, "users": []},
                "streamSettings": {"network": "hysteria", "security": "tls"}
            }]
        });
        configure_local_xray_inbound(&mut config, port).unwrap();
        assert_eq!(config["inbounds"][0]["port"], 13456);
        assert_eq!(config["inbounds"][0]["listen"], "127.0.0.1");
        assert_eq!(
            config["inbounds"][0]["streamSettings"]["network"],
            "hysteria"
        );
    }
    #[test]
    fn offline_budget_is_conservative_and_scoped_to_authorized_users() {
        let cfg = json!({"inbounds":[{"settings":{"clients":[{"id":"550e8400-e29b-41d4-a716-446655440000"}]}}]});
        let u = vec![
            json!({"id":1,"xrayId":"550e8400-e29b-41d4-a716-446655440000","limit":1.0,"used":0.5,"expireAt":1_800_000_010_000_i64}),
            json!({"id":2,"xrayId":"550e8400-e29b-41d4-a716-446655440001","limit":1.0,"used":0.0}),
        ];
        let policy = build_offline_policy(&cfg, &u, 12, 1_800_000_000_000_i64, &"a".repeat(64), 2);
        assert_eq!(policy["users"].as_array().unwrap().len(), 1);
        assert_eq!(policy["users"][0]["offlineBudgetBytes"], 64 * 1024 * 1024);
        assert_eq!(policy["users"][0]["expireAtMs"], 1_800_000_010_000_i64);
        assert_eq!(policy["users"][0]["panelUsedBytes"], 536_870_912);
        assert_eq!(policy["nodeId"], 12);
    }
    #[test]
    fn runtime_inbound_contains_only_active_assigned_uuids() {
        let mut config = json!({"inbounds":[{"protocol":"vless","tag":"NL",
            "settings":{"decryption":"","clients":[]}}]});
        let now = 1_800_000_000_000_i64;
        let users = vec![
            json!({"id":1,"xrayId":"550e8400-e29b-41d4-a716-446655440000","squads":[4]}),
            json!({"id":2,"xrayId":"550e8400-e29b-41d4-a716-446655440001","squads":[4],"disabled":true}),
            json!({"id":3,"xrayId":"550e8400-e29b-41d4-a716-446655440002","squads":[5]}),
            json!({"id":4,"xrayId":"550e8400-e29b-41d4-a716-446655440003","squads":[4],"expireAt":now-1}),
        ];
        let squads = vec![json!({"id":4,"inb":["NL"]}), json!({"id":5,"inb":["SE"]})];
        provision_proxy_users(&mut config, &users, &squads, now).unwrap();
        let settings = &config["inbounds"][0]["settings"];
        assert!(settings.get("users").is_none());
        assert_eq!(settings["clients"].as_array().unwrap().len(), 1);
        assert_eq!(
            settings["clients"][0]["id"],
            "550e8400-e29b-41d4-a716-446655440000"
        );
        assert_eq!(settings["clients"][0]["email"], "xmesh-u1--NL");
        assert_eq!(config["api"]["tag"], "xmesh_stats_api");
        assert_eq!(config["inbounds"][1]["listen"], "127.0.0.1");
        assert_eq!(config["inbounds"][1]["port"], 10085);
        assert_eq!(
            config["routing"]["rules"][0]["outboundTag"],
            "xmesh_stats_api"
        );
        assert_eq!(config["policy"]["levels"]["0"]["statsUserUplink"], true);
        assert_eq!(settings["decryption"], "none");
    }
    #[test]
    fn stats_email_escapes_non_ascii_inbound_tag() {
        let mut config = json!({"inbounds":[{"protocol":"vless","tag":"CDN NL","settings":{}}]});
        let users =
            vec![json!({"id":7,"xrayId":"550e8400-e29b-41d4-a716-446655440000","squads":[4]})];
        let squads = vec![json!({"id":4,"inb":["CDN NL"]})];
        provision_proxy_users(&mut config, &users, &squads, 1_800_000_000_000).unwrap();
        assert_eq!(
            config["inbounds"][0]["settings"]["clients"][0]["email"],
            "xmesh-u7--CDN%20NL"
        );
    }
    #[test]
    fn offline_policy_counts_multi_protocol_accounts_including_ss2022() {
        let config = json!({"inbounds":[
            {"settings":{"users":[
                {"id":"550e8400-e29b-41d4-a716-446655440000","email":"xmesh-u7--VM"},
                {"password":"BASE64_NON_UUID","email":"xmesh-u8--SS22"}]}}]});
        let users = vec![
            json!({"id":7,"xrayId":"550e8400-e29b-41d4-a716-446655440000"}),
            json!({"id":8,"xrayId":"550e8400-e29b-41d4-a716-446655440001"}),
            json!({"id":9,"xrayId":"550e8400-e29b-41d4-a716-446655440002"}),
        ];
        let policy =
            build_offline_policy(&config, &users, 1, 1_800_000_000_000, &"a".repeat(64), 1);
        let entries = policy["users"].as_array().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0]["userId"], 7);
        assert_eq!(entries[1]["userId"], 8);
    }
    #[test]
    fn node_multi_protocol_users_match_client_credentials_and_never_include_disabled() {
        use base64::Engine as _;
        let psk = base64::engine::general_purpose::STANDARD.encode([7u8; 32]);
        let mut config = json!({"inbounds":[
          {"tag":"VM","protocol":"vmess","settings":{}},
          {"tag":"TR","protocol":"trojan","settings":{}},
          {"tag":"SS","protocol":"shadowsocks","settings":{"method":"aes-256-gcm"}},
          {"tag":"SS22","protocol":"shadowsocks","settings":{
              "method":"2022-blake3-aes-256-gcm","password":psk}},
          {"tag":"HY","protocol":"hysteria","settings":{"version":2}},
          {"tag":"MQ","protocol":"masque","settings":{"address":["10.0.0.1/24"]}}
        ]});
        let active = json!({"id":7,"xrayId":"550e8400-e29b-41d4-a716-446655440000",
            "squads":[4],"ssPassword":psk});
        let blocked = json!({"id":8,"xrayId":"550e8400-e29b-41d4-a716-446655440001",
            "squads":[4],"disabled":true});
        let squads = vec![json!({"id":4,"inb":["VM","TR","SS","SS22","HY","MQ"]})];
        provision_proxy_users(&mut config, &[active, blocked], &squads, 1_800_000_000_000).unwrap();
        for (i, expected) in ["id", "password", "password", "password", "auth", "pass"]
            .iter()
            .enumerate()
        {
            let users = &config["inbounds"][i]["settings"]["users"];
            assert_eq!(users.as_array().unwrap().len(), 1);
            assert!(users[0].get(*expected).is_some());
        }
        assert_eq!(
            config["inbounds"][3]["settings"]["users"][0]["password"],
            psk
        );
        assert!(
            config["inbounds"][3]["settings"]["users"][0]
                .get("method")
                .is_none()
        );
        assert_eq!(
            config["inbounds"][5]["settings"]["users"][0]["email"],
            "xmesh-u7--MQ"
        );
    }
    #[test]
    fn same_user_in_multiple_matching_squads_is_not_duplicated() {
        let mut config =
            json!({"inbounds":[{"protocol":"vless","tag":"NL","settings":{"users":[]}}]});
        let users =
            vec![json!({"id":1,"xrayId":"550e8400-e29b-41d4-a716-446655440000","squads":[4,5]})];
        let squads = vec![json!({"id":4,"inb":["NL"]}), json!({"id":5,"inb":["NL"]})];
        provision_proxy_users(&mut config, &users, &squads, 1_800_000_000_000).unwrap();
        assert_eq!(
            config["inbounds"][0]["settings"]["clients"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
}

#[cfg(test)]
mod node_tls_masque_contract_tests {
    use super::*;
    #[test]
    fn managed_tls_is_opt_in_and_node_scoped() {
        let mut config = json!({"inbounds":[{"protocol":"masque","settings":{},
            "streamSettings":{"network":"masque","security":"tls","tlsSettings":{
                "alpn":["h3"],"certificates":[{"certificateFile":"/etc/letsencrypt/live/old.example/fullchain.pem",
                "keyFile":"/etc/letsencrypt/live/old.example/privkey.pem"}]}}}]});
        ensure_masque_address(&mut config).unwrap();
        assert_eq!(
            config["inbounds"][0]["settings"]["address"][0],
            "10.129.0.1/24"
        );
        let node = json!({"tlsAutoProvision":true,"tlsDomain":"new.example.org",
            "tlsAcmeEmail":"ops@example.org"});
        let signed = configure_node_managed_tls(&node, &mut config)
            .unwrap()
            .unwrap();
        assert_eq!(signed["domain"], "new.example.org");
        assert_eq!(
            config["inbounds"][0]["streamSettings"]["tlsSettings"]["certificates"][0]["certificateFile"],
            "/etc/letsencrypt/live/new.example.org/fullchain.pem"
        );
        let mut manual = json!({"inbounds":[]});
        assert!(
            configure_node_managed_tls(&json!({}), &mut manual)
                .unwrap()
                .is_none()
        );
    }
    #[test]
    fn managed_tls_rejects_missing_acme_identity() {
        let mut config = json!({"inbounds":[{"streamSettings":{"security":"tls"}}]});
        assert!(
            configure_node_managed_tls(
                &json!({"tlsAutoProvision":true,
            "tlsDomain":"example.org"}),
                &mut config
            )
            .is_err()
        );
    }
}
