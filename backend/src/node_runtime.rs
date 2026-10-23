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
    #[serde(default)]
    xray_version: Option<String>,
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
    if report.xray_version.as_ref().is_some_and(|v|
        v.len()>40 || !v.bytes().all(|b| b.is_ascii_alphanumeric() || b".-+_".contains(&b))) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST,"Invalid Xray version."));
    }
    node_auth::authenticate_for(
        &state, &headers, report.node_id, &body, "/api/v1/node/heartbeat"
    ).await?;
    sqlx::query(
        "INSERT INTO node_runtime_heartbeats(node_id,version,router_running,xray_running,xray_version,received_at)
         VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(node_id) DO UPDATE
         SET version=EXCLUDED.version,router_running=EXCLUDED.router_running,
         xray_running=EXCLUDED.xray_running,xray_version=EXCLUDED.xray_version,received_at=NOW()"
    ).bind(report.node_id).bind(&report.version).bind(report.router_running)
    .bind(report.xray_running).bind(&report.xray_version).execute(&state.pool).await?;
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
        "SELECT version,router_running,xray_running,xray_version,
                (EXTRACT(EPOCH FROM received_at)*1000)::BIGINT AS received_ms,
                received_at > NOW() - INTERVAL '65 seconds' AS fresh
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
                "xrayVersion":row.try_get::<Option<String>,_>("xray_version")?,
                "lastSeenAt":row.try_get::<i64,_>("received_ms")?
            })))
        }
        None => Ok(Json(json!({"nodeId":node_id,"connected":false,"lastSeenAt":null})))
    }
}

// A metrics agent is read-only; restarts need a separate, signed control agent.
// Requests are queued, claimed by exactly one authenticated node, and acknowledged
// only after systemd reports a confirmed result. No shell commands are accepted.
pub async fn request_restart(
    State(state): State<AppState>,
    axum::extract::Extension(actor): axum::extract::Extension<crate::auth::AuthUser>,
    Path(node_id): Path<i64>,
) -> Result<(StatusCode,Json<Value>),ApiError> {
    crate::require_mutation(&actor)?;
    if node_id<=0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST,"Invalid node ID"));
    }
    let node=sqlx::query_scalar::<_,Value>(
        "SELECT data FROM panel_records WHERE collection='nodes' AND id=$1"
    ).bind(node_id).fetch_optional(&state.pool).await?
        .ok_or_else(||ApiError::new(StatusCode::NOT_FOUND,"Node not found"))?;
    if node.get("disabled").and_then(Value::as_bool)==Some(true) {
        return Err(ApiError::new(StatusCode::CONFLICT,"Node is disabled."));
    }
    let active=sqlx::query_scalar::<_,bool>(
        "SELECT EXISTS(SELECT 1 FROM node_runtime_heartbeats
         WHERE node_id=$1 AND received_at > NOW()-INTERVAL '90 seconds'
           AND (version LIKE 'control-v1%' OR version LIKE 'control-v2%'))"
    ).bind(node_id).fetch_one(&state.pool).await?;
    if !active {
        return Err(ApiError::new(StatusCode::CONFLICT,
            "У ноды нет подключённого управляющего агента. Агент метрик не умеет перезапускать Xray. Установите новую версию агента через «Подключить ноду и метрики»."));
    }
    // A stale command must fail visibly; it must NEVER be executed later.
    sqlx::query(
        "UPDATE node_restart_commands SET state='failed',
         result='Управляющий агент не подтвердил выполнение вовремя',finished_at=NOW()
         WHERE node_id=$1 AND state IN ('pending','claimed')
           AND requested_at<NOW()-INTERVAL '180 seconds'"
    ).bind(node_id).execute(&state.pool).await?;
    let row=sqlx::query_scalar::<_,i64>(
        "INSERT INTO node_restart_commands(node_id,requested_by)
         VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id"
    ).bind(node_id).bind(&actor.username).fetch_optional(&state.pool).await?
      .ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Узел уже выполняет команду управления."))?;
    crate::audit(&state.pool,&actor.username,"node.restart.requested",Some("nodes"),Some(node_id),
        json!({"commandId":row})).await;
    Ok((StatusCode::ACCEPTED,Json(json!({"id":row,"nodeId":node_id,"state":"pending"}))))
}

// Only an authenticated administrator can queue a fixed managed-container update.
// The node never receives an arbitrary command, image URL, or shell snippet.
pub async fn request_xray_update(
    State(state): State<AppState>,
    axum::extract::Extension(actor): axum::extract::Extension<crate::auth::AuthUser>,
    Path(node_id): Path<i64>,
) -> Result<(StatusCode,Json<Value>),ApiError> {
    crate::require_mutation(&actor)?;
    if node_id<=0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST,"Invalid node ID"));
    }
    let node=sqlx::query_scalar::<_,Value>(
        "SELECT data FROM panel_records WHERE collection='nodes' AND id=$1"
    ).bind(node_id).fetch_optional(&state.pool).await?
        .ok_or_else(||ApiError::new(StatusCode::NOT_FOUND,"Node not found"))?;
    if node.get("disabled").and_then(Value::as_bool)==Some(true) {
        return Err(ApiError::new(StatusCode::CONFLICT,"Node is disabled."));
    }
    let active=sqlx::query_scalar::<_,bool>(
        "SELECT EXISTS(SELECT 1 FROM node_runtime_heartbeats
         WHERE node_id=$1 AND received_at>NOW()-INTERVAL '90 seconds'
           AND version LIKE 'control-v2%')"
    ).bind(node_id).fetch_one(&state.pool).await?;
    if !active {
        return Err(ApiError::new(StatusCode::CONFLICT,
            "Обновление требует управляющий агент control-v2 на узле."));
    }
    // Claiming an update is exclusive with a pending restart.
    sqlx::query(
        "UPDATE node_restart_commands SET state='failed',
         result='Command expired before delivery',finished_at=NOW()
         WHERE node_id=$1 AND state IN ('pending','claimed')
           AND requested_at<NOW()-INTERVAL '180 seconds'"
    ).bind(node_id).execute(&state.pool).await?;
    let id=sqlx::query_scalar::<_,i64>(
        "INSERT INTO node_restart_commands(node_id,action,requested_by)
         VALUES($1,'update_xray',$2) ON CONFLICT DO NOTHING RETURNING id"
    ).bind(node_id).bind(&actor.username).fetch_optional(&state.pool).await?
      .ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Узел уже выполняет команду управления."))?;
    crate::audit(&state.pool,&actor.username,"node.xray.update.requested",
        Some("nodes"),Some(node_id),json!({"commandId":id})).await;
    Ok((StatusCode::ACCEPTED,Json(json!({"id":id,"nodeId":node_id,
        "action":"update_xray","state":"pending"}))))
}

pub async fn restart_status(
    State(state): State<AppState>,Path(node_id):Path<i64>,
)->Result<Json<Value>,ApiError>{
    let exists=sqlx::query_scalar::<_,i64>(
        "SELECT id FROM panel_records WHERE collection='nodes' AND id=$1"
    ).bind(node_id).fetch_optional(&state.pool).await?;
    if exists.is_none(){return Err(ApiError::new(StatusCode::NOT_FOUND,"Node not found"))}
    sqlx::query(
        "UPDATE node_restart_commands SET state='failed',
         result='Управляющий агент не подтвердил выполнение вовремя',finished_at=NOW()
         WHERE node_id=$1 AND state IN ('pending','claimed')
           AND requested_at<NOW()-INTERVAL '180 seconds'"
    ).bind(node_id).execute(&state.pool).await?;
    let item=sqlx::query(
        "SELECT id,action,state,result,requested_by,
          (EXTRACT(EPOCH FROM requested_at)*1000)::BIGINT AS requested_ms,
          (EXTRACT(EPOCH FROM finished_at)*1000)::BIGINT AS finished_ms
         FROM node_restart_commands WHERE node_id=$1 ORDER BY id DESC LIMIT 1"
    ).bind(node_id).fetch_optional(&state.pool).await?;
    Ok(Json(match item {
        Some(row)=>json!({
            "id":row.try_get::<i64,_>("id")?,
            "action":row.try_get::<String,_>("action")?,
            "nodeId":node_id,
            "state":row.try_get::<String,_>("state")?,
            "result":row.try_get::<String,_>("result")?,
            "requestedBy":row.try_get::<String,_>("requested_by")?,
            "requestedAt":row.try_get::<i64,_>("requested_ms")?,
            "finishedAt":row.try_get::<Option<i64>,_>("finished_ms")?
        }),
        None=>json!({"nodeId":node_id,"state":"none"})
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NodeCommandPoll { node_id:i64 }

pub async fn poll_restart(
    State(state):State<AppState>,headers:HeaderMap,body:Bytes,
)->Result<Json<Value>,ApiError>{
    let request:NodeCommandPoll=serde_json::from_slice(&body)
        .map_err(|_|ApiError::new(StatusCode::BAD_REQUEST,"Invalid command poll."))?;
    if request.node_id<=0{return Err(ApiError::new(StatusCode::BAD_REQUEST,"Invalid node ID"))}
    node_auth::authenticate_for(
        &state,&headers,request.node_id,&body,"/api/v1/node/restart/poll"
    ).await?;
    sqlx::query(
        "UPDATE node_restart_commands SET state='failed',
         result='Command expired before delivery',finished_at=NOW()
         WHERE node_id=$1 AND state='pending'
           AND requested_at<NOW()-INTERVAL '180 seconds'"
    ).bind(request.node_id).execute(&state.pool).await?;
    let row=sqlx::query(
        "UPDATE node_restart_commands SET state='claimed',claimed_at=NOW()
         WHERE id=(SELECT id FROM node_restart_commands WHERE node_id=$1
           AND state='pending' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
         RETURNING id,action"
    ).bind(request.node_id).fetch_optional(&state.pool).await?;
    let command=match row {
        Some(row)=>Some(json!({"id":row.try_get::<i64,_>("id")?,
            "action":row.try_get::<String,_>("action")?})),
        None=>None
    };
    Ok(Json(json!({"command":command})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NodeCommandAck {
    node_id:i64,
    command_id:i64,
    success:bool,
    detail:String
}

pub async fn acknowledge_restart(
    State(state):State<AppState>,headers:HeaderMap,body:Bytes,
)->Result<Json<Value>,ApiError>{
    let report:NodeCommandAck=serde_json::from_slice(&body)
        .map_err(|_|ApiError::new(StatusCode::BAD_REQUEST,"Invalid command acknowledgement."))?;
    if report.node_id<=0 || report.command_id<=0 || report.detail.len()>256
        || report.detail.chars().any(char::is_control) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST,"Invalid command details."));
    }
    node_auth::authenticate_for(
        &state,&headers,report.node_id,&body,"/api/v1/node/restart/ack"
    ).await?;
    let state_name=if report.success{"succeeded"}else{"failed"};
    let done=sqlx::query_scalar::<_,i64>(
        "UPDATE node_restart_commands SET state=$3,result=$4,finished_at=NOW()
         WHERE node_id=$1 AND id=$2 AND state='claimed' RETURNING id"
    ).bind(report.node_id).bind(report.command_id).bind(state_name).bind(&report.detail)
        .fetch_optional(&state.pool).await?;
    if done.is_none(){
        return Err(ApiError::new(StatusCode::CONFLICT,"Restart command is no longer pending acknowledgement."));
    }
    Ok(Json(json!({"accepted":true})))
}

// Populate Xray VLESS inbound users from the authoritative panel users and squads.
// XRAY STUDIO owns transports/security; panel users own runtime UUID authorization.
fn provision_vless_users(config:&mut Value,users:&[Value],squads:&[Value],now_ms:i64) -> Result<(),ApiError> {
    let inbounds=config.get_mut("inbounds").and_then(Value::as_array_mut)
        .ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Profile has no inbounds."))?;
    for inbound in inbounds {
        if inbound.get("protocol").and_then(Value::as_str)!=Some("vless"){continue}
        let tag=inbound.get("tag").and_then(Value::as_str).unwrap_or("");
        if tag.is_empty(){return Err(ApiError::new(StatusCode::CONFLICT,"VLESS inbound has no tag."))}
        let mut allowed=std::collections::HashSet::new();
        for squad in squads {
            let selected=squad.get("inb").and_then(Value::as_array)
                .is_some_and(|tags|tags.iter().any(|item|item.as_str()==Some(tag)));
            if selected {
                if let Some(id)=squad.get("id").and_then(Value::as_i64){allowed.insert(id);}
            }
        }
        let mut entries=Vec::new();
        let mut seen=std::collections::HashSet::new();
        for user in users {
            if crate::user_status(user,now_ms)!="ACTIVE"{continue}
            let authorized=user.get("squads").and_then(Value::as_array)
                .is_some_and(|ids|ids.iter().any(|id|id.as_i64().is_some_and(|id|allowed.contains(&id))));
            if !authorized{continue}
            let Some(id)=user.get("xrayId").and_then(Value::as_str)else{continue};
            let Ok(uuid)=uuid::Uuid::parse_str(id)else{continue};
            if !seen.insert(uuid){continue}
            let record_id=user.get("id").and_then(Value::as_i64).unwrap_or(0);
            let encoded_tag=tag.bytes().map(|b|{
                if b.is_ascii_alphanumeric() || matches!(b,b'-'|b'_'|b'.'|b'~'){
                    (b as char).to_string()
                }else{format!("%{b:02X}")}
            }).collect::<String>();
            entries.push(json!({"id":uuid.to_string(),"level":0,
                "email":format!("xmesh-u{record_id}--{encoded_tag}")}));
        }
        let settings=inbound.get_mut("settings").and_then(Value::as_object_mut)
            .ok_or_else(||ApiError::new(StatusCode::CONFLICT,"VLESS inbound settings missing."))?;
        // Current Xray requires explicit decryption: "none" for plain VLESS.
        // Preserve configured post-quantum decryption values verbatim.
        if settings.get("decryption").and_then(Value::as_str).is_none_or(|s|s.trim().is_empty()) {
            settings.insert("decryption".to_owned(),json!("none"));
        }
        // Inbound VLESS uses settings.clients, unlike outbound VLESS which uses
        // settings.vnext[].users. Never confuse the two schemas.
        settings.remove("users");
        settings.insert("clients".to_owned(),Value::Array(entries));
    }
    // Keep Xray StatsService private to the node: no public API listeners.
    if config.get("api").is_some_and(|api|!api.is_null()){
        return Err(ApiError::new(StatusCode::CONFLICT,"XRAY STUDIO profile already defines an API. Remove the conflicting API or use the dedicated node telemetry configuration."));
    }
    config["api"]=json!({"tag":"xmesh_stats_api","listen":"127.0.0.1:10085","services":["StatsService"]});
    config["stats"]=json!({});
    let object=config.as_object_mut().ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Invalid Xray profile JSON"))?;
    let policy=object.entry("policy").or_insert_with(||json!({}));
    let po=policy.as_object_mut().ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Invalid policy field"))?;
    let levels=po.entry("levels").or_insert_with(||json!({}));
    let lo=levels.as_object_mut().ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Invalid policy.levels"))?;
    let level=lo.entry("0").or_insert_with(||json!({}));
    let lvl=level.as_object_mut().ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Invalid policy level 0"))?;
    lvl.insert("statsUserUplink".into(),json!(true));
    lvl.insert("statsUserDownlink".into(),json!(true));
    Ok(())
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
    let users=crate::load_records(&state.pool,"users").await?;
    let squads=crate::load_records(&state.pool,"squads").await?;
    let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_millis() as i64;
    provision_vless_users(&mut config,&users,&squads,now)?;
    let digest=hex::encode(sha2::Sha256::digest(serde_json::to_vec(&config).unwrap_or_default()));
    Ok(Json(json!({"nodeId":request.node_id,"profileId":profile_id,"listen":"127.0.0.1","port":port,"revision":digest,"config":config})))
}

#[cfg(test)]
mod provision_tests {
    use super::*;
    #[test]
    fn runtime_inbound_contains_only_active_assigned_uuids(){
        let mut config=json!({"inbounds":[{"protocol":"vless","tag":"NL",
            "settings":{"decryption":"","clients":[]}}]});
        let now=1_800_000_000_000_i64;
        let users=vec![
            json!({"id":1,"xrayId":"550e8400-e29b-41d4-a716-446655440000","squads":[4]}),
            json!({"id":2,"xrayId":"550e8400-e29b-41d4-a716-446655440001","squads":[4],"disabled":true}),
            json!({"id":3,"xrayId":"550e8400-e29b-41d4-a716-446655440002","squads":[5]}),
            json!({"id":4,"xrayId":"550e8400-e29b-41d4-a716-446655440003","squads":[4],"expireAt":now-1})
        ];
        let squads=vec![json!({"id":4,"inb":["NL"]}),json!({"id":5,"inb":["SE"]})];
        provision_vless_users(&mut config,&users,&squads,now).unwrap();
        let settings=&config["inbounds"][0]["settings"];
        assert!(settings.get("users").is_none());
        assert_eq!(settings["clients"].as_array().unwrap().len(),1);
        assert_eq!(settings["clients"][0]["id"],"550e8400-e29b-41d4-a716-446655440000");
        assert_eq!(settings["clients"][0]["email"],"xmesh-u1--NL");
        assert_eq!(config["api"]["listen"],"127.0.0.1:10085");
        assert_eq!(config["policy"]["levels"]["0"]["statsUserUplink"],true);
        assert_eq!(settings["decryption"],"none");
    }
    #[test]
    fn stats_email_escapes_non_ascii_inbound_tag(){
        let mut config=json!({"inbounds":[{"protocol":"vless","tag":"CDN NL","settings":{}}]});
        let users=vec![json!({"id":7,"xrayId":"550e8400-e29b-41d4-a716-446655440000","squads":[4]})];
        let squads=vec![json!({"id":4,"inb":["CDN NL"]})];
        provision_vless_users(&mut config,&users,&squads,1_800_000_000_000).unwrap();
        assert_eq!(config["inbounds"][0]["settings"]["clients"][0]["email"],"xmesh-u7--CDN%20NL");
    }
    #[test]
    fn same_user_in_multiple_matching_squads_is_not_duplicated(){
        let mut config=json!({"inbounds":[{"protocol":"vless","tag":"NL","settings":{"users":[]}}]});
        let users=vec![json!({"id":1,"xrayId":"550e8400-e29b-41d4-a716-446655440000","squads":[4,5]})];
        let squads=vec![json!({"id":4,"inb":["NL"]}),json!({"id":5,"inb":["NL"]})];
        provision_vless_users(&mut config,&users,&squads,1_800_000_000_000).unwrap();
        assert_eq!(config["inbounds"][0]["settings"]["clients"].as_array().unwrap().len(),1);
    }
}
