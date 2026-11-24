//! Original Node policy-key bootstrap over an ALREADY enrolled strict XSP/2
//! product tunnel. Read-only and ZERO AUTHORITY.
//!
//! Ordinary desired-config permanently closes first-Genesis eligibility.
//! A new Node must pin the persistent Ed25519 policy signer WITHOUT invoking
//! that path or trusting a self-declared Node ID or HTTP public key.
use crate::{ApiError, AppState, node_auth};
use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode, header},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;

const PATH: &str = "/api/v1/node/quota-v2/policy-pin";
const MAX_REQUEST: usize = 2048;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    node_id: i64,
    operation: String,
}

fn unavailable() -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        "First-genesis policy identity unavailable: Node already used or not active.",
    )
}

fn valid_request(req: &Request) -> bool {
    req.node_id > 0
        && matches!(
            req.operation.as_str(),
            "discover_policy_signer" | "preview_quarantined_config"
        )
}

fn gate() -> bool {
    crate::quota_v2::enabled() && crate::quota_xray_genesis::quarantine_enabled()
}

fn zero_authority_response(node: i64, activation: &str, signer: &str) -> Value {
    json!({
        "status":"quarantine_pin_only",
        "nodeId":node,
        "activationReceiptSha256":activation,
        "policyPublicKey":signer,
        "authorizedBytes":0,
        "canStart":false,
        "canResume":false,
        "refundableBytes":0
    })
}

/// Strict product-tunneled, feature-gated, owner-enrolled Node key discovery.
///
/// # Errors
/// Denies every non-product request, reused/old Genesis, failed activation,
/// unsupported operation, oversized payload, or database error.
pub async fn handle(
    State(state): State<AppState>,
    headers: HeaderMap,
    raw: Bytes,
) -> Result<([(header::HeaderName, &'static str); 1], Json<Value>), ApiError> {
    if !gate() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "Quota V2 first-genesis policy pin staging disabled.",
        ));
    }
    if raw.is_empty() || raw.len() > MAX_REQUEST {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid strict XSP/2 policy-key request size.",
        ));
    }
    let request: Request = serde_json::from_slice(&raw)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid policy-key request."))?;
    if !valid_request(&request) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Only zero-authority original policy-key or config preview requests are supported.",
        ));
    }
    // The strictly isolated product gateway forwards the original signed
    // activation SHA; its per-Node product identity is independently enrolled.
    // An HTTP header or JSON field alone is never a trust source.
    let activation =
        node_auth::authenticate_product_activation(&state, &headers, request.node_id, PATH).await?;
    let row = sqlx::query(
        "SELECT encode(p.receipt_sha256,'hex') AS activation,
                g.first_activation_sha256,g.policy_path_used,g.prepared_ms
           FROM quota_v2_xray_genesis AS g
           JOIN node_xsp_product_nodes AS p ON p.node_id=g.node_id
          WHERE g.node_id=$1 AND p.state='active'
          FOR SHARE OF g,p",
    )
    .bind(request.node_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(unavailable)?;
    let original: String = row.try_get("activation")?;
    let genesis: Option<String> = row.try_get("first_activation_sha256")?;
    let used: bool = row.try_get("policy_path_used")?;
    if used || original != activation || genesis.as_deref() != Some(activation) {
        return Err(unavailable());
    }
    // A discovered signing key must NEVER authenticate a replacement Node
    // or resurrect old offline quota. This is a strict first-ever stage.
    let previous: bool = sqlx::query_scalar(
        "SELECT
          EXISTS(SELECT 1 FROM node_desired_revisions WHERE node_id=$1)
          OR EXISTS(SELECT 1 FROM quota_v2_reservations WHERE node_id=$1)
          OR EXISTS(SELECT 1 FROM quota_v2_external_wal_birth_anchors WHERE node_id=$1)
          OR EXISTS(SELECT 1 FROM user_node_quota_lifetime WHERE node_id=$1)
          OR EXISTS(SELECT 1 FROM verified_traffic_deltas WHERE node_id=$1)",
    )
    .bind(request.node_id)
    .fetch_one(&state.pool)
    .await?;
    if previous {
        return Err(unavailable());
    }
    if request.operation == "preview_quarantined_config" {
        let prepared_ms: Option<i64> = row.try_get("prepared_ms")?;
        if prepared_ms.is_some() {
            return Err(unavailable());
        }
        return signed_config_preview(&state, request.node_id, activation).await;
    }
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(zero_authority_response(
            request.node_id,
            activation,
            &state.node_policy_signer.public_key(),
        )),
    ))
}

async fn signed_config_preview(
    state: &AppState,
    node_id: i64,
    activation: &str,
) -> Result<([(header::HeaderName, &'static str); 1], Json<Value>), ApiError> {
    let compiled = crate::node_runtime::first_genesis_config_preview(state, node_id).await?;
    let now: i64 =
        sqlx::query_scalar("SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint")
            .fetch_one(&state.pool)
            .await?;
    let payload = json!({
        "schemaVersion":1,
        "kind":"xmesh.quota-v2.quarantined-config-preview",
        "nodeId":node_id,
        "activationReceiptSha256":activation,
        "profileId":compiled["profileId"],
        "port":compiled["port"],
        "config":compiled["config"],
        "configSha256":compiled["configSha256"],
        "issuedAtMs":now,
        "validUntilMs":now.saturating_add(120_000),
        "authorizedBytes":0,
        "publicIngressAllowed":false,
        "canStart":false,
        "canResume":false,
        "refundableBytes":0,
    });
    let signature = state
        .node_policy_signer
        .sign_domain(b"XMESH_XRAY_QUARANTINE_CONFIG_V1\0", &payload)
        .map_err(|_| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Config preview signing failed.",
            )
        })?;
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(json!({"algorithm":"Ed25519","payload":payload,"signature":signature})),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_key_discovery_is_strictly_gated_and_never_admits() {
        let parsed = serde_json::from_slice::<Request>(
            br#"{"node_id":123,"operation":"discover_policy_signer"}"#,
        )
        .unwrap();
        assert!(valid_request(&parsed));
        assert!(valid_request(&Request {
            node_id: 123,
            operation: "preview_quarantined_config".to_owned(),
        }));
        assert!(!valid_request(&Request {
            node_id: 123,
            operation: "request_positive_cap".to_owned(),
        }));
        assert!(!valid_request(&Request {
            node_id: -1,
            operation: "discover_policy_signer".to_owned(),
        }));
        assert!(
            serde_json::from_slice::<Request>(
                br#"{"node_id":123,"operation":"discover_policy_signer","authorizedBytes":1}"#
            )
            .is_err()
        );
        let reply = zero_authority_response(123, &"a".repeat(64), &"b".repeat(64));
        assert_eq!(reply["authorizedBytes"], 0);
        assert_eq!(reply["canStart"], false);
        assert_eq!(reply["canResume"], false);
        assert_eq!(reply["refundableBytes"], 0);
        assert_eq!(reply["status"], "quarantine_pin_only");
    }
}
