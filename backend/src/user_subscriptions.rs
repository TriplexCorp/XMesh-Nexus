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
#[path = "user_device_limits.rs"]
mod device_limits;

pub use base::{
    create, migrate_legacy_ciphertexts, provision_new_user, revoke, rotate_credentials,
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

// The product contract says an empty user override inherits the host and an
// empty host fingerprint means chrome. Older hosts may predate the explicit
// `fp` field, so generated client JSON must materialize that final fallback
// instead of merely showing it in the editor. Existing non-empty host values
// are preserved; a per-user override is applied afterwards.
fn ensure_default_fingerprint(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                ensure_default_fingerprint(item);
            }
        }
        Value::Object(object) => {
            for key in ["tlsSettings", "realitySettings"] {
                if let Some(settings) = object.get_mut(key).and_then(Value::as_object_mut) {
                    let missing = settings
                        .get("fingerprint")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .is_none_or(str::is_empty);
                    if missing {
                        settings
                            .insert("fingerprint".to_owned(), Value::String("chrome".to_owned()));
                    }
                }
            }
            for child in object.values_mut() {
                ensure_default_fingerprint(child);
            }
        }
        _ => {}
    }
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
    ensure_default_fingerprint(&mut value);
    if let Some(fingerprint) = fingerprint {
        apply_fingerprint(&mut value, &fingerprint);
    }
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
    ensure_default_fingerprint(&mut response.0);
    if let Some(fingerprint) = fingerprint {
        apply_fingerprint(&mut response.0, &fingerprint);
    }
    Ok(response)
}

pub async fn status(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    crate::require_mutation(&actor)?;
    let mut response = base::status(State(state.clone()), Extension(actor), Path(id)).await?;
    response.0["deviceLimit"] = device_limits::admin_status(&state, id).await?;
    Ok(response)
}

pub async fn serve(
    State(state): State<AppState>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Query(options): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let fingerprint = token_fingerprint(&state, &token).await?;
    let request_headers = headers.clone();
    // Generate the normal subscription first. A broken/inactive subscription
    // must never consume a trusted device slot merely because it was requested.
    let response = base::serve(
        State(state.clone()),
        Path(token.clone()),
        headers,
        Query(options),
    )
    .await?;
    let decision = device_limits::authorize_feed(&state, &token, &request_headers).await?;
    if matches!(
        &decision,
        device_limits::Decision::Missing { .. } | device_limits::Decision::LimitReached { .. }
    ) {
        return Ok(device_limits::apply_decision(
            response,
            decision,
            &request_headers,
        ));
    }
    let response = patch_response_fingerprint(response, fingerprint).await?;
    Ok(device_limits::apply_decision(
        response,
        decision,
        &request_headers,
    ))
}

pub async fn portal(
    State(state): State<AppState>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Query(options): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let wants_feed = crate::subscription_user_agent::wants_feed(&headers, &options)
        .map_err(|message| ApiError::new(StatusCode::BAD_REQUEST, message))?;
    if wants_feed {
        return serve(State(state), Path(token), headers, Query(options)).await;
    }
    // Human browser views never consume a device slot.
    base::portal(State(state), Path(token), headers, Query(options)).await
}

pub async fn portal_route(
    State(state): State<AppState>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    Query(options): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let (prefix, token) = uri
        .path()
        .rsplit_once('/')
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Subscription not found"))?;
    let settings = crate::read_settings(&state.pool).await?;
    let configured = settings
        .get("subscriptionPath")
        .and_then(Value::as_str)
        .filter(|path| path.starts_with('/'))
        .unwrap_or("/s")
        .trim_end_matches('/');
    if prefix != configured {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "Subscription not found",
        ));
    }
    let wants_feed = crate::subscription_user_agent::wants_feed(&headers, &options)
        .map_err(|message| ApiError::new(StatusCode::BAD_REQUEST, message))?;
    if wants_feed {
        return serve(
            State(state),
            Path(token.to_owned()),
            headers,
            Query(options),
        )
        .await;
    }
    base::portal_route(State(state), OriginalUri(uri), headers, Query(options)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn default_fingerprint_is_materialized_without_overwriting_host_choice() {
        let mut feed = json!({
            "outbounds":[
                {"streamSettings":{"security":"tls","tlsSettings":{"serverName":"tls.example"}}},
                {"streamSettings":{"security":"reality","realitySettings":{"serverName":"reality.example","fingerprint":"safari"}}}
            ]
        });
        ensure_default_fingerprint(&mut feed);
        assert_eq!(
            feed["outbounds"][0]["streamSettings"]["tlsSettings"]["fingerprint"],
            "chrome"
        );
        assert_eq!(
            feed["outbounds"][1]["streamSettings"]["realitySettings"]["fingerprint"],
            "safari"
        );
    }

    #[test]
    fn individual_fingerprint_overrides_only_tls_and_reality_client_settings() {
        let mut feed = json!({
            "outbounds":[
                {"streamSettings":{"security":"tls","tlsSettings":{"serverName":"tls.example"}}},
                {"streamSettings":{"security":"reality","realitySettings":{"serverName":"reality.example","fingerprint":"chrome"}}},
                {"streamSettings":{"security":"none"}}
            ]
        });
        ensure_default_fingerprint(&mut feed);
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
