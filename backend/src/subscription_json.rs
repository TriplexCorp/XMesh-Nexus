//! XMesh JSON Engine: one fail-closed assembler for public native Xray subscriptions.
//! Outbounds are produced from allowlisted client fields by user_subscriptions,
//! never by copying a server inbound/Reality private key into a client profile.
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

fn option<'a>(config: &'a Value, key: &str, values: &[&str], fallback: &'a str) -> &'a str {
    config
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| values.contains(s))
        .unwrap_or(fallback)
}
fn enabled(config: &Value, key: &str, default: bool) -> bool {
    config.get(key).and_then(Value::as_bool).unwrap_or(default)
}
fn port(config: &Value, key: &str, default: u16) -> u16 {
    config
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|v| u16::try_from(v).ok())
        .filter(|v| *v >= 1024)
        .unwrap_or(default)
}
fn country(outbound: &Value) -> String {
    let code = outbound
        .get("xmeshCountry")
        .and_then(Value::as_str)
        .unwrap_or("ZZ");
    let code = code.trim().to_ascii_uppercase();
    if code.len() == 2 && code.bytes().all(|c| c.is_ascii_alphabetic()) && code != "ZZ" {
        return code;
    }
    // Preserve country grouping when the admin uses a flag in the server label.
    let label = outbound.get("tag").and_then(Value::as_str).unwrap_or("");
    let mut flags = label.chars();
    if let (Some(a), Some(b)) = (flags.next(), flags.next()) {
        let ia = a as u32;
        let ib = b as u32;
        if (0x1f1e6..=0x1f1ff).contains(&ia) && (0x1f1e6..=0x1f1ff).contains(&ib) {
            let left = char::from_u32(u32::from(b'A') + ia - 0x1f1e6).unwrap_or('Z');
            let right = char::from_u32(u32::from(b'A') + ib - 0x1f1e6).unwrap_or('Z');
            return format!("{left}{right}");
        }
    }
    // Legacy Hosts often have only a human-readable country name. Infer
    // familiar locations without requiring users to enter ISO codes twice.
    let normalized = label.trim().to_lowercase();
    for (name, code) in [
        ("нидерланды", "NL"),
        ("netherlands", "NL"),
        ("holland", "NL"),
        ("швеция", "SE"),
        ("sweden", "SE"),
        ("германия", "DE"),
        ("germany", "DE"),
        ("польша", "PL"),
        ("poland", "PL"),
        ("эстония", "EE"),
        ("estonia", "EE"),
        ("финляндия", "FI"),
        ("finland", "FI"),
        ("россия", "RU"),
        ("russia", "RU"),
        ("франция", "FR"),
        ("france", "FR"),
        ("сша", "US"),
        ("united states", "US"),
        ("великобритания", "GB"),
        ("united kingdom", "GB"),
        ("испания", "ES"),
        ("spain", "ES"),
    ] {
        if normalized == name
            || normalized.starts_with(&format!("{name} "))
            || normalized.starts_with(&format!("{name}-"))
        {
            return code.to_owned();
        }
    }
    "ZZ".to_owned()
}
fn secure_vless(outbound: &Value) -> bool {
    let user = &outbound["settings"]["vnext"][0]["users"][0];
    let encryption = user["encryption"].as_str().unwrap_or("none");
    let security = outbound["streamSettings"]["security"]
        .as_str()
        .unwrap_or("none");
    match security {
        "tls" | "reality" => true,
        "none" => encryption.starts_with("mlkem768x25519plus."),
        _ => false,
    }
}
fn secure_proxy(outbound: &Value) -> bool {
    let protocol = outbound["protocol"].as_str().unwrap_or("");
    let security = outbound["streamSettings"]["security"]
        .as_str()
        .unwrap_or("none");
    let settings = &outbound["settings"];
    match protocol {
        "vless" => secure_vless(outbound),
        "vmess" => settings["id"].as_str().is_some_and(|s| !s.is_empty()),
        "trojan" => {
            security != "none" && settings["password"].as_str().is_some_and(|s| !s.is_empty())
        }
        "shadowsocks" => {
            settings["password"].as_str().is_some_and(|s| !s.is_empty())
                && settings["method"].as_str().is_some_and(|s| !s.is_empty())
        }
        "hysteria" => {
            security == "tls"
                && settings["version"] == 2
                && outbound["streamSettings"]["hysteriaSettings"]["auth"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty())
        }
        "masque" => {
            security == "tls"
                && outbound["streamSettings"]["masqueSettings"]["user"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty())
                && outbound["streamSettings"]["masqueSettings"]["pass"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty())
        }
        _ => false,
    }
}
fn proxy_address(outbound: &Value) -> &str {
    if outbound["protocol"] == "vless" {
        outbound["settings"]["vnext"][0]["address"]
            .as_str()
            .unwrap_or("")
    } else {
        outbound["settings"]["address"].as_str().unwrap_or("")
    }
}
/// The actual routing mode saved in SUBSCRIPTION STUDIO / Balancers.
/// An absent setting does not implicitly turn SMART on when more nodes appear.
pub(crate) fn smart_enabled(settings: &Value) -> bool {
    let opts = settings.get("subscriptionJson").unwrap_or(&Value::Null);
    enabled(opts, "smart", false)
        && option(
            opts,
            "balance",
            &["leastPing", "roundRobin", "random", "off"],
            "leastPing",
        ) != "off"
}

/// Every proxy passed into this engine must be fully public-side serialized.
pub(crate) fn build(mut proxies: Vec<Value>, setting: &Value) -> Result<Value, String> {
    if proxies.is_empty() {
        return Err("Нет доступных клиентских подключений".into());
    }
    if proxies.len() > 256 {
        return Err("Превышен лимит подключений в одной подписке".into());
    }
    let opts = setting.get("subscriptionJson").unwrap_or(&Value::Null);
    let dns_mode = option(
        opts,
        "dns",
        &["cloudflare", "cloudflare_doh", "yandex", "system"],
        "cloudflare",
    );
    // Plain-IP Cloudflare DNS is the compatibility default: no DoH bootstrap
    // hostname or TLS dependency during initial connectivity. Existing saved
    // "cloudflare" selections also migrate to this reliable mode.
    // IP-addressed DoH is a separate explicit opt-in, avoiding bootstrap loops.
    let dns_server = match dns_mode {
        "cloudflare_doh" => "https://1.1.1.1/dns-query",
        "yandex" => "https://common.dot.dns.yandex.net/dns-query",
        "system" => "localhost",
        _ => "1.1.1.1",
    };
    let query_strategy = option(
        opts,
        "queryStrategy",
        &["UseIPv4", "UseIPv6", "UseIP"],
        "UseIPv4",
    );
    let routing_strategy = option(
        opts,
        "routingStrategy",
        &["AsIs", "IPIfNonMatch", "IPOnDemand"],
        "IPIfNonMatch",
    );
    let balance = option(
        opts,
        "balance",
        &["leastPing", "roundRobin", "random", "off"],
        "leastPing",
    );
    let smart = smart_enabled(setting);
    let sniffing = enabled(opts, "sniffing", true);
    let dns_out = enabled(opts, "dnsRouting", false);
    let socks_port = port(opts, "socksPort", 10808);
    let http_port = port(opts, "httpPort", 10809);
    if socks_port == http_port {
        return Err("Локальные SOCKS и HTTP порты совпадают".into());
    }
    let mut used = HashSet::new();
    let mut countries: HashMap<String, Vec<String>> = HashMap::new();
    let mut tags = Vec::new();
    // An Xray routing tag is not a human-readable server name. Preserve
    // the host's real subscription remark separately for GUI clients.
    let display_names: Vec<String> = proxies
        .iter()
        .map(|p| {
            p.get("tag")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .chars()
                .filter(|c| !c.is_control())
                .take(100)
                .collect()
        })
        .collect();
    for (i, outbound) in proxies.iter_mut().enumerate() {
        if !secure_proxy(outbound) {
            return Err("Некорректные или недостаточно защищённые учётные данные прокси".into());
        }
        let address = proxy_address(outbound);
        if address.is_empty() {
            return Err("Не указан публичный адрес сервера".into());
        }
        let code = country(outbound);
        // Xray routing tags are internal identifiers, never display labels.
        // Keep them stable, unique and ASCII-only regardless of host names.
        let tag = format!("xmesh-{code}-{:04}", i + 1);
        if !used.insert(tag.clone()) {
            return Err("Дублирующийся тег Xray".into());
        }
        outbound
            .as_object_mut()
            .ok_or("Неверная структура outbound")?
            .remove("xmeshCountry");
        outbound.as_object_mut().unwrap().remove("xmeshSourceKey");
        outbound
            .as_object_mut()
            .unwrap()
            .remove("xmeshOwnerNodeKey");
        outbound["tag"] = json!(tag);
        tags.push(tag.clone());
        countries.entry(code).or_default().push(tag);
    }
    let first = tags
        .first()
        .ok_or("Отсутствует маршрут по умолчанию")?
        .clone();
    let mut balancers: Vec<Value> = Vec::new();
    let mut rules = vec![
        json!({"type":"field","ip":["geoip:private"],"outboundTag":"direct"}),
        json!({"type":"field","domain":["geosite:private"],"outboundTag":"direct"}),
    ];
    if dns_out {
        rules.push(
            json!({"type":"field","inboundTag":["socks","http"],"port":53,
            "network":"tcp,udp","outboundTag":"dns-out"}),
        );
    }
    let mut observation = false;
    if smart && tags.len() > 1 && balance != "off" {
        let mut group_names: Vec<String> = countries.keys().cloned().collect();
        group_names.sort();
        for code in group_names {
            let members = &countries[&code];
            if members.len() < 2 || code == "ZZ" {
                continue;
            }
            let tag = format!("{code}_AUTO");
            let mut balancer = json!({
                "tag":tag,"selector":[format!("xmesh-{code}-")],
                "strategy":{"type":balance}
            });
            // Xray requires an Observatory when fallbackTag is present,
            // even for roundRobin/random. Only leastPing configures one.
            if balance == "leastPing" {
                balancer["fallbackTag"] = json!(members[0])
            }
            balancers.push(balancer);
        }
        let mut balancer = json!({
            "tag":"SMART","selector":["xmesh-"],
            "strategy":{"type":balance}
        });
        if balance == "leastPing" {
            balancer["fallbackTag"] = json!(first)
        }
        balancers.push(balancer);
        observation = balance == "leastPing";
        rules.push(json!({"type":"field","inboundTag":["socks","http"],"balancerTag":"SMART"}));
    } else {
        rules.push(json!({"type":"field","inboundTag":["socks","http"],"outboundTag":first}));
    }
    let mut inbounds = vec![
        json!({"tag":"socks","listen":"127.0.0.1","port":socks_port,"protocol":"socks",
         "settings":{"auth":"noauth","udp":true}}),
        json!({"tag":"http","listen":"127.0.0.1","port":http_port,"protocol":"http"}),
    ];
    if sniffing {
        for inbound in &mut inbounds {
            inbound["sniffing"] =
                json!({"enabled":true,"destOverride":["http","tls","quic"],"routeOnly":true});
        }
    }
    proxies.push(json!({"tag":"direct","protocol":"freedom","settings":{"domainStrategy":"AsIs"}}));
    proxies.push(json!({"tag":"block","protocol":"blackhole"}));
    if dns_out {
        proxies.push(json!({"tag":"dns-out","protocol":"dns"}));
    }
    let mut routing = json!({"domainStrategy":routing_strategy,"rules":rules});
    if !balancers.is_empty() {
        routing["balancers"] = json!(balancers)
    }
    let display_name = if display_names.len() == 1 && !display_names[0].is_empty() {
        display_names[0].clone()
    } else {
        setting
            .get("subscriptionName")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.chars().count() <= 100)
            .unwrap_or(if smart && tags.len() > 1 && balance != "off" {
                "XMesh SMART"
            } else {
                "XMesh Servers"
            })
            .to_owned()
    };
    let mut config = json!({
        "remarks":display_name,
        "log":{"loglevel":"warning"},
        "dns":{"queryStrategy":query_strategy,"servers":[dns_server]},
        "inbounds":inbounds,
        "outbounds":proxies,
        "routing":routing
    });
    // A disabled balancer is a hard guarantee, not just a UI preference.
    // Fail closed if a future routing feature accidentally inserts an automatic
    // selector or an observatory when SMART has not been explicitly enabled.
    if !smart || balance == "off" || tags.len() <= 1 {
        let r = &config["routing"];
        if r.get("balancers").is_some()
            || r["rules"]
                .as_array()
                .is_some_and(|rules| rules.iter().any(|rule| rule.get("balancerTag").is_some()))
            || config.get("observatory").is_some()
        {
            return Err("В JSON обнаружена балансировка, хотя SMART отключён".into());
        }
    }
    if observation {
        config["observatory"] = json!({
            "subjectSelector":["xmesh-"],
            "probeUrl":"https://www.gstatic.com/generate_204",
            "probeInterval":"1m",
            "enableConcurrency":false
        });
    }
    Ok(config)
}

/// Public subscription feed: each independently selectable server must be its
/// own complete Xray JSON document in the returned JSON array. A monolithic
/// config with multiple outbounds appears as just one item in Happ.
/// SMART, when explicitly enabled, is offered as an *additional* item, never
/// a replacement for the individual country/server choices.
/// Custom named balancers use stable source identities; never select by IP,
/// host remark or positional Xray tag. Duplicated IPs remain independent.
pub(crate) fn validate_client_balancers(value: &Value) -> Result<(), String> {
    let rows = value
        .as_array()
        .ok_or("Балансировщики должны быть массивом")?;
    let mut tags = HashSet::new();
    for row in rows {
        let obj = row
            .as_object()
            .ok_or("Балансировщик должен быть объектом")?;
        for key in obj.keys() {
            if ![
                "tag",
                "remark",
                "serverDescription",
                "selector",
                "strategy",
                "hideSelectedInbounds",
                "enabled",
                "observatory",
            ]
            .contains(&key.as_str())
            {
                return Err(format!("Неизвестное поле балансировщика: {key}"));
            }
        }
        let tag = row["tag"].as_str().unwrap_or("");
        if tag.is_empty()
            || tag.len() > 64
            || !tag
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
            || ["direct", "block", "dns-out"].contains(&tag)
            || !tags.insert(tag.to_owned())
        {
            return Err("Тег балансировщика должен быть уникальным (латиница, цифры, _ и -)".into());
        }
        for (field, max) in [("remark", 120), ("serverDescription", 240)] {
            let text = row[field].as_str().ok_or(format!("Укажите {field}"))?;
            if text.is_empty() && field == "remark"
                || text.chars().count() > max
                || text.chars().any(char::is_control)
            {
                return Err(format!("Некорректное поле {field}"));
            }
        }
        if !["leastPing", "roundRobin", "random"].contains(&row["strategy"].as_str().unwrap_or(""))
        {
            return Err("Неизвестная стратегия балансировщика".into());
        }
        if row.get("enabled").is_some_and(|v| !v.is_boolean())
            || row
                .get("hideSelectedInbounds")
                .is_some_and(|v| !v.is_boolean())
        {
            return Err("Некорректные переключатели балансировщика".into());
        }
        let selected = row["selector"]
            .as_array()
            .ok_or("Укажите серверы для балансировщика")?;
        if selected.is_empty() {
            return Err(format!("Выберите минимум один сервер для {tag}"));
        }
        let mut sources = HashSet::new();
        for key in selected {
            let key = key.as_str().ok_or("Неверный ID сервера")?;
            if key.len() > 160
                || !(key.starts_with("host:") || key.starts_with("node:"))
                || key.chars().any(char::is_control)
                || !sources.insert(key)
            {
                return Err("Некорректный или повторяющийся сервер".into());
            }
        }
        if let Some(o) = row.get("observatory") {
            let obj = o
                .as_object()
                .ok_or("Настройки проверки должны быть объектом")?;
            for key in obj.keys() {
                if ![
                    "probeInterval",
                    "probeTimeout",
                    "sampling",
                    "probeURL",
                    "connectivity",
                ]
                .contains(&key.as_str())
                {
                    return Err(format!("Неизвестный параметр проверки: {key}"));
                }
            }
            for (field, min, max) in [("probeInterval", 5, 300), ("probeTimeout", 1, 30)] {
                let value =
                    obj.get(field)
                        .and_then(Value::as_str)
                        .unwrap_or(if field == "probeInterval" {
                            "20s"
                        } else {
                            "2s"
                        });
                let secs = value
                    .strip_suffix('s')
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(0);
                if secs < min || secs > max {
                    return Err(format!("Некорректное значение {field}"));
                }
            }
            if let Some(n) = obj.get("sampling")
                && !n.as_u64().is_some_and(|v| (1..=50).contains(&v))
            {
                return Err("sampling должен быть от 1 до 50".into());
            }
            for field in ["probeURL", "connectivity"] {
                if let Some(value) = obj.get(field) {
                    let url = value.as_str().ok_or("Адрес проверки должен быть строкой")?;
                    let allowed_scheme = url.starts_with("https://")
                        || (field == "connectivity" && url.starts_with("http://"));
                    if url.len() > 256
                        || !allowed_scheme
                        || !url.is_ascii()
                        || url
                            .bytes()
                            .any(|c| c <= 32 || c == 127 || c == b'\\' || c == b'@')
                        || url.contains('#')
                    {
                        return Err("Некорректный URL проверки".into());
                    }
                }
            }
        }
    }
    Ok(())
}

/// A public feed contains an independent full Xray JSON profile for each
/// available server plus only the explicitly enabled custom selections.
pub(crate) fn build_feed(proxies: Vec<Value>, settings: &Value) -> Result<Value, String> {
    if proxies.is_empty() {
        return Err("Нет доступных клиентских подключений".into());
    }
    if proxies.len() > 256 {
        return Err("Превышен лимит подключений в одной подписке".into());
    }
    let all_proxies = proxies.clone();
    let custom = settings.get("clientBalancers").and_then(Value::as_array);
    if let Some(rows) = custom {
        validate_client_balancers(&Value::Array(rows.clone()))?
    }
    let mut entries = Vec::new();
    let mut hidden = HashSet::new();
    let mut standalone_settings = settings.clone();
    if let Some(opts) = standalone_settings
        .get_mut("subscriptionJson")
        .and_then(Value::as_object_mut)
    {
        opts.insert("smart".to_owned(), Value::Bool(false));
        opts.insert("balance".to_owned(), Value::String("off".to_owned()));
    }
    if let Some(rows) = custom {
        for row in rows {
            if row.get("enabled").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            let selected = row["selector"]
                .as_array()
                .ok_or("Неверный список серверов")?;
            let source_ids: HashSet<&str> = selected.iter().filter_map(Value::as_str).collect();
            let matched: Vec<Value> = proxies
                .iter()
                .filter(|p| {
                    p.get("xmeshSourceKey")
                        .and_then(Value::as_str)
                        .is_some_and(|id| source_ids.contains(id))
                })
                .cloned()
                .collect();
            // If some nodes are unavailable, do not silently reassign a group to an
            // unrelated endpoint; skip only the missing node and preserve the others.
            if matched.is_empty() {
                continue;
            }
            let mut group_settings = standalone_settings.clone();
            if let Some(opts) = group_settings
                .get_mut("subscriptionJson")
                .and_then(Value::as_object_mut)
            {
                opts.insert("smart".into(), Value::Bool(matched.len() > 1));
                opts.insert("balance".into(), row["strategy"].clone());
            } else {
                group_settings["subscriptionJson"] = json!({
                  "smart":matched.len()>1,"balance":row["strategy"]
                });
            }
            let mut config = build(matched, &group_settings)?;
            config["remarks"] = row["remark"].clone();
            config["serverDescription"] = row["serverDescription"].clone();
            if config["routing"]["balancers"].is_array() {
                // One requested balancer per independent profile. Country auto-groups
                // must not leak into a manually selected combination.
                let first = config["outbounds"][0]["tag"].clone();
                let tags: Vec<Value> = config["outbounds"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|p| {
                        [
                            "vless",
                            "vmess",
                            "trojan",
                            "shadowsocks",
                            "hysteria",
                            "masque",
                        ]
                        .contains(&p["protocol"].as_str().unwrap_or(""))
                    })
                    .map(|p| p["tag"].clone())
                    .collect();
                let strategy = row["strategy"].as_str().unwrap_or("random");
                let mut balancer = json!({
                 "tag":row["tag"],"selector":tags,
                 "strategy":{"type":strategy}
                });
                // Prevent "core: not all dependencies are resolved" on roundRobin/random.
                if strategy == "leastPing" {
                    balancer["fallbackTag"] = first
                }
                config["routing"]["balancers"] = json!([balancer]);
                if let Some(rules) = config["routing"]["rules"].as_array_mut() {
                    for rule in rules {
                        if rule.get("balancerTag").is_some() {
                            rule["balancerTag"] = row["tag"].clone()
                        }
                    }
                }
            }
            // Single-source groups are aliases to that source, not fake balancers.
            if row["strategy"] != "leastPing" {
                config.as_object_mut().unwrap().remove("observatory");
            }
            if row["strategy"] == "leastPing" && config.get("observatory").is_some() {
                let obs = &row["observatory"];
                if let Some(v) = obs.get("probeInterval") {
                    config["observatory"]["probeInterval"] = v.clone()
                }
                if let Some(v) = obs.get("probeURL") {
                    config["observatory"]["probeUrl"] = v.clone()
                }
                // probeTimeout / sampling / connectivity are stored in panel metadata.
                // Xray core does not support them as top-level observatory settings.
            }
            if row["hideSelectedInbounds"] == true {
                hidden.extend(source_ids.iter().map(|s| s.to_string()));
            }
            entries.push(config);
        }
    } else if smart_enabled(settings) && proxies.len() > 1 {
        // Legacy SMART remains compatible until the new editor is first saved.
        entries.push(build(proxies.clone(), settings)?);
    }
    for proxy in proxies {
        if proxy
            .get("xmeshSourceKey")
            .and_then(Value::as_str)
            .is_some_and(|source| hidden.contains(source))
        {
            continue;
        }
        entries.push(crate::client_routing::build_server(
            proxy,
            &all_proxies,
            &standalone_settings,
        )?);
    }
    Ok(Value::Array(entries))
}

/// Reject unknown or unsafe JSON Engine configuration instead of silently
/// accepting privileged raw Xray fields from the appearance settings API.
pub(crate) fn validate_settings(settings: &Value) -> Result<(), String> {
    let object = settings
        .as_object()
        .ok_or("JSON Engine settings must be an object")?;
    if object.len() > 16 {
        return Err("Too many JSON Engine settings".into());
    }
    for (key, value) in object {
        match key.as_str() {
            "dns" => {
                if !["cloudflare", "cloudflare_doh", "yandex", "system"]
                    .contains(&value.as_str().unwrap_or(""))
                {
                    return Err("Unsupported DNS provider".into());
                }
            }
            "queryStrategy" => {
                if !["UseIPv4", "UseIPv6", "UseIP"].contains(&value.as_str().unwrap_or("")) {
                    return Err("Invalid DNS query strategy".into());
                }
            }
            "routingStrategy" => {
                if !["AsIs", "IPIfNonMatch", "IPOnDemand"].contains(&value.as_str().unwrap_or("")) {
                    return Err("Invalid routing strategy".into());
                }
            }
            "balance" => {
                if !["leastPing", "roundRobin", "random", "off"]
                    .contains(&value.as_str().unwrap_or(""))
                {
                    return Err("Invalid balancer strategy".into());
                }
            }
            "smart" | "sniffing" | "dnsRouting" => {
                if !value.is_boolean() {
                    return Err(format!("{key} must be boolean"));
                }
            }
            "socksPort" | "httpPort" => {
                let p = value.as_u64().unwrap_or(0);
                if !(1024..=65535).contains(&p) {
                    return Err("Invalid local proxy port".into());
                }
            }
            _ => return Err(format!("Unknown JSON Engine setting: {key}")),
        }
    }
    if object.get("socksPort").and_then(Value::as_u64)
        == object.get("httpPort").and_then(Value::as_u64)
        && object.get("socksPort").is_some()
    {
        return Err("SOCKS and HTTP ports must be distinct".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn outbound(code: &str) -> Value {
        json!({"tag":"User-facing label","xmeshCountry":code,"protocol":"vless",
   "settings":{"vnext":[{"address":"vpn.example.com","port":443,
   "users":[{"id":"550e8400-e29b-41d4-a716-446655440000","encryption":"none"}]}]},
   "streamSettings":{"security":"reality","network":"xhttp",
   "realitySettings":{"serverName":"example.com","publicKey":"public","shortId":"aa"},
   "xhttpSettings":{"path":"/test","mode":"stream-up"}}})
    }
    #[test]
    fn round_robin_and_random_never_require_missing_observatory() {
        for strategy in ["roundRobin", "random"] {
            let settings = json!({"subscriptionJson":{"smart":true,"balance":strategy}});
            let cfg = build(vec![outbound("NL"), outbound("PL")], &settings).unwrap();
            assert!(cfg.get("observatory").is_none());
            for balancer in cfg["routing"]["balancers"].as_array().unwrap() {
                assert!(balancer.get("fallbackTag").is_none());
                assert_eq!(balancer["strategy"]["type"], strategy);
            }
            let mut nl = outbound("NL");
            nl["xmeshSourceKey"] = json!("host:1");
            let mut pl = outbound("PL");
            pl["xmeshSourceKey"] = json!("host:2");
            let custom = json!({"clientBalancers":[{
             "tag":"AUTO_1","remark":"🇪🇺 Европа","serverDescription":"",
             "selector":["host:1","host:2"],"strategy":strategy,"enabled":true
            }]});
            let feed = build_feed(vec![nl, pl], &custom).unwrap();
            let group = &feed[0];
            assert!(group.get("observatory").is_none());
            assert!(
                group["routing"]["balancers"][0]
                    .get("fallbackTag")
                    .is_none()
            );
            assert_eq!(
                group["routing"]["balancers"][0]["strategy"]["type"],
                strategy
            );
            assert_eq!(group["routing"]["rules"][2]["balancerTag"], "AUTO_1");
        }
    }
    #[test]
    fn least_ping_preserves_observatory_and_fallback() {
        let settings = json!({"subscriptionJson":{"smart":true,"balance":"leastPing"}});
        let cfg = build(vec![outbound("NL"), outbound("PL")], &settings).unwrap();
        assert!(cfg.get("observatory").is_some());
        assert_eq!(
            cfg["routing"]["balancers"][0]["fallbackTag"],
            "xmesh-NL-0001"
        );
    }
    #[test]
    fn custom_groups_select_exact_hosts_and_keep_server_profiles() {
        let mut nl = outbound("NL");
        nl["xmeshSourceKey"] = json!("host:101");
        nl["tag"] = json!("Нидерланды");
        let mut de = outbound("DE");
        de["xmeshSourceKey"] = json!("host:102");
        de["tag"] = json!("Германия");
        let mut pl = outbound("PL");
        pl["xmeshSourceKey"] = json!("host:103");
        pl["tag"] = json!("Польша");
        let settings = json!({"clientBalancers":[{
          "tag":"DE_BEST","remark":"🇩🇪 Лучший — Германия {STATUS_EMOJI}",
          "serverDescription":"Быстрый маршрут",
          "selector":["host:102","host:103"],"strategy":"leastPing",
          "hideSelectedInbounds":false,"enabled":true,
          "observatory":{"probeInterval":"20s","probeTimeout":"2s","sampling":5,
            "probeURL":"https://www.gstatic.com/generate_204",
            "connectivity":"https://cp.cloudflare.com/generate_204"}
        }]});
        let list = build_feed(vec![nl, de, pl], &settings).unwrap();
        let profiles = list.as_array().unwrap();
        assert_eq!(profiles.len(), 4);
        assert_eq!(
            profiles[0]["remarks"],
            "🇩🇪 Лучший — Германия {STATUS_EMOJI}"
        );
        assert_eq!(profiles[0]["routing"]["balancers"][0]["tag"], "DE_BEST");
        assert_eq!(
            profiles[0]["routing"]["balancers"][0]["selector"],
            json!(["xmesh-DE-0001", "xmesh-PL-0002"])
        );
        assert_eq!(profiles[0]["observatory"]["probeInterval"], "20s");
        assert_eq!(profiles[1]["remarks"], "Нидерланды");
        for profile in profiles {
            assert!(profile.get("xmeshSourceKey").is_none());
            assert!(profile.get("xmeshBalancer").is_none());
            assert!(
                profile["outbounds"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|o| o.get("xmeshSourceKey").is_none())
            );
        }
    }
    #[test]
    fn hiding_selected_sources_only_hides_their_individual_profiles() {
        let mut nl = outbound("NL");
        nl["xmeshSourceKey"] = json!("host:101");
        let mut de = outbound("DE");
        de["xmeshSourceKey"] = json!("host:102");
        let settings = json!({"clientBalancers":[{
         "tag":"DE_AUTO","remark":"Германия","serverDescription":"",
         "selector":["host:102"],"strategy":"leastPing",
         "hideSelectedInbounds":true
        }]});
        let list = build_feed(vec![nl, de], &settings).unwrap();
        assert_eq!(list.as_array().unwrap().len(), 2);
        assert_eq!(list[0]["remarks"], "Германия");
        assert!(list[0]["routing"].get("balancers").is_none());
        assert_eq!(list[1]["outbounds"][0]["tag"], "xmesh-NL-0001");
    }
    #[test]
    fn no_custom_group_is_added_when_explicit_list_empty() {
        let list = build_feed(
            vec![outbound("NL"), outbound("PL")],
            &json!({"clientBalancers":[],"subscriptionJson":{"smart":true}}),
        )
        .unwrap();
        assert_eq!(list.as_array().unwrap().len(), 2);
        assert!(list[0]["routing"].get("balancers").is_none());
    }
    #[test]
    fn custom_balancer_validation_rejects_duplicate_tags() {
        let row = json!({"tag":"AUTO","remark":"Auto","serverDescription":"",
   "strategy":"leastPing","selector":["host:1"]});
        assert!(validate_client_balancers(&json!([row.clone(), row])).is_err());
    }
    #[test]
    fn feed_exposes_one_full_json_profile_per_server() {
        let mut nl = outbound("NL");
        nl["tag"] = json!("🇳🇱 Нидерланды");
        let mut pl = outbound("PL");
        pl["tag"] = json!("🇵🇱 Польша");
        let entries = build_feed(vec![nl, pl], &json!({})).unwrap();
        let entries = entries.as_array().unwrap();
        assert_eq!(entries.len(), 2);
        for (idx, entry) in entries.iter().enumerate() {
            assert_eq!(entry["outbounds"].as_array().unwrap().len(), 3);
            assert_eq!(entry["outbounds"][0]["protocol"], "vless");
            assert_eq!(entry["outbounds"][1]["tag"], "direct");
            assert!(entry["routing"].get("balancers").is_none());
            assert!(entry.get("observatory").is_none());
            assert_eq!(
                entry["routing"]["rules"][2]["outboundTag"],
                json!(format!("xmesh-{}-0001", if idx == 0 { "NL" } else { "PL" }))
            );
        }
        assert_eq!(entries[0]["remarks"], "🇳🇱 Нидерланды");
        assert_eq!(entries[1]["remarks"], "🇵🇱 Польша");
    }
    #[test]
    fn smart_is_an_optional_additional_profile() {
        let entries = build_feed(
            vec![outbound("NL"), outbound("PL")],
            &json!({"subscriptionJson":{"smart":true,"balance":"leastPing"}}),
        )
        .unwrap();
        let arr = entries.as_array().unwrap();
        assert_eq!(arr.len(), 3);
        assert_eq!(arr[0]["remarks"], "XMesh SMART");
        assert!(arr[0]["routing"]["balancers"].is_array());
        assert!(arr[1]["routing"].get("balancers").is_none());
        assert!(arr[2]["routing"].get("balancers").is_none());
    }
    #[test]
    fn disabled_smart_never_emits_balancer_or_observatory() {
        for settings in [
            json!({}),
            json!({"subscriptionJson":{"smart":false,"balance":"leastPing"}}),
            json!({"subscriptionJson":{"smart":false,"balance":"roundRobin"}}),
            json!({"subscriptionJson":{"smart":false,"balance":"random"}}),
            json!({"subscriptionJson":{"smart":true,"balance":"off"}}),
        ] {
            let cfg = build(
                vec![outbound("NL"), outbound("PL"), outbound("DE")],
                &settings,
            )
            .unwrap();
            assert!(cfg["routing"].get("balancers").is_none());
            assert!(cfg.get("observatory").is_none());
            assert!(
                cfg["routing"]["rules"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|r| r.get("balancerTag").is_none())
            );
            assert_eq!(cfg["routing"]["rules"][2]["outboundTag"], "xmesh-NL-0001");
            assert_eq!(cfg["outbounds"].as_array().unwrap().len(), 5);
        }
    }
    #[test]
    fn explicit_smart_state_controls_feed_delivery() {
        assert!(!smart_enabled(&json!({})));
        assert!(!smart_enabled(
            &json!({"subscriptionJson":{"smart":false,"balance":"leastPing"}})
        ));
        assert!(!smart_enabled(
            &json!({"subscriptionJson":{"smart":true,"balance":"off"}})
        ));
        assert!(smart_enabled(
            &json!({"subscriptionJson":{"smart":true,"balance":"leastPing"}})
        ));
    }
    #[test]
    fn balancers_are_opt_in_and_servers_remain_distinct() {
        let config = build(vec![outbound("NL"), outbound("PL")], &json!({})).unwrap();
        assert!(config["routing"].get("balancers").is_none());
        assert!(config.get("observatory").is_none());
        assert_eq!(config["outbounds"].as_array().unwrap().len(), 4);
        assert_eq!(config["outbounds"][0]["tag"], "xmesh-NL-0001");
        assert_eq!(config["outbounds"][1]["tag"], "xmesh-PL-0002");
        assert_eq!(
            config["routing"]["rules"][2]["outboundTag"],
            "xmesh-NL-0001"
        );
    }
    #[test]
    fn smart_balancer_observatory_and_country() {
        let config = build(
            vec![outbound("DE"), outbound("DE"), outbound("PL")],
            &json!({"subscriptionJson":{"smart":true}}),
        )
        .unwrap();
        assert_eq!(config["routing"]["balancers"][0]["tag"], "DE_AUTO");
        assert_eq!(config["routing"]["balancers"][1]["tag"], "SMART");
        assert_eq!(config["routing"]["rules"][2]["balancerTag"], "SMART");
        assert_eq!(config["observatory"]["subjectSelector"][0], "xmesh-");
        assert_ne!(config["outbounds"][0]["tag"], config["outbounds"][1]["tag"]);
        assert!(config["outbounds"][0].get("xmeshCountry").is_none());
    }
    #[test]
    fn unicode_host_label_never_leaks_into_routing_tags() {
        let mut a = outbound("NL");
        a["tag"] = json!("Нидерланды 🥷");
        let mut b = outbound("NL");
        b["tag"] = json!("Другой CDN 🇳🇱");
        let c = build(vec![a, b], &json!({"subscriptionJson":{"smart":true}})).unwrap();
        assert_eq!(c["outbounds"][0]["tag"], "xmesh-NL-0001");
        assert_eq!(c["outbounds"][1]["tag"], "xmesh-NL-0002");
        assert_eq!(c["routing"]["balancers"][0]["tag"], "NL_AUTO");
        for outbound in c["outbounds"].as_array().unwrap() {
            assert!(outbound["tag"].as_str().unwrap().is_ascii());
        }
        assert_eq!(c["routing"]["rules"][2]["balancerTag"], "SMART");
    }
    #[test]
    fn unicode_single_host_default_route_is_ascii() {
        let mut a = outbound("ZZ");
        a["tag"] = json!("Нидерланды");
        let c = build(vec![a], &json!({})).unwrap();
        assert_eq!(c["outbounds"][0]["tag"], "xmesh-NL-0001");
        assert_eq!(c["routing"]["rules"][2]["outboundTag"], "xmesh-NL-0001");
    }
    #[test]
    fn host_remark_is_displayed_without_polluting_xray_tags() {
        let mut a = outbound("ZZ");
        a["tag"] = json!("Нидерланды");
        let c = build(vec![a], &json!({})).unwrap();
        assert_eq!(c["remarks"], "Нидерланды");
        assert_eq!(c["outbounds"][0]["tag"], "xmesh-NL-0001");
        assert_eq!(c["routing"]["rules"][2]["outboundTag"], "xmesh-NL-0001");
    }
    #[test]
    fn arbitrary_unicode_label_stays_only_in_display_remark() {
        let mut a = outbound("ZZ");
        a["tag"] = json!("🌍 Premium Zone");
        let c = build(vec![a], &json!({})).unwrap();
        assert_eq!(c["remarks"], "🌍 Premium Zone");
        assert_eq!(c["outbounds"][0]["tag"], "xmesh-ZZ-0001");
    }
    #[test]
    fn one_node_uses_direct_tag_without_empty_balancers() {
        let c = build(vec![outbound("PL")], &json!({})).unwrap();
        assert!(
            c["routing"]["rules"][2]["outboundTag"]
                .as_str()
                .unwrap()
                .starts_with("xmesh-PL-0001")
        );
        assert!(c.get("observatory").is_none());
    }
    #[test]
    fn default_json_has_working_dns_and_fails_closed_to_proxy() {
        let c = build(vec![outbound("NL")], &json!({})).unwrap();
        assert_eq!(c["dns"]["servers"][0], "1.1.1.1");
        assert_eq!(c["routing"]["rules"].as_array().unwrap().len(), 3);
        assert_eq!(c["routing"]["rules"][2]["outboundTag"], "xmesh-NL-0001");
        assert_eq!(
            c["routing"]["rules"][2]["inboundTag"],
            json!(["socks", "http"])
        );
        assert!(
            !c["outbounds"]
                .as_array()
                .unwrap()
                .iter()
                .any(|o| o["tag"] == "dns-out")
        );
        assert!(
            !c["routing"]["rules"]
                .as_array()
                .unwrap()
                .iter()
                .any(|r| r.get("outboundTag") == Some(&json!("direct"))
                    && r.as_object().is_some_and(|m| m.len() == 2))
        );
    }
    #[test]
    fn old_cloudflare_dns_selection_is_migrated_away_from_hostname_doh() {
        let c = build(
            vec![outbound("NL")],
            &json!({"subscriptionJson":{"dns":"cloudflare"}}),
        )
        .unwrap();
        assert_eq!(c["dns"]["servers"][0], "1.1.1.1");
    }
    #[test]
    fn doh_can_be_enabled_without_dns_bootstrap_hostname() {
        let c = build(
            vec![outbound("NL")],
            &json!({"subscriptionJson":{"dns":"cloudflare_doh"}}),
        )
        .unwrap();
        assert_eq!(c["dns"]["servers"][0], "https://1.1.1.1/dns-query");
        assert_eq!(c["routing"]["rules"][2]["outboundTag"], "xmesh-NL-0001");
    }
    #[test]
    fn explicit_dns_interception_keeps_separate_proxy_fallback() {
        let c = build(
            vec![outbound("NL")],
            &json!({"subscriptionJson":{
    "dns":"cloudflare","dnsRouting":true}}),
        )
        .unwrap();
        assert_eq!(c["dns"]["servers"][0], "1.1.1.1");
        assert_eq!(c["routing"]["rules"][2]["outboundTag"], "dns-out");
        assert_eq!(c["routing"]["rules"][3]["outboundTag"], "xmesh-NL-0001");
        assert!(
            c["outbounds"]
                .as_array()
                .unwrap()
                .iter()
                .any(|o| o["tag"] == "dns-out")
        );
    }
    #[test]
    fn multiserver_fallback_uses_smart_not_direct() {
        let c = build(
            vec![outbound("NL"), outbound("DE")],
            &json!({"subscriptionJson":{"smart":true}}),
        )
        .unwrap();
        assert_eq!(c["routing"]["rules"][2]["balancerTag"], "SMART");
        assert!(c["routing"]["rules"][2].get("outboundTag").is_none());
    }
    #[test]
    fn insecure_public_vless_is_rejected() {
        let mut x = outbound("PL");
        x["streamSettings"]["security"] = json!("none");
        assert!(build(vec![x.clone()], &json!({})).is_err());
        x["settings"]["vnext"][0]["users"][0]["encryption"] =
            json!("mlkem768x25519plus.native.1rtt.key");
        assert!(build(vec![x], &json!({})).is_ok());
    }
    #[test]
    fn custom_dns_balancing_and_ports() {
        let c = build(
            vec![outbound("DE"), outbound("PL")],
            &json!({"subscriptionJson":{
   "balance":"roundRobin","dns":"yandex","socksPort":10812,"httpPort":10813,
   "smart":true,"dnsRouting":false,"sniffing":false}}),
        )
        .unwrap();
        assert_eq!(
            c["routing"]["balancers"][0]["strategy"]["type"],
            "roundRobin"
        );
        assert_eq!(c["inbounds"][0]["port"], 10812);
        assert!(c.get("observatory").is_none());
        assert!(
            !c["outbounds"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v["tag"] == "dns-out")
        );
        assert!(c["dns"]["servers"][0].as_str().unwrap().contains("yandex"));
    }
    #[test]
    fn flag_prefix_groups_country_without_explicit_code() {
        let mut a = outbound("ZZ");
        a["tag"] = json!("🇵🇱Польша-1");
        let mut b = outbound("ZZ");
        b["tag"] = json!("🇵🇱Польша-2");
        let c = build(vec![a, b], &json!({"subscriptionJson":{"smart":true}})).unwrap();
        assert_eq!(c["routing"]["balancers"][0]["tag"], "PL_AUTO");
    }
    #[test]
    fn duplicated_public_ip_does_not_delete_nodes() {
        let mut a = outbound("DE");
        let mut b = outbound("PL");
        a["settings"]["vnext"][0]["address"] = json!("203.0.113.8");
        b["settings"]["vnext"][0]["address"] = json!("203.0.113.8");
        let c = build(vec![a, b], &json!({})).unwrap();
        // Two independent proxy connections plus direct/block; DNS-out is opt-in.
        assert_eq!(c["outbounds"].as_array().unwrap().len(), 4);
    }
    #[test]
    fn reject_unsafe_settings() {
        assert!(validate_settings(&json!({"route":[{"outboundTag":"direct"}]})).is_err());
        assert!(validate_settings(&json!({"dns":"cloudflare","smart":true})).is_ok());
        assert!(validate_settings(&json!({"balance":"unavailable"})).is_err());
    }
    #[test]
    fn reject_same_local_ports() {
        assert!(
            build(
                vec![outbound("RU")],
                &json!({"subscriptionJson":{
   "socksPort":10808,"httpPort":10808}})
            )
            .is_err()
        );
    }
}
