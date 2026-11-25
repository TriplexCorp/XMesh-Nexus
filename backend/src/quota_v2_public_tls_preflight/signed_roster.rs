//! Zero-authority, READ-ONLY SQL + Ed25519 proof of the complete first-Genesis roster.
//!
//! Read all evidence in one REPEATABLE READ PostgreSQL snapshot. A matching
//! digest is still NOT an ingress permission: no Linux PID, installed Xray
//! caps, certificate, durable WAL or serialized revocation is proved here.
use super::Request;
use crate::{
    ApiError, AppState,
    quota_v2_public_tls_cap_roster::{FirstTlsIdentity, verified_signed_first_cap_roster_sha256},
};
use serde_json::Value;
use sha2::{Digest, Sha256};

fn original_users(policy: &Value, request: &Request) -> Option<Vec<i64>> {
    let genesis = policy.get("quotaV2Genesis")?;
    if policy.get("kind")?.as_str()? != "xmesh.quota-v2.genesis-quarantine-policy"
        || policy.get("version")?.as_i64()? != 1
        || policy.get("nodeId")?.as_i64()? != request.node_id
        || policy.get("configSha256")?.as_str()? != request.profile_revision
        || genesis.get("mode")?.as_str()? != "quarantined"
        || genesis.get("runtimeId")?.as_str()? != request.runtime_id
        || genesis.get("firstActivationReceiptSha256")?.as_str()?
            != request.activation_receipt_sha256
        || genesis.get("authorizedBytes")?.as_i64()? != 0
        || genesis.get("canStart")?.as_bool()? != false
        || genesis.get("canResume")?.as_bool()? != false
        || genesis.get("refundableBytes")?.as_i64()? != 0
    {
        return None;
    }
    let users = policy.get("users")?.as_array()?;
    if !(1..=2048).contains(&users.len()) {
        return None;
    }
    let mut ids = Vec::with_capacity(users.len());
    for user in users {
        let id = user.get("userId")?.as_i64()?;
        if id <= 0
            || user.get("offlineBudgetBytes")?.as_i64()? != 0
            || user.get("onHold")?.as_bool()? != true
        {
            return None;
        }
        ids.push(id);
    }
    ids.sort_unstable();
    if ids.windows(2).any(|pair| pair[0] == pair[1]) {
        return None;
    }
    Some(ids)
}

/// Returns a digest ONLY for a consistent, exact, currently SQL-eligible
/// original roster. It cannot authorize or enable any public listener.
pub(super) async fn authenticated_digest(
    state: &AppState,
    request: &Request,
    activation: &str,
) -> Result<Option<String>, ApiError> {
    let signer_key = state.node_policy_signer.public_key();
    let mut tx = state.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *tx)
        .await?;
    // One PostgreSQL snapshot prevents combining user/lease/policy generations
    // across consecutive read queries. It does NOT serialize a future grant
    // against a revocation or prove that the remote Node applied the caps.
    let candidate: bool = sqlx::query_scalar(
        "SELECT quota_v2_public_tls_exact_first_roster(
              $1,$2,$3,$4,$5,$6,$7
          ) AND EXISTS(
              SELECT 1 FROM quota_v2_public_tls_first_cap_candidates(
                  $1,$2,$3,$4,$5,$6,$7
              ) AS cap WHERE cap.user_id=$8
          )",
    )
    .bind(request.node_id)
    .bind(activation)
    .bind(&request.runtime_id)
    .bind(&request.profile_revision)
    .bind(&request.genesis_policy_sha256)
    .bind(&signer_key)
    .bind(request.required_lifetime_ms)
    .bind(request.user_id)
    .fetch_one(&mut *tx)
    .await?;
    if !candidate {
        return Ok(None);
    }
    // The original, immutable Genesis source, not a Node-supplied roster,
    // defines the complete exact set of users. Recheck actual signed bytes.
    let policy: Option<(Vec<u8>, String)> = sqlx::query_as(
        "SELECT signed_policy_bytes,policy_signature
            FROM quota_v2_genesis_quarantine_policies
           WHERE node_id=$1 AND first_activation_sha256=$2
             AND runtime_id=$3 AND profile_revision=$4
             AND policy_sha256=$5 AND signer_public_key=$6",
    )
    .bind(request.node_id)
    .bind(activation)
    .bind(&request.runtime_id)
    .bind(&request.profile_revision)
    .bind(&request.genesis_policy_sha256)
    .bind(&signer_key)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((policy_bytes, original_signature)) = policy else {
        return Ok(None);
    };
    if hex::encode(Sha256::digest(&policy_bytes)) != request.genesis_policy_sha256 {
        return Ok(None);
    }
    let Ok(original) = serde_json::from_slice::<Value>(&policy_bytes) else {
        return Ok(None);
    };
    let canonical = serde_json::to_vec(&original).ok();
    let signature = state.node_policy_signer.sign(&original).ok();
    if canonical.as_deref() != Some(policy_bytes.as_slice())
        || signature.as_deref() != Some(original_signature.as_str())
    {
        return Ok(None);
    }
    let Some(expected_users) = original_users(&original, request) else {
        return Ok(None);
    };
    // Read EVERY existing signed first-cap row of this enrolled Node. Never
    // filter to the requested user or let an extra, old, foreign grant hide.
    let grants: Vec<(i64, Vec<u8>)> = sqlx::query_as(
        "SELECT user_id,signed_envelope
            FROM quota_v2_signed_first_cap_outbox
           WHERE node_id=$1 ORDER BY user_id,request_challenge LIMIT 2049",
    )
    .bind(request.node_id)
    .fetch_all(&mut *tx)
    .await?;
    let now_ms: i64 =
        sqlx::query_scalar("SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT")
            .fetch_one(&mut *tx)
            .await?;
    let result = verified_signed_first_cap_roster_sha256(
        &state.node_policy_signer,
        &FirstTlsIdentity {
            node_id: request.node_id,
            activation_sha256: activation,
            genesis_policy_sha256: &request.genesis_policy_sha256,
            runtime_id: &request.runtime_id,
        },
        &expected_users,
        &grants,
        now_ms,
        request.required_lifetime_ms,
    )
    .ok()
    .filter(|digest| *digest == request.cap_roster_sha256);
    // Closing the read-only transaction deliberately grants no lease, no
    // signed TLS authorization, and no revocation continuity guarantee.
    tx.commit().await?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn req() -> Request {
        Request {
            node_id: 7,
            user_id: 33,
            activation_receipt_sha256: "a".repeat(64),
            genesis_policy_sha256: "b".repeat(64),
            runtime_id: "c".repeat(64),
            profile_revision: "d".repeat(64),
            cap_roster_sha256: "e".repeat(64),
            required_lifetime_ms: 1_000,
        }
    }

    fn policy() -> Value {
        json!({
            "kind":"xmesh.quota-v2.genesis-quarantine-policy",
            "version":1, "nodeId":7,"configSha256":"d".repeat(64),
            "users":[
                {"userId":44,"offlineBudgetBytes":0,"onHold":true},
                {"userId":33,"offlineBudgetBytes":0,"onHold":true}
            ],
            "quotaV2Genesis":{
                "mode":"quarantined",
                "runtimeId":"c".repeat(64),
                "firstActivationReceiptSha256":"a".repeat(64),
                "authorizedBytes":0,"canStart":false,"canResume":false,
                "refundableBytes":0
            }
        })
    }

    #[test]
    fn original_policy_enforces_complete_strict_genesis_roster() {
        let r = req();
        let p = policy();
        assert_eq!(original_users(&p, &r), Some(vec![33, 44]));
        for field in ["onHold", "offlineBudgetBytes", "userId"] {
            let mut corrupted = p.clone();
            corrupted["users"][0][field] = json!("invalid");
            assert_eq!(original_users(&corrupted, &r), None, "{field}");
        }
        for faulty in [json!(false), json!("true"), json!(null), json!(1)] {
            let mut corrupted = p.clone();
            corrupted["users"][0]["onHold"] = faulty;
            assert_eq!(original_users(&corrupted, &r), None);
        }
        for modification in [
            ("/nodeId", json!(8)),
            ("/quotaV2Genesis/runtimeId", json!("f".repeat(64))),
            ("/quotaV2Genesis/canStart", json!(true)),
            ("/quotaV2Genesis/authorizedBytes", json!(1)),
        ] {
            let mut corrupted = p.clone();
            *corrupted.pointer_mut(modification.0).expect("field exists") = modification.1;
            assert!(original_users(&corrupted, &r).is_none());
        }
        let mut duplicate = p.clone();
        duplicate["users"][0]["userId"] = json!(33);
        assert!(original_users(&duplicate, &r).is_none());
        let mut empty = p;
        empty["users"] = json!([]);
        assert!(original_users(&empty, &r).is_none());
    }
}
