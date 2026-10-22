use crate::{node_auth, ApiError, AppState};
use axum::{body::Bytes, extract::{Path, State}, http::{HeaderMap, StatusCode}, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Heartbeat {
    node_id: i64,
    version: String,
    router_running: bool,
    xray_running: bool,
}

pub async fn heartbeat(
    State(state): State<AppState>, headers: HeaderMap, body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let report: Heartbeat = serde_json::from_slice(&body)
        .map_err(|_|ApiError::new(StatusCode::BAD_REQUEST,"Invalid node heartbeat JSON."))?;
    if report.node_id <= 0 || report.version.is_empty() || report.version.len() > 80
        || !report.version.bytes().all(|b| b.is_ascii_alphanumeric() || b".-+_".contains(&b))
    {
        return Err(ApiError::new(StatusCode::BAD_REQUEST,"Invalid node identity or version."));
    }
    node_auth::authenticate_for(
        &state, &headers, report.node_id, &body, "/api/v1/node/heartbeat"
    ).await?;
    sqlx::query(
        "INSERT INTO node_runtime_heartbeats(node_id,version,router_running,xray_running,received_at)
         VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(node_id) DO UPDATE
         SET version=EXCLUDED.version,router_running=EXCLUDED.router_running,
         xray_running=EXCLUDED.xray_running,received_at=NOW()"
    ).bind(report.node_id).bind(&report.version).bind(report.router_running)
    .bind(report.xray_running).execute(&state.pool).await?;
    Ok(Json(json!({"accepted":true})))
}

pub async fn status(
    State(state): State<AppState>, Path(node_id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    let exists = sqlx::query_scalar::<_,i64>(
        "SELECT id FROM panel_records WHERE collection='nodes' AND id=$1"
    ).bind(node_id).fetch_optional(&state.pool).await?;
    if exists.is_none() {return Err(ApiError::new(StatusCode::NOT_FOUND,"Node not found."))}
    let record = sqlx::query(
        "SELECT version,router_running,xray_running,
                (EXTRACT(EPOCH FROM received_at)*1000)::BIGINT AS received_ms,
                received_at > NOW() - INTERVAL '150 seconds' AS fresh
         FROM node_runtime_heartbeats WHERE node_id=$1"
    ).bind(node_id).fetch_optional(&state.pool).await?;
    match record {
        Some(row) => {
            let fresh: bool = row.try_get("fresh")?;
            Ok(Json(json!({
                "nodeId":node_id,
                "connected":fresh,
                "version":row.try_get::<String,_>("version")?,
                "routerRunning":row.try_get::<bool,_>("router_running")?,
                "xrayRunning":row.try_get::<bool,_>("xray_running")?,
                "lastSeenAt":row.try_get::<i64,_>("received_ms")?
            })))
        }
        None => Ok(Json(json!({"nodeId":node_id,"connected":false,"lastSeenAt":null})))
    }
}
