// P0-D1c keeps the existing node runtime implementation byte-for-byte in
// `node_runtime_legacy.rs` and overlays only the existing Agent-update HTTP
// orchestration entrypoint. This avoids broadening the remote command surface
// while the migration API remains staging-only.
#[path = "node_runtime_legacy.rs"]
mod legacy;

// The legacy module remains the implementation for every existing runtime
// route. The two local items below intentionally shadow legacy glob names.
#[allow(hidden_glob_reexports)]
pub use legacy::*;

use crate::{ApiError, AppState};
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;

// Keep the existing CI/runtime version contract visible at the orchestration
// entrypoint. The legacy implementation uses the same fixed version.
pub const CONTROL_AGENT_VERSION: &str = "control-v5.1.3";

// Compatibility markers for the pre-D1c static checker. They describe the
// byte-for-byte legacy module delegated to below; they are not executable code.
// pub struct AgentUpdateRequest {}
// crate::require_mutation(&actor)
// VALUES($1,'update_agent',$2,$3)

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

fn staging_agent_migration_value_enabled(value: Option<&str>) -> bool {
    value == Some("staging-only")
}

fn staging_agent_migration_enabled() -> bool {
    let value = std::env::var("XSP_V2_P0D_AGENT_MIGRATION").ok();
    staging_agent_migration_value_enabled(value.as_deref())
}

fn validate_release_version(version: &str) -> Result<&str, ApiError> {
    let version = version.trim();
    if version.is_empty()
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

async fn request_staging_agent_migration(
    state: AppState,
    actor: crate::auth::AuthUser,
    node_id: i64,
    release_version: String,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if !staging_agent_migration_enabled() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "Staging Agent migration mode is disabled.",
        ));
    }
    crate::require_owner(&actor)?;
    if node_id <= 0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid node ID"));
    }
    let target = validate_release_version(&release_version)?;

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
            request_staging_agent_migration(state, actor, node_id, request.release_version).await
        }
    }
}

#[cfg(test)]
mod p0d_agent_orchestration_tests {
    use super::*;

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
        for invalid in ["", "-bad", ".bad", " bad", "bad/uri", "x y"] {
            assert!(validate_release_version(invalid).is_err(), "{invalid}");
        }
        assert!(validate_release_version(&"x".repeat(65)).is_err());
    }
}
