// P0-D lost-response/restart overlay. Keep the exact PR #101 runtime as the
// reviewed baseline and shadow only bounded release-control surfaces.
#[path = "node_runtime_p0d_staged.rs"]
mod staged;

#[allow(hidden_glob_reexports)]
pub use staged::*;

use crate::{ApiError, AppState, node_auth};
use axum::{
    Extension, Json,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;

/// XMesh v6 is the first numbered POSTQUANTUM major control-Agent release.
/// v4/v5 remain accepted only so an already enrolled node can perform the
/// authenticated transition to v6; they are not the advertised target.
pub const CONTROL_AGENT_VERSION: &str = "control-v6.0.0";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RetryPoll {
    node_id: i64,
    #[serde(default, rename = "artifactVersion")]
    artifact_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RetryReleaseIdentity {
    version: String,
    source_revision: String,
    artifact_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RetryAck {
    node_id: i64,
    command_id: i64,
    success: bool,
    detail: String,
    #[serde(default, rename = "releaseIdentity")]
    release_identity: Option<RetryReleaseIdentity>,
}

fn command_from_retry_row(row: &sqlx::postgres::PgRow) -> Result<serde_json::Value, ApiError> {
    let id = row.try_get::<i64, _>("id")?;
    let version = row.try_get::<String, _>("release_version")?;
    let target = row.try_get::<Option<String>, _>("target_version")?;
    let revision = row.try_get::<String, _>("source_revision")?;
    let digest = row.try_get::<String, _>("artifact_sha256")?;
    if target.as_deref() != Some(version.as_str()) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Claimed Agent release identity is inconsistent.",
        ));
    }
    Ok(json!({
        "id": id,
        "action": "update_agent",
        "targetVersion": version,
        "releaseIdentity": {
            "version": version,
            "sourceRevision": revision,
            "artifactSha256": digest
        }
    }))
}

async fn claimed_bound_retry(
    state: &AppState,
    node_id: i64,
) -> Result<Option<sqlx::postgres::PgRow>, ApiError> {
    Ok(sqlx::query(
        "SELECT c.id,c.target_version,m.version AS release_version,m.source_revision,m.artifact_sha256
         FROM node_restart_commands c
         JOIN node_xsp_agent_release_manifests m ON m.id=c.release_manifest_id
         WHERE c.node_id=$1 AND c.state='claimed' AND c.action='update_agent'
           AND c.release_manifest_id IS NOT NULL
           AND c.claimed_at>=NOW()-INTERVAL '15 minutes'
         ORDER BY c.id LIMIT 1",
    )
    .bind(node_id)
    .fetch_optional(&state.pool)
    .await?)
}

async fn control_v6_transition_active(
    state: &AppState,
    node_id: i64,
    seconds: i64,
    include_legacy_v1_v3: bool,
) -> Result<bool, ApiError> {
    let interval = format!("{seconds} seconds");
    let query = if include_legacy_v1_v3 {
        "SELECT EXISTS(SELECT 1 FROM node_runtime_heartbeats
         WHERE node_id=$1 AND received_at>NOW()-$2::INTERVAL
           AND (version LIKE 'control-v1%' OR version LIKE 'control-v2%' OR
                version LIKE 'control-v3%' OR version LIKE 'control-v4%' OR
                version LIKE 'control-v5%' OR version LIKE 'control-v6%'))"
    } else {
        "SELECT EXISTS(SELECT 1 FROM node_runtime_heartbeats
         WHERE node_id=$1 AND received_at>NOW()-$2::INTERVAL
           AND (version LIKE 'control-v3.%' OR version LIKE 'control-v4.%' OR
                version LIKE 'control-v5.%' OR version LIKE 'control-v6.%'))"
    };
    Ok(sqlx::query_scalar::<_, bool>(query)
        .bind(node_id)
        .bind(interval)
        .fetch_one(&state.pool)
        .await?)
}

/// v6 shadow for the legacy restart endpoint. This exists because a genuine
/// control-v6 heartbeat must remain eligible for the same fixed restart action.
pub async fn request_restart(
    State(state): State<AppState>,
    Extension(actor): Extension<crate::auth::AuthUser>,
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
    if !control_v6_transition_active(&state, node_id, 90, true).await? {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "У ноды нет подключённого управляющего агента.",
        ));
    }
    sqlx::query(
        "UPDATE node_restart_commands SET state='failed',
         result='Управляющий агент не подтвердил выполнение вовремя',finished_at=NOW()
         WHERE node_id=$1 AND state IN ('pending','claimed')
           AND ((action='update_agent' AND requested_at<NOW()-INTERVAL '15 minutes') OR
                (action<>'update_agent' AND requested_at<NOW()-INTERVAL '180 seconds'))",
    )
    .bind(node_id)
    .execute(&state.pool)
    .await?;
    let id = sqlx::query_scalar::<_, i64>(
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
        json!({"commandId":id}),
    )
    .await;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({"id":id,"nodeId":node_id,"state":"pending"})),
    ))
}

/// v6 shadow for fixed, allow-listed Xray release updates. Request shape stays
/// exactly `{version}`; no image URL, path or command enters from the client.
pub async fn request_xray_update(
    State(state): State<AppState>,
    Extension(actor): Extension<crate::auth::AuthUser>,
    Path(node_id): Path<i64>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    crate::require_mutation(&actor)?;
    if node_id <= 0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid node ID"));
    }
    let object = body
        .as_object()
        .filter(|value| value.len() == 1)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Invalid Xray update request"))?;
    let target = object
        .get("version")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Некорректная версия Xray"))?
        .trim();
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
    if !releases.iter().any(|release| release.version == target) {
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
    if !control_v6_transition_active(&state, node_id, 90, false).await? {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Для выбора версии требуется активный управляющий агент control-v3+.",
        ));
    }
    sqlx::query(
        "UPDATE node_restart_commands SET state='failed',
         result='Command expired before delivery',finished_at=NOW()
         WHERE node_id=$1 AND state IN ('pending','claimed')
           AND ((action='update_agent' AND requested_at<NOW()-INTERVAL '15 minutes') OR
                (action<>'update_agent' AND requested_at<NOW()-INTERVAL '180 seconds'))",
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
        Json(
            json!({"id":id,"nodeId":node_id,"action":"update_xray","targetVersion":target,"state":"pending"}),
        ),
    ))
}

/// Existing endpoint, now with a v6 legacy/default target. Manifest-bound
/// migration requests continue to delegate to the previously reviewed staged
/// implementation; only the empty `{}` production update target changes.
pub async fn request_agent_update(
    State(state): State<AppState>,
    Extension(actor): Extension<crate::auth::AuthUser>,
    Path(node_id): Path<i64>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let Some(object) = body.as_object() else {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid Agent update request",
        ));
    };
    if !object.is_empty() {
        let parsed: staged::AgentUpdateRequest = serde_json::from_value(body)
            .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid Agent update request"))?;
        return staged::request_agent_update(
            State(state),
            Extension(actor),
            Path(node_id),
            Json(parsed),
        )
        .await;
    }

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
    let active = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM node_runtime_heartbeats
          WHERE node_id=$1 AND received_at>NOW()-INTERVAL '65 seconds'
            AND (version LIKE 'control-v4.%' OR version LIKE 'control-v5.%' OR version LIKE 'control-v6.%'))",
    )
    .bind(node_id)
    .fetch_one(&state.pool)
    .await?;
    if !active {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "На ноде нет активного агента с поддержкой самообновления (control-v4+).",
        ));
    }
    sqlx::query(
        "UPDATE node_restart_commands SET state='failed',
         result='Command expired before delivery',finished_at=NOW()
         WHERE node_id=$1 AND state IN ('pending','claimed')
           AND ((action='update_agent' AND requested_at<NOW()-INTERVAL '15 minutes') OR
                (action<>'update_agent' AND requested_at<NOW()-INTERVAL '180 seconds'))",
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
        json!({"commandId":id,"targetVersion":CONTROL_AGENT_VERSION,"major":"postquantum-v6"}),
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

/// A bound migration is safe to redeliver after a lost poll response or process
/// restart: its immutable manifest identity cannot change and staged apply is
/// content-addressed/idempotent. Legacy claimed commands retain old behavior.
pub async fn poll_restart(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    let request: RetryPoll = serde_json::from_slice(&body)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid command poll."))?;
    if request.node_id <= 0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid node ID"));
    }
    // Artifact delivery already has its own claimed-command binding in the PR
    // #101 baseline; do not consume the node-auth nonce before delegating it.
    if request.artifact_version.is_some() {
        return staged::poll_restart(State(state), headers, body).await;
    }

    if claimed_bound_retry(&state, request.node_id)
        .await?
        .is_none()
    {
        return staged::poll_restart(State(state), headers, body).await;
    }

    node_auth::authenticate_for(
        &state,
        &headers,
        request.node_id,
        &body,
        "/api/v1/node/restart/poll",
    )
    .await?;

    // Re-read after authentication. If lifecycle state changed concurrently,
    // fail closed and let the next fresh signed poll observe the new state.
    let row = claimed_bound_retry(&state, request.node_id)
        .await?
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::CONFLICT,
                "Claimed Agent command changed during retry.",
            )
        })?;
    let command = command_from_retry_row(&row)?;
    Ok(Json(json!({"command": command, "enforceStop": false})).into_response())
}

fn exact_duplicate_ack(row: &sqlx::postgres::PgRow, report: &RetryAck) -> Result<bool, ApiError> {
    let state_name = row.try_get::<String, _>("state")?;
    if !matches!(state_name.as_str(), "succeeded" | "failed") {
        return Ok(false);
    }
    if row
        .try_get::<Option<i64>, _>("release_manifest_id")?
        .is_none()
    {
        return Ok(false);
    }
    let Some(identity) = report.release_identity.as_ref() else {
        return Ok(false);
    };
    let expected_success = state_name == "succeeded";
    if report.success != expected_success
        || row.try_get::<Option<bool>, _>("release_ack_success")? != Some(report.success)
        || row.try_get::<Option<String>, _>("result")?.as_deref() != Some(report.detail.as_str())
    {
        return Ok(false);
    }
    let manifest_version = row.try_get::<Option<String>, _>("release_version")?;
    let manifest_revision = row.try_get::<Option<String>, _>("source_revision")?;
    let manifest_digest = row.try_get::<Option<String>, _>("artifact_sha256")?;
    let ack_version = row.try_get::<Option<String>, _>("release_ack_version")?;
    let ack_revision = row.try_get::<Option<String>, _>("release_ack_source_revision")?;
    let ack_digest = row.try_get::<Option<String>, _>("release_ack_artifact_sha256")?;
    Ok(
        manifest_version.as_deref() == Some(identity.version.as_str())
            && manifest_revision.as_deref() == Some(identity.source_revision.as_str())
            && manifest_digest.as_deref() == Some(identity.artifact_sha256.as_str())
            && ack_version.as_deref() == Some(identity.version.as_str())
            && ack_revision.as_deref() == Some(identity.source_revision.as_str())
            && ack_digest.as_deref() == Some(identity.artifact_sha256.as_str()),
    )
}

async fn completed_bound_row(
    state: &AppState,
    node_id: i64,
    command_id: i64,
) -> Result<Option<sqlx::postgres::PgRow>, ApiError> {
    Ok(sqlx::query(
        "SELECT c.state,c.result,c.release_manifest_id,c.release_ack_version,
                c.release_ack_source_revision,c.release_ack_artifact_sha256,c.release_ack_success,
                m.version AS release_version,m.source_revision,m.artifact_sha256
         FROM node_restart_commands c
         LEFT JOIN node_xsp_agent_release_manifests m ON m.id=c.release_manifest_id
         WHERE c.node_id=$1 AND c.id=$2 AND c.state IN ('succeeded','failed')",
    )
    .bind(node_id)
    .bind(command_id)
    .fetch_optional(&state.pool)
    .await?)
}

/// Permit only a semantically exact retry of a completed manifest-bound ACK
/// after its HTTP response was lost. Different detail/success/identity remains a
/// conflict, and legacy ACK duplicate behavior is unchanged.
pub async fn acknowledge_restart(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<serde_json::Value>, ApiError> {
    let report: RetryAck = serde_json::from_slice(&body)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid command acknowledgement."))?;
    if report.node_id <= 0 || report.command_id <= 0 || report.detail.len() > 256 {
        return staged::acknowledge_restart(State(state), headers, body).await;
    }

    let candidate = completed_bound_row(&state, report.node_id, report.command_id).await?;
    let is_exact_duplicate = match candidate.as_ref() {
        Some(row) => exact_duplicate_ack(row, &report)?,
        None => false,
    };
    if !is_exact_duplicate {
        return staged::acknowledge_restart(State(state), headers, body).await;
    }

    node_auth::authenticate_for(
        &state,
        &headers,
        report.node_id,
        &body,
        "/api/v1/node/restart/ack",
    )
    .await?;
    let row = completed_bound_row(&state, report.node_id, report.command_id)
        .await?
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::CONFLICT,
                "Agent acknowledgement state changed during retry.",
            )
        })?;
    if !exact_duplicate_ack(&row, &report)? {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Agent acknowledgement retry does not exactly match durable evidence.",
        ));
    }
    Ok(Json(json!({"accepted": true, "duplicate": true})))
}
