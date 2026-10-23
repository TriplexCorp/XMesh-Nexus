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
           AND (version LIKE 'control-v1%' OR version LIKE 'control-v2%' OR version LIKE 'control-v3%' OR version LIKE 'control-v4%'))"
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
pub async fn available_xray_releases(
    State(state):State<AppState>,
)->Result<Json<Value>,ApiError>{
    let releases=state.core.all_node_releases().await.map_err(|msg|
        ApiError::new(StatusCode::BAD_GATEWAY,msg))?;
    Ok(Json(json!({"items":releases})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct XrayVersionRequest{version:String}

pub async fn request_xray_update(
    State(state): State<AppState>,
    axum::extract::Extension(actor): axum::extract::Extension<crate::auth::AuthUser>,
    Path(node_id): Path<i64>,
    Json(body): Json<XrayVersionRequest>,
) -> Result<(StatusCode,Json<Value>),ApiError> {
    crate::require_mutation(&actor)?;
    if node_id<=0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST,"Invalid node ID"));
    }
    let target=body.version.trim();
    if target.len()>64 || target.is_empty() ||
       !target.bytes().all(|c|c.is_ascii_alphanumeric()||b"._+-".contains(&c)){
       return Err(ApiError::new(StatusCode::BAD_REQUEST,"Некорректная версия Xray"));
    }
    let releases=state.core.all_node_releases().await.map_err(|msg|
        ApiError::new(StatusCode::BAD_GATEWAY,msg))?;
    if !releases.iter().any(|r|r.version==target){
       return Err(ApiError::new(StatusCode::BAD_REQUEST,
           "Выбранная версия отсутствует среди официальных релизов Xray"));
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
           AND (version LIKE 'control-v3%' OR version LIKE 'control-v4%'))"
    ).bind(node_id).fetch_one(&state.pool).await?;
    if !active {
        return Err(ApiError::new(StatusCode::CONFLICT,
            "Для выбора версии требуется управляющий агент control-v3 на узле."));
    }
    // Claiming an update is exclusive with a pending restart.
    sqlx::query(
        "UPDATE node_restart_commands SET state='failed',
         result='Command expired before delivery',finished_at=NOW()
         WHERE node_id=$1 AND state IN ('pending','claimed')
           AND requested_at<NOW()-INTERVAL '180 seconds'"
    ).bind(node_id).execute(&state.pool).await?;
    let id=sqlx::query_scalar::<_,i64>(
        "INSERT INTO node_restart_commands(node_id,action,requested_by,target_version)
         VALUES($1,'update_xray',$2,$3) ON CONFLICT DO NOTHING RETURNING id"
    ).bind(node_id).bind(&actor.username).bind(target).fetch_optional(&state.pool).await?
      .ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Узел уже выполняет команду управления."))?;
    crate::audit(&state.pool,&actor.username,"node.xray.update.requested",
        Some("nodes"),Some(node_id),json!({"commandId":id,"targetVersion":target})).await;
    Ok((StatusCode::ACCEPTED,Json(json!({"id":id,"nodeId":node_id,
        "action":"update_xray","targetVersion":target,"state":"pending"}))))
}

// Remote agent upgrades are a fixed local action, never a command string or URL.
// Only v4+ nodes understand this action. Older nodes need one bootstrap upgrade.
pub const CONTROL_AGENT_VERSION: &str = "control-v4.0.0";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentUpdateRequest {}

pub async fn request_agent_update(
    State(state): State<AppState>,
    axum::extract::Extension(actor): axum::extract::Extension<crate::auth::AuthUser>,
    Path(node_id): Path<i64>,
    Json(_body): Json<AgentUpdateRequest>,
) -> Result<(StatusCode,Json<Value>),ApiError> {
    crate::require_mutation(&actor)?;
    if node_id<=0 {return Err(ApiError::new(StatusCode::BAD_REQUEST,"Invalid node ID"))}
    let node=sqlx::query_scalar::<_,Value>(
        "SELECT data FROM panel_records WHERE collection='nodes' AND id=$1"
    ).bind(node_id).fetch_optional(&state.pool).await?
      .ok_or_else(||ApiError::new(StatusCode::NOT_FOUND,"Node not found"))?;
    if node.get("disabled").and_then(Value::as_bool)==Some(true){
        return Err(ApiError::new(StatusCode::CONFLICT,
           "Отключённая нода не принимает команды. Сначала восстановите работу узла."));
    }
    let active:bool=sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM node_runtime_heartbeats
          WHERE node_id=$1 AND received_at>NOW()-INTERVAL '65 seconds'
            AND version LIKE 'control-v4.%')"
    ).bind(node_id).fetch_one(&state.pool).await?;
    if !active{
        return Err(ApiError::new(StatusCode::CONFLICT,
          "На ноде нет активного агента с поддержкой самообновления (control-v4+). Старый агент нужно один раз обновить штатным скриптом по SSH."));
    }
    sqlx::query(
        "UPDATE node_restart_commands SET state='failed',
         result='Command expired before delivery',finished_at=NOW()
         WHERE node_id=$1 AND state IN ('pending','claimed')
           AND requested_at<NOW()-INTERVAL '180 seconds'"
    ).bind(node_id).execute(&state.pool).await?;
    let id=sqlx::query_scalar::<_,i64>(
        "INSERT INTO node_restart_commands(node_id,action,requested_by,target_version)
         VALUES($1,'update_agent',$2,$3) ON CONFLICT DO NOTHING RETURNING id"
    ).bind(node_id).bind(&actor.username).bind(CONTROL_AGENT_VERSION)
      .fetch_optional(&state.pool).await?
      .ok_or_else(||ApiError::new(StatusCode::CONFLICT,
         "Узел уже выполняет другую команду управления."))?;
    crate::audit(&state.pool,&actor.username,"node.agent.update.requested",
       Some("nodes"),Some(node_id),json!({"commandId":id,"targetVersion":CONTROL_AGENT_VERSION})).await;
    Ok((StatusCode::ACCEPTED,Json(json!({
       "id":id,"nodeId":node_id,"action":"update_agent",
       "targetVersion":CONTROL_AGENT_VERSION,"state":"pending"
    }))))
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
        "SELECT id,action,target_version,state,result,requested_by,
          (EXTRACT(EPOCH FROM requested_at)*1000)::BIGINT AS requested_ms,
          (EXTRACT(EPOCH FROM finished_at)*1000)::BIGINT AS finished_ms
         FROM node_restart_commands WHERE node_id=$1 ORDER BY id DESC LIMIT 1"
    ).bind(node_id).fetch_optional(&state.pool).await?;
    Ok(Json(match item {
        Some(row)=>json!({
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
    // Quota/manual disable is authoritative. A node is not merely hidden in
    // the UI: the signed control agent MUST stop Xray before processing any
    // restart/update command. Repeat the directive until it is enforced.
    let disabled=sqlx::query_scalar::<_,bool>(
        "SELECT COALESCE((data->>'disabled')::boolean,false)
         FROM panel_records WHERE collection='nodes' AND id=$1"
    ).bind(request.node_id).fetch_optional(&state.pool).await?
     .ok_or_else(||ApiError::new(StatusCode::NOT_FOUND,"Node not found"))?;
    if disabled {
        return Ok(Json(json!({"command":null,"enforceStop":true})));
    }

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
         RETURNING id,action,target_version"
    ).bind(request.node_id).fetch_optional(&state.pool).await?;
    let command=match row {
        Some(row)=>Some(json!({"id":row.try_get::<i64,_>("id")?,
            "action":row.try_get::<String,_>("action")?,
            "targetVersion":row.try_get::<Option<String>,_>("target_version")?})),
        None=>None
    };
    Ok(Json(json!({"command":command,"enforceStop":false})))
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

// Populate Xray proxy inbound accounts from authoritative panel users and squads.
// XRAY STUDIO owns transports/security; panel users own runtime UUID authorization.
fn provision_proxy_users(config:&mut Value,users:&[Value],squads:&[Value],now_ms:i64) -> Result<(),ApiError> {
    let inbounds=config.get_mut("inbounds").and_then(Value::as_array_mut)
        .ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Profile has no inbounds."))?;
    for inbound in inbounds {
        let protocol=inbound.get("protocol").and_then(Value::as_str).unwrap_or("").to_owned();
        if !["vless","vmess","trojan","shadowsocks","hysteria","masque"].contains(&protocol.as_str()){continue}
        let ss_method=inbound.get("settings").and_then(|v|v.get("method"))
            .and_then(Value::as_str).unwrap_or("").to_owned();
        if protocol=="shadowsocks" && ss_method.is_empty(){continue}
        let tag=inbound.get("tag").and_then(Value::as_str).unwrap_or("");
        if tag.is_empty(){return Err(ApiError::new(StatusCode::CONFLICT,"Proxy inbound has no tag."))}
        let mut allowed=std::collections::HashSet::new();
        for squad in squads {
            let selected=squad.get("inb").and_then(Value::as_array)
                .is_some_and(|tags|tags.iter().any(|item|item.as_str()==Some(tag)));
            if selected && let Some(id)=squad.get("id").and_then(Value::as_i64){allowed.insert(id);}
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
            let email=format!("xmesh-u{record_id}--{encoded_tag}");
            let entry=match protocol.as_str() {
                "vless"|"vmess"=>json!({"id":uuid.to_string(),"level":0,"email":email}),
                "trojan"=>json!({"password":uuid.to_string(),"level":0,"email":email}),
                "hysteria"=>json!({"auth":uuid.to_string(),"level":0,"email":email}),
                "masque"=>json!({"pass":uuid.to_string(),"level":0,"email":email}),
                "shadowsocks"=>{
                    // SS2022 passwords must be valid PSKs; never use a plain UUID
                    // as a 2022 cipher key. Require an explicit per-user key.
                    let password=if ss_method.starts_with("2022-"){
                        user.get("ssPassword").and_then(Value::as_str).unwrap_or("")
                    }else{id};
                    if password.is_empty(){continue}
                    if ss_method.starts_with("2022-"){
                        // Xray forbids method in SS2022 per-user entries.
                        use base64::Engine as _;
                        let decoded=base64::engine::general_purpose::STANDARD.decode(password).ok();
                        let length=if ss_method=="2022-blake3-aes-128-gcm"{16}else{32};
                        if decoded.as_ref().is_none_or(|v|v.len()!=length){continue}
                        json!({"password":password,"level":0,"email":email})
                    }else{
                        json!({"password":password,"method":ss_method,"level":0,"email":email})
                    }
                },
                _=>continue
            };
            entries.push(entry);
        }
        let settings=inbound.get_mut("settings").and_then(Value::as_object_mut)
            .ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Proxy inbound settings missing."))?;
        if protocol=="vless"{
            // Server VLESS uses clients; never insert outbound vnext users.
            if settings.get("decryption").and_then(Value::as_str)
                .is_none_or(|s|s.trim().is_empty()){
                settings.insert("decryption".to_owned(),json!("none"));
            }
            settings.remove("users");
            settings.insert("clients".to_owned(),Value::Array(entries));
        }else{
            settings.remove("clients");
            settings.insert("users".to_owned(),Value::Array(entries));
        }
    }
    // Keep Xray StatsService private to the node: no public API listeners.
    if config.get("api").is_some_and(|api|!api.is_null()){
        return Err(ApiError::new(StatusCode::CONFLICT,"XRAY STUDIO profile already defines an API. Remove the conflicting API or use the dedicated node telemetry configuration."));
    }
    // Xray StatsService does not accept api.listen. It must be routed via
    // a private dokodemo-door inbound to an API-tagged outbound.
    config["api"]=json!({"tag":"xmesh_stats_api","services":["StatsService"]});
    config["stats"]=json!({});
    let inbounds=config.get_mut("inbounds").and_then(Value::as_array_mut)
        .ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Missing inbound array"))?;
    inbounds.push(json!({
        "tag":"xmesh_stats_in","listen":"127.0.0.1","port":10085,
        "protocol":"dokodemo-door",
        "settings":{"address":"127.0.0.1","port":10085,"network":"tcp"}
    }));
    let object=config.as_object_mut().ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Invalid Xray profile JSON"))?;
    let routing=object.entry("routing").or_insert_with(||json!({}));
    let ro=routing.as_object_mut().ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Invalid routing field"))?;
    let rules=ro.entry("rules").or_insert_with(||json!([]));
    let rules=rules.as_array_mut().ok_or_else(||ApiError::new(StatusCode::CONFLICT,"Invalid routing.rules"))?;
    rules.insert(0,json!({"type":"field","inboundTag":["xmesh_stats_in"],"outboundTag":"xmesh_stats_api"}));
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

// Offline policy is deliberately conservative: every active node receives at
// most its fraction of the currently unspent global user allowance (capped to
// 64 MiB per node) for a disconnected period. This is NOT a replacement for a
// centrally reserved multi-node quota ledger.
fn build_offline_policy(config:&Value, users:&[Value], node_id:i64, now_ms:i64,
    digest:&str, active_nodes:i64)->Value {
    let allowed:std::collections::HashSet<String>=config.get("inbounds")
        .and_then(Value::as_array).into_iter().flatten()
        .flat_map(|inbound|inbound.pointer("/settings/clients")
            .and_then(Value::as_array).into_iter().flatten())
        .filter_map(|client|client.get("id").and_then(Value::as_str))
        .filter_map(|uuid|uuid::Uuid::parse_str(uuid).ok().map(|id|id.to_string()))
        .collect();
    let mut user_policies=Vec::new();
    for user in users {
        let Some(uuid)=user.get("xrayId").and_then(Value::as_str)
            .and_then(|id|uuid::Uuid::parse_str(id).ok()) else{continue};
        if !allowed.contains(&uuid.to_string()) {continue}
        let Some(user_id)=user.get("id").and_then(Value::as_i64).filter(|id|*id>0)else{continue};
        let expires=crate::number(user,"expireAt").unwrap_or(0).max(0);
        let limit_gb=user.get("limit").and_then(Value::as_f64).unwrap_or(0.0);
        let used_gb=user.get("used").and_then(Value::as_f64).unwrap_or(0.0).max(0.0);
        // Use floor for both limits and remaining capacity: never round quota up.
        let used_bytes=(used_gb * 1_073_741_824.0).floor().clamp(0.0,i64::MAX as f64) as i64;
        let limit_bytes=(limit_gb.max(0.0)*1_073_741_824.0).floor()
            .clamp(0.0,i64::MAX as f64) as i64;
        let remaining=if limit_gb.is_finite() && limit_gb>0.0 {
            let remaining_gb=(limit_gb-used_gb).max(0.0);
            Some((remaining_gb*1_073_741_824.0).floor().clamp(0.0,i64::MAX as f64) as i64)
        } else {None};
        let offline_budget=remaining.map(|bytes|
            (bytes/active_nodes.max(1)).min(64*1024*1024));
        user_policies.push(json!({
            "userId":user_id,"xrayId":uuid.to_string(),
            "expireAtMs":expires,"panelUsedBytes":used_bytes,
            "limitBytes":limit_bytes,"offlineBudgetBytes":offline_budget
        }));
    }
    user_policies.sort_by_key(|item|item.get("userId").and_then(Value::as_i64).unwrap_or(0));
    json!({
        "version":1,"nodeId":node_id,"issuedAtMs":now_ms,
        "validUntilMs":now_ms.saturating_add(7*24*60*60*1000),
        "configSha256":digest,"users":user_policies
    })
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
    if node.get("disabled").and_then(Value::as_bool)==Some(true){
        return Err(ApiError::new(StatusCode::FORBIDDEN,
            "Node disabled: Xray configuration updates blocked."));
    }
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
    provision_proxy_users(&mut config,&users,&squads,now)?;
    let digest=hex::encode(sha2::Sha256::digest(serde_json::to_vec(&config).unwrap_or_default()));
    // Conserve offline allowances across all currently enabled nodes. Large
    // deployments should replace this bound with server-side reserved leases.
    let nodes=crate::load_records(&state.pool,"nodes").await?;
    let active_nodes=nodes.iter().filter(|node|
        node.get("disabled").and_then(Value::as_bool)!=Some(true)).count().max(1) as i64;
    let policy=build_offline_policy(&config,&users,request.node_id,now,&digest,active_nodes);
    let signature=state.node_policy_signer.sign(&policy)
        .map_err(|_|ApiError::new(StatusCode::INTERNAL_SERVER_ERROR,"Node policy signing failed."))?;
    Ok(Json(json!({
        "nodeId":request.node_id,"profileId":profile_id,
        "listen":"127.0.0.1","port":port,"revision":digest,"config":config,
        "policy":policy,"policySignature":signature,
        "policyPublicKey":state.node_policy_signer.public_key()
    })))
}

#[cfg(test)]
mod provision_tests {
    use super::*;
    #[test]
    fn offline_budget_is_conservative_and_scoped_to_authorized_users(){
        let cfg=json!({"inbounds":[{"settings":{"clients":[{"id":"550e8400-e29b-41d4-a716-446655440000"}]}}]});
        let u=vec![
            json!({"id":1,"xrayId":"550e8400-e29b-41d4-a716-446655440000","limit":1.0,"used":0.5,"expireAt":1800000010000_i64}),
            json!({"id":2,"xrayId":"550e8400-e29b-41d4-a716-446655440001","limit":1.0,"used":0.0})
        ];
        let policy=build_offline_policy(&cfg,&u,12,1800000000000_i64,&"a".repeat(64),2);
        assert_eq!(policy["users"].as_array().unwrap().len(),1);
        assert_eq!(policy["users"][0]["offlineBudgetBytes"],64*1024*1024);
        assert_eq!(policy["users"][0]["expireAtMs"],1800000010000_i64);
        assert_eq!(policy["users"][0]["panelUsedBytes"],536870912);
        assert_eq!(policy["nodeId"],12);
    }
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
        provision_proxy_users(&mut config,&users,&squads,now).unwrap();
        let settings=&config["inbounds"][0]["settings"];
        assert!(settings.get("users").is_none());
        assert_eq!(settings["clients"].as_array().unwrap().len(),1);
        assert_eq!(settings["clients"][0]["id"],"550e8400-e29b-41d4-a716-446655440000");
        assert_eq!(settings["clients"][0]["email"],"xmesh-u1--NL");
        assert_eq!(config["api"]["tag"],"xmesh_stats_api");
        assert_eq!(config["inbounds"][1]["listen"],"127.0.0.1");
        assert_eq!(config["inbounds"][1]["port"],10085);
        assert_eq!(config["routing"]["rules"][0]["outboundTag"],"xmesh_stats_api");
        assert_eq!(config["policy"]["levels"]["0"]["statsUserUplink"],true);
        assert_eq!(settings["decryption"],"none");
    }
    #[test]
    fn stats_email_escapes_non_ascii_inbound_tag(){
        let mut config=json!({"inbounds":[{"protocol":"vless","tag":"CDN NL","settings":{}}]});
        let users=vec![json!({"id":7,"xrayId":"550e8400-e29b-41d4-a716-446655440000","squads":[4]})];
        let squads=vec![json!({"id":4,"inb":["CDN NL"]})];
        provision_proxy_users(&mut config,&users,&squads,1_800_000_000_000).unwrap();
        assert_eq!(config["inbounds"][0]["settings"]["clients"][0]["email"],"xmesh-u7--CDN%20NL");
    }
    #[test]
    fn same_user_in_multiple_matching_squads_is_not_duplicated(){
        let mut config=json!({"inbounds":[{"protocol":"vless","tag":"NL","settings":{"users":[]}}]});
        let users=vec![json!({"id":1,"xrayId":"550e8400-e29b-41d4-a716-446655440000","squads":[4,5]})];
        let squads=vec![json!({"id":4,"inb":["NL"]}),json!({"id":5,"inb":["NL"]})];
        provision_proxy_users(&mut config,&users,&squads,1_800_000_000_000).unwrap();
        assert_eq!(config["inbounds"][0]["settings"]["clients"].as_array().unwrap().len(),1);
    }
}
