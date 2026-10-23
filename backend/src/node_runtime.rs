use crate::{node_auth, ApiError, AppState};
use axum::{body::Bytes, extract::{Path, State}, http::{HeaderMap, StatusCode}, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use sha2::Digest;

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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DesiredConfigRequest { node_id: i64 }

/// Authenticated, outbound-only desired Xray configuration retrieval.
/// The node signs the request with its registered Ed25519 identity.
/// Inbounds are bound to loopback so the edge router alone owns public TCP ports.
pub async fn desired_config(
    State(state): State<AppState>, headers: HeaderMap, body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let request: DesiredConfigRequest = serde_json::from_slice(&body)
        .map_err(|_|ApiError::new(StatusCode::BAD_REQUEST,"Invalid node configuration request."))?;
    if request.node_id <= 0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST,"Invalid node ID."));
    }
    node_auth::authenticate_for(
        &state,&headers,request.node_id,&body,"/api/v1/node/desired-config"
    ).await?;
    let node = sqlx::query_scalar::<_,Value>(
        "SELECT data FROM panel_records WHERE collection='nodes' AND id=$1"
    ).bind(request.node_id).fetch_optional(&state.pool).await?
      .ok_or_else(||ApiError::new(StatusCode::NOT_FOUND,"Node not found."))?;
    let port = node.get("xrayLocalPort").and_then(|v|v.as_u64())
        .filter(|p| *p>0 && *p<=65535)
        .ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Set a valid local Xray port on the node."))?;
    let profile_id = node.get("profileId").and_then(|v|v.as_i64())
        .or_else(||node.get("profileId").and_then(|v|v.as_str()).and_then(|s|s.parse::<i64>().ok()))
        .ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Assign an XRAY STUDIO profile."))?;
    let profile = sqlx::query_scalar::<_,Value>(
        "SELECT data FROM panel_records WHERE collection='profiles' AND id=$1"
    ).bind(profile_id).fetch_optional(&state.pool).await?
      .ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Assigned XRAY STUDIO profile was not found."))?;
    let source = profile.get("config").and_then(Value::as_str)
        .ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Profile has no Xray JSON."))?;
    let mut config:Value=serde_json::from_str(source)
        .map_err(|_|ApiError::new(StatusCode::CONFLICT,"Invalid profile JSON."))?;
    let inbounds = config.get_mut("inbounds").and_then(Value::as_array_mut)
        .ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Profile has no inbounds."))?;
    if inbounds.len()!=1 {
        return Err(ApiError::new(StatusCode::CONFLICT,"Automatic local-port mapping currently requires exactly one inbound per profile."));
    }
    let inbound=inbounds.get_mut(0).unwrap();
    let object=inbound.as_object_mut().ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Invalid inbound."))?;
    object.insert("listen".to_owned(),json!("127.0.0.1"));
    object.insert("port".to_owned(),json!(port));
    let digest=hex::encode(sha2::Sha256::digest(serde_json::to_vec(&config).unwrap_or_default()));
    Ok(Json(json!({"nodeId":request.node_id,"profileId":profile_id,"listen":"127.0.0.1","port":port,"revision":digest,"config":config})))
}
