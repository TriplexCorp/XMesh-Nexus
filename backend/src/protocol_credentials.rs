//! Independently generated protocol credentials, shared by subscription issuer
//! and managed-node provisioner. Legacy records use xrayId until an explicit
//! owner-initiated rekey; upgrades must not break already-imported clients.
use aes_gcm::aead::{OsRng, rand_core::RngCore};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Map, Value, json};
use uuid::Uuid;

pub const PROTOCOL_FIELDS: [&str; 5] = [
    "vmessId",
    "trojanPassword",
    "hysteriaPassword",
    "masquePassword",
    "ssLegacyPassword",
];

fn secret256() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Generate all managed credentials on user creation or explicit full rekey.
/// VLESS remains a protocol-required UUID v4; VMess gets an independent UUID.
pub fn provision(object: &mut Map<String, Value>) {
    object.insert("xrayId".into(), json!(Uuid::new_v4().to_string()));
    object.insert("vmessId".into(), json!(Uuid::new_v4().to_string()));
    for field in ["trojanPassword", "hysteriaPassword", "masquePassword", "ssLegacyPassword"] {
        object.insert(field.into(), json!(secret256()));
    }
    let mut key256 = [0u8; 32];
    let mut key128 = [0u8; 16];
    OsRng.fill_bytes(&mut key256);
    OsRng.fill_bytes(&mut key128);
    object.insert("ssPassword".into(), json!(STANDARD.encode(key256)));
    object.insert("ssPassword128".into(), json!(STANDARD.encode(key128)));
}

/// For existing records missing independent fields, retain the old per-user
/// xrayId so client imports do not break until explicit VPN access rotation.
/// Never use this fallback for new accounts: provision() creates all fields.
pub fn for_protocol<'a>(user: &'a Value, protocol: &str, ss_method: &str) -> Option<&'a str> {
    let legacy = user.get("xrayId")?.as_str().filter(|v| Uuid::parse_str(v).is_ok())?;
    let name = match protocol {
        "vless" => return Some(legacy),
        "vmess" => "vmessId",
        "trojan" => "trojanPassword",
        "hysteria" => "hysteriaPassword",
        "masque" => "masquePassword",
        "shadowsocks" if ss_method.starts_with("2022-") => {
            if ss_method == "2022-blake3-aes-128-gcm" {
                "ssPassword128"
            } else {
                "ssPassword"
            }
        }
        "shadowsocks" => "ssLegacyPassword",
        _ => return None,
    };
    let value = user.get(name).and_then(Value::as_str).filter(|v| !v.is_empty());
    if protocol == "shadowsocks" && ss_method.starts_with("2022-") {
        return value;
    }
    if protocol == "vmess" {
        return Some(value.filter(|v| Uuid::parse_str(v).is_ok()).unwrap_or(legacy));
    }
    Some(value.filter(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit())).unwrap_or(legacy))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn new_protocol_credentials_are_distinct_and_consistent() {
        let mut obj = Map::new();
        provision(&mut obj);
        let user = Value::Object(obj);
        let vless = for_protocol(&user, "vless", "").unwrap();
        let vmess = for_protocol(&user, "vmess", "").unwrap();
        assert_ne!(vless, vmess);
        let mut secrets = std::collections::HashSet::new();
        for protocol in ["trojan", "hysteria", "masque", "shadowsocks"] {
            let secret = for_protocol(&user, protocol, "aes-256-gcm").unwrap();
            assert_eq!(secret.len(), 64);
            assert!(secrets.insert(secret));
            assert_ne!(secret, vless);
            assert_ne!(secret, vmess);
        }
        assert_eq!(secrets.len(), 4);
        assert_eq!(STANDARD.decode(for_protocol(&user, "shadowsocks", "2022-blake3-aes-256-gcm").unwrap()).unwrap().len(), 32);
        assert_eq!(STANDARD.decode(for_protocol(&user, "shadowsocks", "2022-blake3-aes-128-gcm").unwrap()).unwrap().len(), 16);
    }
    #[test]
    fn existing_records_keep_legacy_passwords_until_explicit_rekey() {
        let old = json!({"xrayId":"f47ac10b-58cc-4372-a567-0e02b2c3d479"});
        for protocol in ["vless", "vmess", "trojan", "hysteria", "masque", "shadowsocks"] {
            assert_eq!(for_protocol(&old, protocol, "aes-256-gcm"),old["xrayId"].as_str());
        }
        assert!(for_protocol(&old, "shadowsocks", "2022-blake3-aes-256-gcm").is_none());
    }
    #[test]
    fn rekey_changes_all_protocol_credentials() {
        let mut obj = Map::new();
        provision(&mut obj);
        let before = Value::Object(obj.clone());
        provision(&mut obj);
        let after = Value::Object(obj);
        for method in ["vless", "vmess", "trojan", "hysteria", "masque", "shadowsocks"] {
            assert_ne!(for_protocol(&before, method, "aes-256-gcm"),for_protocol(&after, method, "aes-256-gcm"));
        }
        assert_ne!(before["ssPassword"],after["ssPassword"]);
        assert_ne!(before["ssPassword128"],after["ssPassword128"]);
    }
}
