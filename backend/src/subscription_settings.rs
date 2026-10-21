//! Validation for admin-defined subscription-portal appearance and client catalog.
//! This config is a blueprint. Public subscription delivery belongs to a
//! separate service and is not implemented in this repository.
use crate::ApiError;
use axum::http::StatusCode;
use serde_json::{Map, Value};

const CLIENTS: &[&str] = &[
    "happ", "incy", "v2raytun", "v2rayn", "v2rayng", "streisand",
    "hiddify", "nekobox", "shadowrocket", "flclash", "stash",
    "singbox", "v2box", "loon", "mihomo", "clashverge",
];

fn bad(message: &str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, message)
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

fn safe_https_url(value: &str) -> bool {
    if value.is_empty() { return true; }
    if value.len() > 512 || !value.starts_with("https://")
        || !value.is_ascii() || value.bytes().any(|b| b <= 0x20 || b == 0x7f || b == b'\\')
        || value.contains('#') { return false; }
    let authority = value["https://".len()..].split('/').next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') || authority.contains(':') ||
        authority.starts_with('.') || authority.ends_with('.') || authority.contains("..") { return false; }
    authority.split('.').all(|label| {
        !label.is_empty() && label.len() <= 63
            && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            && label.as_bytes()[0].is_ascii_alphanumeric()
            && label.as_bytes()[label.len()-1].is_ascii_alphanumeric()
    })
}

pub(crate) fn validate(object: &Map<String, Value>) -> Result<(), ApiError> {
    for key in [
        "subscriptionBackground", "subscriptionCardColor", "subscriptionTextColor",
    ] {
        if let Some(v) = object.get(key) {
            let text = v.as_str().ok_or_else(|| bad("Цвет должен быть текстом в формате #RRGGBB."))?;
            if !is_hex_color(text) { return Err(bad("Некорректный цвет. Используйте формат #RRGGBB.")); }
        }
    }
    for (key, values) in [
        ("subscriptionLayout", &["standard", "centered", "compact"][..]),
        ("subscriptionCardStyle", &["soft", "outline", "flat"][..]),
        ("subscriptionFont", &["system", "manrope", "mono"][..]),
        ("subscriptionClientLayout", &["grid", "list"][..]),
    ] {
        if let Some(v) = object.get(key) {
            let selected = v.as_str().ok_or_else(|| bad("Недопустимый вариант оформления."))?;
            if !values.contains(&selected) { return Err(bad("Неизвестный вариант оформления портала.")); }
        }
    }
    if let Some(v) = object.get("subscriptionRadius") {
        let radius = v.as_i64().ok_or_else(|| bad("Скругление должно быть целым числом."))?;
        if !(0..=32).contains(&radius) { return Err(bad("Скругление должно быть от 0 до 32 пикселей.")); }
    }
    for (key, max) in [
        ("subscriptionHero", 100), ("subscriptionCta", 80), ("subscriptionSupportLabel", 80),
    ] {
        if let Some(v) = object.get(key) {
            let text = v.as_str().ok_or_else(|| bad("Название блока должно быть текстом."))?;
            if text.chars().count() > max || text.chars().any(char::is_control) {
                return Err(bad("Превышена максимальная длина текста портала."));
            }
        }
    }
    for key in ["subscriptionLogoUrl", "subscriptionSupportUrl"] {
        if let Some(v) = object.get(key) {
            let url = v.as_str().ok_or_else(|| bad("Ссылка должна быть строкой."))?;
            if !safe_https_url(url) { return Err(bad("Допустима только корректная HTTPS-ссылка без логина и нестандартного порта.")); }
        }
    }
    for key in [
        "subscriptionShowStatus", "subscriptionShowApps", "subscriptionShowQr",
        "subscriptionShowCopy", "subscriptionShowSupport", "subscriptionShowDevices",
    ] {
        if let Some(v) = object.get(key) {
            if !v.is_boolean() { return Err(bad("Параметры видимости должны быть переключателями.")); }
        }
    }
    if let Some(v) = object.get("subscriptionClients") {
        let clients = v.as_object().ok_or_else(|| bad("Каталог приложений должен быть объектом."))?;
        if clients.len() > CLIENTS.len() { return Err(bad("Слишком много приложений в каталоге.")); }
        for (key, enabled) in clients {
            if !CLIENTS.contains(&key.as_str()) || !enabled.is_boolean() {
                return Err(bad("Неизвестное приложение или неверное состояние переключателя."));
            }
        }
    }
    if let Some(v) = object.get("subscriptionClientLinks") {
        let links = v.as_object().ok_or_else(|| bad("Ссылки приложений должны быть объектом."))?;
        if links.len() > CLIENTS.len() { return Err(bad("Слишком много ссылок приложений.")); }
        for (key, link) in links {
            if !CLIENTS.contains(&key.as_str()) ||
                !link.as_str().is_some_and(safe_https_url) {
                return Err(bad("Некорректная HTTPS-ссылка приложения или неизвестный клиент."));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn accepts(input: Value) -> bool { validate(input.as_object().unwrap()).is_ok() }
    #[test]
    fn validates_clients_and_presentation() {
        assert!(accepts(json!({"subscriptionClients":{"happ":true,"incy":false},
            "subscriptionLayout":"centered","subscriptionRadius":24,
            "subscriptionClientLinks":{"happ":"https://example.com/download"}})));
        assert!(!accepts(json!({"subscriptionClients":{"unknown":true}})));
        assert!(!accepts(json!({"subscriptionClients":{"happ":"yes"}})));
        assert!(!accepts(json!({"subscriptionClientLinks":{"happ":"javascript:alert(1)"}})));
        assert!(!accepts(json!({"subscriptionLogoUrl":"https://user:pass@example.com/logo.png"})));
        assert!(!accepts(json!({"subscriptionSupportUrl":"http://example.com"})));
        assert!(!accepts(json!({"subscriptionRadius":33})));
        assert!(!accepts(json!({"subscriptionBackground":"red"})));
        assert!(!accepts(json!({"subscriptionShowApps":"yes"})));
    }
}
