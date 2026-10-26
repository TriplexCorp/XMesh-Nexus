//! Safe inbound → outbound `FinalMask` projection for Xray JSON subscriptions.
//! Contract: transport compatibility is checked for every layer. Only masks
//! with truly shared wire settings are inherited; directional configurations
//! must be authored explicitly in xmesh.clientFinalmask / host.clientFinalmask.
//! Source: <https://xtls.github.io/en/config/transports/finalmask.html>
use serde_json::{Value, json};

#[derive(Clone, Copy)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "Independent flags model each transport capability without mutating protocol identity"
)]
struct Transport {
    tcp: bool,
    udp: bool,
    quic: bool,
    kcp: bool,
    xhttp_h3: bool,
    hysteria: bool,
}

fn transport(network: &str, client_stream: &Value) -> Transport {
    let alpn = client_stream
        .get("tlsSettings")
        .and_then(|v| v.get("alpn"))
        .and_then(Value::as_array);
    let has_alpn = alpn.is_some_and(|v| !v.is_empty());
    let h3 = alpn.is_some_and(|v| v.iter().any(|s| s.as_str() == Some("h3")));
    let h2 = alpn.is_some_and(|v| v.iter().any(|s| s.as_str() == Some("h2")));
    let is_xhttp = network == "xhttp";
    let is_masque = network == "masque";
    let hysteria = network == "hysteria";
    let kcp = matches!(network, "mkcp" | "kcp");
    let tcp = matches!(
        network,
        "raw" | "tcp" | "ws" | "websocket" | "grpc" | "httpupgrade"
    ) || ((is_xhttp || is_masque) && (!has_alpn || h2));
    let udp = hysteria || kcp || ((is_xhttp || is_masque) && (!has_alpn && is_masque || h3));
    Transport {
        tcp,
        udp,
        quic: hysteria || ((is_xhttp || is_masque) && udp),
        kcp,
        xhttp_h3: is_xhttp && h3,
        hysteria,
    }
}

fn settings(layer: &Value) -> Result<(&str, &Value), &'static str> {
    let kind = layer
        .get("type")
        .and_then(Value::as_str)
        .ok_or("FinalMask layer needs a type")?;
    let config = layer
        .get("settings")
        .ok_or("FinalMask layer needs settings")?;
    if !config.is_object() {
        return Err("FinalMask settings must be an object");
    }
    Ok((kind, config))
}

fn copy_keys(value: &Value, keys: &[&str]) -> Value {
    let mut out = json!({});
    for key in keys {
        if let Some(v) = value.get(*key) {
            out[*key] = v.clone();
        }
    }
    out
}

fn compatible(
    kind: &str,
    direction: &str,
    caps: Transport,
    explicit: bool,
) -> Result<bool, &'static str> {
    if kind == "filter" {
        // Server-only firewall layer; it never belongs in an outbound.
        return if explicit {
            Err("filter is inbound-only")
        } else {
            Ok(false)
        };
    }
    match (direction, kind) {
        ("tcp", "sudoku" | "header-custom")
        | ("udp", "sudoku" | "header-custom" | "mkcp-legacy" | "salamander") => Ok(true),
        ("tcp", "fragment" | "xmc") | ("udp", "noise" | "xicmp" | "realm" | "udphop")
            if explicit =>
        {
            Ok(true)
        }
        ("udp", "xdns") if explicit && caps.kcp => Ok(true),
        ("tcp", "fragment" | "xmc") | ("udp", "noise" | "xdns" | "xicmp" | "realm" | "udphop") => {
            Err("directional FinalMask needs explicit clientFinalmask")
        }
        _ => Err("unsupported FinalMask layer or direction"),
    }
}

#[expect(
    clippy::too_many_lines,
    reason = "The explicit mask-type validation matrix is intentionally exhaustive and fail-closed"
)]
fn validate_layer(
    layer: &Value,
    direction: &str,
    caps: Transport,
    explicit: bool,
) -> Result<Option<Value>, &'static str> {
    let (kind, src) = settings(layer)?;
    if !compatible(kind, direction, caps, explicit)? {
        return Ok(None);
    }
    let safe = match kind {
        "salamander" => {
            let password = src
                .get("password")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
                .ok_or("Salamander requires password")?;
            let mut out = json!({"password":password});
            if let Some(size) = src.get("packetSize") {
                let range = size.as_str().ok_or("invalid Gecko packetSize")?;
                let parse = |v: &str| v.parse::<u16>().ok().filter(|n| *n > 0);
                let values = range
                    .split_once('-')
                    .and_then(|(lo, hi)| Some((parse(lo)?, parse(hi)?)))
                    .or_else(|| parse(range).map(|v| (v, v)))
                    .ok_or("invalid Gecko packetSize")?;
                if values.0 > values.1 || values.1 > 2048 || !caps.quic {
                    return Err("Gecko packetSize requires QUIC and a maximum of 2048");
                }
                out["packetSize"] = size.clone();
            }
            out
        }
        "sudoku" => copy_keys(
            src,
            &[
                "password",
                "ascii",
                "customTable",
                "customTables",
                "paddingMin",
                "paddingMax",
            ],
        ),
        "mkcp-legacy" => {
            let header = src.get("header").and_then(Value::as_str).unwrap_or("");
            if !["", "dns", "dtls", "srtp", "utp", "wechat", "wireguard"].contains(&header) {
                return Err("unknown mkcp-legacy header");
            }
            if src.get("value").is_some_and(|v| !v.is_string()) {
                return Err("mkcp-legacy value must be a string");
            }
            copy_keys(src, &["header", "value"])
        }
        "header-custom" => {
            let keys: &[&str] = if direction == "tcp" {
                &["clients", "servers"]
            } else {
                &["client", "server"]
            };
            if !keys.iter().any(|k| src.get(*k).is_some()) {
                return Err("header-custom requires directional sequences");
            }
            for key in keys {
                if src.get(*key).is_some_and(|v| !v.is_array()) {
                    return Err("header-custom sequences must be arrays");
                }
            }
            // Inbound 'errors' is intentionally not disclosed to subscribers.
            copy_keys(src, keys)
        }
        "xdns" => {
            if !caps.kcp {
                return Err("xdns requires mKCP, not QUIC");
            }
            if src
                .get("domains")
                .and_then(Value::as_array)
                .is_none_or(Vec::is_empty)
            {
                return Err("xdns requires a non-empty domains array");
            }
            src.clone()
        }
        "udphop" => {
            let mode = src.get("mode").and_then(Value::as_str).unwrap_or("");
            if mode.trim().is_empty() {
                return Err("udphop requires an explicit mode");
            }
            if mode.split(',').any(|m| {
                let m = m.trim();
                !m.is_empty() && !["intervallocal", "intervalremote", "perconnremote"].contains(&m)
            }) {
                return Err("unknown UDP hop mode");
            }
            if mode.split(',').any(|m| m.trim() == "intervallocal")
                && !caps.hysteria
                && !caps.xhttp_h3
            {
                return Err("intervallocal UDP hop supports Hysteria or XHTTP H3 only");
            }
            src.clone()
        }
        "fragment" => {
            if src
                .get("packets")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
                || !src.get("lengths").is_some_and(Value::is_array)
                || !src.get("delays").is_some_and(Value::is_array)
            {
                return Err("fragment needs packets, lengths and delays");
            }
            src.clone()
        }
        "xmc" => {
            if src
                .get("password")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
            {
                return Err("xmc needs an explicit password and compatible Xray version");
            }
            src.clone()
        }
        "noise" => {
            if src
                .get("noise")
                .and_then(Value::as_array)
                .is_none_or(Vec::is_empty)
            {
                return Err("UDP noise requires a non-empty noise array");
            }
            src.clone()
        }
        "xicmp" => {
            if src.get("dgram").is_some_and(|v| !v.is_boolean())
                || src.get("ips").is_some_and(|v| !v.is_array())
            {
                return Err("xicmp dgram must be boolean and ips an array");
            }
            src.clone()
        }
        "realm" => {
            if !src
                .get("url")
                .and_then(Value::as_str)
                .is_some_and(|v| v.starts_with("realm://") || v.starts_with("realm+http://"))
            {
                return Err("realm needs realm:// or realm+http:// URL");
            }
            src.clone()
        }
        _ => return Err("unsupported FinalMask layer"),
    };
    Ok(Some(json!({"type":kind,"settings":safe})))
}

const QUIC_CLIENT_KEYS: &[&str] = &[
    "congestion",
    "bbrProfile",
    "debug",
    "brutalUp",
    "brutalDown",
    "udpHop",
    "initStreamReceiveWindow",
    "maxStreamReceiveWindow",
    "initConnectionReceiveWindow",
    "maxConnectionReceiveWindow",
    "maxIdleTimeout",
    "keepAlivePeriod",
    "disablePathMTUDiscovery",
];

fn validate_quic_params(value: &Value) -> Result<Value, &'static str> {
    let obj = value.as_object().ok_or("quicParams must be an object")?;
    for key in obj.keys() {
        if !QUIC_CLIENT_KEYS.contains(&key.as_str()) {
            return Err("unsupported or server-only QUIC parameter");
        }
    }
    if let Some(mode) = value.get("congestion")
        && !["reno", "bbr", "brutal", "force-brutal"]
            .contains(&mode.as_str().ok_or("congestion must be a string")?)
    {
        return Err("unknown QUIC congestion control");
    }
    for name in ["debug", "disablePathMTUDiscovery"] {
        if value.get(name).is_some_and(|v| !v.is_boolean()) {
            return Err("QUIC flag must be boolean");
        }
    }
    if value.get("bbrProfile").is_some_and(|v| !v.is_string()) {
        return Err("bbrProfile must be a string");
    }
    for name in ["brutalUp", "brutalDown"] {
        if value
            .get(name)
            .is_some_and(|v| !v.is_string() && !v.is_number())
        {
            return Err("QUIC bandwidth must be a number or string");
        }
    }
    for name in [
        "initStreamReceiveWindow",
        "maxStreamReceiveWindow",
        "initConnectionReceiveWindow",
        "maxConnectionReceiveWindow",
    ] {
        if value
            .get(name)
            .is_some_and(|v| v.as_u64().is_none_or(|n| n == 0))
        {
            return Err("QUIC receive window must be positive");
        }
    }
    if value
        .get("maxIdleTimeout")
        .is_some_and(|v| v.as_u64().is_none_or(|n| !(4..=120).contains(&n)))
    {
        return Err("QUIC maxIdleTimeout must be in 4-120 seconds");
    }
    if value
        .get("keepAlivePeriod")
        .is_some_and(|v| v.as_u64().is_none_or(|n| n != 0 && !(2..=60).contains(&n)))
    {
        return Err("QUIC keepAlivePeriod must be 0 or 2-60 seconds");
    }
    if let Some(hop) = value.get("udpHop") {
        if !hop.is_object() {
            return Err("quicParams.udpHop must be an object");
        }
        if hop
            .get("ports")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            return Err("quicParams.udpHop requires ports");
        }
        if hop
            .get("interval")
            .is_some_and(|v| v.as_u64().is_none_or(|n| n < 5))
        {
            return Err("quicParams.udpHop interval must be >= 5 seconds");
        }
    }
    Ok(value.clone())
}

/// Returns None when no client mask is required, or an error when emitting an
/// incomplete/mismatched mask would break the connection.
pub fn project(
    network: &str,
    outbound_stream: &Value,
    server_finalmask: Option<&Value>,
    explicit_client_finalmask: Option<&Value>,
) -> Result<Option<Value>, &'static str> {
    let caps = transport(network, outbound_stream);
    let explicit = explicit_client_finalmask.is_some();
    let Some(source) = explicit_client_finalmask.or(server_finalmask) else {
        return Ok(None);
    };
    let obj = source.as_object().ok_or("finalmask must be an object")?;
    for key in obj.keys() {
        if !["tcp", "udp", "quicParams"].contains(&key.as_str()) {
            return Err("unsupported FinalMask top-level field");
        }
    }
    let mut out = json!({});
    for (direction, allowed) in [("tcp", caps.tcp), ("udp", caps.udp)] {
        let Some(value) = source.get(direction) else {
            continue;
        };
        if !allowed {
            if explicit {
                return Err("FinalMask direction incompatible with transport");
            }
            continue;
        }
        let entries = value
            .as_array()
            .ok_or("FinalMask layers must be an array")?;
        if entries.len() > 16 {
            return Err("too many FinalMask layers");
        }
        let mut layers = Vec::new();
        for layer in entries {
            if let Some(projected) = validate_layer(layer, direction, caps, explicit)? {
                layers.push(projected);
            }
        }
        if !layers.is_empty() {
            out[direction] = json!(layers);
        }
    }
    // A client override must not silently drop or change reversible layers
    // required by the server (e.g. Salamander password). Directional additions
    // are allowed, but the ordered shared subset must match the server wire
    // configuration. Without this check an explicit noise-only mask would
    // produce a plausible-looking, permanently broken subscription.
    if explicit && let Some(server) = server_finalmask {
        for (direction, allowed) in [("tcp", caps.tcp), ("udp", caps.udp)] {
            if !allowed {
                continue;
            }
            let Some(server_layers) = server.get(direction).and_then(Value::as_array) else {
                continue;
            };
            let mut required = Vec::new();
            for layer in server_layers {
                let Some(kind) = layer.get("type").and_then(Value::as_str) else {
                    return Err("invalid server FinalMask layer");
                };
                // These are deliberately directional or inbound-only,
                // not symmetric encoding requirements for subscribers.
                if [
                    "filter", "fragment", "xmc", "noise", "xdns", "xicmp", "realm", "udphop",
                ]
                .contains(&kind)
                {
                    continue;
                }
                if let Some(shared) = validate_layer(layer, direction, caps, false)? {
                    required.push(shared);
                }
            }
            if required.is_empty() {
                continue;
            }
            let mut supplied = Vec::new();
            if let Some(client_layers) = out.get(direction).and_then(Value::as_array) {
                for layer in client_layers {
                    if layer
                        .get("type")
                        .and_then(Value::as_str)
                        .is_some_and(|kind| {
                            ["salamander", "sudoku", "mkcp-legacy", "header-custom"].contains(&kind)
                        })
                    {
                        supplied.push(layer.clone());
                    }
                }
            }
            if supplied != required {
                return Err("clientFinalmask must preserve server shared mask layers");
            }
        }
    }
    // QUIC parameters are per-endpoint and must never be inferred from
    // the server: congestion caps, receive windows, hop ports differ.
    if explicit && let Some(quic) = source.get("quicParams") {
        if !caps.quic {
            return Err("QUIC params require a QUIC transport");
        }
        out["quicParams"] = validate_quic_params(quic)?;
    }
    if out.as_object().is_some_and(|fields| !fields.is_empty()) {
        Ok(Some(out))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn outbound(network: &str, alpn: &[&str]) -> Value {
        json!({"method":network,"security":"tls","tlsSettings":{"alpn":alpn}})
    }
    fn layer(kind: &str, settings: &Value) -> Value {
        json!({"type":kind,"settings":settings})
    }
    #[test]
    fn shared_masks_cover_all_compatible_transports() {
        for network in ["raw", "tcp", "xhttp", "ws", "grpc", "httpupgrade"] {
            let server = json!({"tcp":[layer("sudoku",&json!({"password":"key","serverOnly":"secret"})),
                layer("header-custom",&json!({"clients":[],"servers":[[]],
                    "errors":[[{"packet":"confidential"}]]}))]});
            let client = project(network, &outbound(network, &[]), Some(&server), None)
                .unwrap()
                .unwrap();
            assert_eq!(client["tcp"][0]["settings"]["password"], "key");
            assert!(client.to_string().contains("servers"));
            assert!(!client.to_string().contains("confidential"));
            assert!(!client.to_string().contains("serverOnly"));
        }
        for network in ["hysteria", "mkcp", "masque"] {
            let server = json!({"udp":[layer("salamander",&json!({"password":"secret"})),
                layer("mkcp-legacy",&json!({"header":"dtls"})),
                layer("header-custom",&json!({"client":[],"server":[]}))]});
            let client = project(network, &outbound(network, &[]), Some(&server), None)
                .unwrap()
                .unwrap();
            assert_eq!(client["udp"].as_array().unwrap().len(), 3);
        }
    }
    #[test]
    fn directional_only_layers_need_explicit_client_config() {
        for (network, direction, kind) in [
            ("raw", "tcp", "fragment"),
            ("raw", "tcp", "xmc"),
            ("hysteria", "udp", "noise"),
            ("mkcp", "udp", "xdns"),
            ("hysteria", "udp", "xicmp"),
            ("hysteria", "udp", "realm"),
            ("hysteria", "udp", "udphop"),
        ] {
            let settings = match kind {
                "fragment" => json!({"packets":"tlshello","lengths":["10-20"],"delays":["1-2"]}),
                "xmc" => json!({"password":"minecraft-secret"}),
                "noise" => json!({"noise":[{"rand":"10-20"}]}),
                "xdns" => json!({"domains":[{"names":["t.example.org"]}]}),
                "realm" => json!({"url":"realm://token@example.org/name"}),
                "udphop" => json!({"mode":"intervalremote","remotePorts":"20000-20010"}),
                _ => json!({}),
            };
            let mut server = json!({});
            server[direction] = json!([layer(kind, &settings)]);
            assert!(project(network, &outbound(network, &[]), Some(&server), None).is_err());
            assert!(project(network, &outbound(network, &[]), None, Some(&server)).is_ok());
        }
    }
    #[test]
    fn tcp_udp_and_h3_are_not_interchangeable() {
        let udp = json!({"udp":[layer("salamander",&json!({"password":"secret"}))]});
        assert!(project("raw", &outbound("raw", &[]), None, Some(&udp)).is_err());
        assert!(
            project("xhttp", &outbound("xhttp", &["h3"]), Some(&udp), None)
                .unwrap()
                .is_some()
        );
        assert!(
            project("xhttp", &outbound("xhttp", &["h2"]), Some(&udp), None)
                .unwrap()
                .is_none()
        );
        assert!(
            project("masque", &outbound("masque", &["h3"]), Some(&udp), None)
                .unwrap()
                .is_some()
        );
        assert!(
            project(
                "hysteria",
                &outbound("hysteria", &["h3"]),
                None,
                Some(&json!({"tcp":[layer("sudoku",&json!({}))]}))
            )
            .is_err()
        );
    }
    #[test]
    fn server_filter_does_not_leak_or_break_wire_layers() {
        let source = json!({"tcp":[layer("sudoku",&json!({"password":"p"})),
            layer("filter",&json!({"allowedSourceIPs":["10.0.0.0/8"]}))]});
        let result = project("raw", &outbound("raw", &[]), Some(&source), None)
            .unwrap()
            .unwrap();
        assert_eq!(result["tcp"].as_array().unwrap().len(), 1);
        assert!(!result.to_string().contains("allowedSourceIPs"));
        assert!(project("raw", &outbound("raw", &[]), None, Some(&source)).is_err());
    }
    #[test]
    fn quic_params_are_client_specific() {
        let config = json!({"quicParams":{"congestion":"bbr","maxIdleTimeout":30}});
        assert!(
            project(
                "hysteria",
                &outbound("hysteria", &["h3"]),
                Some(&config),
                None
            )
            .unwrap()
            .is_none()
        );
        assert_eq!(
            project(
                "hysteria",
                &outbound("hysteria", &["h3"]),
                None,
                Some(&config)
            )
            .unwrap()
            .unwrap()["quicParams"],
            config["quicParams"]
        );
        assert!(project("raw", &outbound("raw", &[]), None, Some(&config)).is_err());
        assert!(
            project(
                "hysteria",
                &outbound("hysteria", &["h3"]),
                None,
                Some(&json!({"quicParams":{"maxIncomingStreams":1024}}))
            )
            .is_err()
        );
    }
    #[test]
    fn explicit_client_masks_must_preserve_server_symmetric_wire_layers() {
        let server = json!({"udp":[layer("salamander",&json!({"password":"server-secret"})),
            layer("filter",&json!({"blockedSourceIPs":["10.0.0.0/8"]}))]});
        let client = json!({"udp":[layer("noise",&json!({"noise":[{"rand":"10-20"}]}))]});
        assert!(
            project(
                "hysteria",
                &outbound("hysteria", &["h3"]),
                Some(&server),
                Some(&client)
            )
            .is_err()
        );
        let wrong = json!({"udp":[layer("salamander",&json!({"password":"wrong"}))]});
        assert!(
            project(
                "hysteria",
                &outbound("hysteria", &["h3"]),
                Some(&server),
                Some(&wrong)
            )
            .is_err()
        );
        let correct = json!({"udp":[layer("salamander",&json!({"password":"server-secret"})),
            layer("noise",&json!({"noise":[{"rand":"10-20"}]}))]});
        let result = project(
            "hysteria",
            &outbound("hysteria", &["h3"]),
            Some(&server),
            Some(&correct),
        )
        .unwrap()
        .unwrap();
        assert_eq!(result["udp"].as_array().unwrap().len(), 2);
    }
    #[test]
    fn xdns_only_kcp_and_gecko_only_quic() {
        let xdns = json!({"udp":[layer("xdns",&json!({"domains":[{"names":["t.example.org"]}]}))]});
        assert!(project("mkcp", &outbound("mkcp", &[]), None, Some(&xdns)).is_ok());
        assert!(
            project(
                "hysteria",
                &outbound("hysteria", &["h3"]),
                None,
                Some(&xdns)
            )
            .is_err()
        );
        let gecko = json!({"udp":[layer("salamander",&json!({
            "password":"shared","packetSize":"512-1200"}))]});
        assert!(
            project(
                "hysteria",
                &outbound("hysteria", &["h3"]),
                Some(&gecko),
                None
            )
            .unwrap()
            .is_some()
        );
        assert!(project("mkcp", &outbound("mkcp", &[]), Some(&gecko), None).is_err());
    }
}
