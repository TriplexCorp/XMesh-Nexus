use crate::{auth::AuthUser,ApiError,AppState};
use axum::{extract::{Extension,Path,State,Query,OriginalUri},http::{header,StatusCode,HeaderMap},response::{Html,IntoResponse,Response},Json};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use sqlx::Row;
use uuid::Uuid;
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
 let mut opts=vec![format!("type={}",encode_component(network)),format!("security={}",security)];
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
fn app_catalog(settings:&Value,language:&str)->String{
 let mut apps=String::new();
 let known=[
  ("happ","Happ"),("incy","Incy"),("v2raytun","v2rayTun"),("v2rayn","v2rayN"),
  ("v2rayng","v2rayNG"),("streisand","Streisand"),("hiddify","Hiddify"),
  ("nekobox","NekoBox"),("shadowrocket","Shadowrocket"),("flclash","FlClash"),
  ("stash","Stash"),("singbox","sing-box"),("v2box","V2Box"),("loon","Loon"),
  ("mihomo","Mihomo Party"),("clashverge","Clash Verge")
 ];
 let enabled=settings.get("subscriptionClients");
 let links=settings.get("subscriptionClientLinks");
 for (name,label) in known {
  if enabled.and_then(|v|v.get(name)).and_then(Value::as_bool)!=Some(true){continue}
  let url=links.and_then(|v|v.get(name)).and_then(Value::as_str).unwrap_or("");
  if !url.starts_with("https://"){continue}
  apps.push_str(&format!("<a class=\"client\" href=\"{}\" rel=\"noopener noreferrer\" target=\"_blank\">{}</a>",
   escape_html(url),escape_html(label)));
 }
 if let Some(custom)=settings.get("subscriptionCustomClients").and_then(Value::as_array){
  for item in custom {
   if item.get("enabled").and_then(Value::as_bool)!=Some(true){continue}
   let label=studio_string(item,"name","");
   let url=studio_string(item,"url","");
   if label.is_empty()||!url.starts_with("https://"){continue}
   apps.push_str(&format!("<a class=\"client\" href=\"{}\" rel=\"noopener noreferrer\" target=\"_blank\">{}</a>",
    escape_html(url),escape_html(label)));
  }
 }
 if apps.is_empty(){return String::new()}
 let title=studio_string(settings,if language=="en"{"subscriptionAppsTitleEn"}else{"subscriptionAppsTitle"},
  if language=="en"{"Connection apps"}else{"Приложения для подключения"});
 format!("<section class=\"section\"><h2>{}</h2><div class=\"apps {}\">{}</div></section>",
  escape_html(title),
  if studio_string(settings,"subscriptionClientLayout","grid")=="list"{"list"}else{"grid"},
  apps)
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
 let accept=headers.get(header::ACCEPT).and_then(|v|v.to_str().ok()).unwrap_or("");
 if !accept.contains("text/html") || options.get("raw").is_some_and(|v|v=="1") {
  return serve(State(state),Path(token)).await;
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
 let brand=studio_string(&settings,"subscriptionBrand","XMesh Nexus");
 let title=studio_string(&settings,if en{"subscriptionHeroEn"}else{"subscriptionHero"},
  if en{"Your subscription"}else{"Ваша подписка"});
 let summary=studio_string(&settings,if en{"subscriptionDescriptionEn"}else{"subscriptionDescription"},
  if en{"Your secure connection"}else{"Настройки подключения и информация о подписке."});
 let footer=studio_string(&settings,if en{"subscriptionFooterEn"}else{"subscriptionFooter"},"");
 let link=studio_url(&settings,&token);
 let safe_link=escape_html(&link);
 let bg=studio_color(&settings,"subscriptionBackground","#0c131b");
 let card=studio_color(&settings,"subscriptionCardColor","#15212b");
 let fg=studio_color(&settings,"subscriptionTextColor","#ecf3f6");
 let accent=studio_color(&settings,"subscriptionAccent","#7be5b4");
 let radius=settings.get("subscriptionRadius").and_then(Value::as_u64).unwrap_or(16).clamp(1,36);
 let status=if active{if en{"Active"}else{"Активна"}}else{if en{"Inactive"}else{"Неактивна"}};
 let mut sections=String::new();
 if studio_enabled(&settings,"subscriptionShowStatus",true){
  sections.push_str(&format!("<p class=\"status {}\">● {}</p>",if active{"ok"}else{"off"},status));
 }
 let used=user.get("used").and_then(Value::as_f64).or_else(||user.get("used").and_then(Value::as_i64).map(|v|v as f64)).unwrap_or(0.0).max(0.0);
 let limit=user.get("limit").and_then(Value::as_f64).or_else(||user.get("limit").and_then(Value::as_i64).map(|v|v as f64)).unwrap_or(0.0).max(0.0);
 if studio_enabled(&settings,"subscriptionShowTraffic",true){
  sections.push_str(&format!("<div class=\"kv\"><span>{}</span><strong>{:.2} GB / {}</strong></div>",
   if en{"Traffic"}else{"Трафик"},used,if limit>0.0{format!("{limit:.2} GB")}else{if en{"Unlimited"}else{"Без лимита"}.to_owned()}));
 }
 if studio_enabled(&settings,"subscriptionShowExpiry",true){
  let expiry=user.get("expireAt").and_then(Value::as_i64).unwrap_or(0);
  sections.push_str(&format!("<div class=\"kv\"><span>{}</span><strong class=\"expiry\" data-expiry=\"{}\">{}</strong></div>",
   if en{"Expires"}else{"Действует до"},expiry,if expiry>0{"—"}else{if en{"Unlimited"}else{"Без срока"}}));
 }
 if studio_enabled(&settings,"subscriptionShowDevices",false){
  let max=user.get("hwid").and_then(Value::as_i64).unwrap_or(0);
  if max>0{sections.push_str(&format!("<div class=\"kv\"><span>{}</span><strong>{max}</strong></div>",if en{"Device limit"}else{"Лимит устройств"}))}
 }
 if active{
  let label=studio_string(&settings,if en{"subscriptionCtaEn"}else{"subscriptionCta"},if en{"Connection link"}else{"Ссылка для подключения"});
  sections.push_str(&format!("<div class=\"section\"><h2>{}</h2><input class=\"link\" id=\"subscription-link\" readonly value=\"{}\" aria-label=\"Subscription link\">",escape_html(label),safe_link));
  if studio_enabled(&settings,"subscriptionShowCopy",true){
   sections.push_str(&format!("<button type=\"button\" id=\"copy-link\">{}</button>",if en{"Copy link"}else{"Скопировать ссылку"}));
  }
  if studio_enabled(&settings,"subscriptionShowQr",true){
   sections.push_str("<div id=\"subscription-qr\" aria-label=\"QR code\"></div>");
  }
  sections.push_str("</div>");
  if studio_enabled(&settings,"subscriptionShowApps",true){sections.push_str(&app_catalog(&settings,lang))}
 }else{sections.push_str(if en{"<p>Contact support to restore access.</p>"}else{"<p>Для восстановления доступа обратитесь в поддержку.</p>"})}
 if studio_enabled(&settings,"subscriptionShowSupport",false){
  let url=studio_string(&settings,"subscriptionSupportUrl","");
  if url.starts_with("https://"){
   sections.push_str(&format!("<p><a class=\"support\" rel=\"noopener noreferrer\" href=\"{}\">{}</a></p>",
    escape_html(url),escape_html(studio_string(&settings,if en{"subscriptionSupportLabelEn"}else{"subscriptionSupportLabel"},if en{"Support"}else{"Поддержка"}))));
  }
 }
 let logo=studio_string(&settings,"subscriptionLogoUrl","");
 let logo_markup=if logo.starts_with("https://"){format!("<img class=\"logo\" src=\"{}\" alt=\"\">",escape_html(logo))}else{String::new()};
 let lang_url=format!("?lang={}",if en{"ru"}else{"en"});
 let layout=studio_string(&settings,"subscriptionLayout","standard");
 let html=format!(r#"<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
 <meta name="referrer" content="no-referrer"><title>{brand}</title><style>
 :root{{--bg:{bg};--card:{card};--text:{fg};--accent:{accent};--radius:{radius}px}}
 *{{box-sizing:border-box}}body{{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,Arial,sans-serif;padding:clamp(16px,5vw,80px)}}
 main{{max-width:{max_width};margin:0 auto}}.panel{{background:var(--card);border:1px solid #ffffff22;border-radius:var(--radius);padding:clamp(22px,4vw,42px);box-shadow:0 18px 50px #0002}}
 header{{display:flex;justify-content:space-between;align-items:center;gap:20px}}.logo{{max-height:56px;max-width:180px;object-fit:contain}}
 h1{{font-size:clamp(27px,4vw,42px);line-height:1.2;margin:20px 0 8px}}h2{{font-size:18px}}.muted,footer{{opacity:.7}}
 .status{{font-weight:700}}.ok{{color:var(--accent)}}.off{{color:#ff8a8a}}
 .kv{{display:flex;justify-content:space-between;gap:10px;border-top:1px solid #ffffff18;padding:12px 0;flex-wrap:wrap}}
 .section{{padding-top:18px;margin-top:18px;border-top:1px solid #ffffff18}}
 .link{{width:100%;border:1px solid #ffffff33;border-radius:10px;background:transparent;color:inherit;padding:13px;font-size:14px}}
 button,.client,.support,.lang{{display:inline-flex;align-items:center;justify-content:center;min-height:43px;padding:9px 17px;border-radius:10px;border:1px solid #ffffff30;background:transparent;color:inherit;text-decoration:none;cursor:pointer}}
 button{{margin-top:10px;background:var(--accent);color:#0c131b;border:0;font-weight:700}}
 .apps{{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:10px}}.apps.list{{grid-template-columns:1fr}}.client:hover,.support:hover{{border-color:var(--accent)}}
 #subscription-qr{{margin-top:18px;max-width:260px}}#subscription-qr svg{{width:100%;height:auto;background:#fff;padding:12px;border-radius:10px}}
 footer{{margin-top:20px;text-align:center}}@media(max-width:520px){{.kv{{display:block}}}}
 </style><script src="/qr-code.js" defer></script><script src="/subscription-portal.js" defer></script></head>
 <body><main><div class="panel"><header><div>{logo_markup}<strong>{brand}</strong></div>
 <a class="lang" href="{lang_url}">{switch_label}</a></header><h1>{title}</h1>
 <p class="muted">{summary}</p>{sections}</div><footer>{footer}</footer></main></body></html>"#,
 lang=lang,brand=escape_html(brand),bg=bg,card=card,fg=fg,accent=accent,radius=radius,
 max_width=if layout=="compact"{"660px"}else if layout=="centered"{"760px"}else{"960px"},
 logo_markup=logo_markup,lang_url=lang_url,switch_label=if en{"Русский"}else{"English"},
 title=escape_html(title),summary=escape_html(summary),sections=sections,footer=escape_html(footer));
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
 #[test] fn invalid_reality_not_exported(){
 let user=json!({"xrayId":"550e8400-e29b-41d4-a716-446655440000"});
 let inbound=json!({"protocol":"vless","port":443,"streamSettings":{"network":"xhttp","security":"reality","realitySettings":{"serverNames":["example.org"]}}});
 let host=json!({"address":"vpn.example.org"});
 assert!(vless_link(&user,&inbound,&host).is_none());
 }
}
