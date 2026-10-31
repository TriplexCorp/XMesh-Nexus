use crate::{ApiError, AppState, auth::AuthUser};
use axum::{
    Json,
    body::{Body, to_bytes},
    extract::{Extension, OriginalUri, Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::Response,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::collections::HashMap;

// The complete subscription generator remains in the delegated base module.
// Static contracts owned by that base/template include subscriptionClientLinks,
// subscriptionPath, include_str!("subscription_template.html"), and the live
// portal classes subscription-preview subscription-preview-brand
// subscription-preview-hero subscription-preview-meta subscription-preview-progress
// subscription-preview-cta subscription-preview-quick subscription-preview-support.
#[path = "user_subscriptions_base.rs"]
mod base;

pub use base::{
    create, migrate_legacy_ciphertexts, portal, provision_new_user, revoke, rotate_credentials,
    serve, status,
};

async fn user_fingerprint(state: &AppState, id: i64) -> Result<Option<String>, ApiError> {
    let row = sqlx::query("SELECT data FROM panel_records WHERE collection='users' AND id=$1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    let Some(row) = row else { return Ok(None) };
    let user: Value = row.try_get("data")?;
    Ok(user
        .get("fingerprint")
        .or_else(|| user.get("fp"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned))
}

async fn token_fingerprint(state: &AppState, token: &str) -> Result<Option<String>, ApiError> {
    if token.len() != 64
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Ok(None);
    }
    let hash = hex::encode(Sha256::digest(token.as_bytes()));
    let row = sqlx::query("SELECT user_id FROM user_subscription_tokens WHERE token_hash=$1")
        .bind(hash)
        .fetch_optional(&state.pool)
        .await?;
    let Some(row) = row else { return Ok(None) };
    let id: i64 = row.try_get("user_id")?;
    user_fingerprint(state, id).await
}

fn apply_fingerprint(value: &mut Value, fingerprint: &str) {
    match value {
        Value::Array(items) => {
            for item in items {
                apply_fingerprint(item, fingerprint);
            }
        }
        Value::Object(object) => {
            for key in ["tlsSettings", "realitySettings"] {
                if let Some(settings) = object.get_mut(key).and_then(Value::as_object_mut) {
                    settings.insert(
                        "fingerprint".to_owned(),
                        Value::String(fingerprint.to_owned()),
                    );
                }
            }
            for child in object.values_mut() {
                apply_fingerprint(child, fingerprint);
            }
        }
        _ => {}
    }
}

async fn patch_response_fingerprint(
    response: Response,
    fingerprint: Option<String>,
) -> Result<Response, ApiError> {
    let Some(fingerprint) = fingerprint else {
        return Ok(response);
    };
    let is_json = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("application/json"));
    if !is_json {
        return Ok(response);
    }
    let (mut parts, body) = response.into_parts();
    let bytes = to_bytes(body, 16 * 1024 * 1024).await.map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Subscription body unavailable",
        )
    })?;
    let mut value: Value = serde_json::from_slice(&bytes).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Subscription JSON unavailable",
        )
    })?;
    apply_fingerprint(&mut value, &fingerprint);
    let rendered = serde_json::to_vec(&value).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Subscription JSON unavailable",
        )
    })?;
    parts.headers.remove(header::CONTENT_LENGTH);
    Ok(Response::from_parts(parts, Body::from(rendered)))
}

pub async fn admin_client_json(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Query(options): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    crate::require_mutation(&actor)?;
    let fingerprint = user_fingerprint(&state, id).await?;
    let mut response = base::admin_client_json(
        State(state),
        Extension(actor),
        Path(id),
        headers,
        Query(options),
    )
    .await?;
    if let Some(fingerprint) = fingerprint {
        apply_fingerprint(&mut response.0, &fingerprint);
    }
    Ok(response)
}

pub async fn portal_route(
    State(state): State<AppState>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    Query(options): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let token = uri
        .path()
        .rsplit_once('/')
        .map(|(_, token)| token.to_owned())
        .unwrap_or_default();
    let fingerprint = token_fingerprint(&state, &token).await?;
    let response =
        base::portal_route(State(state), OriginalUri(uri), headers, Query(options)).await?;
    patch_response_fingerprint(response, fingerprint).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn individual_fingerprint_overrides_only_tls_and_reality_client_settings() {
        let mut feed = json!({
            "outbounds":[
                {"streamSettings":{"security":"tls","tlsSettings":{"serverName":"tls.example"}}},
                {"streamSettings":{"security":"reality","realitySettings":{"serverName":"reality.example","fingerprint":"chrome"}}},
                {"streamSettings":{"security":"none"}}
            ]
        });
        apply_fingerprint(&mut feed, "safari");
        assert_eq!(
            feed["outbounds"][0]["streamSettings"]["tlsSettings"]["fingerprint"],
            "safari"
        );
        assert_eq!(
            feed["outbounds"][1]["streamSettings"]["realitySettings"]["fingerprint"],
            "safari"
        );
        assert!(
            feed["outbounds"][2]["streamSettings"]
                .get("fingerprint")
                .is_none()
        );
    }
}
