//! Per-user protocol credentials. A VPN UUID is an identity, not a universal
//! password: new users and explicit owner rekeys get independent secrets.
//! Legacy users without these fields retain their existing UUID credentials
//! until an explicit, disruptive "Rotate VPN access" action.
use aes_gcm::aead::{OsRng, rand_core::RngCore};
use serde_json::{Map, Value, json};
use std::collections::HashSet;
use uuid::Uuid;

pub const INDEPENDENT_FIELDS: [&str; 7] = [
    "vmessId",
    "trojanPassword",
    "ssLegacyPassword",
    "hysteriaPassword",
    "masquePassword",
    "socksPassword",
    "httpPassword",
];

fn random_password() -> String {
    let mut secret = [0u8; 32];
    OsRng.fill_bytes(&mut secret);
    hex::encode(secret)
}

/// Generate fresh unrelated credentials. Only VLESS gets `xrayId`; `VMess` gets
/// its own v4 UUID, while all password-based protocols get 256-bit secrets.
pub fn generate() -> Map<String, Value> {
    let mut fields = Map::new();
    fields.insert("xrayId".into(), json!(Uuid::new_v4().to_string()));
    fields.insert("vmessId".into(), json!(Uuid::new_v4().to_string()));
    for field in &INDEPENDENT_FIELDS[1..] {
        fields.insert((*field).into(), json!(random_password()));
    }
    fields
}

fn independent_field(protocol: &str) -> Option<&'static str> {
    match protocol {
        "vmess" => Some("vmessId"),
        "trojan" => Some("trojanPassword"),
        "shadowsocks" => Some("ssLegacyPassword"),
        "hysteria" => Some("hysteriaPassword"),
        "masque" => Some("masquePassword"),
        "socks" | "mixed" => Some("socksPassword"),
        "http" => Some("httpPassword"),
        _ => None,
    }
}

fn valid_secret(field: &str, secret: &str) -> bool {
    if field == "vmessId" {
        return Uuid::parse_str(secret).is_ok();
    }
    secret.len() == 64 && secret.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Recover older accounts without changing their already installed clients.
/// An explicitly present but invalid secret is NEVER downgraded to the old
/// UUID: absence means legacy, corruption means fail closed.
pub fn for_protocol<'a>(user: &'a Value, protocol: &str) -> Option<&'a str> {
    let id = user.get("xrayId")?.as_str()?;
    Uuid::parse_str(id).ok()?;
    if protocol == "vless" {
        return Some(id);
    }
    let field = independent_field(protocol)?;
    match user.get(field) {
        Some(value) => {
            let secret = value.as_str()?;
            valid_secret(field, secret).then_some(secret)
        }
        None => Some(id),
    }
}

/// UI must expose an explicit legacy warning: simply installing new backend
/// code cannot isolate already-imported secrets without breaking clients.
pub fn is_isolated(user: &Value) -> bool {
    let Some(vless) = for_protocol(user, "vless") else {
        return false;
    };
    let mut seen = HashSet::from([vless]);
    for field in INDEPENDENT_FIELDS {
        let protocol = match field {
            "vmessId" => "vmess",
            "trojanPassword" => "trojan",
            "ssLegacyPassword" => "shadowsocks",
            "hysteriaPassword" => "hysteria",
            "masquePassword" => "masque",
            "socksPassword" => "socks",
            "httpPassword" => "http",
            _ => return false,
        };
        if user.get(field).is_none() {
            return false;
        }
        let Some(secret) = for_protocol(user, protocol) else {
            return false;
        };
        if !seen.insert(secret) {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_user_has_independent_random_secrets() {
        let user = Value::Object(generate());
        assert!(is_isolated(&user));
        assert_ne!(user["vmessId"], user["xrayId"]);
        assert!(Uuid::parse_str(for_protocol(&user, "vmess").unwrap()).is_ok());
        for protocol in [
            "trojan",
            "shadowsocks",
            "hysteria",
            "masque",
            "http",
            "socks",
        ] {
            let secret = for_protocol(&user, protocol).unwrap();
            assert_eq!(secret.len(), 64, "{protocol}");
            assert!(secret.bytes().all(|b| b.is_ascii_hexdigit()));
            assert_ne!(secret, user["xrayId"].as_str().unwrap());
        }
        assert_eq!(for_protocol(&user, "mixed"), for_protocol(&user, "socks"));
        assert_ne!(Value::Object(generate()), user);
    }

    #[test]
    fn old_uuid_accounts_remain_functional_but_are_flagged_for_rekey() {
        let user = json!({"xrayId":"550e8400-e29b-41d4-a716-446655440000"});
        assert!(!is_isolated(&user));
        for protocol in [
            "vless",
            "vmess",
            "trojan",
            "shadowsocks",
            "hysteria",
            "masque",
            "http",
            "socks",
        ] {
            assert_eq!(for_protocol(&user, protocol), user["xrayId"].as_str());
        }
    }

    #[test]
    fn corrupted_or_malformed_credentials_are_not_downgraded() {
        let mut user = Value::Object(generate());
        user["trojanPassword"] = json!("not-a-256-bit-secret");
        assert!(for_protocol(&user, "trojan").is_none());
        assert!(!is_isolated(&user));
        user["vmessId"] = json!("not-a-uuid");
        assert!(for_protocol(&user, "vmess").is_none());
    }
}
