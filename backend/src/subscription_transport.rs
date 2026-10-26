//! Client-side Xray stream settings. Never serialize an inbound streamSettings verbatim.
//! Source of truth: <https://xtls.github.io/en/config/transport.html>
//! XHTTP fields: `Xray-core` `infra/conf/transport_method.go` (`SplitHTTPConfig`).
use serde_json::{Value, json};

fn field<'a>(obj: &'a Value, key: &str) -> Option<&'a str> {
    obj.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}
fn allowed(value: &Value) -> bool {
    value.is_string()
        || value.is_number()
        || value.is_boolean()
        || value.is_array()
        || value.is_object()
}
fn pick(obj: &Value, keys: &[&str]) -> Value {
    let mut result = json!({});
    for key in keys {
        if let Some(v) = obj.get(*key).filter(|v| allowed(v) && !v.is_null()) {
            result[*key] = v.clone();
        }
    }
    result
}
fn merge_allowed(target: &mut Value, extra: &Value, keys: &[&str]) {
    for key in keys {
        if let Some(v) = extra.get(*key).filter(|v| allowed(v) && !v.is_null()) {
            target[*key] = v.clone();
        }
    }
}
// Only documented client-applicable XHTTP fields. Server-only limits:
// scMaxBufferedPosts, scStreamUpServerSecs, serverMaxHeaderBytes.
// downloadSettings is client-only but must be explicitly configured as client
// metadata, not inherited from the inbound.
const XHTTP_FIELDS: &[&str] = &[
    "path",
    "host",
    "mode",
    "headers",
    "xPaddingBytes",
    "xPaddingObfsMode",
    "xPaddingKey",
    "xPaddingHeader",
    "xPaddingPlacement",
    "xPaddingMethod",
    "uplinkHTTPMethod",
    "sessionIDPlacement",
    "sessionIDKey",
    "sessionIDTable",
    "sessionIDLength",
    "seqPlacement",
    "seqKey",
    "uplinkDataPlacement",
    "uplinkDataKey",
    "uplinkChunkSize",
    "noGRPCHeader",
    "noSSEHeader",
    "scMaxEachPostBytes",
    "scMinPostsIntervalMs",
    "xmux",
];
const XHTTP_DEVICE_FIELDS: &[&str] = &[
    "mode",
    "headers",
    "xPaddingBytes",
    "uplinkHTTPMethod",
    "uplinkDataPlacement",
    "uplinkDataKey",
    "uplinkChunkSize",
    "scMaxEachPostBytes",
    "scMinPostsIntervalMs",
    "xmux",
];
const WS_FIELDS: &[&str] = &["path", "host", "heartbeatPeriod"];
const GRPC_FIELDS: &[&str] = &[
    "serviceName",
    "authority",
    "multiMode",
    "user_agent",
    "idle_timeout",
    "health_check_timeout",
    "permit_without_stream",
    "initial_windows_size",
];
const HTTPUPGRADE_FIELDS: &[&str] = &["path", "host"];
const RAW_FIELDS: &[&str] = &["header"];
const HYSTERIA_FIELDS: &[&str] = &["version", "udpIdleTimeout"];
const MASQUE_FIELDS: &[&str] = &["path"];
const KCP_FIELDS: &[&str] = &[
    "mtu",
    "tti",
    "uplinkCapacity",
    "downlinkCapacity",
    "cwndMultiplier",
    "maxSendingWindow",
    "header",
    "seed",
];

fn object_or_json(value: &Value) -> Option<Value> {
    if value.is_object() {
        return Some(value.clone());
    }
    value
        .as_str()
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .filter(Value::is_object)
}
fn effective_xhttp(config: &Value) -> Value {
    // Xray's SplitHTTPConfig.Build: extra replaces the settings body;
    // top-level host/path/mode are reapplied on top of the extra object.
    let Some(extra) = config.get("extra").and_then(object_or_json) else {
        return config.clone();
    };
    let mut effective = extra;
    for key in ["host", "path", "mode"] {
        effective[key] = config
            .get(key)
            .filter(|v| v.is_string())
            .cloned()
            .unwrap_or_else(|| json!(""));
    }
    effective
}
fn device_xhttp<'a>(inbound: &'a Value, device: &str) -> Option<&'a Value> {
    let name = match device {
        "ios" => "iOS",
        "windows" => "Windows",
        _ => return None,
    };
    inbound
        .get("xmesh")
        .and_then(|v| v.get("xhttpDeviceProfiles"))
        .or_else(|| inbound.get("xhttpDeviceProfiles"))
        .and_then(|v| v.get(name))
}
fn client_metadata<'a>(inbound: &'a Value, host: &'a Value, key: &str) -> Option<&'a Value> {
    host.get(key)
        .or_else(|| inbound.get("xmesh").and_then(|v| v.get(key)))
}
fn client_transport(
    stream: &Value,
    inbound: &Value,
    host: &Value,
    device: &str,
    network: &str,
) -> Value {
    let (settings_key, fields) = match network {
        "xhttp" => ("xhttpSettings", XHTTP_FIELDS),
        "ws" | "websocket" => ("wsSettings", WS_FIELDS),
        "grpc" => ("grpcSettings", GRPC_FIELDS),
        "httpupgrade" => ("httpupgradeSettings", HTTPUPGRADE_FIELDS),
        "raw" | "tcp" => ("rawSettings", RAW_FIELDS),
        "mkcp" | "kcp" => ("kcpSettings", KCP_FIELDS),
        "hysteria" => ("hysteriaSettings", HYSTERIA_FIELDS),
        "masque" => ("masqueSettings", MASQUE_FIELDS),
        _ => return json!({}),
    };
    let mut config = stream
        .get(settings_key)
        .cloned()
        .unwrap_or_else(|| json!({}));
    if network == "tcp" && config.as_object().is_some_and(serde_json::Map::is_empty) {
        config = stream
            .get("tcpSettings")
            .cloned()
            .unwrap_or_else(|| json!({}));
    }
    if network == "xhttp" {
        config = effective_xhttp(&config);
        // Do not silently pretend newly introduced Xray-core options have
        // been synchronized. Values may be sensitive: log key names only.
        if let Some(object) = config.as_object() {
            for key in object.keys() {
                if !XHTTP_FIELDS.contains(&key.as_str())
                    && ![
                        "scStreamUpServerSecs",
                        "scMaxBufferedPosts",
                        "serverMaxHeaderBytes",
                        "downloadSettings",
                        "extra",
                    ]
                    .contains(&key.as_str())
                {
                    tracing::warn!(xhttp_field=%key,
                        "Xray XHTTP parameter requires an explicit client projection rule");
                }
            }
        }
    }
    let mut transport = pick(&config, fields);
    if network == "xhttp" {
        // These three are structured types, never JSON-encoded strings.
        for key in ["headers", "xmux"] {
            if !transport.get(key).is_some_and(Value::is_object) {
                transport.as_object_mut().unwrap().remove(key);
            }
        }
        if let Some(profile) = device_xhttp(inbound, device) {
            merge_allowed(&mut transport, profile, XHTTP_DEVICE_FIELDS);
        }
        if let Some(client) = client_metadata(inbound, host, "clientXhttpSettings") {
            merge_allowed(&mut transport, client, XHTTP_FIELDS);
            if let Some(download) = client.get("downloadSettings").filter(|v| v.is_object()) {
                transport["downloadSettings"] = download.clone();
            }
        }
    } else if network == "ws" || network == "websocket" || network == "httpupgrade" {
        // HTTP request headers are client-specific. Never inherit arbitrary
        // inbound-only acceptProxyProtocol or other server values.
        if let Some(headers) =
            client_metadata(inbound, host, "clientHeaders").and_then(Value::as_object)
        {
            transport["headers"] = Value::Object(headers.clone());
        }
    }
    if network != "grpc"
        && let Some(path) = field(host, "path")
    {
        transport["path"] = json!(path);
    }
    if let Some(hostname) = field(host, "host").or_else(|| field(host, "externalHost"))
        && ["xhttp", "ws", "websocket", "httpupgrade"].contains(&network)
    {
        transport["host"] = json!(hostname);
    }
    if network == "grpc"
        && let Some(service) = field(host, "serviceName")
    {
        transport["serviceName"] = json!(service);
    }
    if network == "masque" {
        if let Some(extra) = client_metadata(inbound, host, "clientMasqueSettings") {
            merge_allowed(&mut transport, extra, &["host", "headers", "xmux"]);
        }
        if let Some(hostname) = field(host, "host").or_else(|| field(host, "externalHost")) {
            transport["host"] = json!(hostname);
        }
    }
    transport
}

fn client_reality_settings(inbound: &Value, host: &Value, stream: &Value) -> Option<Value> {
    let mut out = json!({});
    let reality = stream.get("realitySettings").unwrap_or(&Value::Null);
    // 'password' is the current client name; 'publicKey' is its old alias.
    let key = field(host, "realityPassword")
        .or_else(|| field(host, "publicKey"))
        .or_else(|| field(host, "realityPublicKey"))
        .or_else(|| field(inbound, "publicKey"))
        .or_else(|| field(reality, "password"))
        .or_else(|| field(reality, "publicKey"))?;
    let sni = field(host, "sni")
        .or_else(|| field(host, "externalSNI"))
        .or_else(|| {
            reality
                .get("serverNames")
                .and_then(Value::as_array)
                .and_then(|a| a.first())
                .and_then(Value::as_str)
        })?;
    let sid = field(host, "shortId")
        .or_else(|| field(host, "externalShortId"))
        .or_else(|| {
            reality
                .get("shortIds")
                .and_then(Value::as_array)
                .and_then(|a| a.first())
                .and_then(Value::as_str)
        })?;
    out["realitySettings"] = json!({
        "serverName":sni,"password":key,"shortId":sid,
        "fingerprint":field(host,"fp").or_else(||field(host,"fingerprint")).unwrap_or("chrome"),
        "spiderX":field(host,"spiderX").unwrap_or("/")
    });
    if let Some(verify) = field(host, "mldsa65Verify")
        .or_else(|| inbound.get("xmesh").and_then(|m| field(m, "mldsa65Verify")))
    {
        out["realitySettings"]["mldsa65Verify"] = json!(verify);
    }
    Some(out["realitySettings"].clone())
}

fn client_tls_settings(inbound: &Value, host: &Value, stream: &Value) -> Option<Value> {
    let server = stream.get("tlsSettings").unwrap_or(&Value::Null);
    let sni = field(host, "sni")
        .or_else(|| field(host, "externalSNI"))
        .or_else(|| field(server, "serverName"))
        .or_else(|| field(host, "address"))?;
    let mut tls = pick(
        server,
        &[
            "alpn",
            "minVersion",
            "maxVersion",
            "cipherSuites",
            "curvePreferences",
        ],
    );
    tls["serverName"] = json!(sni);
    if let Some(override_alpn) = field(host, "alpn") {
        let alpn: Vec<&str> = override_alpn
            .split(',')
            .map(str::trim)
            .filter(|s| {
                !s.is_empty()
                    && s.len() <= 32
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"/.-_".contains(&b))
            })
            .collect();
        if !alpn.is_empty() {
            tls["alpn"] = json!(alpn);
        }
    }
    if let Some(fp) = field(host, "fp").or_else(|| field(host, "fingerprint")) {
        tls["fingerprint"] = json!(fp);
    }
    // Certificate chains, private keys, server ECH keys, OCSP stapling,
    // rejectUnknownSni, and all inbound trust material never leave the server.
    if let Some(client) = client_metadata(inbound, host, "clientTlsSettings") {
        merge_allowed(
            &mut tls,
            client,
            &[
                "verifyPeerCertByName",
                "allowInsecure",
                "alpn",
                "fingerprint",
                "pinnedPeerCertSha256",
                "useSystemCA",
                "disableSystemRoot",
                "enableSessionResumption",
                "echConfigList",
                "echSockopt",
                "minVersion",
                "maxVersion",
                "cipherSuites",
                "curvePreferences",
            ],
        );
    }
    Some(tls)
}

pub fn client_stream(inbound: &Value, host: &Value, device: &str) -> Option<Value> {
    let stream = inbound.get("streamSettings")?;
    let security = field(stream, "security").unwrap_or("none");
    let network = field(stream, "method")
        .or_else(|| field(stream, "network"))
        .unwrap_or("raw");
    if !["none", "tls", "reality"].contains(&security) {
        return None;
    }
    if ![
        "raw",
        "tcp",
        "xhttp",
        "ws",
        "websocket",
        "grpc",
        "httpupgrade",
        "mkcp",
        "kcp",
        "hysteria",
        "masque",
    ]
    .contains(&network)
    {
        return None;
    }
    if network == "masque" && (security != "tls" || field(inbound, "protocol") != Some("masque")) {
        return None;
    }
    if security == "reality" && !["raw", "tcp", "xhttp", "grpc"].contains(&network) {
        return None;
    }
    let mut out = if field(stream, "method").is_some() || ["hysteria", "masque"].contains(&network)
    {
        json!({"security":security,"method":network})
    } else {
        json!({"security":security,"network":network})
    };
    if security == "reality" {
        out["realitySettings"] = client_reality_settings(inbound, host, stream)?;
    } else if security == "tls" {
        out["tlsSettings"] = client_tls_settings(inbound, host, stream)?;
    }
    let transport = client_transport(stream, inbound, host, device, network);
    if !transport.as_object().is_some_and(serde_json::Map::is_empty) {
        let field = match network {
            "raw" | "tcp" => "rawSettings",
            "xhttp" => "xhttpSettings",
            "ws" | "websocket" => "wsSettings",
            "grpc" => "grpcSettings",
            "httpupgrade" => "httpupgradeSettings",
            "mkcp" | "kcp" => "kcpSettings",
            "hysteria" => "hysteriaSettings",
            "masque" => "masqueSettings",
            _ => return None,
        };
        out[field] = transport;
    }
    // The projection verifies each mask against the actual transport, never
    // copies server-only layers, and rejects incomplete client/server chains.
    // A deliberately authored clientFinalmask overrides automatic inheritance.
    let explicit = client_metadata(inbound, host, "clientFinalmask");
    match crate::subscription_finalmask::project(
        network, &out, stream.get("finalmask"), explicit
    ) {
        Ok(Some(mask)) => out["finalmask"] = mask,
        Ok(None) => {}
        Err(reason) => {
            tracing::warn!(network, reason,
                "Unsupported FinalMask client projection: omitting incompatible outbound");
            return None;
        }
    }
    if let Some(sockopt) = client_metadata(inbound, host, "clientSockopt").filter(|v| v.is_object())
    {
        out["sockopt"] = sockopt.clone();
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn xhttp_obfs_and_session_fields_survive_without_server_limits() {
        let inbound = json!({"streamSettings":{"network":"xhttp","security":"none",
            "xhttpSettings":{"path":"/a","mode":"stream-up",
                "xPaddingObfsMode":true,"xPaddingKey":"x-token",
                "xPaddingHeader":"X-Request-Token","xPaddingMethod":"tokenish",
                "xPaddingPlacement":"header","seqPlacement":"query","seqKey":"segment",
                "sessionIDPlacement":"cookie","sessionIDKey":"session_id",
                "sessionIDTable":"Base62","sessionIDLength":"16-48",
                "scStreamUpServerSecs":"30-60","serverMaxHeaderBytes":1000,
                "scMaxBufferedPosts":80}}});
        let stream = client_stream(&inbound, &json!({}), "auto").unwrap();
        let x = &stream["xhttpSettings"];
        assert_eq!(x["xPaddingObfsMode"], true);
        assert_eq!(x["xPaddingMethod"], "tokenish");
        assert_eq!(x["sessionIDLength"], "16-48");
        for field in [
            "scStreamUpServerSecs",
            "serverMaxHeaderBytes",
            "scMaxBufferedPosts",
        ] {
            assert!(x.get(field).is_none(), "{field} is server-only");
        }
    }
    #[test]
    fn xhttp_extra_is_effective_and_device_profile_overrides_only_client_fields() {
        let inbound = json!({"xmesh":{"xhttpDeviceProfiles":{"iOS":{
            "mode":"packet-up","uplinkHTTPMethod":"POST","xmux":{"cMaxReuseTimes":0}}}},
            "streamSettings":{"network":"xhttp","security":"none","xhttpSettings":{
                "path":"/outside","mode":"auto",
                "extra":{"xPaddingObfsMode":true,"xPaddingPlacement":"header",
                    "path":"/inside","mode":"stream-up","scStreamUpServerSecs":"20-30"}}}});
        let ios = client_stream(&inbound, &json!({}), "ios").unwrap();
        assert_eq!(ios["xhttpSettings"]["path"], "/outside");
        assert_eq!(ios["xhttpSettings"]["mode"], "packet-up");
        assert_eq!(ios["xhttpSettings"]["xPaddingObfsMode"], true);
        assert!(ios["xhttpSettings"].get("scStreamUpServerSecs").is_none());
    }
    #[test]
    fn never_leak_server_reality_tls_and_finalmask() {
        let inbound = json!({"streamSettings":{"network":"raw","security":"reality",
            "realitySettings":{"privateKey":"SECRET","target":"secret:443",
                "serverNames":["example.org"],"shortIds":["abcd"],"publicKey":"PUB"},
            "finalmask":{"udp":[{"type":"noise","settings":{"server":"PRIVATE"}}]}}});
        let host = json!({"address":"vpn.example.com"});
        let c = client_stream(&inbound, &host, "auto").unwrap();
        let body = c.to_string();
        assert!(body.contains("\"password\":\"PUB\""));
        assert!(
            !body.contains("SECRET") && !body.contains("secret:443") && !body.contains("PRIVATE")
        );
        assert!(c.get("finalmask").is_none());
    }
    #[test]
    fn hysteria_salamander_finalmask_reaches_client_without_server_only_fields() {
        let inbound = json!({"protocol":"hysteria","streamSettings":{
            "network":"hysteria","security":"tls",
            "tlsSettings":{"serverName":"pl.example.org"},
            "finalmask":{"udp":[
                {"type":"salamander","settings":{"password":"shared-obfs","serverOnly":"do-not-copy"}},
                {"type":"noise","settings":{"server":"private"}}]}}});
        let host = json!({"address":"198.51.100.1"});
        // Mixed layers must never be partially exported: refuse the outbound.
        assert!(client_stream(&inbound, &host, "auto").is_none());
        let explicit = json!({"address":"198.51.100.1","clientFinalmask":{"udp":[
            {"type":"salamander","settings":{"password":"shared-obfs"}}]}});
        assert_eq!(client_stream(&inbound, &explicit, "auto").unwrap()["finalmask"],
            explicit["clientFinalmask"]);
        let mismatched = json!({"address":"198.51.100.1","clientFinalmask":{"udp":[
            {"type":"salamander","settings":{"password":"wrong-password"}}]}});
        assert!(client_stream(&inbound, &mismatched, "auto").is_none());
    }
    #[test]
    fn hysteria_salamander_and_gecko_export_when_symmetric() {
        let inbound = json!({"streamSettings":{"network":"hysteria","security":"tls",
            "tlsSettings":{"serverName":"pl.example.org"},
            "finalmask":{"udp":[{"type":"salamander","settings":{
                "password":"shared","packetSize":"512-1200"}}]}}});
        let client = client_stream(&inbound, &json!({"address":"198.51.100.1"}), "auto").unwrap();
        assert_eq!(client["finalmask"]["udp"][0]["settings"]["password"], "shared");
        assert_eq!(client["finalmask"]["udp"][0]["settings"]["packetSize"], "512-1200");
    }
    #[test]
    fn non_hysteria_does_not_inherit_salamander() {
        let inbound = json!({"streamSettings":{"network":"raw","security":"tls",
            "tlsSettings":{"serverName":"example.org"},
            "finalmask":{"udp":[{"type":"salamander","settings":{"password":"secret"}}]}}});
        assert!(client_stream(&inbound, &json!({"address":"example.org"}), "auto")
            .unwrap().get("finalmask").is_none());
    }
    #[test]
    fn symmetric_sudoku_is_exported_for_tcp_and_udp_transports() {
        for (network, direction) in [("raw", "tcp"), ("xhttp", "tcp"), ("grpc", "tcp"),
            ("hysteria", "udp"), ("masque", "udp"), ("mkcp", "udp")] {
            let mut inbound = json!({"streamSettings":{"network":network,"security":"tls",
                "tlsSettings":{"serverName":"example.org"}}});
            inbound["streamSettings"]["finalmask"][direction] = json!([
                {"type":"sudoku","settings":{"password":"shared","paddingMin":2,"serverOnly":"hidden"}}]);
            let client = client_stream(&inbound, &json!({"address":"example.org"}), "auto").unwrap();
            assert_eq!(client["finalmask"][direction][0]["settings"]["password"], "shared");
            assert!(client["finalmask"][direction][0]["settings"].get("serverOnly").is_none());
        }
    }
    #[test]
    fn unsupported_mask_layer_is_not_partially_exported() {
        let inbound = json!({"streamSettings":{"network":"hysteria","security":"tls",
            "tlsSettings":{"serverName":"example.org"},
            "finalmask":{"udp":[
                {"type":"salamander","settings":{"password":"shared"}},
                {"type":"noise","settings":{"noise":[{"rand":"10-20"}]}}]}}});
        assert!(client_stream(&inbound, &json!({"address":"example.org"}), "auto").is_none());
    }
    #[test]
    fn kcp_seed_and_header_are_shared_but_proxy_protocol_is_server_only() {
        let inbound = json!({"streamSettings":{"network":"mkcp","security":"none",
          "kcpSettings":{"header":{"type":"wechat-video"},"seed":"shared-secret",
           "acceptProxyProtocol":true,"mtu":1350}}});
        let result = client_stream(&inbound, &json!({}), "auto").unwrap();
        assert_eq!(result["kcpSettings"]["seed"], "shared-secret");
        assert_eq!(result["kcpSettings"]["header"]["type"], "wechat-video");
        assert!(result["kcpSettings"].get("acceptProxyProtocol").is_none());
    }
    #[test]
    fn transports_strip_inbound_only_keys() {
        for (method, key) in [
            ("ws", "wsSettings"),
            ("httpupgrade", "httpupgradeSettings"),
            ("raw", "rawSettings"),
            ("grpc", "grpcSettings"),
            ("mkcp", "kcpSettings"),
        ] {
            let mut inbound = json!({"streamSettings":{"network":method,"security":"tls",
                "tlsSettings":{"serverName":"example.org","certificates":[{"key":"SERVER_KEY"}]}}});
            inbound["streamSettings"][key] = json!({"acceptProxyProtocol":true,
                "path":"/example","serviceName":"demo","header":{"type":"none"},"mtu":1350});
            let c = client_stream(&inbound, &json!({"address":"example.org"}), "auto").unwrap();
            assert!(!c.to_string().contains("SERVER_KEY"));
            assert!(!c.to_string().contains("acceptProxyProtocol"));
        }
    }
}
