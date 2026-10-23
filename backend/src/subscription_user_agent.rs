//! Public subscription content negotiation using the requesting client's
//! User-Agent. Unknown/ambiguous device agents remain on the generic transport
//! settings: incorrectly assuming iOS packet-up or Windows stream-up breaks XHTTP.
use std::collections::HashMap;
use axum::http::{header, HeaderMap};

#[derive(Debug,Clone,Copy,PartialEq,Eq)]
pub(crate) enum Format {Json, Vless}
#[derive(Debug,Clone,Copy,PartialEq,Eq)]
pub(crate) enum Device {Auto, Ios, Windows}

impl Device {
 pub(crate) fn as_str(self)->&'static str {
  match self { Self::Auto=>"auto",Self::Ios=>"ios",Self::Windows=>"windows" }
 }
}

#[derive(Debug,Clone,Copy,PartialEq,Eq)]
pub(crate) struct Client {
 pub(crate) format:Format,
 pub(crate) device:Device,
 pub(crate) known_app:bool,
}

fn has_agent_token(agent:&str,token:&str)->bool{
 agent.match_indices(token).any(|(i,_)|{
  let before=agent[..i].chars().next_back();
  let after=agent[i+token.len()..].chars().next();
  before.is_none_or(|c|!c.is_ascii_alphanumeric())
   && after.is_none_or(|c|!c.is_ascii_alphanumeric())
 })
}
pub(crate) fn detect(headers:&HeaderMap)->Client{
 let ua=headers.get(header::USER_AGENT).and_then(|v|v.to_str().ok())
  .unwrap_or("").to_ascii_lowercase();
 // Client-specific fingerprints outrank generic Mozilla, okhttp or Go
 // fingerprints that some apps also send with HTTP requests.
 let happ=has_agent_token(&ua,"happ");
 let incy=has_agent_token(&ua,"incy");
 let v2raytun=has_agent_token(&ua,"v2raytun");
 let v2rayng=has_agent_token(&ua,"v2rayng");
 let v2rayn=has_agent_token(&ua,"v2rayn");
 let streisand=has_agent_token(&ua,"streisand");
 let shadowrocket=has_agent_token(&ua,"shadowrocket");
 let v2box=has_agent_token(&ua,"v2box");
 let nekobox=has_agent_token(&ua,"nekobox");
 let hiddify=has_agent_token(&ua,"hiddify");
 let singbox=has_agent_token(&ua,"sing-box")||has_agent_token(&ua,"singbox");
 let clash=has_agent_token(&ua,"clash")||has_agent_token(&ua,"mihomo");
 let known_app=happ||incy||v2raytun||v2rayn||v2rayng||streisand
  ||shadowrocket||v2box||nekobox||hiddify||singbox||clash;
 let format=if v2rayn||v2rayng||streisand||shadowrocket||v2box||nekobox
   ||hiddify||singbox||clash {Format::Vless}
   else {Format::Json};
 let ios=ua.contains("iphone")||ua.contains("ipad")||ua.contains("ipod")
  ||has_agent_token(&ua,"ios")||ua.contains("cfnetwork");
 let windows=ua.contains("windows")||ua.contains("win64")||ua.contains("win32");
 let other_os=ua.contains("android")||ua.contains("linux")||ua.contains("macintosh")
  ||ua.contains("mac os x")||ua.contains("darwin");
 let device=if ios {Device::Ios}
  else if windows{Device::Windows}
  else if other_os{Device::Auto}
  else if streisand||shadowrocket{Device::Ios}
  else if v2rayn{Device::Windows}
  else {Device::Auto};
 Client{format,device,known_app}
}
pub(crate) fn negotiate(
 headers:&HeaderMap,options:&HashMap<String,String>
)->Result<Client,&'static str>{
 let mut selected=detect(headers);
 if let Some(format)=options.get("format"){
  selected.format=match format.to_ascii_lowercase().as_str(){
   "json"=>Format::Json,
   "vless"=>Format::Vless,
   _=>return Err("Неподдерживаемый формат подписки")
  }
 }
 if let Some(device)=options.get("device"){
  selected.device=match device.to_ascii_lowercase().as_str(){
   "ios"=>Device::Ios,
   "windows"=>Device::Windows,
   "auto"|"android"|"macos"|"linux"=>Device::Auto,
   _=>return Err("Неподдерживаемый профиль устройства")
  }
 }
 Ok(selected)
}

#[cfg(test)]
mod tests{
 use super::*;
 fn headers(ua:&str,accept:&str)->HeaderMap{
  let mut headers=HeaderMap::new();
  headers.insert(header::USER_AGENT,ua.parse().unwrap());
  headers.insert(header::ACCEPT,accept.parse().unwrap());
  headers
 }
 #[test] fn happ_detects_ios_windows_without_hardcoded_device(){
  let iphone=detect(&headers("Happ/26.7.28 (iPhone; iOS 18.5)","*/*"));
  assert_eq!(iphone.format,Format::Json);assert_eq!(iphone.device,Device::Ios);
  let desktop=detect(&headers("Happ/26.7.28 (Windows NT 10.0; Win64; x64)","*/*"));
  assert_eq!(desktop.format,Format::Json);assert_eq!(desktop.device,Device::Windows);
  assert_eq!(detect(&headers("Happ/26.7.28","*/*")).device,Device::Auto);
 }
 #[test] fn incy_and_v2raytun_are_native_json(){
  assert_eq!(detect(&headers("Incy/1.0 (iPad; iOS 19)","*/*")).format,Format::Json);
  assert_eq!(detect(&headers("v2raytun/3.0 (Android 15)","*/*")).device,Device::Auto);
 }
 #[test] fn legacy_apps_get_link_format_and_correct_platform(){
  let ios=detect(&headers("Streisand/1.2","text/html"));
  assert_eq!(ios.format,Format::Vless);assert_eq!(ios.device,Device::Ios);
  assert!(ios.known_app);
  let android=detect(&headers("v2rayNG/1.10 (Android 15)","*/*"));
  assert_eq!(android.format,Format::Vless);assert_eq!(android.device,Device::Auto);
  let windows=detect(&headers("v2rayN/7.7","*/*"));
  assert_eq!(windows.format,Format::Vless);assert_eq!(windows.device,Device::Windows);
  let linux=detect(&headers("v2rayN/7.7 (Linux)","*/*"));
  assert_eq!(linux.device,Device::Auto);
 }
 #[test] fn browser_html_is_not_a_known_app(){
  let agent=detect(&headers("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1","text/html"));
  assert!(!agent.known_app);
  assert_eq!(agent.device,Device::Ios);
 }
 #[test] fn app_mozilla_fingerprint_remains_app(){
  let agent=detect(&headers("Mozilla/5.0 (Windows NT 10.0) Happ/26.7.28","text/html"));
  assert!(agent.known_app);
  assert_eq!(agent.format,Format::Json);
 }
 #[test] fn explicit_overrides_and_invalid_values(){
  let headers=headers("v2rayNG/1.1 Android","*/*");
  let mut overrides=HashMap::new();
  overrides.insert("format".to_owned(),"json".to_owned());
  overrides.insert("device".to_owned(),"ios".to_owned());
  let selected=negotiate(&headers,&overrides).unwrap();
  assert_eq!(selected.format,Format::Json);assert_eq!(selected.device,Device::Ios);
  overrides.insert("device".to_owned(),"unknown".to_owned());
  assert!(negotiate(&headers,&overrides).is_err());
 }
 #[test] fn unknown_agents_default_json_with_generic_transport(){
  let unknown=detect(&headers("Go-http-client/2.0","*/*"));
  assert_eq!(unknown.device,Device::Auto);assert_eq!(unknown.format,Format::Json);
  assert!(!unknown.known_app);
 }
 #[test] fn disallow_substring_false_positives(){
  let unknown=detect(&headers("unhappy/1.2","*/*"));
  assert!(!unknown.known_app);
 }
}
