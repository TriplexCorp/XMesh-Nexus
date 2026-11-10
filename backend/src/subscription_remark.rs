//! Dynamic public Host remark labels. Only the client-visible label is templated:
//! Xray routing tags, endpoint addresses and secrets must remain untouched.
use serde_json::Value;
use std::net::IpAddr;

pub const VARIABLES: &[&str] = &[
    "SERVER_IP",
    "SERVER_IPV6",
    "USERNAME",
    "DATA_USAGE",
    "DATA_LEFT",
    "DATA_LIMIT",
    "CDN_DATA_LEFT",
    "NODE_DATA_LEFT",
    "TRAFFIC_LEFT",
    "DAYS_LEFT",
    "EXPIRE_DATE",
    "JALALI_EXPIRE_DATE",
    "TIME_LEFT",
    "STATUS_TEXT",
    "STATUS_EMOJI",
    "PROTOCOL",
    "TRANSPORT",
];

pub const EMOJI_STATUSES: &[(&str, &str)] = &[
    ("ACTIVE", "✅"),
    ("ON_HOLD", "⌛️"),
    ("LIMITED", "🪫"),
    ("EXPIRED", "❌"),
    ("DISABLED", "🔌"),
];

pub fn validate_emoji_settings(value: &Value) -> Result<(), String> {
    let map = value
        .as_object()
        .ok_or("Эмодзи статусов должны быть объектом")?;
    for (status, value) in map {
        if !EMOJI_STATUSES.iter().any(|(key, _)| key == status) {
            return Err(format!("Неизвестный статус эмодзи: {status}"));
        }
        let emoji = value
            .as_str()
            .ok_or_else(|| format!("Эмодзи {status} должен быть строкой"))?;
        if emoji.is_empty() || emoji.chars().count() > 16 || emoji.chars().any(char::is_control) {
            return Err(format!("Недопустимый эмодзи для статуса {status}"));
        }
    }
    Ok(())
}

/// Stable quota classification for client-visible labels. The owner node ID
/// can later support node-scoped policies, but this revision does not enforce them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrafficScope {
    Account,
    Cdn,
    Unknown,
}

#[derive(Clone, Copy, Debug)]
pub struct TrafficContext {
    pub scope: TrafficScope,
    pub cdn_used_bytes: Option<i64>,
    #[expect(
        dead_code,
        reason = "Reserved for future per-node quota lookup; current CDN quota is pooled"
    )]
    pub owner_node_id: Option<i64>,
    pub node_remaining: crate::node_user_quotas::Remaining,
}

impl Default for TrafficContext {
    fn default() -> Self {
        Self {
            scope: TrafficScope::Unknown,
            cdn_used_bytes: None,
            owner_node_id: None,
            node_remaining: crate::node_user_quotas::Remaining::Unavailable,
        }
    }
}

/// Calculate in exact decimal bytes, rounding only the displayed GB value.
fn cdn_left(user: &Value, used_bytes: Option<i64>) -> String {
    let limit = bytes_gb(user, "cdnLimitGb");
    if limit <= 0.0 {
        return "∞".to_owned();
    }
    let Some(consumed_bytes) = used_bytes else {
        return "—".to_owned();
    };
    let remaining = crate::gb_to_bytes_i64(limit)
        .saturating_sub(consumed_bytes.max(0))
        .max(0);
    let hundredths = remaining.saturating_add(5_000_000) / 10_000_000;
    format!("{}.{:02} ГБ", hundredths / 100, hundredths % 100)
}

/// Format exact server-derived per-node balances for a client label.
fn node_left(state: crate::node_user_quotas::Remaining) -> String {
    match state {
        crate::node_user_quotas::Remaining::Unlimited => "∞".to_owned(),
        crate::node_user_quotas::Remaining::Unavailable => "—".to_owned(),
        crate::node_user_quotas::Remaining::Bytes(0) => "0.00 ГБ".to_owned(),
        crate::node_user_quotas::Remaining::Bytes(bytes) if bytes < 5_000_000 => {
            "<0.01 ГБ".to_owned()
        }
        crate::node_user_quotas::Remaining::Bytes(bytes) => {
            let rounded = bytes.saturating_add(5_000_000) / 10_000_000;
            format!("{}.{:02} ГБ", rounded / 100, rounded % 100)
        }
    }
}

fn field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
}
fn bytes_gb(value: &Value, key: &str) -> f64 {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite() && *n > 0.0)
        .unwrap_or(0.0)
}
fn gb(value: f64) -> String {
    format!("{value:.2} ГБ")
}
fn epoch_ms(value: &Value) -> i64 {
    let raw = value.get("expireAt").and_then(Value::as_i64).unwrap_or(0);
    if raw <= 0 {
        0
    } else if raw < 100_000_000_000 {
        raw.saturating_mul(1000)
    } else {
        raw
    }
}

// Gregorian UTC conversion with no extra dependencies (civil_from_days).
const fn gregorian(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    (year, month, day)
}

// Gregorian -> Solar Hijri (Jalali), matching the conventional Marzban date.
fn jalali(gy: i64, gm: i64, gd: i64) -> (i64, i64, i64) {
    let months = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let gy2 = gy + i64::from(gm > 2);
    let mut days = 355_666 + 365 * gy + (gy2 + 3) / 4 - (gy2 + 99) / 100
        + (gy2 + 399) / 400
        + gd
        + months[usize::try_from(gm - 1).expect("valid Gregorian month")];
    let mut jy = -1_595 + 33 * (days / 12_053);
    days %= 12_053;
    jy += 4 * (days / 1_461);
    days %= 1_461;
    if days > 365 {
        jy += (days - 1) / 365;
        days = (days - 1) % 365;
    }
    let (jm, jd) = if days < 186 {
        (1 + days / 31, 1 + days % 31)
    } else {
        (7 + (days - 186) / 30, 1 + (days - 186) % 30)
    };
    (jy, jm, jd)
}
fn expire_date(expiry_ms: i64, persian: bool) -> String {
    if expiry_ms <= 0 {
        return "∞".to_owned();
    }
    let (year, month, day) = gregorian(expiry_ms.div_euclid(86_400_000));
    let (year, month, day) = if persian {
        jalali(year, month, day)
    } else {
        (year, month, day)
    };
    format!("{year:04}-{month:02}-{day:02}")
}

fn public_ip(value: &str, ipv6: bool) -> Option<String> {
    let addr: IpAddr = value.trim_matches(['[', ']']).parse().ok()?;
    match addr {
        IpAddr::V4(ip)
            if !ipv6
                && !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_broadcast()
                && !ip.is_unspecified()
                && !ip.is_multicast() =>
        {
            Some(ip.to_string())
        }
        IpAddr::V6(ip)
            if ipv6
                && !ip.is_loopback()
                && !ip.is_unique_local()
                && !ip.is_unspecified()
                && !ip.is_multicast() =>
        {
            Some(ip.to_string())
        }
        _ => None,
    }
}
#[expect(
    clippy::too_many_arguments,
    clippy::too_many_lines,
    reason = "A single auditable template variable switch requires the explicit user, endpoint and quota context"
)]
fn resolve(
    variable: &str,
    user: &Value,
    inbound: &Value,
    _host: &Value,
    settings: &Value,
    now_ms: i64,
    server_address: &str,
    traffic: TrafficContext,
) -> Option<String> {
    let status = crate::user_status(user, now_ms);
    let consumed = bytes_gb(user, "used");
    let limit = bytes_gb(user, "limit");
    let hold = status == "ON_HOLD";
    let expiry_ms = epoch_ms(user);
    let remaining_ms = expiry_ms.saturating_sub(now_ms).max(0);
    Some(match variable {
        "SERVER_IP" => public_ip(server_address, false).unwrap_or_else(|| "—".into()),
        "SERVER_IPV6" => public_ip(server_address, true).unwrap_or_else(|| "—".into()),
        "USERNAME" => field(user, "username")
            .or_else(|| field(user, "name"))
            .unwrap_or("—")
            .to_owned(),
        "DATA_USAGE" => gb(consumed),
        "DATA_LEFT" => {
            if limit <= 0.0 {
                "∞".into()
            } else {
                gb((limit - consumed).max(0.0))
            }
        }
        "DATA_LIMIT" => {
            if limit <= 0.0 {
                "∞".into()
            } else {
                gb(limit)
            }
        }
        "CDN_DATA_LEFT" => cdn_left(user, traffic.cdn_used_bytes),
        "NODE_DATA_LEFT" => node_left(traffic.node_remaining),
        "TRAFFIC_LEFT" => match traffic.node_remaining {
            crate::node_user_quotas::Remaining::Bytes(_) => node_left(traffic.node_remaining),
            crate::node_user_quotas::Remaining::Unavailable => "—".into(),
            crate::node_user_quotas::Remaining::Unlimited => match traffic.scope {
                TrafficScope::Account => {
                    if limit <= 0.0 {
                        "∞".into()
                    } else {
                        gb((limit - consumed).max(0.0))
                    }
                }
                TrafficScope::Cdn => cdn_left(user, traffic.cdn_used_bytes),
                TrafficScope::Unknown => "—".into(),
            },
        },
        "DAYS_LEFT" => {
            if hold {
                user.get("holdDays")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    .max(0)
                    .to_string()
            } else if expiry_ms <= 0 {
                "∞".into()
            } else {
                ((remaining_ms + 86_399_999) / 86_400_000).to_string()
            }
        }
        "TIME_LEFT" => {
            if hold {
                "До первого подключения".into()
            } else if expiry_ms <= 0 {
                "∞".into()
            } else {
                let seconds = remaining_ms / 1000;
                format!(
                    "{} д. {} ч. {} мин.",
                    seconds / 86_400,
                    (seconds / 3_600) % 24,
                    (seconds / 60) % 60
                )
            }
        }
        "EXPIRE_DATE" => {
            if hold {
                "—".into()
            } else {
                expire_date(expiry_ms, false)
            }
        }
        "JALALI_EXPIRE_DATE" => {
            if hold {
                "—".into()
            } else {
                expire_date(expiry_ms, true)
            }
        }
        "STATUS_TEXT" => match status {
            "ACTIVE" => "Активна",
            "ON_HOLD" => "Ожидает подключения",
            "LIMITED" => "Трафик исчерпан",
            "EXPIRED" => "Истекла",
            _ => "Отключена",
        }
        .into(),
        "STATUS_EMOJI" => settings
            .get("subscriptionStatusEmojis")
            .and_then(|v| field(v, status))
            .or_else(|| {
                EMOJI_STATUSES
                    .iter()
                    .find(|(key, _)| *key == status)
                    .map(|(_, emoji)| *emoji)
            })
            .unwrap_or("❔")
            .to_owned(),
        "PROTOCOL" => field(inbound, "protocol").unwrap_or("—").to_uppercase(),
        "TRANSPORT" => inbound
            .get("streamSettings")
            .and_then(|s| field(s, "method").or_else(|| field(s, "network")))
            .unwrap_or("tcp")
            .to_owned(),
        _ => return None,
    })
}

/// Single-pass substitution prevents values containing braces from being expanded
/// as new tokens. Unknown variables remain literal to make typos visible.
pub fn render(
    template: &str,
    user: &Value,
    inbound: &Value,
    host: &Value,
    settings: &Value,
    now_ms: i64,
    server_address: &str,
) -> String {
    render_with_context(
        template,
        user,
        inbound,
        host,
        settings,
        now_ms,
        server_address,
        TrafficContext::default(),
    )
}

#[expect(
    clippy::too_many_arguments,
    reason = "Explicit immutable inputs keep quota scope separate from user-controlled data"
)]
pub fn render_with_context(
    template: &str,
    user: &Value,
    inbound: &Value,
    host: &Value,
    settings: &Value,
    now_ms: i64,
    server_address: &str,
    traffic: TrafficContext,
) -> String {
    sanitize_text(
        &expand_template(template, user, inbound, host, settings, now_ms, server_address, traffic),
        100,
        false,
    )
}

/// VPN client announcement headers are user-specific, but have no endpoint or
/// node context. Per-node variables therefore return a visible dash instead of
/// fabricating a balance. The selected message is expanded after UTC rotation.
pub fn render_announcement(
    template: &str,
    user: &Value,
    settings: &Value,
    now_ms: i64,
    cdn_used_bytes: Option<i64>,
) -> String {
    let inbound = serde_json::json!({"protocol":"—","streamSettings":{"network":"—"}});
    let scope = TrafficContext { cdn_used_bytes, ..TrafficContext::default() };
    sanitize_text(
        &expand_template(template, user, &inbound, &Value::Null, settings, now_ms, "", scope),
        3072,
        true,
    )
}

/// Preserve newlines in announcements (they are base64-encoded as a header);
/// never keep CR/control characters or produce an oversized HTTP header.
/// The byte limit is applied only after variable expansion and at UTF-8
/// boundaries so a long username cannot break header serialization.
fn sanitize_text(value: &str, max_bytes: usize, allow_newlines: bool) -> String {
    let mut result = String::with_capacity(value.len().min(max_bytes));
    for ch in value.chars() {
        if ch.is_control() && !(allow_newlines && ch == '\n') {
            continue;
        }
        if result.len().saturating_add(ch.len_utf8()) > max_bytes {
            break;
        }
        result.push(ch);
    }
    result
}

#[expect(
    clippy::too_many_arguments,
    reason = "Shared non-recursive placeholder expansion keeps personalized labels and announcements consistent"
)]
fn expand_template(
    template: &str,
    user: &Value,
    inbound: &Value,
    host: &Value,
    settings: &Value,
    now_ms: i64,
    server_address: &str,
    traffic: TrafficContext,
) -> String {
    let mut remainder = template;
    let mut result = String::with_capacity(template.len().min(256));
    while let Some(start) = remainder.find('{') {
        result.push_str(&remainder[..start]);
        let after = &remainder[start + 1..];
        let Some(end) = after.find('}') else {
            remainder = &remainder[start..];
            break;
        };
        let variable = &after[..end];
        if VARIABLES.contains(&variable) {
            let value = resolve(
                variable,
                user,
                inbound,
                host,
                settings,
                now_ms,
                server_address,
                traffic,
            )
            .expect("declared variable must resolve");
            result.push_str(&value);
        } else {
            result.push_str(&remainder[start..start + end + 2]);
        }
        remainder = &after[end + 1..];
    }
    result.push_str(remainder);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn all_placeholders_resolve_without_touching_unknown_tokens() {
        let user = json!({"username":"alice","used":2.5,"limit":10.0});
        let inbound = json!({"protocol":"vless","streamSettings":{"network":"xhttp"}});
        let host = json!({"remark":"unused"});
        for variable in VARIABLES {
            let token = format!("{{{variable}}}");
            let resolved = render(
                &token,
                &user,
                &inbound,
                &host,
                &json!({}),
                1_800_000_000_000,
                "203.0.113.7",
            );
            assert_ne!(resolved, token, "variable {variable} was not resolved");
        }
        let output = render(
            "{USERNAME} {PROTOCOL} {TRANSPORT}",
            &user,
            &inbound,
            &host,
            &json!({}),
            1_800_000_000_000,
            "203.0.113.7",
        );
        assert!(output.contains("alice") && output.contains("VLESS") && output.contains("xhttp"));
        assert!(render("Hi {TYPO}", &user, &inbound, &host, &json!({}), 0, "").contains("{TYPO}"));
    }

    #[test]
    fn emoji_override_is_applied_and_validated() {
        let user = json!({"username":"alice","disabled":true});
        let settings = json!({"subscriptionStatusEmojis":{"DISABLED":"🛑"}});
        let output = render(
            "{STATUS_EMOJI} {STATUS_TEXT}",
            &user,
            &json!({}),
            &json!({}),
            &settings,
            0,
            "",
        );
        assert_eq!(output, "🛑 Отключена");
        assert!(validate_emoji_settings(&settings["subscriptionStatusEmojis"]).is_ok());
        assert!(validate_emoji_settings(&json!({"UNKNOWN":"x"})).is_err());
    }

    #[test]
    fn lifetime_and_solar_date_are_correct() {
        let unix_days = 20_533_i64; // 2026-03-21
        assert_eq!(expire_date(unix_days * 86_400_000, false), "2026-03-21");
        assert_eq!(expire_date(unix_days * 86_400_000, true), "1405-01-01");
        let user = json!({"expireAt":unix_days * 86_400_000,"limit":0});
        assert_eq!(
            render(
                "{DAYS_LEFT}",
                &user,
                &json!({}),
                &json!({}),
                &json!({}),
                unix_days * 86_400_000 - 5_000,
                ""
            ),
            "1"
        );
        assert_eq!(
            render(
                "{DATA_LEFT}/{DATA_LIMIT}",
                &user,
                &json!({}),
                &json!({}),
                &json!({}),
                0,
                ""
            ),
            "∞/∞"
        );
    }

    #[test]
    fn quota_display_is_based_on_scope_and_authoritative_meter() {
        let account = json!({"username":"example","limit":0.0,"used":80.0,
            "cdnLimitGb":5.0});
        let inbound = json!({"protocol":"vless"});
        let host = json!({"remark":"Poland"});
        let settings = json!({});
        let render_for = |scope, used_bytes| {
            render_with_context(
                "{DATA_LEFT}|{CDN_DATA_LEFT}|{TRAFFIC_LEFT}",
                &account,
                &inbound,
                &host,
                &settings,
                0,
                "vpn.example.org",
                TrafficContext {
                    scope,
                    cdn_used_bytes: used_bytes,
                    owner_node_id: Some(7),
                    node_remaining: crate::node_user_quotas::Remaining::Unlimited,
                },
            )
        };
        assert_eq!(
            render_for(TrafficScope::Account, Some(1_750_000_000)),
            "∞|3.25 ГБ|∞"
        );
        assert_eq!(
            render_for(TrafficScope::Cdn, Some(1_750_000_000)),
            "∞|3.25 ГБ|3.25 ГБ"
        );
        assert_eq!(
            render_for(TrafficScope::Cdn, Some(5_900_000_000)),
            "∞|0.00 ГБ|0.00 ГБ"
        );
        assert_eq!(
            render_for(TrafficScope::Unknown, Some(1_750_000_000)),
            "∞|3.25 ГБ|—"
        );
        assert_eq!(render_for(TrafficScope::Cdn, None), "∞|—|—");
        assert_eq!(cdn_left(&json!({"cdnLimitGb":0}), None), "∞");
    }

    #[test]
    fn node_remaining_overrides_global_and_cdn_without_rewriting_endpoint() {
        let user = json!({"username":"alice","limit":0,"cdnLimitGb":5.0});
        let inbound = json!({"protocol":"vless"});
        let host = json!({"remark":"server C"});
        let settings = json!({});
        let display = |remaining| {
            render_with_context(
                "{NODE_DATA_LEFT}|{TRAFFIC_LEFT}",
                &user,
                &inbound,
                &host,
                &settings,
                0,
                "example.com",
                TrafficContext {
                    scope: TrafficScope::Cdn,
                    cdn_used_bytes: Some(0),
                    owner_node_id: Some(42),
                    node_remaining: remaining,
                },
            )
        };
        assert_eq!(
            display(crate::node_user_quotas::Remaining::Bytes(3_250_000_000)),
            "3.25 ГБ|3.25 ГБ"
        );
        assert_eq!(
            display(crate::node_user_quotas::Remaining::Bytes(0)),
            "0.00 ГБ|0.00 ГБ"
        );
        assert_eq!(
            display(crate::node_user_quotas::Remaining::Unavailable),
            "—|—"
        );
        assert_eq!(
            display(crate::node_user_quotas::Remaining::Unlimited),
            "∞|5.00 ГБ"
        );
    }

    #[test]
    fn announcement_substitutes_user_and_real_cdn_balance_across_lines() {
        let user = json!({"username":"alice","limit":0,"used":3.0,
            "cdnLimitGb":5.0,"expireAt":0});
        let settings = json!({"subscriptionStatusEmojis":{"ACTIVE":"💚"}});
        let rendered = render_announcement(
            "Пользователь: {USERNAME}\nОсталось LTE: {CDN_DATA_LEFT}\nСтатус: {STATUS_EMOJI}",
            &user, &settings, 1_800_000_000_000, Some(1_750_000_000),
        );
        assert_eq!(rendered, "Пользователь: alice\nОсталось LTE: 3.25 ГБ\nСтатус: 💚");
    }

    #[test]
    fn announcement_never_guesses_node_or_transport_and_never_recurses() {
        let user = json!({"username":"{STATUS_EMOJI}","cdnLimitGb":5.0});
        let rendered = render_announcement(
            "{USERNAME}|{NODE_DATA_LEFT}|{TRAFFIC_LEFT}|{SERVER_IP}|{TRANSPORT}|{CDN_DATA_LEFT}",
            &user, &json!({}), 0, None,
        );
        assert_eq!(rendered, "{STATUS_EMOJI}|—|—|—|—|—");
        assert_eq!(render_announcement("{UNKNOWN}", &user, &json!({}), 0, None), "{UNKNOWN}");
    }

    #[test]
    fn announcement_preserves_newlines_but_strips_controls_and_limits_encoded_size() {
        let user = json!({"username":"a".repeat(9000)});
        let result = render_announcement("Сообщение\r\n{USERNAME}\0\nГотово",
            &user, &json!({}), 0, None);
        assert!(result.starts_with("Сообщение\n"));
        assert!(!result.contains('\r'));
        assert!(!result.contains('\0'));
        assert!(result.len() <= 3072);
        assert!(std::str::from_utf8(result.as_bytes()).is_ok());
        let emoji = json!({"username":"💚".repeat(1100)});
        let result = render_announcement("{USERNAME}", &emoji, &json!({}), 0, None);
        assert!(result.len() <= 3072);
        assert!(result.chars().all(|c| c == '💚'));
    }

    #[test]
    fn no_origin_ip_leak_when_using_cdn_domain() {
        let user = json!({"username":"{STATUS_EMOJI}"});
        let out = render(
            "{USERNAME} {SERVER_IP}",
            &user,
            &json!({}),
            &json!({}),
            &json!({}),
            0,
            "cdn.example.com",
        );
        assert_eq!(out, "{STATUS_EMOJI} —");
    }
}
