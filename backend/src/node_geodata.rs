//! Per-node `GeoData` policy. Only source metadata enters the signed node policy;
//! the node downloads assets itself and validates the complete Xray configuration.
use crate::ApiError;
use axum::http::StatusCode;
use serde_json::{Value, json};
use std::collections::HashSet;

fn invalid(message: &str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, message)
}

fn source_url(url: &str) -> Result<String, ApiError> {
    if url.len() > 1024 || url.trim() != url {
        return Err(invalid("GeoData: URL is too long or contains whitespace."));
    }
    let parsed = reqwest::Url::parse(url).map_err(|_| invalid("GeoData: invalid source URL."))?;
    if parsed.scheme() != "https"
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.fragment().is_some()
        || parsed.port_or_known_default() != Some(443)
        || parsed.host_str().is_none()
    {
        return Err(invalid(
            "GeoData requires an HTTPS URL on port 443 without credentials or fragments.",
        ));
    }
    let host = parsed.host_str().unwrap();
    if host.parse::<std::net::IpAddr>().is_ok()
        || host.eq_ignore_ascii_case("localhost")
        || std::path::Path::new(host)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("local"))
        || host.ends_with(".internal")
        || !host.contains('.')
    {
        return Err(invalid("GeoData URLs must use public DNS hostnames."));
    }
    Ok(url.to_owned())
}

fn source(name: &str, url: &str, checksum: Option<&str>) -> Result<Value, ApiError> {
    let bare = name
        .strip_suffix(".dat")
        .ok_or_else(|| invalid("GeoData filenames must end with .dat"))?;
    if bare.is_empty()
        || bare.len() > 48
        || !bare
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        return Err(invalid(
            "GeoData filenames may contain only letters, digits, - and _.",
        ));
    }
    let sha = match checksum {
        Some(s) if s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()) => {
            Some(s.to_ascii_lowercase())
        }
        Some(_) => {
            return Err(invalid(
                "GeoData SHA-256 must contain 64 hexadecimal characters.",
            ));
        }
        None => None,
    };
    Ok(json!({"name":name,"url":source_url(url)?,"sha256":sha}))
}

/// Validate and inject node-level routes before the first user profile catch-all.
/// Returns the asset manifest that is included in the signed offline policy.
pub fn apply(node: &Value, config: &mut Value) -> Result<Option<Value>, ApiError> {
    if node.get("geoEnabled").and_then(Value::as_bool) != Some(true) {
        return Ok(None);
    }
    let hours = node
        .get("geoUpdateHours")
        .and_then(Value::as_u64)
        .unwrap_or(24);
    if !(6..=168).contains(&hours) {
        return Err(invalid(
            "GeoData update interval must be between 6 and 168 hours.",
        ));
    }
    let site = node
        .get("geoSiteUrl")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(
            "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat",
        );
    let ip = node
        .get("geoIpUrl")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(
            "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat",
        );
    let mut sources = vec![
        source("geosite.dat", site, None)?,
        source("geoip.dat", ip, None)?,
    ];
    let mut filenames = HashSet::from(["geosite.dat".to_owned(), "geoip.dat".to_owned()]);
    for line in node
        .get("geoExtraSources")
        .and_then(Value::as_str)
        .unwrap_or("")
        .lines()
    {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let parts: Vec<_> = line.split_whitespace().collect();
        if !(2..=3).contains(&parts.len()) {
            return Err(invalid(
                "GeoData: custom sources must be 'filename.dat https://url [sha256]'.",
            ));
        }
        let name = parts[0];
        if !filenames.insert(name.to_owned()) {
            return Err(invalid("GeoData: duplicate filename."));
        }
        if sources.len() >= 10 {
            return Err(invalid("GeoData: at most 10 files per node."));
        }
        sources.push(source(name, parts[1], parts.get(2).copied())?);
    }
    let mut rules = Vec::<Value>::new();
    if node.get("geoBlockAds").and_then(Value::as_bool) == Some(true) {
        rules.push(json!({"type":"field","domain":["geosite:category-ads-all"],"outboundTag":"xmesh_geo_block"}));
    }
    let outbounds = config
        .get_mut("outbounds")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| invalid("GeoData: Xray profile needs an outbounds array."))?;
    if outbounds
        .iter()
        .any(|o| o.get("tag").and_then(Value::as_str) == Some("xmesh_geo_block"))
    {
        return Err(invalid(
            "GeoData: reserved outbound tag xmesh_geo_block already exists.",
        ));
    }
    let direct_available = outbounds.iter().any(|o| {
        o.get("tag").and_then(Value::as_str) == Some("direct")
            && o.get("protocol").and_then(Value::as_str) == Some("freedom")
    });
    let mut custom_count = 0;
    for line in node
        .get("geoCustomRules")
        .and_then(Value::as_str)
        .unwrap_or("")
        .lines()
    {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        custom_count += 1;
        if custom_count > 64 {
            return Err(invalid("GeoData: maximum 64 custom routing rules."));
        }
        let (matcher, action) = line.split_once("=>").ok_or_else(|| {
            invalid("GeoData rules must use 'geosite:name => block' or 'geoip:code => direct'.")
        })?;
        let matcher = matcher.trim();
        let action = action.trim().to_ascii_lowercase();
        if matcher.len() > 128
            || matcher.is_empty()
            || !matcher
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'-' | b'_' | b'.'))
        {
            return Err(invalid("GeoData: unsafe or invalid rule matcher."));
        }
        let (key, value) = if matcher.starts_with("geosite:") || matcher.starts_with("ext:") {
            ("domain", matcher)
        } else if matcher.starts_with("geoip:") {
            ("ip", matcher)
        } else {
            return Err(invalid("GeoData supports geosite:, geoip: and ext: rules."));
        };
        if !matcher.contains(':') || matcher.ends_with(':') {
            return Err(invalid("GeoData: empty category."));
        }
        let outbound = match action.as_str() {
            "block" => "xmesh_geo_block",
            "direct" if direct_available => "direct",
            "direct" => {
                return Err(invalid(
                    "GeoData: profile needs a 'direct' freedom outbound.",
                ));
            }
            _ => return Err(invalid("GeoData: allowed actions are block and direct.")),
        };
        let mut rule = json!({"type":"field","outboundTag":outbound});
        rule[key] = json!([value]);
        rules.push(rule);
    }
    if !rules.is_empty() {
        outbounds.push(json!({"tag":"xmesh_geo_block","protocol":"blackhole"}));
        let routing = config
            .as_object_mut()
            .ok_or_else(|| invalid("GeoData: Xray config must be an object."))?
            .entry("routing")
            .or_insert_with(|| json!({}));
        let routing = routing
            .as_object_mut()
            .ok_or_else(|| invalid("GeoData: routing must be an object."))?;
        let existing = routing.entry("rules").or_insert_with(|| json!([]));
        let existing = existing
            .as_array_mut()
            .ok_or_else(|| invalid("GeoData: routing.rules must be an array."))?;
        // StatsService inbound must remain the first rule. Other node rules win
        // over broad profile catch-all rules.
        let offset = existing
            .iter()
            .take_while(|r| {
                r.get("inboundTag")
                    .and_then(Value::as_array)
                    .is_some_and(|tags| tags.iter().any(|t| t.as_str() == Some("xmesh_stats_in")))
            })
            .count();
        existing.splice(offset..offset, rules);
    }
    let refresh_revision = node
        .get("geoRefreshRevision")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    Ok(Some(
        json!({"version":1,"intervalHours":hours,"refreshRevision":refresh_revision,"files":sources}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> Value {
        json!({"routing":{"rules":[{"type":"field","inboundTag":["xmesh_stats_in"],"outboundTag":"xmesh_stats_api"},{"type":"field","outboundTag":"direct","inboundTag":["vless-main"]}]},"outbounds":[{"tag":"direct","protocol":"freedom"}]})
    }
    #[test]
    fn ad_rule_precedes_profile_catch_all_and_signed_manifest_is_scoped() {
        let mut cfg = config();
        let manifest = apply(&json!({"geoEnabled":true,"geoBlockAds":true}), &mut cfg)
            .unwrap()
            .unwrap();
        assert_eq!(manifest["files"][0]["name"], "geosite.dat");
        assert_eq!(cfg["routing"]["rules"][0]["outboundTag"], "xmesh_stats_api");
        assert_eq!(cfg["routing"]["rules"][1]["outboundTag"], "xmesh_geo_block");
        assert_eq!(cfg["routing"]["rules"][2]["outboundTag"], "direct");
    }
    #[test]
    fn rejects_private_network_urls_and_unsafe_filenames() {
        let mut cfg = config();
        assert!(
            apply(
                &json!({"geoEnabled":true,"geoSiteUrl":"http://127.0.0.1/geo.dat"}),
                &mut cfg
            )
            .is_err()
        );
        assert!(
            apply(
                &json!({"geoEnabled":true,"geoExtraSources":"../evil.dat https://example.com/a"}),
                &mut cfg
            )
            .is_err()
        );
    }
    #[test]
    fn disabled_means_no_changes() {
        let mut cfg = config();
        let before = cfg.clone();
        assert!(apply(&json!({}), &mut cfg).unwrap().is_none());
        assert_eq!(cfg, before);
    }
}
