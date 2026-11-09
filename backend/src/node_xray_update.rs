//! Bounded, authenticated progress for one fixed Xray update command.
use crate::{ApiError, AppState, node_auth};
use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;

pub fn supported(version: &str) -> bool {
    let Some(value) = version.strip_prefix("control-v") else {
        return false;
    };
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    let Ok(major) = parts[0].parse::<u32>() else {
        return false;
    };
    let Ok(minor) = parts[1].parse::<u32>() else {
        return false;
    };
    let Ok(patch) = parts[2].parse::<u32>() else {
        return false;
    };
    major == 6 && (minor > 0 || patch >= 10)
}

pub async fn require_supported(state: &AppState, node_id: i64) -> Result<(), ApiError> {
    let agent=sqlx::query_scalar::<_,String>("SELECT version FROM node_runtime_heartbeats WHERE node_id=$1 AND received_at>NOW()-INTERVAL '90 seconds' ORDER BY received_at DESC LIMIT 1").bind(node_id).fetch_optional(&state.pool).await?;
    if !agent.as_deref().is_some_and(supported) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Update Agent to control-v6.0.10 or newer before updating Xray.",
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Progress {
    node_id: i64,
    command_id: i64,
    stage: String,
    code: Option<String>,
    #[serde(rename = "exitCode")]
    exit_code: Option<i32>,
    rollback: Option<String>,
}

fn valid(report: &Progress) -> bool {
    report.node_id > 0
        && report.command_id > 0
        && matches!(
            report.stage.as_str(),
            "preparing"
                | "downloading"
                | "validating"
                | "staging"
                | "starting"
                | "health_check"
                | "committing"
                | "rolling_back"
                | "completed"
        )
        && report.code.as_deref().is_none_or(|code| {
            matches!(
                code,
                "ok" | "tls_resource_missing"
                    | "geodata_missing"
                    | "resource_permission"
                    | "config_invalid"
                    | "disk_full"
                    | "docker_unavailable"
                    | "download_failed"
                    | "registry_unavailable"
                    | "image_not_found"
                    | "registry_denied"
                    | "image_identity"
                    | "docker_validation"
                    | "timeout"
                    | "prepare_failed"
                    | "start_failed"
                    | "health_failed"
                    | "pin_failed"
                    | "interrupted"
                    | "internal_error"
            )
        })
        && report
            .rollback
            .as_deref()
            .is_none_or(|state| matches!(state, "unchanged" | "rolled_back" | "rollback_failed"))
        && report
            .exit_code
            .is_none_or(|code| (0..=255).contains(&code))
}

pub async fn progress(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let report: Progress = serde_json::from_slice(&body)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid Xray update progress."))?;
    if !valid(&report) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid Xray update progress.",
        ));
    }
    node_auth::authenticate_for(
        &state,
        &headers,
        report.node_id,
        &body,
        "/api/v1/node/restart/progress",
    )
    .await?;
    // Never accept arbitrary log/config text from a node. Values are closed enums.
    let value = json!({"stage":report.stage,"code":report.code,"exitCode":report.exit_code,"rollback":report.rollback});
    let updated = sqlx::query_scalar::<_, i64>("UPDATE node_restart_commands SET progress=$3,progress_received_at=NOW() WHERE id=$1 AND node_id=$2 AND action='update_xray' AND state='claimed' RETURNING id")
        .bind(report.command_id).bind(report.node_id).bind(value).fetch_optional(&state.pool).await?;
    if updated.is_none() {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Xray update command is no longer active.",
        ));
    }
    Ok(Json(json!({"accepted":true})))
}

/// Durable node journals make only fixed-version Xray commands safe to redeliver.
pub async fn retry(state: &AppState, node_id: i64) -> Result<Option<Value>, ApiError> {
    let row = sqlx::query("SELECT c.id,c.target_version FROM node_restart_commands c JOIN panel_records n ON n.collection='nodes' AND n.id=c.node_id WHERE c.node_id=$1 AND c.action='update_xray' AND c.state='claimed' AND c.requested_at>NOW()-INTERVAL '10 minutes' AND NOT COALESCE((n.data->>'disabled')::boolean,false) ORDER BY c.id LIMIT 1")
        .bind(node_id).fetch_optional(&state.pool).await?;
    row.map(|r| Ok(json!({"id":r.try_get::<i64,_>("id")?,"action":"update_xray","targetVersion":r.try_get::<String,_>("target_version")?}))).transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn update_requires_transaction_capable_agent() {
        for version in ["control-v6.0.10", "control-v6.0.11", "control-v6.1.0"] {
            assert!(supported(version));
        }
        for version in [
            "control-v6.0.9",
            "control-v4.0.0",
            "control-v7.0.0",
            "untrusted-v6.0.10",
            "control-v6.0.10-malformed",
        ] {
            assert!(!supported(version));
        }
    }

    #[test]
    fn progress_accepts_only_closed_nonsecret_fields() {
        let good = json!({"node_id":1,"command_id":2,"stage":"validating","code":"tls_resource_missing","exitCode":23});
        assert!(valid(
            &serde_json::from_value::<Progress>(good.clone()).unwrap()
        ));
        for (field, value) in [
            ("stage", json!("privateKey=secret")),
            ("code", json!("full config")),
            ("exitCode", json!(-1)),
            ("rollback", json!("true")),
        ] {
            let mut bad = good.clone();
            bad[field] = value;
            assert!(!valid(&serde_json::from_value::<Progress>(bad).unwrap()));
        }
        let mut bad = good;
        bad["stderr"] = json!("secret");
        assert!(serde_json::from_value::<Progress>(bad).is_err());
    }
}
