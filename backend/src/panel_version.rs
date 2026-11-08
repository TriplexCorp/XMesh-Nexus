//! Read-only build provenance and owner-only upstream version check.
//! The update command remains isolated in the existing host-owned updater.
use axum::{Json, extract::Extension};
use serde_json::{Value, json};
use std::time::Duration;

use crate::{ApiError, auth, require_owner};

const PRODUCT_VERSION: &str = include_str!("../../VERSION");
// The display release advances with the verified first-parent main history.
// VERSION remains pinned for v6 agent / post-quantum protocol compatibility.
const DISPLAY_VERSION: &str = match option_env!("PANEL_DISPLAY_VERSION") {
    Some(version) => version,
    None => "unknown",
};
fn installed_panel_version() -> &'static str {
    let version = DISPLAY_VERSION.trim();
    let parts = version.split('.').collect::<Vec<_>>();
    if parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit())
        })
    {
        version
    } else {
        PRODUCT_VERSION.trim()
    }
}
const BUILD_REVISION: &str = match option_env!("PANEL_BUILD_REVISION") {
    Some(revision) => revision,
    None => "unknown",
};
const GITHUB_API: &str = "https://api.github.com/repos/TriplexCorp/XMesh-Nexus";

fn valid_revision(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}
fn installed_revision() -> Option<&'static str> {
    valid_revision(BUILD_REVISION).then_some(BUILD_REVISION)
}
fn classify_compare_status(value: &str) -> &'static str {
    match value {
        "ahead" => "update_available",
        "identical" => "up_to_date",
        "behind" => "local_ahead",
        _ => "unverifiable",
    }
}

/// A stable, local source of truth, usable without external network access.
/// Every authenticated role can inspect the panel version.
pub async fn installed() -> Json<Value> {
    Json(json!({
        "version": installed_panel_version(),
        "compatibility_version": PRODUCT_VERSION.trim(),
        "revision": installed_revision(),
        "source": "running_build"
    }))
}

async fn github_json(client: &reqwest::Client, path: &str) -> Option<Value> {
    let response = client
        .get(format!("{GITHUB_API}/{path}"))
        .header(reqwest::header::USER_AGENT, "XMesh-Nexus-VersionCheck")
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<Value>().await.ok()
}

/// Only the owner may initiate an upstream network check; it is never an update.
/// Git ancestry still determines update availability: the semantic display
/// version alone is not proof that one installed binary contains another.
pub async fn check(Extension(actor): Extension<auth::AuthUser>) -> Result<Json<Value>, ApiError> {
    require_owner(&actor)?;
    let Ok(client) = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(9))
        .build()
    else {
        return Ok(Json(json!({"status":"unavailable"})));
    };
    let remote = github_json(&client, "commits/main").await;
    let Some(remote_sha) = remote
        .as_ref()
        .and_then(|body| body.get("sha"))
        .and_then(Value::as_str)
        .filter(|sha| valid_revision(sha))
    else {
        return Ok(Json(json!({"status":"unavailable"})));
    };
    let Some(local) = installed_revision() else {
        return Ok(Json(json!({
            "status":"unknown_revision",
            "latest_revision":remote_sha,
            "version":installed_panel_version()
        })));
    };
    if local == remote_sha {
        return Ok(Json(json!({
            "status":"up_to_date",
            "latest_revision":remote_sha,
            "revision":local
        })));
    }
    let compare = github_json(&client, &format!("compare/{local}...{remote_sha}")).await;
    let Some(compare) = compare else {
        return Ok(Json(json!({
            "status":"unverifiable",
            "latest_revision":remote_sha,
            "revision":local
        })));
    };
    let status =
        classify_compare_status(compare.get("status").and_then(Value::as_str).unwrap_or(""));
    Ok(Json(json!({
        "status":status,
        "latest_revision":remote_sha,
        "revision":local,
        "commits_behind":compare.get("ahead_by").and_then(Value::as_u64)
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn display_version_has_a_safe_fallback() {
        assert_eq!(installed_panel_version().split('.').count(), 3);
        assert_eq!(PRODUCT_VERSION.trim(), "6.0.0");
    }
    #[test]
    fn revision_validation_is_strict() {
        assert!(valid_revision(&"a".repeat(40)));
        assert!(!valid_revision(&"A".repeat(40)));
        assert!(!valid_revision(&"z".repeat(40)));
        assert!(!valid_revision(&"a".repeat(39)));
        assert!(!valid_revision("main"));
    }
    #[test]
    fn divergence_never_claims_update_available() {
        assert_eq!(classify_compare_status("ahead"), "update_available");
        assert_eq!(classify_compare_status("identical"), "up_to_date");
        assert_eq!(classify_compare_status("behind"), "local_ahead");
        assert_eq!(classify_compare_status("diverged"), "unverifiable");
    }
}
