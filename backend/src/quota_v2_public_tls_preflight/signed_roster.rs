//! Zero-authority SQL + Ed25519 proof of the complete first-Genesis roster.
//!
//! Verify immutable signed evidence, then acquire the serialized SQL gate
//! in the SAME READ COMMITTED transaction. No persistent state is changed.
//! A matching digest is still NOT an ingress permission: no Linux PID,
//! installed Xray caps, certificate or durable WAL is proved here.
mod current_plan;
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
        || genesis.get("canStart")?.as_bool()?
        || genesis.get("canResume")?.as_bool()?
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
            || !user.get("onHold")?.as_bool()?
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

fn gate_contention(error: &sqlx::Error) -> bool {
    error.as_database_error().is_some_and(|database| {
        matches!(
            database.code().as_deref(),
            Some("55P03" | "57014" | "40P01" | "40001")
        )
    })
}

/// Returns a digest ONLY for a cryptographically exact original roster
/// which passed the serialized SQL gate. It cannot authorize or enable
/// any public listener.
pub(super) async fn authenticated_digest(
    state: &AppState,
    request: &Request,
    activation: &str,
) -> Result<Option<String>, ApiError> {
    let mut tx = state.pool.begin().await?;
    configure_transaction(&mut tx).await?;
    let checked = locked_digest(&mut tx, state, request, activation).await;
    // Never persist allocator helper writes in a diagnostic.
    tx.rollback().await?;
    checked
}

pub(crate) async fn configure_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), sqlx::Error> {
    // 0169 requires READ COMMITTED so its final check observes writers
    // that committed before the gate acquired all of its row locks.
    sqlx::query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ WRITE")
        .execute(&mut **tx)
        .await?;
    sqlx::query("SET LOCAL lock_timeout = '250ms'")
        .execute(&mut **tx)
        .await?;
    sqlx::query("SET LOCAL statement_timeout = '3s'")
        .execute(&mut **tx)
        .await?;
    sqlx::query("SET LOCAL idle_in_transaction_session_timeout = '5s'")
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// The caller retains the same transaction and all acquired row locks.
/// This is control-plane evidence only; not a measured runtime proof.
pub(crate) async fn locked_digest(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    state: &AppState,
    request: &Request,
    activation: &str,
) -> Result<Option<String>, ApiError> {
    let signer_key = state.node_policy_signer.public_key();
    // Cheap advisory rejection before doing any Ed25519 work or taking
    // row locks. This is NOT the final eligibility decision.
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
    .fetch_one(&mut **tx)
    .await?;
    if !candidate {
        return Ok(None);
    }
    let original = verified_original_users(tx, state, request, activation, &signer_key).await?;
    let Some(original) = original else {
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
    .fetch_all(&mut **tx)
    .await?;
    let now_ms: i64 =
        sqlx::query_scalar("SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT")
            .fetch_one(&mut **tx)
            .await?;
    let result = verified_signed_first_cap_roster_sha256(
        &state.node_policy_signer,
        &FirstTlsIdentity {
            node_id: request.node_id,
            activation_sha256: activation,
            genesis_policy_sha256: &request.genesis_policy_sha256,
            runtime_id: &request.runtime_id,
        },
        &original.users,
        &grants,
        now_ms,
        request.required_lifetime_ms,
    )
    .ok()
    .filter(|digest| *digest == request.cap_roster_sha256);
    let Some(digest) = result else {
        return Ok(None);
    };

    let check = verify_locked_plan(tx, request, activation, &signer_key, &original, &grants);
    let checked = check.await;
    match checked {
        Ok(true) => Ok(Some(digest)),
        Ok(false) => Ok(None),
        Err(error) if error.status.is_client_error() => Ok(None),
        Err(error) => Err(error),
    }
}

struct VerifiedOriginal {
    users: Vec<i64>,
    credentials: Vec<String>,
}

async fn verify_locked_plan(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request: &Request,
    activation: &str,
    signer_key: &str,
    original: &VerifiedOriginal,
    grants: &[(i64, Vec<u8>)],
) -> Result<bool, ApiError> {
    // The normal allocator locks each user before its account/lease.
    // Do not reverse that order by acquiring 0169's account locks first.
    let users = match current_plan::lock_users(tx, &original.users).await {
        Ok(Some(users)) => users,
        Ok(None) => return Ok(false),
        Err(error) if gate_contention(&error) => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    match lock_exact_roster(tx, request, activation, signer_key).await {
        Ok(true) => {}
        Ok(false) => return Ok(false),
        Err(error) if gate_contention(&error) => return Ok(false),
        Err(error) => return Err(error.into()),
    }
    current_plan::check_users(tx, request.node_id, &users, &original.credentials, grants).await
}

async fn lock_exact_roster(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request: &Request,
    activation: &str,
    signer_key: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        "SELECT quota_v2_public_tls_lock_exact_first_roster(
             $1,$2,$3,$4,$5,$6,$7
         )",
    )
    .bind(request.node_id)
    .bind(activation)
    .bind(&request.runtime_id)
    .bind(&request.profile_revision)
    .bind(&request.genesis_policy_sha256)
    .bind(signer_key)
    .bind(request.required_lifetime_ms)
    .fetch_one(&mut **tx)
    .await
}

async fn verified_original_users(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    state: &AppState,
    request: &Request,
    activation: &str,
    signer_key: &str,
) -> Result<Option<VerifiedOriginal>, ApiError> {
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
    .bind(signer_key)
    .fetch_optional(&mut **tx)
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
    let Some(credentials) = original_credentials(&original, &expected_users) else {
        return Ok(None);
    };
    Ok(Some(VerifiedOriginal {
        users: expected_users,
        credentials,
    }))
}

fn original_credentials(policy: &Value, ids: &[i64]) -> Option<Vec<String>> {
    let mut credentials = std::collections::BTreeMap::new();
    for user in policy.get("users")?.as_array()? {
        let id = user.get("userId")?.as_i64()?;
        let raw = user.get("xrayId")?.as_str()?;
        if !uuid::Uuid::parse_str(raw).is_ok_and(|value| value.to_string() == raw)
            || credentials.insert(id, raw.to_owned()).is_some()
        {
            return None;
        }
    }
    if credentials.len() != ids.len() {
        return None;
    }
    ids.iter().map(|id| credentials.remove(id)).collect()
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
