//! First-ever Node policy-key bootstrap over the already enrolled strict
//! XSP/2 product tunnel. Read-only and ZERO AUTHORITY.
//!
//! The ordinary desired-config reply cannot be fetched first: it irrevocably
//! closes Genesis eligibility. Only the owner-enrolled strict-PQ product
//! tunnel is allowed to carry the persistent public policy signer identity.
//! This is not TOFU and cannot issue or install any Xray spending cap.
use crate::{ApiError, AppState, node_auth};
use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode, header},
};
use serde::Deserialize;
use serde_json::{Value,json};
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
    ApiError::new(StatusCode::CONFLICT,
        "First-genesis policy identity unavailable: Node already used or not active.")
}

fn gate() -> bool {
    crate::quota_v2::enabled()
        && crate::quota_xray_genesis::quarantine_enabled()
}

pub async fn handle(
    State(state): State<AppState>,
    headers: HeaderMap,
    raw: Bytes,
) -> Result<([(header::HeaderName, &'static str);1],Json<Value>),ApiError> {
    if !gate() {
        return Err(ApiError::new(StatusCode::NOT_FOUND,
            "Quota V2 first-genesis policy pin staging disabled."));
    }
    if raw.is_empty() || raw.len() > MAX_REQUEST {
        return Err(ApiError::new(StatusCode::BAD_REQUEST,
            "Invalid strict XSP/2 policy-key request size."));
    }
    let request: Request = serde_json::from_slice(&raw).map_err(|_| {
        ApiError::new(StatusCode::BAD_REQUEST,"Invalid policy-key request.")
    })?;
    if request.node_id <= 0 || request.operation != "discover_policy_signer" {
        return Err(ApiError::new(StatusCode::BAD_REQUEST,
            "Only an original zero-authority policy-key discovery is supported."));
    }
    // The strict gateway supplies BOTH the independently authenticated Node
    // ID and the original enrolled activation receipt SHA. Never trust JSON
    // claims or a client-supplied public key as an authorization source.
    let activation = node_auth::authenticate_product_activation(
        &state,&headers,request.node_id,PATH,
    ).await?;
    let row=sqlx::query(
        "SELECT encode(p.receipt_sha256,'hex') AS activation,
                g.first_activation_sha256,g.policy_path_used
           FROM quota_v2_xray_genesis AS g
           JOIN node_xsp_product_nodes AS p ON p.node_id=g.node_id
          WHERE g.node_id=$1 AND p.state='active'
          FOR SHARE OF g,p",
    )
    .bind(request.node_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(unavailable)?;
    let original:String=row.try_get("activation")?;
    let genesis:Option<String>=row.try_get("first_activation_sha256")?;
    let used:bool=row.try_get("policy_path_used")?;
    if used || original != activation || genesis.as_deref()!=Some(activation) {
        return Err(unavailable());
    }
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
    let key=state.node_policy_signer.public_key();
    Ok((
        [(header::CACHE_CONTROL,"no-store")],
        Json(json!({
            "status":"quarantine_pin_only",
            "nodeId":request.node_id,
            "activationReceiptSha256":activation,
            "policyPublicKey":key,
            "authorizedBytes":0,
            "canStart":false,
            "canResume":false,
            "refundableBytes":0
        })),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn policy_key_discovery_is_strictly_gated_and_never_admits() {
        let raw=serde_json::from_slice::<Request>(
            br#"{"node_id":123,"operation":"discover_policy_signer"}"#).unwrap();
        assert_eq!(raw.node_id,123);
        assert_eq!(raw.operation,"discover_policy_signer");
        assert!(serde_json::from_slice::<Request>(
            br#"{"node_id":123,"operation":"discover_policy_signer","authorizedBytes":1}"#
        ).is_err());
        assert!(serde_json::from_slice::<Request>(
            br#"{"node_id":123,"operation":"request_positive_cap"}"#
        ).is_ok()); // parser alone cannot grant: handler rejects any other operation
    }
}
