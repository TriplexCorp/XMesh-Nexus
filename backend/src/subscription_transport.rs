//! Client-side Xray stream settings. Never serialize an inbound streamSettings verbatim.
//! Source of truth: https://xtls.github.io/en/config/transport.html
//! XHTTP fields: Xray-core infra/conf/transport_method.go (SplitHTTPConfig).
use serde_json::{json, Value};

fn field<'a>(obj:&'a Value,key:&str)->Option<&'a str>{
    obj.get(key).and_then(Value::as_str).filter(|s|!s.is_empty())
}
fn allowed(value:&Value)->bool{
    value.is_string()||value.is_number()||value.is_boolean()||value.is_array()||value.is_object()
}
fn pick(obj:&Value, keys:&[&str])->Value{
    let mut result=json!({});
    for key in keys {
        if let Some(v)=obj.get(*key).filter(|v|allowed(v) && !v.is_null()){
            result[*key]=v.clone();
        }
    }
    result
}
fn merge_allowed(target:&mut Value, extra:&Value, keys:&[&str]){
    for key in keys{
        if let Some(v)=extra.get(*key).filter(|v|allowed(v)&&!v.is_null()){
            target[*key]=v.clone();
        }
    }
}
// Only documented client-applicable XHTTP fields. Server-only limits:
// scMaxBufferedPosts, scStreamUpServerSecs, serverMaxHeaderBytes.
// downloadSettings is client-only but must be explicitly configured as client
// metadata, not inherited from the inbound.
const XHTTP_FIELDS:&[&str]=&[
    "path","host","mode","headers","xPaddingBytes",
    "xPaddingObfsMode","xPaddingKey","xPaddingHeader","xPaddingPlacement",
    "xPaddingMethod","uplinkHTTPMethod","sessionIDPlacement","sessionIDKey",
    "sessionIDTable","sessionIDLength","seqPlacement","seqKey",
    "uplinkDataPlacement","uplinkDataKey","uplinkChunkSize",
    "noGRPCHeader","noSSEHeader","scMaxEachPostBytes","scMinPostsIntervalMs",
    "xmux"
];
const XHTTP_DEVICE_FIELDS:&[&str]=&[
    "mode","headers","xPaddingBytes","uplinkHTTPMethod",
    "uplinkDataPlacement","uplinkDataKey","uplinkChunkSize",
    "scMaxEachPostBytes","scMinPostsIntervalMs","xmux"
];
const WS_FIELDS:&[&str]=&["path","host","heartbeatPeriod"];
const GRPC_FIELDS:&[&str]=&["serviceName","authority","multiMode","user_agent",
    "idle_timeout","health_check_timeout","permit_without_stream","initial_windows_size"];
const HTTPUPGRADE_FIELDS:&[&str]=&["path","host"];
const RAW_FIELDS:&[&str]=&["header"];
const HYSTERIA_FIELDS:&[&str]=&["version","udpIdleTimeout"];
const MASQUE_FIELDS:&[&str]=&["path"];
const KCP_FIELDS:&[&str]=&[
    "mtu","tti","uplinkCapacity","downlinkCapacity","cwndMultiplier","maxSendingWindow","header","seed"
];

fn object_or_json(value:&Value)->Option<Value>{
    if value.is_object(){return Some(value.clone())}
    value.as_str().and_then(|s|serde_json::from_str::<Value>(s).ok()).filter(Value::is_object)
}
fn effective_xhttp(config:&Value)->Value{
    // Xray's SplitHTTPConfig.Build: extra replaces the settings body;
    // top-level host/path/mode are reapplied on top of the extra object.
    let Some(extra)=config.get("extra").and_then(object_or_json) else{return config.clone()};
    let mut effective=extra;
    for key in ["host","path","mode"]{
        effective[key]=config.get(key).filter(|v|v.is_string())
            .cloned().unwrap_or_else(||json!(""));
    }
    effective
}
fn device_xhttp<'a>(inbound:&'a Value,device:&str)->Option<&'a Value>{
    let name=match device{"ios"=>"iOS","windows"=>"Windows",_=>return None};
    inbound.get("xmesh").and_then(|v|v.get("xhttpDeviceProfiles"))
        .or_else(||inbound.get("xhttpDeviceProfiles"))
        .and_then(|v|v.get(name))
}
fn client_metadata<'a>(inbound:&'a Value,host:&'a Value,key:&str)->Option<&'a Value>{
    host.get(key).or_else(||inbound.get("xmesh").and_then(|v|v.get(key)))
}
fn client_transport(stream:&Value,inbound:&Value,host:&Value,device:&str,network:&str)->Value{
    let (settings_key,fields)=match network{
        "xhttp"=>("xhttpSettings",XHTTP_FIELDS),
        "ws"|"websocket"=>("wsSettings",WS_FIELDS),
        "grpc"=>("grpcSettings",GRPC_FIELDS),
        "httpupgrade"=>("httpupgradeSettings",HTTPUPGRADE_FIELDS),
        "raw"|"tcp"=>("rawSettings",RAW_FIELDS),
        "mkcp"|"kcp"=>("kcpSettings",KCP_FIELDS),
        "hysteria"=>("hysteriaSettings",HYSTERIA_FIELDS),
        "masque"=>("masqueSettings",MASQUE_FIELDS),
        _=>return json!({})
    };
    let mut config=stream.get(settings_key).cloned().unwrap_or_else(||json!({}));
    if network=="tcp" && config.as_object().is_some_and(|m|m.is_empty()){
        config=stream.get("tcpSettings").cloned().unwrap_or_else(||json!({}));
    }
    if network=="xhttp"{config=effective_xhttp(&config)}
    let mut transport=pick(&config,fields);
    if network=="xhttp"{
        // These three are structured types, never JSON-encoded strings.
        for key in ["headers","xmux"]{
            if !transport.get(key).is_some_and(Value::is_object){
                transport.as_object_mut().unwrap().remove(key);
            }
        }
        if let Some(profile)=device_xhttp(inbound,device){
            merge_allowed(&mut transport,profile,XHTTP_DEVICE_FIELDS);
        }
        if let Some(client)=client_metadata(inbound,host,"clientXhttpSettings"){
            merge_allowed(&mut transport,client,XHTTP_FIELDS);
            if let Some(download)=client.get("downloadSettings").filter(|v|v.is_object()){
                transport["downloadSettings"]=download.clone();
            }
        }
    }else if network=="ws"||network=="websocket"||network=="httpupgrade"{
        // HTTP request headers are client-specific. Never inherit arbitrary
        // inbound-only acceptProxyProtocol or other server values.
        if let Some(headers)=client_metadata(inbound,host,"clientHeaders")
            .and_then(Value::as_object) {
            transport["headers"]=Value::Object(headers.clone());
        }
    }
    if network!="grpc" {
        if let Some(path)=field(host,"path"){transport["path"]=json!(path)}
    }
    if let Some(hostname)=field(host,"host").or_else(||field(host,"externalHost")){
        if ["xhttp","ws","websocket","httpupgrade"].contains(&network){
            transport["host"]=json!(hostname);
        }
    }
    if network=="grpc" {
        if let Some(service)=field(host,"serviceName"){transport["serviceName"]=json!(service)}
    }
    if network=="masque" {
        if let Some(extra)=client_metadata(inbound,host,"clientMasqueSettings"){
            merge_allowed(&mut transport,extra,&["host","headers","xmux"]);
        }
        if let Some(hostname)=field(host,"host").or_else(||field(host,"externalHost")){
            transport["host"]=json!(hostname);
        }
    }
    transport
}

pub(crate) fn client_stream(inbound:&Value,host:&Value,device:&str)->Option<Value>{
    let stream=inbound.get("streamSettings")?;
    let security=field(stream,"security").unwrap_or("none");
    let network=field(stream,"method").or_else(||field(stream,"network")).unwrap_or("raw");
    if !["none","tls","reality"].contains(&security){return None}
    if !["raw","tcp","xhttp","ws","websocket","grpc","httpupgrade","mkcp","kcp","hysteria","masque"].contains(&network){return None}
    if network=="masque" && (security!="tls" || field(inbound,"protocol")!=Some("masque")){return None}
    if security=="reality" && !["raw","tcp","xhttp","grpc"].contains(&network){return None}
    let mut out=if field(stream,"method").is_some(){json!({"security":security,"method":network})}
        else{json!({"security":security,"network":network})};
    if security=="reality"{
        let reality=stream.get("realitySettings").unwrap_or(&Value::Null);
        // 'password' is the current client name; 'publicKey' is its old alias.
        let key=field(host,"realityPassword")
            .or_else(||field(host,"publicKey"))
            .or_else(||field(host,"realityPublicKey"))
            .or_else(||field(inbound,"publicKey"))
            .or_else(||field(reality,"password"))
            .or_else(||field(reality,"publicKey"))?;
        let sni=field(host,"sni").or_else(||field(host,"externalSNI"))
            .or_else(||reality.get("serverNames").and_then(Value::as_array)
                .and_then(|a|a.first()).and_then(Value::as_str))?;
        let sid=field(host,"shortId").or_else(||field(host,"externalShortId"))
            .or_else(||reality.get("shortIds").and_then(Value::as_array)
                .and_then(|a|a.first()).and_then(Value::as_str))?;
        out["realitySettings"]=json!({
            "serverName":sni,"password":key,"shortId":sid,
            "fingerprint":field(host,"fp").or_else(||field(host,"fingerprint")).unwrap_or("chrome"),
            "spiderX":field(host,"spiderX").unwrap_or("/")
        });
        if let Some(verify)=field(host,"mldsa65Verify")
            .or_else(||inbound.get("xmesh").and_then(|m|field(m,"mldsa65Verify"))){
            out["realitySettings"]["mldsa65Verify"]=json!(verify);
        }
    }else if security=="tls"{
        let server=stream.get("tlsSettings").unwrap_or(&Value::Null);
        let sni=field(host,"sni").or_else(||field(host,"externalSNI"))
            .or_else(||field(server,"serverName"))
            .or_else(||field(host,"address"))?;
        let mut tls=pick(server,&["alpn","minVersion","maxVersion","cipherSuites","curvePreferences"]);
        tls["serverName"]=json!(sni);
        if let Some(override_alpn)=field(host,"alpn"){
            let alpn:Vec<&str>=override_alpn.split(',').map(str::trim)
                .filter(|s|!s.is_empty()&&s.len()<=32
                    && s.bytes().all(|b|b.is_ascii_alphanumeric()||b"/.-_".contains(&b))).collect();
            if !alpn.is_empty(){tls["alpn"]=json!(alpn)}
        }
        if let Some(fp)=field(host,"fp").or_else(||field(host,"fingerprint")){
            tls["fingerprint"]=json!(fp);
        }
        // Certificate chains, private keys, server ECH keys, OCSP stapling,
        // rejectUnknownSni, and all inbound trust material never leave the server.
        if let Some(client)=client_metadata(inbound,host,"clientTlsSettings"){
            merge_allowed(&mut tls,client,&[
                "verifyPeerCertByName","allowInsecure","alpn","fingerprint",
                "pinnedPeerCertSha256","useSystemCA","disableSystemRoot",
                "enableSessionResumption","echConfigList","echSockopt",
                "minVersion","maxVersion","cipherSuites","curvePreferences"
            ]);
        }
        out["tlsSettings"]=tls;
    }
    let transport=client_transport(stream,inbound,host,device,network);
    if !transport.as_object().is_some_and(|o|o.is_empty()){
        let field=match network{
            "raw"|"tcp"=>"rawSettings","xhttp"=>"xhttpSettings","ws"|"websocket"=>"wsSettings",
            "grpc"=>"grpcSettings","httpupgrade"=>"httpupgradeSettings",
            "mkcp"|"kcp"=>"kcpSettings","hysteria"=>"hysteriaSettings",
            "masque"=>"masqueSettings",_=>return None
        };
        out[field]=transport;
    }
    // FinalMask is directional: copy ONLY an intentionally authored client
    // configuration. The inbound's finalmask can contain server-side payloads.
    if let Some(mask)=client_metadata(inbound,host,"clientFinalmask").filter(|v|v.is_object()){
        out["finalmask"]=mask.clone();
    }
    if let Some(sockopt)=client_metadata(inbound,host,"clientSockopt").filter(|v|v.is_object()){
        out["sockopt"]=sockopt.clone();
    }
    Some(out)
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn xhttp_obfs_and_session_fields_survive_without_server_limits(){
        let inbound=json!({"streamSettings":{"network":"xhttp","security":"none",
            "xhttpSettings":{"path":"/a","mode":"stream-up",
                "xPaddingObfsMode":true,"xPaddingKey":"x-token",
                "xPaddingHeader":"X-Request-Token","xPaddingMethod":"tokenish",
                "xPaddingPlacement":"header","seqPlacement":"query","seqKey":"segment",
                "sessionIDPlacement":"cookie","sessionIDKey":"session_id",
                "sessionIDTable":"Base62","sessionIDLength":"16-48",
                "scStreamUpServerSecs":"30-60","serverMaxHeaderBytes":1000,
                "scMaxBufferedPosts":80}}});
        let stream=client_stream(&inbound,&json!({}),"auto").unwrap();
        let x=&stream["xhttpSettings"];
        assert_eq!(x["xPaddingObfsMode"],true);
        assert_eq!(x["xPaddingMethod"],"tokenish");
        assert_eq!(x["sessionIDLength"],"16-48");
        for field in ["scStreamUpServerSecs","serverMaxHeaderBytes","scMaxBufferedPosts"]{
            assert!(x.get(field).is_none(),"{field} is server-only");
        }
    }
    #[test] fn xhttp_extra_is_effective_and_device_profile_overrides_only_client_fields(){
        let inbound=json!({"xmesh":{"xhttpDeviceProfiles":{"iOS":{
            "mode":"packet-up","uplinkHTTPMethod":"POST","xmux":{"cMaxReuseTimes":0}}}},
            "streamSettings":{"network":"xhttp","security":"none","xhttpSettings":{
                "path":"/outside","mode":"auto",
                "extra":{"xPaddingObfsMode":true,"xPaddingPlacement":"header",
                    "path":"/inside","mode":"stream-up","scStreamUpServerSecs":"20-30"}}}});
        let ios=client_stream(&inbound,&json!({}),"ios").unwrap();
        assert_eq!(ios["xhttpSettings"]["path"],"/outside");
        assert_eq!(ios["xhttpSettings"]["mode"],"packet-up");
        assert_eq!(ios["xhttpSettings"]["xPaddingObfsMode"],true);
        assert!(ios["xhttpSettings"].get("scStreamUpServerSecs").is_none());
    }
    #[test] fn never_leak_server_reality_tls_and_finalmask(){
        let inbound=json!({"streamSettings":{"network":"raw","security":"reality",
            "realitySettings":{"privateKey":"SECRET","target":"secret:443",
                "serverNames":["example.org"],"shortIds":["abcd"],"publicKey":"PUB"},
            "finalmask":{"udp":[{"type":"noise","settings":{"server":"PRIVATE"}}]}}});
        let host=json!({"address":"vpn.example.com"});
        let c=client_stream(&inbound,&host,"auto").unwrap();
        let body=c.to_string();
        assert!(body.contains("\"password\":\"PUB\""));
        assert!(!body.contains("SECRET")&&!body.contains("secret:443")&&!body.contains("PRIVATE"));
        assert!(c.get("finalmask").is_none());
    }
    #[test] fn transports_strip_inbound_only_keys(){
        for (method,key) in [("ws","wsSettings"),("httpupgrade","httpupgradeSettings"),
            ("raw","rawSettings"),("grpc","grpcSettings"),("mkcp","kcpSettings")]{
            let mut inbound=json!({"streamSettings":{"network":method,"security":"tls",
                "tlsSettings":{"serverName":"example.org","certificates":[{"key":"SERVER_KEY"}]}}});
            inbound["streamSettings"][key]=json!({"acceptProxyProtocol":true,
                "path":"/example","serviceName":"demo","header":{"type":"none"},"mtu":1350});
            let c=client_stream(&inbound,&json!({"address":"example.org"}),"auto").unwrap();
            assert!(!c.to_string().contains("SERVER_KEY"));
            assert!(!c.to_string().contains("acceptProxyProtocol"));
        }
    }
}
