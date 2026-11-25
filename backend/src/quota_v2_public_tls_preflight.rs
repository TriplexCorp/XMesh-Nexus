//! Strict-PQ authenticated, READ-ONLY public TLS candidate diagnostic.
//!
//! This handler does not sign a public TLS authority, open a socket,
//! install a cap or assert that Xray is running. In particular, a matching
//! SQL record cannot attest the Linux process or a fully fsynced meter WAL.
//! The future issuer must recheck *all* of these conditions under the
//! correct account/lease/revocation locks and verify live Node evidence.
//! Returning a candidate NEVER permits traffic.
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
struct Request {
    node_id: i64,
    user_id: i64,
    activation_receipt_sha256: String,
    genesis_policy_sha256: String,
    runtime_id: String,
    profile_revision: String,
    required_lifetime_ms: i64,
}

fn hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn valid(request: &Request) -> bool {
    request.node_id > 0
        && request.user_id > 0
        && [
            &request.activation_receipt_sha256,
            &request.genesis_policy_sha256,
            &request.runtime_id,
            &request.profile_revision,
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

fn reply(node_id: i64, user_id: i64, evidence_matched: bool) -> Value {
    json!({
        "status": "candidate_only_not_authorized",
        "nodeId": node_id,
        "userId": user_id,
        "evidenceMatched": evidence_matched,
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

    // The pinned signer is taken ONLY from Nexus AppState: Node-provided
    // alternate keys must never make a foreign signed cap look authentic.
    let signer = state.node_policy_signer.public_key();
    let evidence_matched: bool = sqlx::query_scalar(
        "SELECT EXISTS(
             SELECT 1 FROM quota_v2_public_tls_first_cap_candidates(
                 $1,$2,$3,$4,$5,$6,$7
             ) AS candidate
             WHERE candidate.user_id=$8
         )",
    )
    .bind(request.node_id)
    .bind(activation)
    .bind(&request.runtime_id)
    .bind(&request.profile_revision)
    .bind(&request.genesis_policy_sha256)
    .bind(&signer)
    .bind(request.required_lifetime_ms)
    .bind(request.user_id)
    .fetch_one(&state.pool)
    .await?;

    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(reply(request.node_id, request.user_id, evidence_matched)),
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
        for candidate in [true, false] {
            let result = reply(47, 91, candidate);
            assert_eq!(result["status"], "candidate_only_not_authorized");
            assert_eq!(result["evidenceMatched"], candidate);
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
            "requiredLifetimeMs": 30_000,
        });
        let req: Request = serde_json::from_value(base.clone()).expect("valid request");
        assert!(valid(&req));
        for field in ["activationReceiptSha256", "runtimeId", "nodeId"] {
            let mut modified = base.clone();
            modified.as_object_mut().expect("object").remove(field);
            assert!(serde_json::from_value::<Request>(modified).is_err());
        }
        for change in ["activationReceiptSha256", "runtimeId", "profileRevision"] {
            let mut modified = base.clone();
            modified[change] = json!("e".repeat(63));
            let request: Request = serde_json::from_value(modified).expect("string still parses");
            assert!(!valid(&request));
        }
    }
}
