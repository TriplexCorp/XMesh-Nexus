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
    let server = value["settings"]["vnext"][0]["address"]
        .as_str()
        .or_else(|| text(value, &["settings", "address"]))?;
    if server.len() > 253
        || server.chars().any(char::is_control)
        || server.bytes().any(|b| b"@/?# \\".contains(&b))
    {
        return None;
    }
    let port = value["settings"]["vnext"][0]["port"]
        .as_u64()
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
    value["tag"]
        .as_str()
        .unwrap_or("Server")
        .chars()
        .filter(|c| !c.is_control())
        .take(100)
        .collect()
}
fn vless_identity(value: &Value) -> Option<&str> {
    if value["protocol"] != "vless" {
        return None;
    }
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
    if !["tls", "reality"].contains(&mode) {
        return None;
    }
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
    text(
        value,
        &[
            "streamSettings",
            if mode == "reality" {
                "realitySettings"
            } else {
                "tlsSettings"
            },
            "serverName",
        ],
    )
}
fn tls_options(value: &Value, mode: &str) -> Option<Value> {
    let stream = &value["streamSettings"];
    let settings = &stream[if mode == "reality" {
        "realitySettings"
    } else {
        "tlsSettings"
    }];
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
    if let Some(host) = settings["headers"]["Host"]
        .as_str()
        .or_else(|| settings["host"].as_str())
    {
        result["headers"] = json!({"Host":host});
    }
    result
}
fn grpc_options(stream: &Value) -> Value {
    json!({"service_name":stream["grpcSettings"]["serviceName"].as_str().unwrap_or("")})
}
fn supported_shadowsocks(value: &Value) -> Option<(&str, &str)> {
    if value["protocol"] != "shadowsocks" {
        return None;
    }
    let cipher = text(value, &["settings", "method"])?;
    if !["aes-128-gcm", "aes-256-gcm", "chacha20-poly1305"].contains(&cipher) {
        // SS2022 multi-user compound PSKs require client-specific validation.
        return None;
    }
    let password = text(value, &["settings", "password"])?;
    if !["none", ""].contains(
        &value["streamSettings"]["security"]
            .as_str()
            .unwrap_or("none"),
    ) || !["raw", "tcp"].contains(&value["streamSettings"]["network"].as_str().unwrap_or("tcp"))
    {
        return None;
    }
    Some((cipher, password))
}
fn alt_link(value: &Value) -> Option<String> {
    let protocol = value["protocol"].as_str()?;
    if protocol == "vless" {
        return link_for(value);
    }
    let (server, port) = address(value)?;
    let tag = encode(&name(value));
    match protocol {
        "trojan" => {
            let password = text(value, &["settings", "password"])?;
            let mode = security(value)?;
            if mode != "tls" {
                return None;
            }
            let net = transport(value)?;
            if !["tcp", "ws", "grpc"].contains(&net) {
                return None;
            }
            let mut params = vec![format!("security={mode}"), format!("type={net}")];
            params.push(format!("sni={}", encode(sni(value, mode)?)));
            if net == "ws" {
                let options = ws_options(&value["streamSettings"]);
                params.push(format!("path={}", encode(options["path"].as_str()?)));
                if let Some(host) = options["headers"]["Host"].as_str() {
                    params.push(format!("host={}", encode(host)));
                }
            }
            if net == "grpc" {
                params.push(format!(
                    "serviceName={}",
                    encode(
                        value["streamSettings"]["grpcSettings"]["serviceName"]
                            .as_str()
                            .unwrap_or("")
                    )
                ));
            }
            Some(format!(
                "trojan://{}@{}:{port}?{}#{tag}",
                encode(password),
                link_address(&server),
                params.join("&")
            ))
        }
        "shadowsocks" => {
            let (cipher, password) = supported_shadowsocks(value)?;
            let user = base64::engine::general_purpose::STANDARD_NO_PAD
                .encode(format!("{cipher}:{password}"));
            Some(format!(
                "ss://{user}@{}:{port}#{tag}",
                link_address(&server)
            ))
        }
        "vmess" => {
            let uuid = text(value, &["settings", "id"])?;
            uuid::Uuid::parse_str(uuid).ok()?;
            let mode = security(value)?;
            if mode != "tls" {
                return None;
            }
            let net = transport(value)?;
            if !["tcp", "ws", "grpc"].contains(&net) {
                return None;
            }
            let stream = &value["streamSettings"];
            let mut item = json!({"v":"2","ps":name(value),"add":server,"port":port.to_string(),
                "id":uuid,"aid":"0","scy":"auto","net":net,"type":"none",
                "host":"","path":"","tls":"tls","sni":sni(value,mode)?});
            if net == "ws" {
                let opt = ws_options(stream);
                item["path"] = opt["path"].clone();
                if let Some(host) = opt["headers"]["Host"].as_str() {
                    item["host"] = json!(host);
                }
            }
            if net == "grpc" {
                item["path"] = json!(stream["grpcSettings"]["serviceName"].as_str().unwrap_or(""));
            }
            let encoded =
                base64::engine::general_purpose::STANDARD.encode(serde_json::to_vec(&item).ok()?);
            Some(format!("vmess://{encoded}"))
        }
        _ => None,
    }
}
fn other_mihomo(value: &Value) -> Option<Value> {
    let protocol = value["protocol"].as_str()?;
    let (server, port) = address(value)?;
    if protocol == "shadowsocks" {
        let (cipher, password) = supported_shadowsocks(value)?;
        return Some(
            json!({"name":name(value),"type":"ss","server":server,"port":port,
            "cipher":cipher,"password":password,"udp":true}),
        );
    }
    let mode = security(value)?;
    if mode != "tls" {
        return None;
    }
    let net = transport(value)?;
    if !["tcp", "ws", "grpc"].contains(&net) {
        return None;
    }
    let tls = tls_options(value, mode)?;
    let mut proxy = match protocol {
        "trojan" => json!({"name":name(value),"type":"trojan","server":server,
            "port":port,"password":text(value,&["settings","password"])?,
            "sni":tls["server_name"],"udp":true}),
        "vmess" => {
            let uuid = text(value, &["settings", "id"])?;
            uuid::Uuid::parse_str(uuid).ok()?;
            json!({"name":name(value),"type":"vmess","server":server,"port":port,
                "uuid":uuid,"alterId":0,"cipher":"auto","tls":true,"servername":tls["server_name"],"udp":true})
        }
        _ => return None,
    };
    if net == "ws" {
        proxy["network"] = json!("ws");
        proxy["ws-opts"] = ws_options(&value["streamSettings"]);
    }
    if net == "grpc" {
        proxy["network"] = json!("grpc");
        proxy["grpc-opts"] = json!({"grpc-service-name":
            value["streamSettings"]["grpcSettings"]["serviceName"].as_str().unwrap_or("")});
    }
    Some(proxy)
}
fn other_singbox(value: &Value) -> Option<Value> {
    let protocol = value["protocol"].as_str()?;
    let (server, port) = address(value)?;
    if protocol == "shadowsocks" {
        let (method, password) = supported_shadowsocks(value)?;
        return Some(
            json!({"tag":name(value),"type":"shadowsocks","server":server,
            "server_port":port,"method":method,"password":password}),
        );
    }
    let mode = security(value)?;
    if mode != "tls" {
        return None;
    }
    let net = transport(value)?;
    if !["tcp", "ws", "grpc"].contains(&net) {
        return None;
    }
    let mut proxy = match protocol {
        "trojan" => json!({"type":"trojan","tag":name(value),"server":server,
            "server_port":port,"password":text(value,&["settings","password"])?,
            "tls":tls_options(value,mode)?}),
        "vmess" => {
            let uuid = text(value, &["settings", "id"])?;
            uuid::Uuid::parse_str(uuid).ok()?;
            json!({"type":"vmess","tag":name(value),"server":server,"server_port":port,
                "uuid":uuid,"security":"auto","alter_id":0,"tls":tls_options(value,mode)?})
        }
        _ => return None,
    };
    if net == "ws" {
        let ws = ws_options(&value["streamSettings"]);
        let mut transport = json!({"type":"ws","path":ws["path"]});
        if let Some(headers) = ws.get("headers") {
            transport["headers"] = headers.clone();
        }
        proxy["transport"] = transport;
    }
    if net == "grpc" {
        proxy["transport"] = json!({"type":"grpc","service_name":
            value["streamSettings"]["grpcSettings"]["serviceName"].as_str().unwrap_or("")});
    }
    Some(proxy)
}
fn link_for(value: &Value) -> Option<String> {
    let (server, port) = address(value)?;
    let stream = &value["streamSettings"];
    let network = transport(value)?;
    let mode = security(value)?;
    let mut options = vec![format!("security={mode}"), format!("type={network}")];
    if let Some(sni) = sni(value, mode) {
        options.push(format!("sni={}", encode(sni)));
    }
    if mode == "reality" {
        let reality = &stream["realitySettings"];
        options.push(format!(
            "pbk={}",
            encode(text(reality, &["password"]).or_else(|| text(reality, &["publicKey"]))?)
        ));
        options.push(format!(
            "sid={}",
            encode(reality["shortId"].as_str().unwrap_or(""))
        ));
        if let Some(fp) = text(reality, &["fingerprint"]) {
            options.push(format!("fp={}", encode(fp)));
        }
        if let Some(spider) = text(reality, &["spiderX"]) {
            options.push(format!("spx={}", encode(spider)));
        }
    }
    if let Some(flow) = value["settings"]["vnext"][0]["users"][0]["flow"].as_str() {
        options.push(format!("flow={}", encode(flow)));
    }
    match network {
        "ws" => {
            let cfg = ws_options(stream);
            options.push(format!("path={}", encode(cfg["path"].as_str()?)));
            if let Some(host) = cfg["headers"]["Host"].as_str() {
                options.push(format!("host={}", encode(host)));
            }
        }
        "grpc" => options.push(format!(
            "serviceName={}",
            encode(stream["grpcSettings"]["serviceName"].as_str().unwrap_or(""))
        )),
        "httpupgrade" => {
            let cfg = &stream["httpupgradeSettings"];
            options.push(format!(
                "path={}",
                encode(cfg["path"].as_str().unwrap_or("/"))
            ));
            if let Some(host) = cfg["host"].as_str() {
                options.push(format!("host={}", encode(host)));
            }
        }
        "xhttp" => {
            let cfg = &stream["xhttpSettings"];
            options.push(format!(
                "path={}",
                encode(cfg["path"].as_str().unwrap_or("/"))
            ));
            if let Some(host) = cfg["host"].as_str() {
                options.push(format!("host={}", encode(host)));
            }
            if let Some(mode) = cfg["mode"].as_str() {
                options.push(format!("mode={}", encode(mode)));
            }
            // Standard Xray share links carry advanced XHTTP settings in
            // the percent-encoded 'extra' JSON parameter, never as raw URL text.
            let mut extra = cfg.as_object()?.clone();
            for key in ["path", "host", "mode"] {
                extra.remove(key);
            }
            if !extra.is_empty() {
                let serialized = serde_json::to_string(&extra).ok()?;
                options.push(format!("extra={}", encode(&serialized)));
            }
        }
        _ => {}
    }
    let uuid = vless_identity(value)?;
    Some(format!(
        "vless://{uuid}@{}:{port}?{}#{}",
        link_address(&server),
        options.join("&"),
        encode(&name(value))
    ))
}
fn mihomo_proxy(value: &Value) -> Option<Value> {
    if value["protocol"] != "vless" {
        return other_mihomo(value);
    }
    let (server, port) = address(value)?;
    let net = transport(value)?;
    let sec = security(value)?;
    let uuid = vless_identity(value)?;
    let tls = tls_options(value, sec)?;
    let mut p = json!({"name":name(value),"type":"vless","server":server,
        "port":port,"uuid":uuid,"udp":true,"tls":true,
        "servername":tls["server_name"]});
    if let Some(flow) = value["settings"]["vnext"][0]["users"][0]["flow"].as_str() {
        p["flow"] = json!(flow);
    }
    if sec == "reality" {
        p["reality-opts"] = json!({"public-key":tls["reality"]["public_key"],"short-id":tls["reality"]["short_id"]});
        if let Some(fp) = tls["utls"]["fingerprint"].as_str() {
            p["client-fingerprint"] = json!(fp);
        }
    }
    if let Some(alpn) = tls.get("alpn") {
        p["alpn"] = alpn.clone();
    }
    let stream = &value["streamSettings"];
    match net {
        "tcp" => {}
        "ws" => {
            p["network"] = json!("ws");
            p["ws-opts"] = ws_options(stream);
        }
        "grpc" => {
            p["network"] = json!("grpc");
            p["grpc-opts"] = json!({
              "grpc-service-name":stream["grpcSettings"]["serviceName"].as_str().unwrap_or("")
            });
        }
        "httpupgrade" => {
            p["network"] = json!("httpupgrade");
            p["httpupgrade-opts"] = json!({
              "path":stream["httpupgradeSettings"]["path"].as_str().unwrap_or("/"),
              "host":stream["httpupgradeSettings"]["host"].as_str().unwrap_or("")
            });
        }
        "xhttp" => {
            // Only publish basic xhttp: advanced Xray-only params are not interchangeable.
            let cfg = &stream["xhttpSettings"];
            let mut opts = json!({
                "path":cfg["path"].as_str().unwrap_or("/"),
                "host":cfg["host"].as_str().unwrap_or(""),
                "mode":cfg["mode"].as_str().unwrap_or("auto")
            });
            for (source, target) in [
                ("xPaddingBytes", "x-padding-bytes"),
                ("xPaddingObfsMode", "x-padding-obfs-mode"),
                ("xPaddingKey", "x-padding-key"),
                ("xPaddingHeader", "x-padding-header"),
                ("xPaddingPlacement", "x-padding-placement"),
                ("xPaddingMethod", "x-padding-method"),
                ("noGRPCHeader", "no-grpc-header"),
                ("noSSEHeader", "no-sse-header"),
                ("headers", "headers"),
            ] {
                if let Some(v) = cfg.get(source) {
                    opts[target] = v.clone();
                }
            }
            // Unmapped Xray-only fields cannot be silently dropped, since
            // padding/splitting mismatches cause intermittent connection errors.
            if cfg.as_object()?.keys().any(|k| {
                ![
                    "path",
                    "host",
                    "mode",
                    "xPaddingBytes",
                    "xPaddingObfsMode",
                    "xPaddingKey",
                    "xPaddingHeader",
                    "xPaddingPlacement",
                    "xPaddingMethod",
                    "noGRPCHeader",
                    "noSSEHeader",
                    "headers",
                ]
                .contains(&k.as_str())
            }) {
                return None;
            }
            p["network"] = json!("xhttp");
            p["xhttp-opts"] = opts;
        }
        _ => return None,
    }
    Some(p)
}
fn singbox_proxy(value: &Value) -> Option<Value> {
    if value["protocol"] != "vless" {
        return other_singbox(value);
    }
    let (server, port) = address(value)?;
    let net = transport(value)?;
    // Upstream sing-box does not support Xray XHTTP or Xray's new VLESS encryption.
    if net == "xhttp" {
        return None;
    }
    let sec = security(value)?;
    let uuid = vless_identity(value)?;
    let mut proxy = json!({"type":"vless","tag":name(value),
        "server":server,"server_port":port,"uuid":uuid,
        "tls":tls_options(value,sec)?});
    if let Some(flow) = value["settings"]["vnext"][0]["users"][0]["flow"].as_str() {
        proxy["flow"] = json!(flow);
    }
    let stream = &value["streamSettings"];
    match net {
        "tcp" => {}
        "ws" => {
            let ws = ws_options(stream);
            let mut transport = json!({"type":"ws","path":ws["path"]});
            if let Some(headers) = ws.get("headers") {
                transport["headers"] = headers.clone();
            }
            proxy["transport"] = transport;
        }
        "grpc" => {
            proxy["transport"] = json!({"type":"grpc",
            "service_name":grpc_options(stream)["service_name"]})
        }
        "httpupgrade" => {
            proxy["transport"] = json!({"type":"httpupgrade",
            "path":stream["httpupgradeSettings"]["path"].as_str().unwrap_or("/"),
            "host":stream["httpupgradeSettings"]["host"].as_str().unwrap_or("")})
        }
        _ => return None,
    }
    Some(proxy)
}
/// Render a single authenticated set of client outbounds, skipping unsupported
/// combinations but never inserting insecure direct fallbacks.
pub fn render(outbounds: &[Value], format: FeedFormat) -> Result<Rendered, String> {
    let mut converted = Vec::new();
    let mut skipped = 0;
    for proxy in outbounds {
        let item = match format {
            FeedFormat::Links | FeedFormat::Base64 => alt_link(proxy).map(Value::String),
            FeedFormat::Mihomo => mihomo_proxy(proxy),
            FeedFormat::SingBox => singbox_proxy(proxy),
            FeedFormat::Xray => {
                return Err("Native Xray is rendered by the existing feed engine".into());
            }
        };
        if let Some(item) = item {
            converted.push(item);
        } else {
            skipped += 1;
        }
    }
    if converted.is_empty() {
        return Err(
            "Ни один сервер не поддерживает выбранный формат или транспорт. Выберите Xray JSON."
                .into(),
        );
    }
    // The source list is bounded at 256 by the subscription engine.
    let body = match format {
        FeedFormat::Links | FeedFormat::Base64 => {
            let lines = converted
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join("\n");
            if format == FeedFormat::Base64 {
                base64::engine::general_purpose::STANDARD.encode(lines)
            } else {
                lines
            }
        }
        FeedFormat::Mihomo => {
            // JSON flow values are valid YAML 1.2 scalars/mappings, and avoid
            // malicious host remarks injecting YAML directives or extra rules.
            let mut names = Vec::new();
            let mut proxies = String::new();
            for (i, p) in converted.iter_mut().enumerate() {
                let unique = format!("{} #{}", p["name"].as_str().unwrap_or("Server"), i + 1);
                p["name"] = json!(unique);
                names.push(unique);
                proxies.push_str("  - ");
                proxies
                    .push_str(&serde_json::to_string(p).map_err(|_| "Ошибка сериализации YAML")?);
                proxies.push('\n');
            }
            let select = json!({"name":"PROXY","type":"select","proxies":names});
            format!(
                "mixed-port: 7890\nallow-lan: false\nmode: rule\nlog-level: warning\nproxies:\n{proxies}proxy-groups:\n  - {}\nrules:\n  - 'MATCH,PROXY'\n",
                serde_json::to_string(&select).map_err(|_| "Ошибка сериализации YAML")?
            )
        }
        FeedFormat::SingBox => {
            let mut tags = Vec::new();
            for (i, p) in converted.iter_mut().enumerate() {
                let unique = format!("{} #{}", p["tag"].as_str().unwrap_or("Server"), i + 1);
                p["tag"] = json!(unique);
                tags.push(unique);
            }
            let mut outbounds = converted;
            outbounds
                .push(json!({"type":"selector","tag":"select","outbounds":tags,"default":tags[0]}));
            let document = json!({
                "log":{"level":"warn"},
                "inbounds":[{"type":"mixed","tag":"mixed-in","listen":"127.0.0.1","listen_port":2080}],
                "outbounds":outbounds,
                "route":{"final":"select"}
            });
            serde_json::to_string(&document).map_err(|_| "Ошибка сериализации sing-box JSON")?
        }
        FeedFormat::Xray => unreachable!(),
    };
    Ok(Rendered { body, skipped })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn vless(net: &str, secure: &str) -> Value {
        let mut stream = json!({"network":net,"security":secure,
            "tlsSettings":{"serverName":"host.example.org"},
            "realitySettings":{"serverName":"example.org","password":"public-key","shortId":"abcd","fingerprint":"chrome"},
            "wsSettings":{"path":"/ws","headers":{"Host":"cdn.example.org"}},
            "xhttpSettings":{"path":"/x","host":"edge.example.org","mode":"auto"}});
        if net == "grpc" {
            stream["grpcSettings"] = json!({"serviceName":"proxy"});
        }
        json!({"protocol":"vless","tag":"PL Test",
            "settings":{"vnext":[{"address":"example.com","port":443,"users":[{"id":"bf000d23-0752-40b4-affe-68f7707a9661","encryption":"none"}]}]},
            "streamSettings":stream})
    }
    #[test]
    fn vless_reality_links_keep_credentials_and_encoding() {
        let link = render(&[vless("xhttp", "reality")], FeedFormat::Links)
            .unwrap()
            .body;
        assert!(link.starts_with("vless://bf000d23-0752-40b4-affe-68f7707a9661@example.com:443?"));
        assert!(link.contains("security=reality"));
        assert!(link.contains("pbk=public-key"));
        assert!(link.contains("type=xhttp"));
        assert!(link.ends_with("#PL%20Test"));
        let encoded = render(&[vless("xhttp", "reality")], FeedFormat::Base64)
            .unwrap()
            .body;
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .unwrap(),
            link.as_bytes()
        );
    }
    #[test]
    fn mihomo_and_singbox_never_silently_convert_unsupported_xhttp() {
        let proxy = vless("xhttp", "reality");
        assert!(
            render(&[proxy.clone()], FeedFormat::Mihomo)
                .unwrap()
                .body
                .contains("reality-opts")
        );
        assert!(render(&[proxy], FeedFormat::SingBox).is_err());
        let sb = render(&[vless("ws", "tls")], FeedFormat::SingBox).unwrap();
        let doc: Value = serde_json::from_str(&sb.body).unwrap();
        assert_eq!(doc["outbounds"][0]["transport"]["type"], "ws");
    }
    #[test]
    fn classic_proxy_protocols_export_without_server_secrets() {
        let mut trojan = json!({"protocol":"trojan","tag":"Trojan",
            "settings":{"address":"edge.example.org","port":443,"password":"user-password"},
            "streamSettings":{"network":"tcp","security":"tls","tlsSettings":{"serverName":"edge.example.org"}}});
        let links = render(&[trojan.clone()], FeedFormat::Links).unwrap().body;
        assert!(links.starts_with("trojan://user-password@edge.example.org:443?"));
        assert!(
            render(&[trojan.clone()], FeedFormat::Mihomo)
                .unwrap()
                .body
                .contains(r#""type":"trojan""#)
        );
        assert!(
            render(&[trojan.clone()], FeedFormat::SingBox)
                .unwrap()
                .body
                .contains(r#""type":"trojan""#)
        );
        trojan["settings"]["password"] = json!("");
        assert!(render(&[trojan], FeedFormat::Links).is_err());

        let ss = json!({"protocol":"shadowsocks","tag":"SS",
            "settings":{"address":"ss.example.org","port":8388,
                "method":"aes-256-gcm","password":"user-pass"},
            "streamSettings":{"network":"raw","security":"none"}});
        assert!(
            render(&[ss.clone()], FeedFormat::Links)
                .unwrap()
                .body
                .starts_with("ss://")
        );
        assert!(
            render(&[ss.clone()], FeedFormat::Mihomo)
                .unwrap()
                .body
                .contains(r#""type":"ss""#)
        );
        assert!(
            render(&[ss], FeedFormat::SingBox)
                .unwrap()
                .body
                .contains(r#""type":"shadowsocks""#)
        );

        let vmess = json!({"protocol":"vmess","tag":"VMess",
            "settings":{"address":"vm.example.org","port":443,
                "id":"bf000d23-0752-40b4-affe-68f7707a9661","security":"auto"},
            "streamSettings":{"network":"ws","security":"tls",
                "tlsSettings":{"serverName":"vm.example.org"},
                "wsSettings":{"path":"/ray","headers":{"Host":"vm.example.org"}}}});
        assert!(
            render(&[vmess.clone()], FeedFormat::Links)
                .unwrap()
                .body
                .starts_with("vmess://")
        );
        assert!(
            render(&[vmess.clone()], FeedFormat::Mihomo)
                .unwrap()
                .body
                .contains(r#""type":"vmess""#)
        );
        assert!(
            render(&[vmess], FeedFormat::SingBox)
                .unwrap()
                .body
                .contains(r#""type":"vmess""#)
        );
    }
    #[test]
    fn partial_export_reports_skipped_and_never_returns_direct_only() {
        let mut invalid = vless("xhttp", "tls");
        invalid["settings"]["vnext"][0]["users"][0]["encryption"] =
            json!("mlkem768x25519plus.example");
        let result = render(&[vless("tcp", "tls"), invalid], FeedFormat::SingBox).unwrap();
        assert_eq!(result.skipped, 1);
        assert!(result.body.contains(r#""type":"selector""#));
        assert!(!result.body.contains(r#""tag":"direct""#));
    }
    #[test]
    fn never_export_unencrypted_or_unsupported_vless() {
        let mut proxy = vless("tcp", "tls");
        proxy["settings"]["vnext"][0]["users"][0]["encryption"] =
            json!("mlkem768x25519plus.secret");
        assert!(render(&[proxy], FeedFormat::Links).is_err());
        let mut proxy = vless("tcp", "tls");
        proxy["streamSettings"]["security"] = json!("none");
        assert!(render(&[proxy], FeedFormat::Mihomo).is_err());
    }
    #[test]
    fn xhttp_advanced_settings_are_preserved_in_links() {
        let mut proxy = vless("xhttp", "reality");
        proxy["streamSettings"]["xhttpSettings"]["xPaddingBytes"] = json!("100-1000");
        let url = render(&[proxy.clone()], FeedFormat::Links).unwrap().body;
        assert!(url.contains("extra=%7B"));
        assert!(url.contains("xPaddingBytes"));
        let yaml = render(&[proxy], FeedFormat::Mihomo).unwrap().body;
        assert!(yaml.contains("x-padding-bytes"));
    }
    #[test]
    fn yaml_uses_quoted_flow_nodes_to_prevent_name_injection() {
        let mut proxy = vless("tcp", "tls");
        proxy["tag"] = json!("Test\"\nrules:\n- MATCH,DIRECT");
        let y = render(&[proxy], FeedFormat::Mihomo).unwrap().body;
        assert!(y.contains("\\n"));
        assert_eq!(y.matches("\nrules:\n").count(), 1);
    }
}
