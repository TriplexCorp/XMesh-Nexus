// P0-D keeps the existing node runtime implementation in
// `node_runtime_legacy.rs` and overlays only bounded Agent-migration surfaces.
// Legacy unbound update behavior remains delegated unchanged; staged bound
// migrations add exact immutable release identity to the existing signed
// poll/ACK lifecycle without introducing another remote action or control plane.
#[expect(
    dead_code,
    reason = "P0-D intentionally shadows only the preserved legacy poll/ACK handlers while keeping the reviewed legacy runtime baseline intact"
)]
#[path = "node_runtime_legacy.rs"]
mod legacy;

// The legacy module remains the implementation for every existing runtime
// route. Local items below intentionally shadow only the bounded P0-D surfaces.
#[allow(hidden_glob_reexports)]
pub use legacy::*;

use crate::{ApiError, AppState, node_auth};
use axum::{
    Extension, Json,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;

// Keep the existing CI/runtime version contract visible at the orchestration
// entrypoint. The legacy implementation uses the same fixed version.
pub const CONTROL_AGENT_VERSION: &str = "control-v5.1.3";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LegacyAgentUpdateRequest {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentMigrationUpdateRequest {
    release_version: String,
}

/// The existing `{}` request stays a distinct variant. Migration callers may
/// add exactly one field (`releaseVersion`) and never executable input.
#[derive(Deserialize)]
#[serde(untagged)]
pub enum AgentUpdateRequest {
    Legacy(LegacyAgentUpdateRequest),
    Migration(AgentMigrationUpdateRequest),
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentReleaseIdentity {
    version: String,
    source_revision: String,
    artifact_sha256: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NodeCommandPoll {
    node_id: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NodeCommandAck {
    node_id: i64,
    command_id: i64,
    success: bool,
    detail: String,
    #[serde(default, rename = "releaseIdentity")]
    release_identity: Option<AgentReleaseIdentity>,
}

fn staging_agent_migration_value_enabled(value: Option<&str>) -> bool {
    value == Some("staging-only")
}

fn staging_agent_migration_enabled() -> bool {
    let value = std::env::var("XSP_V2_P0D_AGENT_MIGRATION").ok();
    staging_agent_migration_value_enabled(value.as_deref())
}

fn validate_release_version(version: &str) -> Result<&str, ApiError> {
    if version.trim() != version
        || version.is_empty()
        || version.len() > 64
        || !version.bytes().enumerate().all(|(index, byte)| {
            if index == 0 {
                byte.is_ascii_alphanumeric()
            } else {
                byte.is_ascii_alphanumeric() || b"._+-".contains(&byte)
            }
        })
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid approved Agent release version.",
        ));
    }
    Ok(version)
}

fn lowercase_hex_exact(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn validate_release_identity(identity: &AgentReleaseIdentity) -> Result<(), ApiError> {
    validate_release_version(&identity.version)?;
    if !lowercase_hex_exact(&identity.source_revision, 40)
        || !lowercase_hex_exact(&identity.artifact_sha256, 64)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid Agent release identity.",
        ));
    }
    Ok(())
}

fn exact_release_identity_matches(
    expected_version: &str,
    expected_revision: &str,
    expected_digest: &str,
    reported: &AgentReleaseIdentity,
) -> bool {
    reported.version == expected_version
        && reported.source_revision == expected_revision
        && reported.artifact_sha256 == expected_digest
}

fn polled_command_from_row(row: &sqlx::postgres::PgRow) -> Result<Value, ApiError> {
    let id = row.try_get::<i64, _>("id")?;
    let action = row.try_get::<String, _>("action")?;
    let target_version = row.try_get::<Option<String>, _>("target_version")?;
    let manifest_id = row.try_get::<Option<i64>, _>("release_manifest_id")?;
    let mut command = json!({
        "id":id,
        "action":action,
        "targetVersion":target_version
    });

    if manifest_id.is_some() {
        let release_version = row
            .try_get::<Option<String>, _>("release_version")?
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::CONFLICT,
                    "Bound Agent release identity is missing.",
                )
            })?;
        let source_revision = row
            .try_get::<Option<String>, _>("source_revision")?
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::CONFLICT,
                    "Bound Agent release identity is missing.",
                )
            })?;
        let artifact_sha256 = row
            .try_get::<Option<String>, _>("artifact_sha256")?
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::CONFLICT,
                    "Bound Agent release identity is missing.",
                )
            })?;
        if action != "update_agent"
            || target_version.as_deref() != Some(release_version.as_str())
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "Bound Agent release identity does not match the queued command.",
            ));
        }
        command["releaseIdentity"] = json!({
            "version":release_version,
            "sourceRevision":source_revision,
            "artifactSha256":artifact_sha256
        });
    }

    Ok(command)
}

#[expect(
    clippy::too_many_lines,
    reason = "P0-D1c keeps gate, owner authorization, node state and atomic manifest binding in one auditable orchestration path"
)]
async fn request_staging_agent_migration(
    state: &AppState,
    actor: &crate::auth::AuthUser,
    node_id: i64,
    release_version: &str,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if !staging_agent_migration_enabled() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "Staging Agent migration mode is disabled.",
        ));
    }
    crate::require_owner(actor)?;
    if node_id <= 0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid node ID"));
    }
    let target = validate_release_version(release_version)?;

    tracing::debug!(
        node_id,
        legacy_default_version = CONTROL_AGENT_VERSION,
        "Staging Agent migration request"
    );

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

    let approved: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM node_xsp_agent_release_manifests WHERE version=$1)",
    )
    .bind(target)
    .fetch_one(&state.pool)
    .await?;
    if !approved {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "Approved Agent release was not found.",
        ));
    }

    let row = match sqlx::query(
        "SELECT command_id,manifest_id,version,source_revision,artifact_sha256
         FROM stage_node_xsp_agent_migration($1,$2,$3)",
    )
    .bind(node_id)
    .bind(target)
    .bind(&actor.username)
    .fetch_one(&state.pool)
    .await
    {
        Ok(row) => row,
        Err(error)
            if error
                .to_string()
                .contains("node already has an active control command") =>
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "Узел уже выполняет другую команду управления.",
            ));
        }
        Err(error) => return Err(error.into()),
    };

    let command_id = row.try_get::<i64, _>("command_id")?;
    let manifest_id = row.try_get::<i64, _>("manifest_id")?;
    let version = row.try_get::<String, _>("version")?;
    let source_revision = row.try_get::<String, _>("source_revision")?;
    let artifact_sha256 = row.try_get::<String, _>("artifact_sha256")?;

    crate::audit(
        &state.pool,
        &actor.username,
        "node.agent.migration.requested",
        Some("nodes"),
        Some(node_id),
        json!({
            "commandId":command_id,
            "manifestId":manifest_id,
            "releaseVersion":version,
            "sourceRevision":source_revision,
            "artifactSha256":artifact_sha256
        }),
    )
    .await;

    Ok((
        StatusCode::ACCEPTED,
        Json(json!({
            "id":command_id,
            "nodeId":node_id,
            "action":"update_agent",
            "targetVersion":version,
            "state":"pending",
            "migration":{
                "manifestId":manifest_id,
                "sourceRevision":source_revision,
                "artifactSha256":artifact_sha256
            }
        })),
    ))
}

/// Existing endpoint, two deliberately separate modes:
/// - `{}` delegates to the byte-for-byte legacy implementation;
/// - `{ "releaseVersion": "..." }` is owner-only and staging-gated.
pub async fn request_agent_update(
    State(state): State<AppState>,
    Extension(actor): Extension<crate::auth::AuthUser>,
    Path(node_id): Path<i64>,
    Json(body): Json<AgentUpdateRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    match body {
        AgentUpdateRequest::Legacy(_) => {
            legacy::request_agent_update(
                State(state),
                Extension(actor),
                Path(node_id),
                Json(legacy::AgentUpdateRequest {}),
            )
            .await
        }
        AgentUpdateRequest::Migration(request) => {
            request_staging_agent_migration(&state, &actor, node_id, &request.release_version).await
        }
    }
}

/// Existing authenticated command poll, extended only for commands that already
/// carry the immutable D1b/D1c release-manifest binding. Unbound legacy commands
/// preserve the historical response shape and receive no fabricated identity.
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
        "WITH claimed AS (
           UPDATE node_restart_commands SET state='claimed',claimed_at=NOW()
           WHERE id=(SELECT id FROM node_restart_commands WHERE node_id=$1
             AND state='pending' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
           RETURNING id,action,target_version,release_manifest_id
         )
         SELECT c.id,c.action,c.target_version,c.release_manifest_id,
                m.version AS release_version,m.source_revision,m.artifact_sha256
         FROM claimed c
         LEFT JOIN node_xsp_agent_release_manifests m ON m.id=c.release_manifest_id",
    )
    .bind(request.node_id)
    .fetch_optional(&state.pool)
    .await?;

    let command = row.as_ref().map(polled_command_from_row).transpose()?;
    Ok(Json(json!({"command":command,"enforceStop":false})))
}

/// Bound staging migrations must return the exact immutable identity they were
/// polled with. Legacy unbound commands continue to use the old ACK body and
/// cannot attach fabricated migration identity.
#[expect(
    clippy::too_many_lines,
    reason = "The identity lock, exact manifest comparison and lifecycle update stay together so the security boundary is auditable"
)]
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
    if let Some(identity) = report.release_identity.as_ref() {
        validate_release_identity(identity)?;
    }

    node_auth::authenticate_for(
        &state,
        &headers,
        report.node_id,
        &body,
        "/api/v1/node/restart/ack",
    )
    .await?;

    let mut tx = state.pool.begin().await?;
    let row = sqlx::query(
        "SELECT c.action,c.target_version,c.release_manifest_id,
                m.version AS release_version,m.source_revision,m.artifact_sha256
         FROM node_restart_commands c
         LEFT JOIN node_xsp_agent_release_manifests m ON m.id=c.release_manifest_id
         WHERE c.node_id=$1 AND c.id=$2 AND c.state='claimed'
         FOR UPDATE OF c",
    )
    .bind(report.node_id)
    .bind(report.command_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "Restart command is no longer pending acknowledgement.",
        )
    })?;

    let manifest_id = row.try_get::<Option<i64>, _>("release_manifest_id")?;
    let ack_identity = if manifest_id.is_none() {
        if report.release_identity.is_some() {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "Legacy command must not carry Agent release identity.",
            ));
        }
        None
    } else {
        let expected_version = row
            .try_get::<Option<String>, _>("release_version")?
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::CONFLICT,
                    "Bound Agent release identity is missing.",
                )
            })?;
        let expected_revision = row
            .try_get::<Option<String>, _>("source_revision")?
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::CONFLICT,
                    "Bound Agent release identity is missing.",
                )
            })?;
        let expected_digest = row
            .try_get::<Option<String>, _>("artifact_sha256")?
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::CONFLICT,
                    "Bound Agent release identity is missing.",
                )
            })?;
        let target_version = row.try_get::<Option<String>, _>("target_version")?;
        let action = row.try_get::<String, _>("action")?;
        let reported = report.release_identity.as_ref().ok_or_else(|| {
            ApiError::new(
                StatusCode::CONFLICT,
                "Bound Agent command requires exact release identity acknowledgement.",
            )
        })?;
        if action != "update_agent"
            || target_version.as_deref() != Some(expected_version.as_str())
            || !exact_release_identity_matches(
                &expected_version,
                &expected_revision,
                &expected_digest,
                reported,
            )
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "Agent release identity acknowledgement does not match the bound manifest.",
            ));
        }
        Some(reported)
    };

    let state_name = if report.success {
        "succeeded"
    } else {
        "failed"
    };
    let (ack_version, ack_revision, ack_digest, ack_success) = match ack_identity {
        Some(identity) => (
            Some(identity.version.as_str()),
            Some(identity.source_revision.as_str()),
            Some(identity.artifact_sha256.as_str()),
            Some(report.success),
        ),
        None => (None, None, None, None),
    };

    let done = sqlx::query_scalar::<_, i64>(
        "UPDATE node_restart_commands
         SET state=$3,result=$4,finished_at=NOW(),
             release_ack_version=$5,release_ack_source_revision=$6,
             release_ack_artifact_sha256=$7,release_ack_success=$8,
             release_ack_received_at=CASE WHEN $5::TEXT IS NULL THEN NULL ELSE NOW() END
         WHERE node_id=$1 AND id=$2 AND state='claimed' RETURNING id",
    )
    .bind(report.node_id)
    .bind(report.command_id)
    .bind(state_name)
    .bind(&report.detail)
    .bind(ack_version)
    .bind(ack_revision)
    .bind(ack_digest)
    .bind(ack_success)
    .fetch_optional(&mut *tx)
    .await?;
    if done.is_none() {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Restart command is no longer pending acknowledgement.",
        ));
    }
    tx.commit().await?;
    Ok(Json(json!({"accepted":true})))
}

#[cfg(test)]
mod p0d_agent_orchestration_tests {
    use super::*;

    fn identity() -> AgentReleaseIdentity {
        AgentReleaseIdentity {
            version: "control-v5.2.0".to_owned(),
            source_revision: "a".repeat(40),
            artifact_sha256: "b".repeat(64),
        }
    }

    #[test]
    fn staging_gate_is_exact_and_non_default() {
        assert!(!staging_agent_migration_value_enabled(None));
        assert!(!staging_agent_migration_value_enabled(Some("")));
        assert!(!staging_agent_migration_value_enabled(Some("1")));
        assert!(!staging_agent_migration_value_enabled(Some("staging")));
        assert!(!staging_agent_migration_value_enabled(Some("STAGING-ONLY")));
        assert!(staging_agent_migration_value_enabled(Some("staging-only")));
    }

    #[test]
    fn request_schema_keeps_legacy_empty_and_migration_version_only() {
        assert!(matches!(
            serde_json::from_str::<AgentUpdateRequest>("{}").unwrap(),
            AgentUpdateRequest::Legacy(_)
        ));
        assert!(matches!(
            serde_json::from_str::<AgentUpdateRequest>(r#"{"releaseVersion":"control-v5.2.0"}"#)
                .unwrap(),
            AgentUpdateRequest::Migration(_)
        ));
        for rejected in [
            r#"{"releaseVersion":null}"#,
            r#"{"artifactSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#,
            r#"{"url":"https://example.invalid/agent"}"#,
            r#"{"command":"custom"}"#,
            r#"{"releaseVersion":"control-v5.2.0","sourceRevision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#,
        ] {
            assert!(serde_json::from_str::<AgentUpdateRequest>(rejected).is_err());
        }
    }

    #[test]
    fn release_version_validation_matches_manifest_contract() {
        for valid in ["control-v5.1.3", "agent_1+pq", "A"] {
            assert_eq!(validate_release_version(valid).unwrap(), valid);
        }
        for invalid in ["", "-bad", ".bad", " bad", "bad ", "bad/uri", "x y"] {
            assert!(validate_release_version(invalid).is_err(), "{invalid}");
        }
        assert!(validate_release_version(&"x".repeat(65)).is_err());
    }

    #[test]
    fn ack_schema_keeps_legacy_compatible_and_accepts_exact_optional_identity() {
        let legacy = r#"{"node_id":7,"command_id":11,"success":true,"detail":"ok"}"#;
        let parsed: NodeCommandAck = serde_json::from_str(legacy).unwrap();
        assert!(parsed.release_identity.is_none());

        let bound = format!(
            r#"{{"node_id":7,"command_id":11,"success":true,"detail":"ok","releaseIdentity":{{"version":"control-v5.2.0","sourceRevision":"{}","artifactSha256":"{}"}}}}"#,
            "a".repeat(40),
            "b".repeat(64)
        );
        let parsed: NodeCommandAck = serde_json::from_str(&bound).unwrap();
        assert_eq!(parsed.release_identity.as_ref(), Some(&identity()));
        validate_release_identity(parsed.release_identity.as_ref().unwrap()).unwrap();
    }

    #[test]
    fn release_identity_is_exact_and_cannot_be_partially_or_loosely_bound() {
        let expected = identity();
        assert!(exact_release_identity_matches(
            &expected.version,
            &expected.source_revision,
            &expected.artifact_sha256,
            &expected
        ));

        let mut wrong = identity();
        wrong.artifact_sha256 = "c".repeat(64);
        assert!(!exact_release_identity_matches(
            &expected.version,
            &expected.source_revision,
            &expected.artifact_sha256,
            &wrong
        ));

        let invalid = AgentReleaseIdentity {
            version: expected.version,
            source_revision: "A".repeat(40),
            artifact_sha256: expected.artifact_sha256,
        };
        assert!(validate_release_identity(&invalid).is_err());

        for rejected in [
            r#"{"node_id":7,"command_id":11,"success":true,"detail":"ok","releaseIdentity":{}}"#,
            r#"{"node_id":7,"command_id":11,"success":true,"detail":"ok","releaseIdentity":{"version":"control-v5.2.0"}}"#,
            r#"{"node_id":7,"command_id":11,"success":true,"detail":"ok","releaseIdentity":{"version":"control-v5.2.0","sourceRevision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","artifactSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","url":"https://example.invalid"}}"#,
        ] {
            assert!(serde_json::from_str::<NodeCommandAck>(rejected).is_err());
        }
    }
}
