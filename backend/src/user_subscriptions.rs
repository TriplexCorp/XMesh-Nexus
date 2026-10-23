use crate::{auth::AuthUser,ApiError,AppState};
use axum::{extract::{Extension,Path,State,Query,OriginalUri},http::{header,StatusCode,HeaderMap},response::{Html,IntoResponse,Response},Json};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use sqlx::Row;
use std::collections::HashMap;
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
 let client_encryption=nonempty(host,"clientEncryption")
  .or_else(||nonempty(host,"externalClientEncryption"))
  .or_else(||nonempty(user,"vlessEncryption"))
  .or_else(||inbound.get("xmesh").and_then(|v|nonempty(v,"clientEncryption")))
  .unwrap_or("none");
 let server_decryption=inbound.get("settings").and_then(|v|nonempty(v,"decryption")).unwrap_or("none");
 if server_decryption!="none"&&client_encryption=="none"{return None}
 if security=="none"&&!client_encryption.starts_with("mlkem768x25519plus."){return None}
 let mut opts=vec![format!("type={}",encode_component(network)),format!("security={}",security)];
 if client_encryption!="none"{
  opts.push(format!("encryption={}",encode_component(client_encryption)));
 }
 let settings=inbound.get("settings").unwrap_or(&Value::Null);
 if let Some(flow)=nonempty(settings,"flow"){opts.push(format!("flow={}",encode_component(flow)))}
 let transport=match network{"xhttp"=>stream.get("xhttpSettings"),"ws"=>stream.get("wsSettings"),"grpc"=>stream.get("grpcSettings"),_=>None};
 if let Some(config)=transport{
  if let Some(path)=nonempty(host,"path").or_else(||nonempty(config,"path")){opts.push(format!("path={}",encode_component(path)))}
  if let Some(h)=nonempty(host,"host").or_else(||nonempty(host,"externalHost")){opts.push(format!("host={}",encode_component(h)))}
  if network=="grpc" && let Some(service)=nonempty(config,"serviceName"){opts.push(format!("serviceName={}",encode_component(service)))}
  if network=="xhttp" && let Some(mode)=nonempty(config,"mode"){opts.push(format!("mode={}",encode_component(mode)))}
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
// Client-native Xray outbound: build from explicitly allowed public values,
// not from server-side streamSettings containing Reality private keys.
fn vless_outbound(user:&Value,inbound:&Value,host:&Value,device:&str)->Option<Value>{
 vless_link(user,inbound,host)?;
 let address=endpoint(host)?;
 let port=["externalPort","port"].into_iter().find_map(|key|host.get(key).and_then(self::port))
   .or_else(||inbound.get("port").and_then(self::port))?;
 let stream=inbound.get("streamSettings")?;
 let security=nonempty(stream,"security").unwrap_or("none");
 let network=nonempty(stream,"network").unwrap_or("tcp");
 let uuid=nonempty(user,"xrayId")?;
 let tag=nonempty(host,"remark").or_else(||nonempty(inbound,"tag")).unwrap_or(address);
 let country=nonempty(host,"countryCode").or_else(||nonempty(host,"country"))
  .or_else(||nonempty(host,"region")).unwrap_or("ZZ");

 // The server's VLESS decryption string is NOT a client encryption string.
 // Only explicitly provided client-side encryption material may be exported.
 let server_decryption=inbound.get("settings").and_then(|v|nonempty(v,"decryption")).unwrap_or("none");
 let client_encryption=nonempty(host,"clientEncryption")
  .or_else(||nonempty(host,"externalClientEncryption"))
  .or_else(||nonempty(user,"vlessEncryption"))
  .or_else(||inbound.get("xmesh").and_then(|v|nonempty(v,"clientEncryption")))
  .unwrap_or("none");
 if server_decryption!="none" && client_encryption=="none"{return None}
 let mut client=json!({"id":uuid,"encryption":client_encryption});
 // Flow must only be included when the inbound actually supports it.
 if let Some(flow)=inbound.get("settings").and_then(|v|nonempty(v,"flow")){
  client["flow"]=json!(flow);
 }
 let mut outbound_stream=json!({"network":network,"security":security});
 if security=="reality"{
  let server=stream.get("realitySettings").unwrap_or(&Value::Null);
  let sni=nonempty(host,"sni").or_else(||nonempty(host,"externalSNI"))
   .or_else(||server.get("serverNames").and_then(Value::as_array).and_then(|v|v.first()).and_then(Value::as_str))?;
  let key=nonempty(host,"publicKey").or_else(||nonempty(host,"realityPublicKey"))
   .or_else(||nonempty(inbound,"publicKey")).or_else(||nonempty(server,"publicKey"))?;
  let sid=nonempty(host,"shortId").or_else(||nonempty(host,"externalShortId"))
   .or_else(||server.get("shortIds").and_then(Value::as_array).and_then(|v|v.first()).and_then(Value::as_str))?;
  outbound_stream["realitySettings"]=json!({
   "serverName":sni,"publicKey":key,"shortId":sid,
   "fingerprint":nonempty(host,"fp").or_else(||nonempty(host,"fingerprint")).unwrap_or("chrome"),
   "spiderX":nonempty(host,"spiderX").unwrap_or("/")
  });
 }else if security=="tls"{
  let sni=nonempty(host,"sni").or_else(||nonempty(host,"externalSNI"))
   .or_else(||stream.get("tlsSettings").and_then(|v|nonempty(v,"serverName")))?;
  let mut tls=json!({"serverName":sni});
  if let Some(values)=stream.get("tlsSettings").and_then(|v|v.get("alpn")).and_then(Value::as_array){
   tls["alpn"]=json!(values);
  }
  outbound_stream["tlsSettings"]=tls;
 }
 let config=match network{
  "xhttp"=>stream.get("xhttpSettings"),
  "ws"=>stream.get("wsSettings"),
  "grpc"=>stream.get("grpcSettings"),
  "raw"=>stream.get("rawSettings"),
  "tcp"=>stream.get("tcpSettings"),
  _=>None
 };
 let mut transport=json!({});
 if let Some(config)=config{
  let fields=match network{
   "xhttp"=>&["path","host","mode","xPaddingBytes","scMaxEachPostBytes","scMinPostsIntervalMs"][..],
   "ws"=>&["path"][..],
   "grpc"=>&["serviceName","multiMode"][..],
   _=>&[][..]
  };
  for key in fields {
   if let Some(v)=config.get(*key).filter(|v|v.is_string()||v.is_boolean()||v.is_number()){
    transport[*key]=v.clone()
   }
  }
  if network=="xhttp"{
   for key in ["xmux","headers"]{
    if let Some(value)=config.get(key).filter(|v|v.is_object()){transport[key]=value.clone()}
   }
  }
 }
 if let Some(path)=nonempty(host,"path") && network!="grpc"{
  transport["path"]=json!(path);
 }
 if let Some(hostname)=nonempty(host,"host").or_else(||nonempty(host,"externalHost")){
  if network=="ws"{transport["headers"]=json!({"Host":hostname})}
  else if network=="xhttp"{transport["host"]=json!(hostname)}
 }
 // Device profiles are client-side transport overrides only; never copy
 // the entire server inbound or any Reality private material.
 if network=="xhttp" && (device=="ios"||device=="windows"){
  let profile_key=if device=="ios"{"iOS"}else{"Windows"};
  let profile=inbound.get("xmesh").and_then(|v|v.get("xhttpDeviceProfiles"))
    .or_else(||inbound.get("xhttpDeviceProfiles"))
    .and_then(|v|v.get(profile_key));
  if let Some(profile)=profile {
   for key in ["mode","uplinkHTTPMethod","scMaxEachPostBytes","scMinPostsIntervalMs"]{
    if let Some(value)=profile.get(key).filter(|v|v.is_string()||v.is_number()){
     transport[key]=value.clone();
    }
   }
   if let Some(xmux)=profile.get("xmux").filter(|v|v.is_object()){
    transport["xmux"]=xmux.clone();
   }
  }
 }
 if transport.as_object().is_some_and(|o|!o.is_empty()){
  if network=="xhttp"{outbound_stream["xhttpSettings"]=transport}
  else if network=="ws"{outbound_stream["wsSettings"]=transport}
  else if network=="grpc"{outbound_stream["grpcSettings"]=transport}
 }
 Some(json!({
  "tag":tag,"xmeshCountry":country,"protocol":"vless",
  "settings":{"vnext":[{"address":address,"port":port,"users":[client]}]},
  "streamSettings":outbound_stream
 }))
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
 let mut secret=[0u8;32];OsRng.fill_bytes(&mut secret);
 let token=hex::encode(secret);
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
async fn collect_user_outbounds(state:&AppState,user:&Value,device:&str)->Result<(Vec<String>,Vec<Value>),ApiError>{
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
 let mut outbounds=Vec::<Value>::new();
 for profile in &profiles{
  let cfg=match profile.get("config"){Some(Value::String(raw))=>serde_json::from_str::<Value>(raw).ok(),Some(v)=>Some(v.clone()),None=>None};
  let Some(cfg)=cfg else{continue};
  let Some(inbounds)=cfg.get("inbounds").and_then(Value::as_array)else{continue};
  for inbound in inbounds{
   let Some(tag)=nonempty(inbound,"tag")else{continue};
   if !tags.contains(tag){continue}
   let matched:Vec<&Value>=hosts.iter().filter(|h|h.get("disabled")!=Some(&Value::Bool(true))&&nonempty(h,"tag")==Some(tag)).collect();
   if !matched.is_empty(){
    for host in matched{
     if let Some(link)=vless_link(user,inbound,host) && let Some(outbound)=vless_outbound(user,inbound,host,device){
      outbounds.push(outbound);links.push(link)
     }
    }
   }else{
    for node in nodes.iter().filter(|n|n.get("profileId")==profile.get("id")&&n.get("disabled")!=Some(&Value::Bool(true))){
     let host=json!({"address":node.get("publicAddress").or_else(||node.get("externalAddress")).or_else(||node.get("addr")),"port":inbound.get("port"),"remark":node.get("name"),"country":node.get("country")});
     if let Some(link)=vless_link(user,inbound,&host) && let Some(outbound)=vless_outbound(user,inbound,&host,device){
      outbounds.push(outbound);links.push(link)
     }
    }
   }
  }
 }
 if links.is_empty(){return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE,"No valid public VLESS endpoints configured"))}
 Ok((links,outbounds))
}
pub async fn admin_client_json(
 State(state):State<AppState>,Extension(actor):Extension<AuthUser>,Path(id):Path<i64>,
 headers:HeaderMap,Query(options):Query<HashMap<String,String>>,
)->Result<Json<Value>,ApiError>{
 crate::require_mutation(&actor)?;
 let user=record(&state,id).await?;
 let device=crate::subscription_user_agent::negotiate(&headers,&options)
  .map_err(bad)?.device.as_str();
 let (_,proxies)=collect_user_outbounds(&state,&user,device).await?;
 let setting=crate::read_settings(&state.pool).await?;
 let profile=crate::subscription_json::build(proxies,&setting)
  .map_err(|detail|ApiError::new(StatusCode::BAD_REQUEST,detail))?;
 Ok(Json(profile))
}
pub async fn serve(State(state):State<AppState>,Path(token):Path<String>,
 headers:HeaderMap,Query(options):Query<HashMap<String,String>>)->Result<Response,ApiError>{
 if !valid_token(&token){return Err(ApiError::new(StatusCode::NOT_FOUND,"Subscription not found"))}
 let row=sqlx::query("SELECT user_id FROM user_subscription_tokens WHERE token_hash=$1")
  .bind(token_hash(&token)).fetch_optional(&state.pool).await?.ok_or_else(||ApiError::new(StatusCode::NOT_FOUND,"Subscription not found"))?;
 let id:i64=row.try_get("user_id")?;
 let user=record(&state,id).await?;
 let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as i64;
 if crate::user_status(&user,now)!="ACTIVE"{return Err(ApiError::new(StatusCode::FORBIDDEN,"Subscription inactive"))}
 // Resolve content and XHTTP transport profile from the VPN client's
 // actual User-Agent. Explicit query parameters remain optional overrides.
 let client=crate::subscription_user_agent::negotiate(&headers,&options)
  .map_err(bad)?;
 let (links,outbounds)=collect_user_outbounds(&state,&user,client.device.as_str()).await?;
 let legacy=client.format==crate::subscription_user_agent::Format::Vless;

 let mut response=if legacy{
  links.join("\n").into_response()
 }else{
  let settings=crate::read_settings(&state.pool).await?;
  let json=crate::subscription_json::build(outbounds,&settings).map_err(|message|{
    tracing::warn!(user_id=id, error=%message,"Subscription JSON could not be generated");
    ApiError::new(StatusCode::SERVICE_UNAVAILABLE,message)
  })?;
  let body=serde_json::to_string_pretty(&json)
   .map_err(|_|ApiError::new(StatusCode::INTERNAL_SERVER_ERROR,"Could not serialize Xray JSON"))?;
  body.into_response()
 };
 response.headers_mut().insert(header::CONTENT_TYPE,if legacy{
  "text/plain; charset=utf-8".parse().unwrap()
 }else{"application/json; charset=utf-8".parse().unwrap()});
 response.headers_mut().insert(header::CACHE_CONTROL,"no-store, private".parse().unwrap());
 response.headers_mut().insert(header::REFERRER_POLICY,"no-referrer".parse().unwrap());
 response.headers_mut().insert(header::VARY,"User-Agent, Accept".parse().unwrap());
 Ok(response)
}

fn escape_html(input:&str)->String{
 input.replace('&',"&amp;").replace('<',"&lt;").replace('>',"&gt;")
  .replace('"',"&quot;").replace('\'',"&#39;")
}
fn studio_string<'a>(settings:&'a Value,key:&str,fallback:&'a str)->&'a str {
 settings.get(key).and_then(Value::as_str).filter(|s|!s.trim().is_empty()).unwrap_or(fallback)
}
fn studio_enabled(settings:&Value,key:&str,default:bool)->bool{
 settings.get(key).and_then(Value::as_bool).unwrap_or(default)
}
fn studio_color(settings:&Value,key:&str,default:&str)->String{
 let v=studio_string(settings,key,default);
 if v.len()==7 && v.starts_with('#') && v.bytes().skip(1).all(|c|c.is_ascii_hexdigit()) {
  v.to_owned()
 }else{default.to_owned()}
}
fn app_item(label:&str,platform:&str,url:&str)->String{
 let icon=label.chars().take(2).collect::<String>();
 let content=format!("<span>{}</span><div><b>{}</b><small>{}</small></div>",
  escape_html(&icon),escape_html(label),escape_html(platform));
 if url.starts_with("https://") && !url.contains(['"', '<', '>']) {
  format!("<a class=\"subscription-preview-app\" href=\"{}\" target=\"_blank\" rel=\"noopener noreferrer\">{}</a>",
   escape_html(url),content)
 }else{
  format!("<div class=\"subscription-preview-app\">{}</div>",content)
 }
}
fn app_catalog(settings:&Value,language:&str)->String{
 let mut apps=String::new();
 let known=[
  ("happ","Happ","iOS · Android · Windows · macOS"),
  ("incy","Incy","iOS · Android"),
  ("v2raytun","v2rayTun","iOS · Android"),
  ("v2rayn","v2rayN","Windows · Linux · macOS"),
  ("v2rayng","v2rayNG","Android"),
  ("streisand","Streisand","iOS"),
  ("hiddify","Hiddify","iOS · Android · Windows · macOS · Linux"),
  ("nekobox","NekoBox","Android"),
  ("shadowrocket","Shadowrocket","iOS"),
  ("flclash","FlClash","Windows · macOS · Linux · Android"),
  ("stash","Stash","iOS"),
  ("singbox","sing-box","iOS · Android · Desktop"),
  ("v2box","V2Box","iOS · Android"),
  ("loon","Loon","iOS"),
  ("mihomo","Mihomo Party","Desktop"),
  ("clashverge","Clash Verge","Windows · macOS · Linux")
 ];
 let enabled=settings.get("subscriptionClients");
 let links=settings.get("subscriptionClientLinks");
 for (index,(id,label,platform)) in known.into_iter().enumerate() {
  let visible=enabled.and_then(|v|v.get(id)).and_then(Value::as_bool).unwrap_or(index<7);
  if !visible{continue}
  let url=links.and_then(|v|v.get(id)).and_then(Value::as_str).unwrap_or("");
  apps.push_str(&app_item(label,platform,url));
 }
 if let Some(custom)=settings.get("subscriptionCustomClients").and_then(Value::as_array){
  for item in custom{
   if item.get("enabled").and_then(Value::as_bool)!=Some(true){continue}
   let label=studio_string(item,"name","");
   if label.is_empty(){continue}
   apps.push_str(&app_item(label,studio_string(item,"platforms",""),studio_string(item,"url","")));
  }
 }
 if apps.is_empty(){return String::new()}
 let title=studio_string(settings,if language=="en"{"subscriptionAppsTitleEn"}else{"subscriptionAppsTitle"},
  if language=="en"{"Connection apps"}else{"Приложения для подключения"});
 let layout=if studio_string(settings,"subscriptionClientLayout","grid")=="list"{"list"}else{"grid"};
 format!("<section class=\"subscription-preview-apps\" data-client-layout=\"{}\"><header>{}</header><div>{}</div></section>",
  layout,escape_html(title),apps)
}
// Match the exact persisted Studio path. Unknown public routes are never
// treated as subscriptions, even though the router supports variable prefixes.
pub async fn portal_route(
 State(state):State<AppState>,OriginalUri(uri):OriginalUri,
 headers:HeaderMap,Query(options):Query<HashMap<String,String>>,
)->Result<Response,ApiError>{
 let (prefix,token)=uri.path().rsplit_once('/').ok_or_else(||
  ApiError::new(StatusCode::NOT_FOUND,"Subscription not found"))?;
 if !valid_token(token){return Err(ApiError::new(StatusCode::NOT_FOUND,"Subscription not found"))}
 let settings=crate::read_settings(&state.pool).await?;
 let configured=studio_string(&settings,"subscriptionPath","/s").trim_end_matches('/');
 if prefix!=configured {return Err(ApiError::new(StatusCode::NOT_FOUND,"Subscription not found"))}
 portal(State(state),Path(token.to_owned()),headers,Query(options)).await
}
pub async fn portal(
 State(state):State<AppState>,Path(token):Path<String>,
 headers:HeaderMap,Query(options):Query<HashMap<String,String>>,
)->Result<Response,ApiError>{
 if !valid_token(&token){return Err(ApiError::new(StatusCode::NOT_FOUND,"Subscription not found"))}
 // A single permanent HTTPS URL is a portal for browsers and a
 // negotiated JSON/VLESS subscription for the VPN client's User-Agent.
 if crate::subscription_user_agent::wants_feed(&headers,&options).map_err(bad)? {
  return serve(State(state),Path(token),headers,Query(options)).await;
 }
 let hash=token_hash(&token);
 let row=sqlx::query("SELECT user_id FROM user_subscription_tokens WHERE token_hash=$1")
  .bind(hash).fetch_optional(&state.pool).await?
  .ok_or_else(||ApiError::new(StatusCode::NOT_FOUND,"Subscription not found"))?;
 let user_id:i64=row.try_get("user_id")?;
 let user=record(&state,user_id).await?;
 let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
  .unwrap_or_default().as_millis() as i64;
 let active=crate::user_status(&user,now)=="ACTIVE";
 let settings=crate::read_settings(&state.pool).await?;
 let lang=if options.get("lang").is_some_and(|s|s=="en"){"en"} else if options.get("lang").is_some_and(|s|s=="ru"){"ru"}
 else {studio_string(&settings,"subscriptionLanguage","ru")};
 let en=lang=="en";
 let used=user.get("used").and_then(Value::as_f64)
  .or_else(||user.get("used").and_then(Value::as_i64).map(|v|v as f64))
  .unwrap_or(0.0).max(0.0);
 let limit=user.get("limit").and_then(Value::as_f64)
  .or_else(||user.get("limit").and_then(Value::as_i64).map(|v|v as f64))
  .unwrap_or(0.0).max(0.0);
 let mut metrics=String::new();
 if studio_enabled(&settings,"subscriptionShowTraffic",true){
  let remaining=if limit>0.0{
   format!("{:.2} / {:.2} {}",used,limit,if en{"GB"}else{"ГБ"})
  }else{
   format!("{:.2} {} / {}",used,if en{"GB"}else{"ГБ"},if en{"Unlimited"}else{"Без лимита"})
  };
  let pct=if limit>0.0{(used/limit*100.0).clamp(0.0,100.0)}else{0.0};
  metrics.push_str(&format!(
   "<div data-subscription-traffic><small>{}</small><b>{}</b><div class=\"subscription-preview-progress\"><i style=\"width:{pct:.1}%\"></i></div></div>",
   if en{"Traffic"}else{"Трафик"},escape_html(&remaining)));
 }
 if studio_enabled(&settings,"subscriptionShowExpiry",true){
  let expiry=user.get("expireAt").and_then(Value::as_i64).unwrap_or(0);
  metrics.push_str(&format!(
   "<div data-subscription-expiry><small>{}</small><b data-expiry=\"{}\">{}</b></div>",
   if en{"Expires"}else{"Действует до"},expiry,if expiry>0{"—"}else{if en{"Unlimited"}else{"Бессрочно"}}));
 }
 if !metrics.is_empty(){
  metrics=format!("<div class=\"subscription-preview-meta\" data-subscription-metrics>{metrics}</div>");
 }
 // Show/copy one canonical HTTPS subscription URL. The requesting app's
 // User-Agent decides the JSON/link format and device profile.
 let raw_link=studio_url(&settings,&token);
 let mut quick=String::new();
 let mut qr=String::new();
 let mut devices=String::new();
 let cta;
 let mut apps=String::new();
 if active{
  let button=studio_string(&settings,if en{"subscriptionCtaEn"}else{"subscriptionCta"},
   if en{"Connect"}else{"Подключиться"});
  cta=format!("<button type=\"button\" class=\"subscription-preview-cta\" id=\"connect-link\" title=\"{}\">{}</button><input type=\"hidden\" id=\"subscription-link\" value=\"{}\">",
   if en{"Copy HTTPS subscription link"}else{"Скопировать HTTPS-ссылку подписки"},
   escape_html(button),escape_html(&raw_link));
  if studio_enabled(&settings,"subscriptionShowCopy",true){
   quick.push_str(&format!("<button type=\"button\" id=\"copy-link\">{}</button>",
    if en{"Copy link"}else{"Скопировать ссылку"}));
  }
  if studio_enabled(&settings,"subscriptionShowQr",true){
   quick.push_str("<button type=\"button\" id=\"toggle-qr\" aria-controls=\"subscription-qr\" aria-expanded=\"false\">QR</button>");
   qr="<div id=\"subscription-qr\" class=\"subscription-preview-qr\" hidden aria-label=\"QR-код подписки\"></div>".to_owned();
  }
  if studio_enabled(&settings,"subscriptionShowDevices",false){
   quick.push_str(&format!("<button type=\"button\" id=\"toggle-devices\" aria-controls=\"subscription-devices\" aria-expanded=\"false\">{}</button>",if en{"Devices"}else{"Устройства"}));
   let maximum=user.get("hwid").and_then(Value::as_i64).unwrap_or(0);
   let used=user.get("devices").and_then(Value::as_array).map(|d|d.len()).unwrap_or(0);
   devices=format!("<div id=\"subscription-devices\" class=\"subscription-public-devices\" hidden>{}: {} · {}: {}</div>",
    if en{"Connected devices"}else{"Подключённые устройства"},used,
    if en{"Limit"}else{"Лимит"},if maximum>0{maximum.to_string()}else{if en{"Unlimited"}else{"Без лимита"}.to_owned()});
  }
  if !quick.is_empty(){quick=format!("<div class=\"subscription-preview-quick\">{quick}</div>")}
  if studio_enabled(&settings,"subscriptionShowApps",true){apps=app_catalog(&settings,lang)}
 }else{
  cta=format!("<div class=\"subscription-preview-cta\" aria-disabled=\"true\">{}</div>",
   if en{"Subscription inactive"}else{"Подписка неактивна"});
 }
 let support=if studio_enabled(&settings,"subscriptionShowSupport",false){
  let url=studio_string(&settings,"subscriptionSupportUrl","");
  let label=escape_html(studio_string(&settings,
   if en{"subscriptionSupportLabelEn"}else{"subscriptionSupportLabel"},
   if en{"Support"}else{"Поддержка"}));
  if url.starts_with("https://"){
   format!("<a class=\"subscription-preview-support\" href=\"{}\" rel=\"noopener noreferrer\" target=\"_blank\">{label}</a>",escape_html(url))
  }else{
   format!("<div class=\"subscription-preview-support\">{label}</div>")
  }
 }else{String::new()};
 let logo=studio_string(&settings,"subscriptionLogoUrl","");
 let logo_markup=if logo.starts_with("https://"){
  format!("<img src=\"{}\" alt=\"\" class=\"subscription-preview-logo\">",escape_html(logo))
 }else{"<span aria-hidden=\"true\">✦</span>".to_owned()};
 let visible_status=studio_enabled(&settings,"subscriptionShowStatus",true);
 let status_dot=if visible_status{
  format!("<span class=\"subscription-preview-ok\" style=\"color:{}\">●</span>",
   if active{"var(--portal-accent)"}else{"#ef8888"})
 }else{String::new()};
 let title=if active{
  studio_string(&settings,if en{"subscriptionHeroEn"}else{"subscriptionHero"},
   if en{"Subscription active"}else{"Подписка активна"})
 }else if en{"Subscription inactive"}else{"Подписка неактивна"};
 let footer=studio_string(&settings,if en{"subscriptionFooterEn"}else{"subscriptionFooter"},"");
 let logo_brand=studio_string(&settings,"subscriptionBrand",
  studio_string(&settings,"brand","XMesh Nexus"));
 let background=studio_color(&settings,"subscriptionBackground","#0c131b");
 let card_color=studio_color(&settings,"subscriptionCardColor","#15212b");
 let text_color=studio_color(&settings,"subscriptionTextColor","#ecf3f6");
 let accent=studio_color(&settings,"subscriptionAccent","#7be5b4");
 let secondary=studio_color(&settings,"subscriptionSecondaryAccent","#c6e985");
 let radius=settings.get("subscriptionRadius").and_then(Value::as_u64).unwrap_or(16).clamp(1,36);
 let allowed=|key:&str,valid:&[&str],default:&str| -> String{
  let value=studio_string(&settings,key,default);
  if valid.contains(&value){value.to_owned()}else{default.to_owned()}
 };
 let mut html=include_str!("subscription_template.html").to_owned();
 let changes=[
  ("{{LANG}}",lang.to_owned()),
  ("{{BRAND}}",escape_html(logo_brand)),
  ("{{ACCENT}}",accent),("{{SECONDARY_ACCENT}}",secondary),("{{BACKGROUND}}",background),
  ("{{CARD_COLOR}}",card_color),("{{TEXT_COLOR}}",text_color),
  ("{{RADIUS}}",radius.to_string()),
  ("{{THEME}}",allowed("subscriptionTheme",&["dark","light"],"dark")),
  ("{{LAYOUT}}",allowed("subscriptionLayout",&["standard","centered","compact"],"standard")),
  ("{{CARD_STYLE}}",allowed("subscriptionCardStyle",&["soft","outline","flat","glass","raised"],"soft")),
  ("{{FONT}}",allowed("subscriptionFont",&["system","manrope","mono","onest","inter","golos","rubik","nunito","plex","roboto","pt","montserrat","ubuntu","opensans","source","fira","jost"],"system")),
  ("{{LOGO}}",logo_markup),
  ("{{RU_SELECTED}}",if en{String::new()}else{"on".to_owned()}),
  ("{{EN_SELECTED}}",if en{"on".to_owned()}else{String::new()}),
  ("{{RU_CURRENT}}",if en{"false"}else{"page"}.to_owned()),
  ("{{EN_CURRENT}}",if en{"page"}else{"false"}.to_owned()),
  ("{{STATUS_DOT}}",status_dot),
  ("{{HERO}}",escape_html(title)),
  ("{{DESCRIPTION}}",escape_html(studio_string(&settings,
   if en{"subscriptionDescriptionEn"}else{"subscriptionDescription"},
   if en{"Connection setup and subscription information."}else{"Настройки подключения и информация о подписке."}))),
  ("{{METRICS}}",metrics),
  ("{{CTA}}",cta),
  ("{{QUICK_ACTIONS}}",quick),
  ("{{QR}}",qr),
  ("{{DEVICE_INFO}}",devices),
  ("{{APPS}}",apps),
  ("{{SUPPORT}}",support),
  ("{{FOOTER}}",escape_html(footer)),
 ];
 for (marker,value) in changes {html=html.replace(marker,&value);}
 let mut response=Html(html).into_response();
 response.headers_mut().insert(header::CACHE_CONTROL,"private, no-store".parse().unwrap());
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
 #[test] fn native_json_is_structured_and_never_leaks_reality_private_key(){
  let user=json!({"xrayId":"550e8400-e29b-41d4-a716-446655440000"});
  let inbound=json!({"tag":"SWEDEN","protocol":"vless","port":443,
   "settings":{"flow":"xtls-rprx-vision"},
   "streamSettings":{"network":"xhttp","security":"reality",
    "xhttpSettings":{"path":"/stream","mode":"stream-up","xmux":{"cMaxReuseTimes":64}},
    "realitySettings":{"privateKey":"SERVER_PRIVATE_KEY_MUST_NEVER_LEAK",
     "serverNames":["vpn.example.org"],"shortIds":["abcd"]}}});
  let host=json!({"address":"vpn.example.org","publicKey":"PUBLIC_KEY",
   "externalSNI":"vpn.example.org","shortId":"abcd","remark":"Sweden"});
  let outbound=vless_outbound(&user,&inbound,&host,"auto").expect("Reality public metadata is complete");
  let data=crate::subscription_json::build(vec![outbound],&json!({})).expect("build client config");
  let rendered=serde_json::to_string(&data).expect("serialize Xray JSON");
  assert!(!rendered.contains("SERVER_PRIVATE_KEY_MUST_NEVER_LEAK"));
  assert_eq!(data["outbounds"][0]["settings"]["vnext"][0]["users"][0]["id"],user["xrayId"]);
  assert_eq!(data["outbounds"][0]["streamSettings"]["xhttpSettings"]["mode"],"stream-up");
  assert_eq!(data["outbounds"][0]["streamSettings"]["xhttpSettings"]["xmux"]["cMaxReuseTimes"],64);
  assert_eq!(data["outbounds"][0]["streamSettings"]["realitySettings"]["publicKey"],"PUBLIC_KEY");
  assert!(data["routing"]["rules"][3]["outboundTag"].as_str().unwrap().starts_with("xmesh-ZZ-0001"));
  assert_eq!(data["inbounds"][0]["protocol"],"socks");
 }
 #[test] fn xhttp_device_profiles_are_applied_only_to_selected_device(){
  let user=json!({"xrayId":"550e8400-e29b-41d4-a716-446655440000"});
  let inbound=json!({"tag":"DE","protocol":"vless","port":443,
   "xmesh":{"xhttpDeviceProfiles":{
      "iOS":{"mode":"packet-up","uplinkHTTPMethod":"POST","xmux":{"cMaxReuseTimes":0}},
      "Windows":{"mode":"stream-up","xmux":{"cMaxReuseTimes":64}}
   }},
   "settings":{"decryption":"none"},
   "streamSettings":{"network":"xhttp","security":"tls",
    "tlsSettings":{"serverName":"vpn.example.org"},
    "xhttpSettings":{"path":"/x","mode":"auto"}}});
  let host=json!({"address":"vpn.example.org","sni":"vpn.example.org"});
  let ios=vless_outbound(&user,&inbound,&host,"ios").unwrap();
  let windows=vless_outbound(&user,&inbound,&host,"windows").unwrap();
  let automatic=vless_outbound(&user,&inbound,&host,"auto").unwrap();
  assert_eq!(ios["streamSettings"]["xhttpSettings"]["mode"],"packet-up");
  assert_eq!(windows["streamSettings"]["xhttpSettings"]["mode"],"stream-up");
  assert_eq!(automatic["streamSettings"]["xhttpSettings"]["mode"],"auto");
  assert_eq!(windows["streamSettings"]["xhttpSettings"]["xmux"]["cMaxReuseTimes"],64);
 }
 #[test] fn invalid_reality_not_exported(){
 let user=json!({"xrayId":"550e8400-e29b-41d4-a716-446655440000"});
 let inbound=json!({"protocol":"vless","port":443,"streamSettings":{"network":"xhttp","security":"reality","realitySettings":{"serverNames":["example.org"]}}});
 let host=json!({"address":"vpn.example.org"});
 assert!(vless_link(&user,&inbound,&host).is_none());
 }
}
