//! Auditable, fail-closed conversion of already authorized client outbounds.
//! Never parse server-side inbounds here: only sanitized user_subscriptions::collect_user_outbounds.
use base64::Engine as _;
use serde_json::{Value, json};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FeedFormat {
    Xray,
    Links,
    Base64,
    Mihomo,
    SingBox,
}

impl FeedFormat {
    pub fn from_name(name: &str) -> Option<Self> {
        match name.to_ascii_lowercase().as_str() {
            "xray" | "json" => Some(Self::Xray),
            "vless" | "links" | "uri" => Some(Self::Links),
            "base64" | "b64" => Some(Self::Base64),
            "mihomo" | "clash" | "yaml" => Some(Self::Mihomo),
            "singbox" | "sing-box" => Some(Self::SingBox),
            _ => None,
        }
    }
    pub const fn content_type(self) -> &'static str {
        match self {
            Self::Xray | Self::SingBox => "application/json; charset=utf-8",
            Self::Mihomo => "application/yaml; charset=utf-8",
            Self::Links | Self::Base64 => "text/plain; charset=utf-8",
        }
    }
}

pub struct Rendered {
    pub body: String,
    pub skipped: usize,
}

fn text<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str().filter(|s| !s.is_empty())
}
fn encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}
fn address(value: &Value) -> Option<(String, u16)> {
    let server = text(value, &["settings", "vnext", "0", "address"])
        .or_else(|| text(value, &["settings", "address"]));
    // JSON arrays must be accessed by index, not by a text key.
    let server = server.or_else(|| value["settings"]["vnext"][0]["address"].as_str())?;
    if server.len() > 253 || server.chars().any(char::is_control)
        || server.bytes().any(|b| b"@/?# \\".contains(&b))
    {
        return None;
    }
    let port = value["settings"]["vnext"][0]["port"].as_u64()
        .or_else(|| value["settings"]["port"].as_u64())?;
    let port = u16::try_from(port).ok().filter(|v| *v > 0)?;
    Some((server.to_owned(), port))
}
fn link_address(address: &str) -> String {
    if address.contains(':') && !address.starts_with('[') {
        format!("[{address}]")
    } else {
        address.to_owned()
    }
}
fn name(value: &Value) -> String {
    value["tag"].as_str().unwrap_or("Server")
        .chars().filter(|c| !c.is_control()).take(100).collect()
}
fn vless_identity(value: &Value) -> Option<&str> {
    if value["protocol"] != "vless" { return None; }
    let user = &value["settings"]["vnext"][0]["users"][0];
    if user["encryption"].as_str().unwrap_or("none") != "none" {
        return None;
    }
    let uuid = user["id"].as_str()?;
    uuid::Uuid::parse_str(uuid).ok()?;
    Some(uuid)
}
fn security(value: &Value) -> Option<&str> {
    let stream = &value["streamSettings"];
    let mode = stream["security"].as_str().unwrap_or("none");
    if !["tls", "reality"].contains(&mode) { return None; }
    Some(mode)
}
fn transport(value: &Value) -> Option<&str> {
    let network = value["streamSettings"]["network"].as_str().unwrap_or("tcp");
    match network {
        "raw" | "tcp" => Some("tcp"),
        "ws" | "websocket" => Some("ws"),
        "grpc" => Some("grpc"),
        "httpupgrade" => Some("httpupgrade"),
        "xhttp" => Some("xhttp"),
        _ => None,
    }
}
fn sni(value: &Value, mode: &str) -> Option<&str> {
    text(value, &["streamSettings", if mode == "reality" { "realitySettings" } else { "tlsSettings" }, "serverName"])
}
fn tls_options(value: &Value, mode: &str) -> Option<Value> {
    let stream = &value["streamSettings"];
    let settings = &stream[if mode == "reality" { "realitySettings" } else { "tlsSettings" }];
    let mut data = json!({"enabled":true,"server_name":sni(value, mode)?});
    if let Some(alpn) = settings.get("alpn").filter(|v| v.is_array()) {
        data["alpn"] = alpn.clone();
    }
    if mode == "reality" {
        let public = text(settings, &["password"]).or_else(|| text(settings, &["publicKey"]))?;
        let short = settings["shortId"].as_str().unwrap_or("");
        data["reality"] = json!({"enabled":true,"public_key":public,"short_id":short});
        if let Some(fp) = text(settings, &["fingerprint"]) {
            data["utls"] = json!({"enabled":true,"fingerprint":fp});
        }
    } else if settings["allowInsecure"] == true {
        // Never silently weaken TLS verification for alternate exporters.
        return None;
    }
    Some(data)
}
fn ws_options(stream: &Value) -> Value {
    let settings = &stream["wsSettings"];
    let mut result = json!({"path":settings["path"].as_str().unwrap_or("/")});
    if let Some(host) = settings["headers"]["Host"].as_str().or_else(|| settings["host"].as_str()) {
        result["headers"] = json!({"Host":host});
    }
    result
}
fn grpc_options(stream: &Value) -> Value {
    json!({"service_name":stream["grpcSettings"]["serviceName"].as_str().unwrap_or("")})
}
fn link_for(value: &Value) -> Option<String> {
    let (server,port) = address(value)?;
    let stream=&value["streamSettings"];
    let network=transport(value)?;
    let mode=security(value)?;
    let mut options=vec![format!("security={mode}"),format!("type={network}")];
    if let Some(sni) = sni(value,mode) { options.push(format!("sni={}",encode(sni))); }
    if mode=="reality" {
        let reality=&stream["realitySettings"];
        options.push(format!("pbk={}",encode(text(reality,&["password"])
            .or_else(||text(reality,&["publicKey"]))?)));
        options.push(format!("sid={}",encode(reality["shortId"].as_str().unwrap_or(""))));
        if let Some(fp)=text(reality,&["fingerprint"]) {
            options.push(format!("fp={}",encode(fp)));
        }
        if let Some(spider)=text(reality,&["spiderX"]) {
            options.push(format!("spx={}",encode(spider)));
        }
    }
    if let Some(flow) = text(value,&["settings","vnext","0","users","0","flow"])
        .or_else(||value["settings"]["vnext"][0]["users"][0]["flow"].as_str())
    {
        options.push(format!("flow={}",encode(flow)));
    }
    match network {
        "ws" => {
            let cfg=ws_options(stream);
            options.push(format!("path={}",encode(cfg["path"].as_str()?)));
            if let Some(host)=cfg["headers"]["Host"].as_str() {
                options.push(format!("host={}",encode(host)));
            }
        }
        "grpc" => options.push(format!("serviceName={}",encode(stream["grpcSettings"]["serviceName"].as_str().unwrap_or("")))),
        "httpupgrade" => {
            let cfg=&stream["httpupgradeSettings"];
            options.push(format!("path={}",encode(cfg["path"].as_str().unwrap_or("/"))));
            if let Some(host)=cfg["host"].as_str() { options.push(format!("host={}",encode(host))); }
        }
        "xhttp" => {
            let cfg=&stream["xhttpSettings"];
            options.push(format!("path={}",encode(cfg["path"].as_str().unwrap_or("/"))));
            if let Some(host)=cfg["host"].as_str() { options.push(format!("host={}",encode(host))); }
            if let Some(mode)=cfg["mode"].as_str() { options.push(format!("mode={}",encode(mode))); }
            // XHTTP's extra client metadata cannot be represented by every URI importer.
            // Reject advanced settings rather than dropping critical transport parameters.
            if cfg.as_object()?.keys().any(|k| !["path","host","mode"].contains(&k.as_str())) {
                return None;
            }
        }
        _ => {}
    }
    let uuid=vless_identity(value)?;
    Some(format!("vless://{uuid}@{}:{port}?{}#{}",
        link_address(&server), options.join("&"),encode(&name(value))))
}
fn mihomo_proxy(value: &Value) -> Option<Value> {
    let (server,port)=address(value)?;
    let net=transport(value)?;
    let sec=security(value)?;
    let uuid=vless_identity(value)?;
    let tls=tls_options(value,sec)?;
    let mut p=json!({"name":name(value),"type":"vless","server":server,
        "port":port,"uuid":uuid,"udp":true,"tls":true,
        "servername":tls["server_name"]});
    if let Some(flow)=value["settings"]["vnext"][0]["users"][0]["flow"].as_str() {
        p["flow"]=json!(flow);
    }
    if sec=="reality" {
        p["reality-opts"]=json!({"public-key":tls["reality"]["public_key"],"short-id":tls["reality"]["short_id"]});
        if let Some(fp)=tls["utls"]["fingerprint"].as_str() {
            p["client-fingerprint"]=json!(fp);
        }
    }
    if let Some(alpn)=tls.get("alpn") { p["alpn"]=alpn.clone(); }
    let stream=&value["streamSettings"];
    match net {
        "tcp" => {}
        "ws" => {p["network"]=json!("ws");p["ws-opts"]=ws_options(stream);}
        "grpc" => {p["network"]=json!("grpc");p["grpc-opts"]=json!({
          "grpc-service-name":stream["grpcSettings"]["serviceName"].as_str().unwrap_or("")
        });}
        "httpupgrade" => {p["network"]=json!("httpupgrade");p["httpupgrade-opts"]=json!({
          "path":stream["httpupgradeSettings"]["path"].as_str().unwrap_or("/"),
          "host":stream["httpupgradeSettings"]["host"].as_str().unwrap_or("")
        });}
        "xhttp" => {
            // Only publish basic xhttp: advanced Xray-only params are not interchangeable.
            let cfg=&stream["xhttpSettings"];
            if cfg.as_object()?.keys().any(|k| !["path","host","mode"].contains(&k.as_str())) {
                return None;
            }
            p["network"]=json!("xhttp");
            p["xhttp-opts"]=json!({
                "path":cfg["path"].as_str().unwrap_or("/"),
                "host":cfg["host"].as_str().unwrap_or(""),
                "mode":cfg["mode"].as_str().unwrap_or("auto")
            });
        }
        _ => return None,
    }
    Some(p)
}
fn singbox_proxy(value: &Value) -> Option<Value> {
    let (server,port)=address(value)?;
    let net=transport(value)?;
    // Upstream sing-box does not support Xray XHTTP or Xray's new VLESS encryption.
    if net=="xhttp" {return None;}
    let sec=security(value)?;
    let uuid=vless_identity(value)?;
    let mut proxy=json!({"type":"vless","tag":name(value),
        "server":server,"server_port":port,"uuid":uuid,
        "tls":tls_options(value,sec)?});
    if let Some(flow)=value["settings"]["vnext"][0]["users"][0]["flow"].as_str() {
        proxy["flow"]=json!(flow);
    }
    let stream=&value["streamSettings"];
    match net {
        "tcp" => {}
        "ws" => {
            let ws=ws_options(stream);
            let mut transport=json!({"type":"ws","path":ws["path"]});
            if let Some(headers)=ws.get("headers") {transport["headers"]=headers.clone();}
            proxy["transport"]=transport;
        }
        "grpc" => proxy["transport"]=json!({"type":"grpc",
            "service_name":grpc_options(stream)["service_name"]}),
        "httpupgrade" => proxy["transport"]=json!({"type":"httpupgrade",
            "path":stream["httpupgradeSettings"]["path"].as_str().unwrap_or("/"),
            "host":stream["httpupgradeSettings"]["host"].as_str().unwrap_or("")}),
        _ => return None,
    }
    Some(proxy)
}
/// Render a single authenticated set of client outbounds, skipping unsupported
/// combinations but never inserting insecure direct fallbacks.
pub fn render(outbounds:&[Value], format:FeedFormat) -> Result<Rendered,String> {
    let mut converted=Vec::new();
    let mut skipped=0;
    for proxy in outbounds {
        let item=match format {
            FeedFormat::Links | FeedFormat::Base64 => link_for(proxy).map(Value::String),
            FeedFormat::Mihomo => mihomo_proxy(proxy),
            FeedFormat::SingBox => singbox_proxy(proxy),
            FeedFormat::Xray => return Err("Native Xray is rendered by the existing feed engine".into()),
        };
        if let Some(item)=item {converted.push(item);} else {skipped+=1;}
    }
    if converted.is_empty() {
        return Err("Ни один сервер не поддерживает выбранный формат или транспорт. Выберите Xray JSON.".into());
    }
    // The source list is bounded at 256 by the subscription engine.
    let body=match format {
        FeedFormat::Links | FeedFormat::Base64 => {
            let lines=converted.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("\n");
            if format==FeedFormat::Base64 {
                base64::engine::general_purpose::STANDARD.encode(lines)
            }else {lines}
        }
        FeedFormat::Mihomo => {
            // JSON flow values are valid YAML 1.2 scalars/mappings, and avoid
            // malicious host remarks injecting YAML directives or extra rules.
            let mut names=Vec::new();
            let mut proxies=String::new();
            for (i,p) in converted.iter_mut().enumerate() {
                let unique=format!("{} #{}",p["name"].as_str().unwrap_or("Server"),i+1);
                p["name"]=json!(unique);
                names.push(unique);
                proxies.push_str("  - ");
                proxies.push_str(&serde_json::to_string(p).map_err(|_|"Ошибка сериализации YAML")?);
                proxies.push('\n');
            }
            let select=json!({"name":"PROXY","type":"select","proxies":names});
            format!("mixed-port: 7890\nallow-lan: false\nmode: rule\nlog-level: warning\nproxies:\n{proxies}proxy-groups:\n  - {}\nrules:\n  - 'MATCH,PROXY'\n",
                serde_json::to_string(&select).map_err(|_|"Ошибка сериализации YAML")?)
        }
        FeedFormat::SingBox => {
            let mut tags=Vec::new();
            for (i,p) in converted.iter_mut().enumerate() {
                let unique=format!("{} #{}",p["tag"].as_str().unwrap_or("Server"),i+1);
                p["tag"]=json!(unique);
                tags.push(unique);
            }
            let mut outbounds=converted;
            outbounds.push(json!({"type":"selector","tag":"select","outbounds":tags,"default":tags[0]}));
            let document=json!({
                "log":{"level":"warn"},
                "inbounds":[{"type":"mixed","tag":"mixed-in","listen":"127.0.0.1","listen_port":2080}],
                "outbounds":outbounds,
                "route":{"final":"select"}
            });
            serde_json::to_string(&document).map_err(|_|"Ошибка сериализации sing-box JSON")?
        }
        FeedFormat::Xray => unreachable!(),
    };
    Ok(Rendered{body,skipped})
}
#[cfg(test)]
mod tests {
    use super::*;
    fn vless(net:&str,secure:&str) -> Value {
        let mut stream=json!({"network":net,"security":secure,
            "tlsSettings":{"serverName":"host.example.org"},
            "realitySettings":{"serverName":"example.org","password":"public-key","shortId":"abcd","fingerprint":"chrome"},
            "wsSettings":{"path":"/ws","headers":{"Host":"cdn.example.org"}},
            "xhttpSettings":{"path":"/x","host":"edge.example.org","mode":"auto"}});
        if net=="grpc" {stream["grpcSettings"]=json!({"serviceName":"proxy"});}
        json!({"protocol":"vless","tag":"PL Test",
            "settings":{"vnext":[{"address":"example.com","port":443,"users":[{"id":"bf000d23-0752-40b4-affe-68f7707a9661","encryption":"none"}]}]},
            "streamSettings":stream})
    }
    #[test]
    fn vless_reality_links_keep_credentials_and_encoding() {
        let link=render(&[vless("xhttp","reality")],FeedFormat::Links).unwrap().body;
        assert!(link.starts_with("vless://bf000d23-0752-40b4-affe-68f7707a9661@example.com:443?"));
        assert!(link.contains("security=reality"));
        assert!(link.contains("pbk=public-key"));
        assert!(link.contains("type=xhttp"));
        assert!(link.ends_with("#PL%20Test"));
        let encoded=render(&[vless("xhttp","reality")],FeedFormat::Base64).unwrap().body;
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(encoded).unwrap(),link.as_bytes());
    }
    #[test]
    fn mihomo_and_singbox_never_silently_convert_unsupported_xhttp() {
        let proxy=vless("xhttp","reality");
        assert!(render(&[proxy.clone()],FeedFormat::Mihomo).unwrap().body.contains("reality-opts"));
        assert!(render(&[proxy],FeedFormat::SingBox).is_err());
        let sb=render(&[vless("ws","tls")],FeedFormat::SingBox).unwrap();
        let doc:Value=serde_json::from_str(&sb.body).unwrap();
        assert_eq!(doc["outbounds"][0]["transport"]["type"],"ws");
    }
    #[test]
    fn never_export_unencrypted_or_unsupported_vless() {
        let mut proxy=vless("tcp","tls");
        proxy["settings"]["vnext"][0]["users"][0]["encryption"]=json!("mlkem768x25519plus.secret");
        assert!(render(&[proxy],FeedFormat::Links).is_err());
        let mut proxy=vless("tcp","tls");
        proxy["streamSettings"]["security"]=json!("none");
        assert!(render(&[proxy],FeedFormat::Mihomo).is_err());
    }
    #[test]
    fn yaml_uses_quoted_flow_nodes_to_prevent_name_injection() {
        let mut proxy=vless("tcp","tls");
        proxy["tag"]=json!("Test\"\nrules:\n- MATCH,DIRECT");
        let y=render(&[proxy],FeedFormat::Mihomo).unwrap().body;
        assert!(y.contains("\\n"));
        assert_eq!(y.matches("\nrules:\n").count(),1);
    }
}
