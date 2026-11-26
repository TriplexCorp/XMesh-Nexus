//! Strict-PQ authenticated, non-authorizing public TLS candidate diagnostic.
//!
//! This handler does not sign a public TLS authority, open a socket,
//! install a cap or assert that Xray is running. In particular, a matching
//! SQL record cannot attest the Linux process or a fully fsynced meter WAL.
//! The SQL roster is checked under account/lease/revocation locks, which
//! are released before replying. A future issuer must retain them through
//! signing and durable commit, and verify live Node evidence.
//! Returning a candidate NEVER permits traffic.
mod revocation;
pub(crate) mod signed_roster;

pub use revocation::handle as revocation_handle;

use crate::{ApiError, AppState, node_auth};
use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode, header},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const PATH: &str = "/api/v1/node/quota-v2/public-tls-preflight";
const MAX_BODY: usize = 1536;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    pub(crate) node_id: i64,
    pub(crate) user_id: i64,
    pub(crate) activation_receipt_sha256: String,
    pub(crate) genesis_policy_sha256: String,
    pub(crate) runtime_id: String,
    pub(crate) profile_revision: String,
    pub(crate) cap_roster_sha256: String,
    pub(crate) required_lifetime_ms: i64,
}

fn hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(crate) fn valid(request: &Request) -> bool {
    request.node_id > 0
        && request.user_id > 0
        && [
            &request.activation_receipt_sha256,
            &request.genesis_policy_sha256,
            &request.runtime_id,
            &request.profile_revision,
            &request.cap_roster_sha256,
        ]
        .into_iter()
        .all(|digest| hex64(digest))
        && (1_000..=120_000).contains(&request.required_lifetime_ms)
}

fn deny() -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        "No public TLS preflight evidence for the enrolled Node.",
    )
}

fn reply(node_id: i64, user_id: i64, verified_digest: Option<&str>) -> Value {
    json!({
        "status": "candidate_only_not_authorized",
        "nodeId": node_id,
        "userId": user_id,
        "evidenceMatched": verified_digest.is_some(),
        "capRosterSha256": verified_digest,
        "canServePublic": false,
        "canStart": false,
        "canResume": false,
        "canSpend": false,
        "authorizedBytes": 0,
        "signedEnvelope": null,
        "liveMeterVerified": false,
        "certificateVerified": false,
        "revocationWatchInstalled": false,
    })
}

/// Only enrolled strict-PQ Nodes may inspect their own candidate evidence.
/// Direct unsigned or legacy HTTP requests lack the product gateway's
/// authenticated internal token/path/original activation receipt binding.
///
/// The SQL filter is strictly advisory. Success cannot become a signed
/// positive TLS authority, even if the database lists an unexpired cap.
pub async fn handle(
    State(state): State<AppState>,
    headers: HeaderMap,
    raw: Bytes,
) -> Result<([(header::HeaderName, &'static str); 1], Json<Value>), ApiError> {
    if !crate::quota_v2::enabled() || !crate::quota_xray_genesis::quarantine_enabled() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "Quota V2 public TLS preflight is disabled.",
        ));
    }
    if raw.is_empty() || raw.len() > MAX_BODY {
        return Err(deny());
    }
    let request: Request = serde_json::from_slice(&raw).map_err(|_| deny())?;
    if !valid(&request) {
        return Err(deny());
    }

    let activation =
        node_auth::authenticate_product_activation(&state, &headers, request.node_id, PATH).await?;
    if activation != request.activation_receipt_sha256 {
        return Err(deny());
    }

    // Strict-PQ identity is only the first gate. Independently verify
    // the ORIGINAL signed Genesis policy and EVERY immutable first cap
    // against the pinned actual Nexus signer and the serialized SQL gate.
    // A user-supplied roster digest never qualifies by itself.
    let verified_digest = signed_roster::authenticated_digest(&state, &request, activation).await?;
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(reply(
            request.node_id,
            request.user_id,
            verified_digest.as_deref(),
        )),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> Request {
        Request {
            node_id: 47,
            user_id: 91,
            activation_receipt_sha256: "a".repeat(64),
            genesis_policy_sha256: "b".repeat(64),
            runtime_id: "c".repeat(64),
            profile_revision: "d".repeat(64),
            cap_roster_sha256: "e".repeat(64),
            required_lifetime_ms: 30_000,
        }
    }

    #[test]
    fn request_rejects_foreign_identity_invalid_ttl_and_extra_fields() {
        let good = request();
        assert!(valid(&good));
        let mut bad = request();
        bad.runtime_id = "C".repeat(64);
        assert!(!valid(&bad));
        bad = request();
        bad.genesis_policy_sha256.pop();
        assert!(!valid(&bad));
        bad = request();
        bad.node_id = 0;
        assert!(!valid(&bad));
        bad = request();
        bad.user_id = -1;
        assert!(!valid(&bad));
        for ttl in [-1, 0, 999, 120_001] {
            let mut other = request();
            other.required_lifetime_ms = ttl;
            assert!(!valid(&other));
        }
        let mut json = serde_json::to_value(request()).expect("sample request");
        json["foreignSignerKey"] = Value::String("f".repeat(64));
        assert!(serde_json::from_value::<Request>(json).is_err());
        let mut json = serde_json::to_value(request()).expect("sample request");
        json["requiredLifetimeMs"] = Value::Bool(true);
        assert!(serde_json::from_value::<Request>(json).is_err());
    }

    #[test]
    fn matching_database_evidence_still_never_authorizes_public_tls() {
        for candidate in [Some("e".repeat(64)), None] {
            let result = reply(47, 91, candidate.as_deref());
            assert_eq!(result["status"], "candidate_only_not_authorized");
            assert_eq!(result["evidenceMatched"], candidate.is_some());
            assert_eq!(
                result["capRosterSha256"],
                candidate.map_or(Value::Null, Value::String)
            );
            assert_eq!(result["canServePublic"], false);
            assert_eq!(result["canStart"], false);
            assert_eq!(result["canResume"], false);
            assert_eq!(result["canSpend"], false);
            assert_eq!(result["authorizedBytes"], 0);
            assert!(result["signedEnvelope"].is_null());
            assert_eq!(result["liveMeterVerified"], false);
            assert_eq!(result["certificateVerified"], false);
            assert_eq!(result["revocationWatchInstalled"], false);
        }
    }

    #[test]
    fn parser_requires_one_exact_original_activation_and_no_extra_keys() {
        let base = json!({
            "nodeId": 47,
            "userId": 91,
            "activationReceiptSha256": "a".repeat(64),
            "genesisPolicySha256": "b".repeat(64),
            "runtimeId": "c".repeat(64),
            "profileRevision": "d".repeat(64),
            "capRosterSha256": "e".repeat(64),
            "requiredLifetimeMs": 30_000,
        });
        let req: Request = serde_json::from_value(base.clone()).expect("valid request");
        assert!(valid(&req));
        for field in [
            "activationReceiptSha256",
            "runtimeId",
            "nodeId",
            "capRosterSha256",
        ] {
            let mut modified = base.clone();
            modified.as_object_mut().expect("object").remove(field);
            assert!(serde_json::from_value::<Request>(modified).is_err());
        }
        for change in [
            "activationReceiptSha256",
            "runtimeId",
            "profileRevision",
            "capRosterSha256",
        ] {
            let mut modified = base.clone();
            modified[change] = json!("e".repeat(63));
            let request: Request = serde_json::from_value(modified).expect("string still parses");
            assert!(!valid(&request));
        }
    }
}
