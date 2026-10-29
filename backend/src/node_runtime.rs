// P0-D lost-response/restart overlay. Keep the exact PR #101 runtime as the
// reviewed baseline and shadow only signed poll retry plus exact ACK replay.
#[path = "node_runtime_p0d_staged.rs"]
mod staged;

#[allow(hidden_glob_reexports)]
pub use staged::*;

use crate::{ApiError, AppState, node_auth};
use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;

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

    if claimed_bound_retry(&state, request.node_id).await?.is_none() {
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
    Ok(manifest_version.as_deref() == Some(identity.version.as_str())
        && manifest_revision.as_deref() == Some(identity.source_revision.as_str())
        && manifest_digest.as_deref() == Some(identity.artifact_sha256.as_str())
        && ack_version.as_deref() == Some(identity.version.as_str())
        && ack_revision.as_deref() == Some(identity.source_revision.as_str())
        && ack_digest.as_deref() == Some(identity.artifact_sha256.as_str()))
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
