//! Integration API v1. Strictly separate from browser sessions and node identities.
//! An integration token never authenticates to legacy /api/v1/collections.
#[path = "integration_api_auth.rs"]
mod auth;
#[path = "integration_api_catalog.rs"]
mod catalog;
#[path = "integration_api_grants.rs"]
mod grants;
#[path = "integration_api_quotas.rs"]
mod quotas;
#[path = "integration_api_squad_members.rs"]
mod squad_members;
#[path = "integration_api_telegram.rs"]
mod telegram;
#[path = "integration_api_user_mutations.rs"]
mod user_mutations;
#[path = "integration_api_users.rs"]
mod users;

use crate::{ApiError, AppState};
use axum::{
    Json, Router,
    http::{HeaderValue, StatusCode, header},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub use auth::{create_token, list_tokens, revoke_token};

#[derive(Clone, Debug)]
pub struct ServicePrincipal {
    client_id: i64,
    token_id: i64,
    name: String,
    scopes: Vec<String>,
    allowed_user_ids: Option<Vec<i64>>,
}

impl ServicePrincipal {
    fn allow_scope(&self, scope: &str) -> Result<(), Problem> {
        if self.scopes.iter().any(|s| s == scope) {
            Ok(())
        } else {
            Err(Problem::new(
                StatusCode::FORBIDDEN,
                "insufficient_scope",
                "Insufficient scope",
            ))
        }
    }

    fn allow_user(&self, id: i64) -> Result<(), Problem> {
        if id < 1 {
            return Err(Problem::new(
                StatusCode::NOT_FOUND,
                "not_found",
                "User not found",
            ));
        }
        if self
            .allowed_user_ids
            .as_ref()
            .is_none_or(|ids| ids.contains(&id))
        {
            Ok(())
        } else {
            // Never reveal if an inaccessible ID exists.
            Err(Problem::new(
                StatusCode::NOT_FOUND,
                "not_found",
                "User not found",
            ))
        }
    }
}

#[derive(Debug)]
pub struct Problem {
    status: StatusCode,
    code: &'static str,
    message: &'static str,
}

impl Problem {
    const fn new(status: StatusCode, code: &'static str, message: &'static str) -> Self {
        Self {
            status,
            code,
            message,
        }
    }
    const fn unavailable() -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "temporarily_unavailable",
            "Service unavailable",
        )
    }
}

impl From<ApiError> for Problem {
    fn from(error: ApiError) -> Self {
        match error.status {
            StatusCode::NOT_FOUND => Self::new(StatusCode::NOT_FOUND, "not_found", "Not found"),
            StatusCode::CONFLICT => Self::new(StatusCode::CONFLICT, "conflict", "Conflict"),
            StatusCode::BAD_REQUEST => Self::new(
                StatusCode::BAD_REQUEST,
                "validation_error",
                "Invalid request",
            ),
            _ => Self::unavailable(),
        }
    }
}

impl From<sqlx::Error> for Problem {
    fn from(error: sqlx::Error) -> Self {
        tracing::error!(%error, "Integration API SQL failure");
        Self::unavailable()
    }
}

impl IntoResponse for Problem {
    fn into_response(self) -> Response {
        let request_id = Uuid::new_v4().to_string();
        let mut response = (
            self.status,
            Json(json!({
                "type": format!("urn:xmesh:problem:{}", self.code),
                "title": self.message,
                "status": self.status.as_u16(),
                "code": self.code,
                "requestId": request_id
            })),
        )
            .into_response();
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/problem+json"),
        );
        if self.status == StatusCode::TOO_MANY_REQUESTS {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static("60"));
        }
        if let Ok(value) = HeaderValue::from_str(&request_id) {
            response.headers_mut().insert("x-request-id", value);
        }
        response
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX)
}

#[expect(
    clippy::needless_pass_by_value,
    reason = "Owned API response data is serialized into a new envelope"
)]
pub fn reply(data: Value) -> Json<Value> {
    Json(json!({
        "data": data,
        "meta": {
            "apiVersion": "v1",
            "requestId": Uuid::new_v4().to_string(),
            "serverNowMs": now_ms()
        }
    }))
}

async fn capabilities(
    axum::extract::Extension(client): axum::extract::Extension<ServicePrincipal>,
) -> Result<Json<Value>, Problem> {
    Ok(reply(json!({
        "version": "v1",
        "service": client.name,
        "scopes": client.scopes,
        "features": {
            "usersRead": true,
            "trafficRead": true,
            "subscriptionsRead": true,
            "entitlementsGrant": true,
            "accessControl": true,
            "usersCreate": client.scopes.iter().any(|s| s == "users:create"),
            "usersUpdate": client.scopes.iter().any(|s| s == "users:update"),
            "quotasRead": client.scopes.iter().any(|s| s == "quotas:read"),
            "quotasWrite": client.scopes.iter().any(|s| s == "quotas:write"),
            "squadsRead": client.scopes.iter().any(|s| s == "squads:read"),
            "squadsMembersWrite": client.scopes.iter().any(|s| s == "squads:members:write"),
            "nodesRead": client.scopes.iter().any(|s| s == "nodes:read"),
            "telegramRead": client.scopes.iter().any(|s| s == "telegram:read"),
            "telegramAssign": client.scopes.iter().any(|s| s == "telegram:assign")
        }
    })))
}

pub fn service_router(state: &AppState) -> Router<AppState> {
    Router::new()
        .route("/capabilities", get(capabilities))
        .route("/users", get(users::list).post(user_mutations::create))
        .route("/users/by-telegram/{telegram_id}", get(telegram::lookup))
        .route(
            "/users/{id}/telegram",
            axum::routing::patch(telegram::assign),
        )
        .route("/users/{id}", get(users::get).patch(user_mutations::patch))
        .route("/users/{id}/traffic", get(users::traffic))
        .route("/users/{id}/quotas", get(quotas::get).patch(quotas::patch))
        .route("/users/{id}/subscription", get(users::subscription))
        .route("/squads", get(catalog::list_squads))
        .route("/squads/{id}", get(catalog::get_squad))
        .route(
            "/squads/{id}/members",
            post(squad_members::add).delete(squad_members::remove),
        )
        .route("/nodes", get(catalog::list_nodes))
        .route("/nodes/{id}", get(catalog::get_node))
        .route("/users/{id}/enable", post(users::enable))
        .route("/users/{id}/disable", post(users::disable))
        .route("/users/{id}/entitlements/grant", post(grants::grant))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_service,
        ))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(64 * 1024))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn user_scope_is_object_scoped_and_never_confuses_a_secret() {
        let p = ServicePrincipal {
            client_id: 1,
            token_id: 3,
            name: "test".into(),
            scopes: vec!["users:read".into()],
            allowed_user_ids: Some(vec![123]),
        };
        assert!(p.allow_scope("users:read").is_ok());
        assert!(p.allow_scope("entitlements:grant").is_err());
        assert!(p.allow_user(123).is_ok());
        assert!(p.allow_user(124).is_err());
        assert!(p.allow_user(0).is_err());
    }
}
