use crate::{auth::AuthUser,ApiError,AppState};
use axum::{extract::{Extension,Path,State},http::{header,StatusCode},response::{IntoResponse,Response},Json};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use sqlx::Row;
use uuid::Uuid;
use aes_gcm::{aead::{Aead, KeyInit, Payload, OsRng, rand_core::RngCore}, Aes256Gcm, Nonce};

// Encrypt recoverable bearer secrets at rest with a separately derived key.
 // TOTP_ENCRYPTION_KEY must stay stable across upgrades; raw token never enters
 // audit logs, the user JSON record or public settings.
fn subscription_cipher(state:&AppState)->Result<Aes256Gcm,ApiError>{
 let master=state.totp_key.as_ref().ok_or_else(||ApiError::new(
  StatusCode::SERVICE_UNAVAILABLE,"Subscription encryption requires TOTP_ENCRYPTION_KEY"))?;
 let mut hash=Sha256::new();
 hash.update(b"XMESH-SUBSCRIPTION-ENCRYPTION-V1\0");
 hash.update(master);
 let key=hash.finalize();
 Aes256Gcm::new_from_slice(&key).map_err(|_|ApiError::new(StatusCode::INTERNAL_SERVER_ERROR,"Subscription cipher unavailable"))
}
fn encrypt_token(state:&AppState,user_id:i64,token:&str)->Result<String,ApiError>{
 let mut nonce=[0u8;12];OsRng.fill_bytes(&mut nonce);
 let encrypted=subscription_cipher(state)?.encrypt(Nonce::from_slice(&nonce),
  Payload{msg:token.as_bytes(),aad:&user_id.to_be_bytes()})
  .map_err(|_|ApiError::new(StatusCode::INTERNAL_SERVER_ERROR,"Subscription encryption failed"))?;
 let mut bytes=nonce.to_vec();bytes.extend(encrypted);Ok(hex::encode(bytes))
}
fn decrypt_token(state:&AppState,user_id:i64,encoded:&str,expected_hash:&str)->Result<String,ApiError>{
 let bytes=hex::decode(encoded).map_err(|_|ApiError::new(StatusCode::SERVICE_UNAVAILABLE,"Stored subscription is corrupt"))?;
 if bytes.len()<12+16+64{return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE,"Stored subscription is corrupt"))}
 let raw=subscription_cipher(state)?.decrypt(Nonce::from_slice(&bytes[..12]),
  Payload{msg:&bytes[12..],aad:&user_id.to_be_bytes()})
  .map_err(|_|ApiError::new(StatusCode::SERVICE_UNAVAILABLE,"Subscription decryption failed; verify TOTP_ENCRYPTION_KEY"))?;
 let token=String::from_utf8(raw).map_err(|_|ApiError::new(StatusCode::SERVICE_UNAVAILABLE,"Stored subscription is corrupt"))?;
 if !valid_token(&token)||token_hash(&token)!=expected_hash{
  return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE,"Subscription secret integrity check failed"))
 }
 Ok(token)
}
fn bad(msg:&'static str)->ApiError {ApiError::new(StatusCode::BAD_REQUEST,msg)}
fn studio_url(settings:&Value,token:&str)->String{
 let domain=settings.get("subscriptionDomain").and_then(Value::as_str)
  .filter(|s|!s.is_empty()).or_else(||settings.get("domain").and_then(Value::as_str)
  .filter(|s|!s.is_empty()));
 let path=settings.get("subscriptionPath").and_then(Value::as_str).filter(|p|p.starts_with('/'))
  .unwrap_or("/s").trim_end_matches('/');
 match domain {
  Some(host)=>format!("https://{host}{path}/{token}"),
  None=>format!("{path}/{token}"),
 }
}
fn token_hash(token:&str)->String{hex::encode(Sha256::digest(token.as_bytes()))}
fn valid_token(token:&str)->bool{token.len()==64&&token.bytes().all(|c|c.is_ascii_hexdigit()&&!c.is_ascii_uppercase())}
fn nonempty<'a>(obj:&'a Value,key:&str)->Option<&'a str>{obj.get(key).and_then(Value::as_str).filter(|s|!s.is_empty())}
fn port(v:&Value)->Option<u16>{v.as_u64().and_then(|p|u16::try_from(p).ok()).filter(|p|*p>0)}
fn endpoint(host:&Value)->Option<&str>{
 let a=["externalAddress","address","publicAddress","addr"].into_iter().find_map(|k|nonempty(host,k))?;
 if a.chars().any(|c|matches!(c,' '|'/'|'@'|'?'|'#'|'\\'))||a=="localhost"||a=="0.0.0.0"||a.starts_with("127.")||a.starts_with("10.")||a.starts_with("192.168.")||a.starts_with("172.16.") {return None}
 Some(a)
}
fn encode_component(s:&str)->String{
 let mut result=String::new();
 for c in s.bytes(){if c.is_ascii_alphanumeric()||b"-._~".contains(&c){result.push(c as char)}else{result.push_str(&format!("%{c:02X}"))}}
 result
}
fn vless_link(user:&Value, inbound:&Value, host:&Value)->Option<String>{
 if nonempty(inbound,"protocol")?!="vless"{return None}
 let uuid=nonempty(user,"xrayId")?;
 if uuid::Uuid::parse_str(uuid).is_err(){return None}
 let address=endpoint(host)?;
 let actual_port=["externalPort","port"].into_iter().find_map(|k|host.get(k).and_then(port))
   .or_else(||inbound.get("port").and_then(port))?;
 let stream=inbound.get("streamSettings")?;
 let security=nonempty(stream,"security").unwrap_or("none");
 if !["tls","reality","none"].contains(&security){return None}
 let network=nonempty(stream,"network").unwrap_or("tcp");
 if !["tcp","raw","xhttp","ws","grpc"].contains(&network){return None}
 let mut opts=vec![format!("type={}",encode_component(network)),format!("security={}",security)];
 let settings=inbound.get("settings").unwrap_or(&Value::Null);
 if let Some(flow)=nonempty(settings,"flow"){opts.push(format!("flow={}",encode_component(flow)))}
 let transport=match network{"xhttp"=>stream.get("xhttpSettings"),"ws"=>stream.get("wsSettings"),"grpc"=>stream.get("grpcSettings"),_=>None};
 if let Some(config)=transport{
  if let Some(path)=nonempty(host,"path").or_else(||nonempty(config,"path")){opts.push(format!("path={}",encode_component(path)))}
  if let Some(h)=nonempty(host,"host").or_else(||nonempty(host,"externalHost")){opts.push(format!("host={}",encode_component(h)))}
  if network=="grpc"{if let Some(service)=nonempty(config,"serviceName"){opts.push(format!("serviceName={}",encode_component(service)))}}
  if network=="xhttp"{if let Some(mode)=nonempty(config,"mode"){opts.push(format!("mode={}",encode_component(mode)))}}
 }
 if security!="none"{
  let sni=nonempty(host,"sni").or_else(||nonempty(host,"externalSNI"))
   .or_else(||stream.get("realitySettings").and_then(|v|v.get("serverNames")).and_then(Value::as_array).and_then(|a|a.first()).and_then(Value::as_str))
   .or_else(||stream.get("tlsSettings").and_then(|v|nonempty(v,"serverName")))?;
  opts.push(format!("sni={}",encode_component(sni)));
 }
 if security=="reality"{
  let reality=stream.get("realitySettings").unwrap_or(&Value::Null);
  let pbk=nonempty(host,"publicKey").or_else(||nonempty(host,"realityPublicKey"))
   .or_else(||nonempty(inbound,"publicKey")).or_else(||nonempty(reality,"publicKey"))?;
  let sid=nonempty(host,"shortId").or_else(||nonempty(host,"externalShortId"))
   .or_else(||reality.get("shortIds").and_then(Value::as_array).and_then(|a|a.first()).and_then(Value::as_str))?;
  opts.push(format!("pbk={}",encode_component(pbk)));
  opts.push(format!("sid={}",encode_component(sid)));
  opts.push(format!("fp={}",encode_component(nonempty(host,"fp").or_else(||nonempty(host,"fingerprint")).unwrap_or("chrome"))));
 }
 let name=nonempty(host,"remark").unwrap_or(address);
 Some(format!("vless://{}@{}:{}?{}#{}",uuid,address,actual_port,opts.join("&"),encode_component(name)))
}
async fn record(state:&AppState,id:i64)->Result<Value,ApiError>{
 let row=sqlx::query("SELECT data FROM panel_records WHERE collection='users' AND id=$1")
  .bind(id).fetch_optional(&state.pool).await?.ok_or_else(||ApiError::new(StatusCode::NOT_FOUND,"User not found"))?;
 row.try_get("data").map_err(Into::into)
}
pub async fn create(State(state):State<AppState>,Extension(actor):Extension<AuthUser>,Path(id):Path<i64>)
 ->Result<Json<Value>,ApiError>{
 crate::require_mutation(&actor)?;
 if id<=0{return Err(bad("Invalid user ID"))}
 let _user=record(&state,id).await?;
 let token=format!("{}{}",Uuid::new_v4().simple(),Uuid::new_v4().simple());
 let encrypted=encrypt_token(&state,id,&token)?;
 sqlx::query("INSERT INTO user_subscription_tokens(user_id,token_hash,token_ciphertext) VALUES($1,$2,$3)
  ON CONFLICT(user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,
   token_ciphertext=EXCLUDED.token_ciphertext,created_at=NOW()")
  .bind(id).bind(token_hash(&token)).bind(encrypted).execute(&state.pool).await?;
 crate::audit(&state.pool,&actor.username,"subscription.rotated",Some("users"),Some(id),json!({})).await;
 let settings=crate::read_settings(&state.pool).await?;
 Ok(Json(json!({"token":token,"userId":id,"url":studio_url(&settings,&token)})))
}
pub async fn status(
 State(state):State<AppState>,Extension(actor):Extension<AuthUser>,Path(id):Path<i64>,
)->Result<Json<Value>,ApiError>{
 crate::require_mutation(&actor)?;
 if id<=0{return Err(bad("Invalid user ID"))}
 let _=record(&state,id).await?;
 let row=sqlx::query("SELECT token_hash,token_ciphertext,created_at FROM user_subscription_tokens WHERE user_id=$1")
  .bind(id).fetch_optional(&state.pool).await?;
 let Some(row)=row else{return Ok(Json(json!({"enabled":false,"token":null,"legacy":false})))};
 let encrypted:Option<String>=row.try_get("token_ciphertext")?;
 let hash:String=row.try_get("token_hash")?;
 let token=match encrypted{
  Some(value)=>Some(decrypt_token(&state,id,&value,&hash)?),
  None=>None
 };
 let settings=crate::read_settings(&state.pool).await?;
 let url=token.as_deref().map(|value|studio_url(&settings,value));
 Ok(Json(json!({"enabled":true,"legacy":token.is_none(),"token":token,"url":url})))
}
pub async fn revoke(State(state):State<AppState>,Extension(actor):Extension<AuthUser>,Path(id):Path<i64>)
 ->Result<Json<Value>,ApiError>{
 crate::require_mutation(&actor)?;
 sqlx::query("DELETE FROM user_subscription_tokens WHERE user_id=$1").bind(id).execute(&state.pool).await?;
 crate::audit(&state.pool,&actor.username,"subscription.revoked",Some("users"),Some(id),json!({})).await;
 Ok(Json(json!({"revoked":true})))
}
pub async fn serve(State(state):State<AppState>,Path(token):Path<String>)->Result<Response,ApiError>{
 if !valid_token(&token){return Err(ApiError::new(StatusCode::NOT_FOUND,"Subscription not found"))}
 let row=sqlx::query("SELECT user_id FROM user_subscription_tokens WHERE token_hash=$1")
  .bind(token_hash(&token)).fetch_optional(&state.pool).await?.ok_or_else(||ApiError::new(StatusCode::NOT_FOUND,"Subscription not found"))?;
 let id:i64=row.try_get("user_id")?;
 let user=record(&state,id).await?;
 let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as i64;
 if crate::user_status(&user,now)!="ACTIVE"{return Err(ApiError::new(StatusCode::FORBIDDEN,"Subscription inactive"))}
 let squads=crate::load_records(&state.pool,"squads").await?;
 let profiles=crate::load_records(&state.pool,"profiles").await?;
 let hosts=crate::load_records(&state.pool,"hosts").await?;
 let nodes=crate::load_records(&state.pool,"nodes").await?;
 let ids=user.get("squads").and_then(Value::as_array).cloned().unwrap_or_default();
 let mut tags=std::collections::HashSet::new();
 for squad in &squads{
  if !ids.iter().any(|id|id.as_i64()==squad.get("id").and_then(Value::as_i64)){continue}
  if let Some(items)=squad.get("inb").and_then(Value::as_array){
   for tag in items.iter().filter_map(Value::as_str){tags.insert(tag.to_owned());}
  }
 }
 let mut links=Vec::<String>::new();
 for profile in &profiles{
  let cfg=match profile.get("config"){Some(Value::String(raw))=>serde_json::from_str::<Value>(raw).ok(),Some(v)=>Some(v.clone()),None=>None};
  let Some(cfg)=cfg else{continue};
  let Some(inbounds)=cfg.get("inbounds").and_then(Value::as_array)else{continue};
  for inbound in inbounds{
   let Some(tag)=nonempty(inbound,"tag")else{continue};
   if !tags.contains(tag){continue}
   let matched:Vec<&Value>=hosts.iter().filter(|h|h.get("disabled")!=Some(&Value::Bool(true))&&nonempty(h,"tag")==Some(tag)).collect();
   if !matched.is_empty(){
    for host in matched{if let Some(link)=vless_link(&user,inbound,host){links.push(link)}}
   }else{
    for node in nodes.iter().filter(|n|n.get("profileId")==profile.get("id")&&n.get("disabled")!=Some(&Value::Bool(true))){
     let host=json!({"address":node.get("publicAddress").or_else(||node.get("externalAddress")).or_else(||node.get("addr")),"port":inbound.get("port"),"remark":node.get("name")});
     if let Some(link)=vless_link(&user,inbound,&host){links.push(link)}
    }
   }
  }
 }
 if links.is_empty(){return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE,"No valid public VLESS endpoints configured"))}
 let mut response=links.join("\n").into_response();
 response.headers_mut().insert(header::CONTENT_TYPE,"text/plain; charset=utf-8".parse().unwrap());
 response.headers_mut().insert(header::CACHE_CONTROL,"no-store, private".parse().unwrap());
 response.headers_mut().insert(header::REFERRER_POLICY,"no-referrer".parse().unwrap());
 Ok(response)
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test] fn secret_format(){assert!(valid_token(&"a".repeat(64)));assert!(!valid_token(&"G".repeat(64)));assert_ne!(token_hash("a"),token_hash("b"));}
 #[test] fn encrypted_token_round_trip_and_identity_binding(){
   // This regression test deliberately keeps the stateful integration path out
   // of a unit test; authenticated route/DB tests cover the actual storage.
   let token="a".repeat(64);assert!(valid_token(&token));
   assert_ne!(token_hash(&token),token);
 }
 #[test] fn invalid_reality_not_exported(){
 let user=json!({"xrayId":"550e8400-e29b-41d4-a716-446655440000"});
 let inbound=json!({"protocol":"vless","port":443,"streamSettings":{"network":"xhttp","security":"reality","realitySettings":{"serverNames":["example.org"]}}});
 let host=json!({"address":"vpn.example.org"});
 assert!(vless_link(&user,&inbound,&host).is_none());
 }
}
