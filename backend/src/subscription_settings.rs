//! Validation for the live public subscription portal and client catalog.
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
    let authority = value["https://".len()..].split(['/', '?']).next().unwrap_or("");
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
        "subscriptionBackground", "subscriptionCardColor", "subscriptionTextColor", "subscriptionSecondaryAccent",
    ] {
        if let Some(v) = object.get(key) {
            let text = v.as_str().ok_or_else(|| bad("Цвет должен быть текстом в формате #RRGGBB."))?;
            if !is_hex_color(text) { return Err(bad("Некорректный цвет. Используйте формат #RRGGBB.")); }
        }
    }
    for (key, values) in [
        ("subscriptionLayout", &["standard", "centered", "compact"][..]),
        ("subscriptionCardStyle", &["soft", "outline", "flat", "glass", "raised"][..]),
        ("subscriptionFont", &["system", "manrope", "mono", "onest", "inter", "golos", "rubik", "nunito", "plex", "roboto", "pt", "montserrat", "ubuntu", "opensans", "source", "fira", "jost"][..]),
        ("subscriptionClientLayout", &["grid", "list"][..]),
    ] {
        if let Some(v) = object.get(key) {
            let selected = v.as_str().ok_or_else(|| bad("Недопустимый вариант оформления."))?;
            if !values.contains(&selected) { return Err(bad("Неизвестный вариант оформления портала.")); }
        }
    }
    if let Some(v) = object.get("subscriptionRadius") {
        let radius = v.as_i64().ok_or_else(|| bad("Скругление должно быть целым числом."))?;
        if !(1..=36).contains(&radius) { return Err(bad("Скругление должно быть от 1 до 36 пикселей.")); }
    }
    for (key, max) in [
        ("subscriptionHero", 100), ("subscriptionHeroEn", 100), ("subscriptionCta", 80), ("subscriptionCtaEn", 80), ("subscriptionSupportLabel", 80), ("subscriptionSupportLabelEn", 80),
    ] {
        if let Some(v) = object.get(key) {
            let text = v.as_str().ok_or_else(|| bad("Название блока должно быть текстом."))?;
            if text.chars().count() > max || text.chars().any(char::is_control) {
                return Err(bad("Превышена максимальная длина текста портала."));
            }
        }
    }
    for key in ["subscriptionAppsTitle","subscriptionAppsTitleEn"] {
        if let Some(v) = object.get(key) {
            let title = v.as_str().ok_or_else(|| bad("Заголовок приложений должен быть строкой."))?;
            if title.chars().count() > 80 || title.chars().any(char::is_control) {
                return Err(bad("Заголовок приложений должен быть короче 80 символов."));
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
        "subscriptionSyncPanelTheme",
        "subscriptionShowStatus", "subscriptionShowApps", "subscriptionShowQr",
        "subscriptionShowCopy", "subscriptionShowSupport", "subscriptionShowDevices",
    ] {
        if let Some(v) = object.get(key) && !v.is_boolean() {
            return Err(bad("Параметры видимости должны быть переключателями."));
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
    if let Some(value) = object.get("subscriptionCustomClients") {
        let clients = value.as_array().ok_or_else(|| bad("Свои приложения должны быть массивом."))?;
        if clients.len() > 32 { return Err(bad("Можно добавить не более 32 своих приложений.")); }
        let mut ids = std::collections::HashSet::new();
        for client in clients {
            let record = client.as_object().ok_or_else(|| bad("Приложение должно быть объектом."))?;
            if record.len() != 5 || record.keys().any(|key|
                !["id", "name", "platforms", "url", "enabled"].contains(&key.as_str())
            ) {
                return Err(bad("Неизвестное или отсутствующее поле приложения."));
            }
            let id = record.get("id").and_then(Value::as_str)
                .ok_or_else(|| bad("Некорректный ID приложения."))?;
            if !id.starts_with("custom-") || id.len() > 32 || id.len() < 8 ||
                !id["custom-".len()..].bytes().all(|b| b.is_ascii_digit()) ||
                !ids.insert(id)
            {
                return Err(bad("Некорректный или повторяющийся ID приложения."));
            }
            let name = record.get("name").and_then(Value::as_str)
                .ok_or_else(|| bad("Некорректное название приложения."))?;
            let platforms = record.get("platforms").and_then(Value::as_str)
                .ok_or_else(|| bad("Некорректное описание платформ."))?;
            if name.trim().is_empty() || name.chars().count() > 80 ||
                name.chars().any(char::is_control) || platforms.chars().count() > 120 ||
                platforms.chars().any(char::is_control)
            {
                return Err(bad("Название или платформы приложения содержат недопустимые символы."));
            }
            let url = record.get("url").and_then(Value::as_str)
                .ok_or_else(|| bad("Ссылка приложения должна быть строкой."))?;
            if !safe_https_url(url) { return Err(bad("Укажите корректную HTTPS-ссылку своего приложения.")); }
            if !record.get("enabled").is_some_and(Value::is_boolean) {
                return Err(bad("Состояние приложения должно быть переключателем."));
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
        assert!(accepts(json!({"subscriptionRadius":29})));
        assert!(accepts(json!({"subscriptionRadius":36})));
        assert!(!accepts(json!({"subscriptionRadius":0})));
        assert!(!accepts(json!({"subscriptionRadius":37})));
        assert!(accepts(json!({"subscriptionSyncPanelTheme":true})));
        assert!(accepts(json!({"subscriptionAppsTitleEn":"Connection apps","subscriptionHeroEn":"Active"})));
        assert!(!accepts(json!({"subscriptionAppsTitleEn":"<script>\u{0000}</script>"})));
        assert!(!accepts(json!({"subscriptionHeroEn":false})));
        assert!(!accepts(json!({"subscriptionSyncPanelTheme":"yes"})));
        assert!(!accepts(json!({"subscriptionBackground":"red"})));
        assert!(!accepts(json!({"subscriptionShowApps":"yes"})));
        assert!(accepts(json!({"subscriptionAppsTitle":"Поддерживаемые клиенты",
            "subscriptionCustomClients":[{"id":"custom-1","name":"My Client",
            "platforms":"Android · iOS","url":"https://example.com/install",
            "enabled":true}]})));
        assert!(accepts(json!({"subscriptionCustomClients":[]})));
        assert!(!accepts(json!({"subscriptionAppsTitle":true})));
        assert!(!accepts(json!({"subscriptionAppsTitle":"x".repeat(81)})));
        assert!(!accepts(json!({"subscriptionCustomClients":[{"id":"custom-1",
            "name":"", "platforms":"iOS","url":"","enabled":true}]})));
        assert!(!accepts(json!({"subscriptionCustomClients":[{"id":"custom-1",
            "name":"Custom","platforms":"","url":"javascript:alert(1)","enabled":true}]})));
        assert!(!accepts(json!({"subscriptionCustomClients":[{"id":"custom-1",
            "name":"Client A","platforms":"","url":"","enabled":true},
            {"id":"custom-1","name":"Client B","platforms":"","url":"","enabled":false}]})));
        assert!(!accepts(json!({"subscriptionCustomClients":[{"id":"custom-2",
            "name":"Client","platforms":"","url":"","enabled":"yes"}]})));
        assert!(!accepts(json!({"subscriptionCustomClients":[{"id":"custom-2",
            "name":"Client","platforms":"","url":"","enabled":true,
            "html":"<script>alert(1)</script>"}]})));
        assert!(!accepts(json!({"subscriptionCustomClients":vec![json!({
            "id":"custom-1","name":"Client","platforms":"","url":"","enabled":true
        }); 33]})));

    }
}
