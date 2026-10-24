//! Reusable client-side Xray routing policies assigned to nodes and public hosts.
//! This is deliberately separate from server-side `node_routing`. Public client
//! outbounds are assembled only from the authenticated subscriber's endpoints.
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;

fn positive_id(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|b| b.is_ascii_digit())
        && value.parse::<u64>().is_ok_and(|n| n > 0)
}
fn source_key(key: &str, allow_node_group: bool) -> bool {
    if key.len() > 180 || key.chars().any(char::is_control) {
        return false;
    }
    if let Some(id) = key.strip_prefix("host:") {
        return positive_id(id);
    }
    if let Some(rest) = key.strip_prefix("node:") {
        if allow_node_group && positive_id(rest) {
            return true;
        }
        if let Some((id, tag)) = rest.split_once(':') {
            return positive_id(id)
                && !tag.is_empty()
                && tag.len() <= 128
                && !tag.contains(':')
                && !tag.chars().any(char::is_control);
        }
    }
    false
}
fn valid_match(kind: &str, value: &str) -> bool {
    if value.is_empty()
        || value.len() > 200
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return false;
    }
    match kind {
        "geosite" | "geoip" => {
            value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".:_-".contains(&b))
                && !value.contains("..")
                && !value.starts_with(':')
                && !value.ends_with(':')
        }
        "domain" => {
            value.len() <= 253
                && value.contains('.')
                && value.split('.').all(|part| {
                    !part.is_empty()
                        && part.len() <= 63
                        && part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                        && !part.starts_with('-')
                        && !part.ends_with('-')
                })
        }
        "ip" => {
            if value.parse::<IpAddr>().is_ok() {
                return true;
            }
            value.split_once('/').is_some_and(|(ip, prefix)| {
                ip.parse::<IpAddr>().is_ok_and(|addr| {
                    prefix
                        .parse::<u8>()
                        .is_ok_and(|n| n <= if addr.is_ipv4() { 32 } else { 128 })
                })
            })
        }
        "port" => value.split(',').all(|part| {
            let valid = |p: &str| !p.is_empty() && p.parse::<u16>().is_ok_and(|v| v > 0);
            if let Some((a, b)) = part.split_once('-') {
                valid(a) && valid(b) && a.parse::<u16>().unwrap() <= b.parse::<u16>().unwrap()
            } else {
                valid(part)
            }
        }),
        _ => false,
    }
}
fn err(text: &str) -> Result<(), String> {
    Err(text.into())
}
pub fn validate(value: &Value) -> Result<(), String> {
    let policies = value
        .as_array()
        .ok_or("Маршрутизация клиентов должна быть массивом")?;
    if policies.len() > 64 {
        return err("Не более 64 шаблонов маршрутизации");
    }
    let mut ids = HashSet::new();
    let mut assigned = HashSet::new();
    for profile in policies {
        let obj = profile.as_object().ok_or("Шаблон должен быть объектом")?;
        if obj
            .keys()
            .any(|k| !["id", "name", "servers", "rules", "enabled"].contains(&k.as_str()))
        {
            return err("Неизвестное поле шаблона маршрутизации");
        }
        let id = profile["id"].as_str().unwrap_or("");
        if id.len() < 3
            || id.len() > 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            || !ids.insert(id)
        {
            return err("Некорректный или повторяющийся ID шаблона");
        }
        let name = profile["name"].as_str().unwrap_or("");
        if name.trim().is_empty()
            || name.chars().count() > 100
            || name.chars().any(char::is_control)
        {
            return err("Укажите название маршрутизации (до 100 символов)");
        }
        if profile.get("enabled").is_some_and(|v| !v.is_boolean()) {
            return err("enabled должен быть переключателем");
        }
        let servers = profile["servers"]
            .as_array()
            .ok_or("Укажите список серверов")?;
        if servers.len() > 256 {
            return err("Не более 256 серверов на шаблон");
        }
        for server in servers {
            let key = server.as_str().ok_or("Некорректный ID сервера")?;
            if !source_key(key, true) || !assigned.insert(key.to_owned()) {
                return err("Некорректная или повторная привязка маршрутизации к серверу");
            }
        }
        let rules = profile["rules"]
            .as_array()
            .ok_or("Укажите массив правил маршрутизации")?;
        if rules.len() > 64 {
            return err("Не более 64 правил в шаблоне");
        }
        for rule in rules {
            let obj = rule.as_object().ok_or("Правило должно быть объектом")?;
            if obj
                .keys()
                .any(|k| !["match", "value", "action", "server", "network"].contains(&k.as_str()))
            {
                return err("Неизвестное поле правила");
            }
            let kind = rule["match"].as_str().unwrap_or("");
            let value = rule["value"].as_str().unwrap_or("");
            if !valid_match(kind, value) {
                return err("Некорректный тип или значение правила маршрутизации");
            }
            if let Some(network) = rule.get("network")
                && !["tcp", "udp", "tcp,udp"].contains(&network.as_str().unwrap_or(""))
            {
                return err("Сеть должна быть tcp, udp или tcp,udp");
            }
            let action = rule["action"].as_str().unwrap_or("");
            if !["proxy", "direct", "block", "server"].contains(&action) {
                return err("Неизвестное действие клиентской маршрутизации");
            }
            if action == "server" {
                if !source_key(rule["server"].as_str().unwrap_or(""), false) {
                    return err("Укажите точный ID целевого сервера");
                }
            } else if rule
                .get("server")
                .is_some_and(|v| !v.is_null() && v.as_str().is_some_and(|s| !s.is_empty()))
            {
                return err("Целевой сервер допустим только для действия server");
            }
        }
    }
    Ok(())
}
fn root_source_key(source: &Value) -> Option<String> {
    let key = source.get("xmeshSourceKey")?.as_str()?;
    if !source_key(key, false) {
        return None;
    }
    Some(key.to_owned())
}
fn assigned<'a>(source: &Value, settings: &'a Value) -> Option<&'a Value> {
    let src = root_source_key(source)?;
    let parent = src
        .strip_prefix("node:")
        .and_then(|value| value.split_once(':').map(|(id, _)| format!("node:{id}")));
    let candidates = [
        Some(src.as_str()),
        source.get("xmeshOwnerNodeKey").and_then(Value::as_str),
        parent.as_deref(),
    ];
    let profiles = settings.get("clientRoutingProfiles")?.as_array()?;
    for key in candidates.into_iter().flatten() {
        if let Some(profile) = profiles.iter().find(|p| {
            p["enabled"] != false
                && p["servers"]
                    .as_array()
                    .is_some_and(|keys| keys.iter().any(|s| s.as_str() == Some(key)))
        }) {
            return Some(profile);
        }
    }
    None
}
fn make_rule(spec: &Value, target: &str) -> Value {
    let kind = spec["match"].as_str().unwrap_or("");
    let value = spec["value"].as_str().unwrap_or("");
    let mut rule = json!({"type":"field","outboundTag":target});
    match kind {
        "domain" => rule["domain"] = json!([format!("domain:{value}")]),
        "geosite" => rule["domain"] = json!([format!("geosite:{value}")]),
        "geoip" => rule["ip"] = json!([format!("geoip:{value}")]),
        "ip" => rule["ip"] = json!([value]),
        "port" => rule["port"] = json!(value),
        _ => {}
    }
    if let Some(network) = spec.get("network").and_then(Value::as_str) {
        rule["network"] = json!(network);
    }
    rule
}
/// Build a standalone client entry. Extra outbound destinations come only from
/// the subscriber's already authorized endpoints. Missing targets resolve to
/// 'block', never to direct or another accidental server.
pub fn build_server(source: Value, all: &[Value], settings: &Value) -> Result<Value, String> {
    let Some(profile) = assigned(&source, settings) else {
        return crate::subscription_json::build(vec![source], settings);
    };
    let mut proxy_list = vec![source.clone()];
    let mut targets = HashMap::new();
    let rows = profile["rules"]
        .as_array()
        .ok_or("Некорректный шаблон маршрутизации")?;
    for rule in rows {
        if rule["action"] != "server" {
            continue;
        }
        let key = rule["server"].as_str().ok_or("Не выбран целевой сервер")?;
        if targets.contains_key(key) {
            continue;
        }
        if root_source_key(&source).as_deref() == Some(key) {
            targets.insert(key.to_owned(), 0usize);
            continue;
        }
        if let Some(proxy) = all
            .iter()
            .find(|p| root_source_key(p).as_deref() == Some(key))
        {
            targets.insert(key.to_owned(), proxy_list.len());
            proxy_list.push(proxy.clone());
        }
    }
    let mut config = crate::subscription_json::build(proxy_list, settings)?;
    // The entry is the chosen server, not a newly-created selection group.
    if let Some(name) = source["tag"].as_str().filter(|s| !s.is_empty()) {
        config["remarks"] = json!(
            name.chars()
                .filter(|c| !c.is_control())
                .take(100)
                .collect::<String>()
        );
    }
    let outbound_tags: Vec<String> = config["outbounds"]
        .as_array()
        .ok_or("Отсутствуют outbounds")?
        .iter()
        .filter_map(|p| p["tag"].as_str().map(str::to_owned))
        .collect();
    let first = outbound_tags
        .first()
        .ok_or("Нет исходящего сервера")?
        .clone();
    let mut mapped = Vec::new();
    for rule in rows {
        let action = rule["action"].as_str().unwrap_or("");
        let tag = match action {
            "proxy" => first.as_str(),
            "direct" => "direct",
            "block" => "block",
            "server" => rule["server"]
                .as_str()
                .and_then(|key| targets.get(key))
                .and_then(|index| outbound_tags.get(*index))
                .map_or("block", String::as_str),
            _ => return Err("Неизвестное действие маршрутизации".into()),
        };
        mapped.push(make_rule(rule, tag));
    }
    let rules = config["routing"]["rules"]
        .as_array_mut()
        .ok_or("Нет массива routing.rules")?;
    let index = rules
        .len()
        .checked_sub(1)
        .ok_or("Нет маршрута по умолчанию")?;
    rules.splice(index..index, mapped);
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn proxy(source: &str, code: &str) -> Value {
        json!({"tag":format!("{source} display"),"xmeshSourceKey":source,
   "xmeshCountry":code,"protocol":"vless",
   "settings":{"vnext":[{"address":"vpn.example.org","port":443,
    "users":[{"id":"550e8400-e29b-41d4-a716-446655440000","encryption":"none"}]}]},
   "streamSettings":{"network":"tcp","security":"tls",
    "tlsSettings":{"serverName":"vpn.example.org"}}})
    }
    fn settings() -> Value {
        json!({"clientRoutingProfiles":[{"id":"ru-domains","name":"RU через Польшу",
   "servers":["node:1","host:20"],"rules":[
    {"match":"geosite","value":"category-ru","action":"server","server":"host:30"},
    {"match":"domain","value":"example.com","action":"direct"},
    {"match":"geoip","value":"ru","action":"block"}]}]})
    }
    #[test]
    fn same_template_is_shared_and_server_route_keeps_default_source() {
        let mut nl = proxy("host:20", "NL");
        nl["xmeshOwnerNodeKey"] = json!("node:1");
        let mut de = proxy("host:21", "DE");
        de["xmeshOwnerNodeKey"] = json!("node:1");
        let pl = proxy("host:30", "PL");
        let all = vec![nl.clone(), de.clone(), pl];
        let config = build_server(nl, &all, &settings()).unwrap();
        let rules = config["routing"]["rules"].as_array().unwrap();
        assert_eq!(rules[2]["domain"], json!(["geosite:category-ru"]));
        assert_eq!(rules[2]["outboundTag"], config["outbounds"][1]["tag"]);
        assert_eq!(rules[3]["outboundTag"], "direct");
        assert_eq!(rules[4]["outboundTag"], "block");
        assert_eq!(rules[5]["outboundTag"], config["outbounds"][0]["tag"]);
        assert!(!config.to_string().contains("xmeshSourceKey"));
        assert!(!config.to_string().contains("xmeshOwnerNodeKey"));
        let inherited = build_server(de, &all, &settings()).unwrap();
        assert_eq!(
            inherited["routing"]["rules"][2]["outboundTag"],
            inherited["outbounds"][1]["tag"]
        );
        assert_eq!(config["remarks"], "host:20 display");
    }
    #[test]
    fn unknown_or_unauthorized_destination_blocks_instead_of_falling_back() {
        let source = proxy("host:20", "NL");
        let config = build_server(source.clone(), &[source], &settings()).unwrap();
        assert_eq!(config["routing"]["rules"][2]["outboundTag"], "block");
        assert_eq!(
            config["routing"]["rules"][5]["outboundTag"],
            config["outbounds"][0]["tag"]
        );
        assert_eq!(config["outbounds"].as_array().unwrap().len(), 3);
    }
    #[test]
    fn assignment_does_not_leak_to_other_hosts() {
        let x = proxy("host:66", "NL");
        let c = build_server(x.clone(), &[x], &settings()).unwrap();
        assert_eq!(c["routing"]["rules"].as_array().unwrap().len(), 3);
    }
    #[test]
    fn validation_rejects_injections_conflicts_and_dangling_targets() {
        let mut bad = settings();
        bad["clientRoutingProfiles"][0]["rules"][0]["value"] = json!("ru\\n injection");
        assert!(validate(&bad["clientRoutingProfiles"]).is_err());
        let mut bad = settings();
        bad["clientRoutingProfiles"][0]["rules"][0]["server"] = json!("direct");
        assert!(validate(&bad["clientRoutingProfiles"]).is_err());
        let mut bad = settings();
        bad["clientRoutingProfiles"][0]["servers"]
            .as_array_mut()
            .unwrap()
            .push(json!("host:20"));
        assert!(validate(&bad["clientRoutingProfiles"]).is_err());
        assert!(validate(&settings()["clientRoutingProfiles"]).is_ok());
    }
}
