//! Experimental, disconnected XSP-v2 atomic DB **candidate** ACK commit.
//! No route, protected signer, receipt or production suite activation.
//! This helper is intentionally UNCALLED until database fault-injection review.
#![allow(dead_code)]
use crate::{
    xsp_v2_ack_ledger_validator::adjudicate_new_applied_ack,
    xsp_v2_candidate_binding::{CandidatePublic, candidate_sha256},
    xsp_v2_signed_cutover::{
        ExpectedPermit, TrustedPublic, verify_signed_applied_ack, verify_signed_permit,
    },
};
use anyhow::{Context as _, Result, bail};
use sha2::{Digest as _, Sha256};
use sqlx::{PgPool, Row};

/// Committed DATABASE state only. Not proof of durable Node vault or a receipt.
pub struct StagingACKCommit {
    pub node_id: i64,
    pub request_id: String,
    pub from_epoch: i64,
    pub to_epoch: i64,
    pub signed_ack_envelope_sha256_hex: String,
}

fn checked_ack_nonce(raw: &[u8]) -> Result<[u8; 16]> {
    // Signature and strict JSON parsing MUST already have been validated by
    // adjudicate_new_applied_ack before calling this function. A raw client
    // JSON object is never a trusted source by itself.
    let json: serde_json::Value =
        serde_json::from_slice(raw).context("authenticated ACK JSON invalid")?;
    let nonce = json
        .pointer("/message/nonceHex")
        .and_then(serde_json::Value::as_str)
        .context("ACK nonce absent")?;
    if nonce.len() != 32 {
        bail!("ACK nonce length invalid");
    }
    let bytes = hex::decode(nonce).context("ACK nonce not hex")?;
    if hex::encode(&bytes) != nonce || bytes.iter().all(|v| *v == 0) {
        bail!("noncanonical ACK nonce");
    }
    bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("ACK nonce length"))
}

/// Validates a fresh, new-key dual-signed ACK from the **original locked**
/// Nexus permit, then performs a single PostgreSQL transaction to:
/// 1. insert a one-use ACK replay nonce,
/// 2. install ONLY the prepared public keyset for the next epoch,
/// 3. compare-and-swap the XSP-v2 server key epoch,
/// 4. record the exact dual-signed ACK and its SHA-256 in the immutable ledger.
///
/// This does NOT retire the previous public keyset or change the suite floor.
/// It never touches Xray or any live Node, and there is NO caller or HTTP API.
///
/// It does NOT issue a protected signed commit receipt, and it is not a
/// complete durable cutover protocol. Client authentication, signer custody,
/// Node anti-rollback, retry after ACK expiry and DB fault-injection tests are
/// required before connecting a route.
///
/// # Errors
/// Rejects missing approval/proof, expired original permit or ACK, missing
/// dual signatures, tampered nonce/candidate/epoch, replay or conflicting
/// keyset, stale suite epoch or any failed SQL write. Failed writes roll back
/// because the transaction is owned and committed only on total success.
pub async fn commit_fresh_applied_ack_staging(
    pool: &PgPool,
    authenticated_node_id: i64,
    request_id: &str,
    signed_ack_bytes: &[u8],
    pinned_panel: &TrustedPublic,
    now_ms: i64,
) -> Result<StagingACKCommit> {
    let mut tx = pool.begin().await?;
    let ack = adjudicate_new_applied_ack(
        &mut tx,
        authenticated_node_id,
        request_id,
        signed_ack_bytes,
        pinned_panel,
        now_ms,
    )
    .await?;
    let nonce = checked_ack_nonce(&ack.signed_ack_bytes)?;
    let inserted = sqlx::query(
        "INSERT INTO node_xsp_replay_nonces
             (node_id,key_epoch,direction,nonce,request_id)
         VALUES($1,$2,1,$3,$4)",
    )
    .bind(ack.node_id)
    .bind(ack.to_epoch)
    .bind(nonce.as_slice())
    .bind(&ack.request_id)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() != 1 {
        bail!("ACK nonce was not durably registered");
    }

    // Only the independently approved+proved pending public pair, locked by
    // adjudicate_new_applied_ack, can become the next verifier. Old rows stay.
    let inserted = sqlx::query(
        "INSERT INTO node_xsp_public_keysets
             (node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,
              ed25519_public,mldsa65_public)
         SELECT node_id,purpose,to_epoch,ed25519_key_id,mldsa65_key_id,
                ed25519_public,mldsa65_public
         FROM node_xsp_rotation_preparations
         WHERE node_id=$1 AND purpose='node_request' AND from_epoch=$2
           AND to_epoch=$3 AND proved_at IS NOT NULL AND expires_at>NOW()
         RETURNING node_id",
    )
    .bind(ack.node_id)
    .bind(ack.from_epoch)
    .bind(ack.to_epoch)
    .fetch_optional(&mut *tx)
    .await?;
    if inserted.is_none() {
        bail!("approved prepared next keyset vanished before ACK commit");
    }

    // CAS against the original epoch under the suite lock held by the
    // verifier. No implicit strict suite transition and no key retirement.
    let suite = sqlx::query(
        "UPDATE node_xsp_suite_state SET key_epoch=$3
         WHERE node_id=$1 AND key_epoch=$2 AND minimum_suite=1
           AND activation_phase IN ('dual_enrolled','shadow')
         RETURNING key_epoch",
    )
    .bind(ack.node_id)
    .bind(ack.from_epoch)
    .bind(ack.to_epoch)
    .fetch_optional(&mut *tx)
    .await?
    .context("stale or unauthorized server epoch compare-and-swap")?;
    let actual_epoch: i64 = suite.try_get("key_epoch")?;
    if actual_epoch != ack.to_epoch {
        bail!("server key epoch mismatch after compare-and-swap");
    }

    let hash = hex::decode(&ack.signed_ack_envelope_sha256_hex)?;
    let recorded = sqlx::query(
        "UPDATE node_xsp_cutover_permit_ledger
         SET state='ack_verified', applied_ack_sha256=$3,
             signed_applied_ack=$4,
             ack_verified_at=GREATEST(NOW(),issued_at)
         WHERE node_id=$1 AND request_id=$2 AND state='issued'
           AND from_epoch=$5 AND to_epoch=$6
           AND issued_at<=NOW()
         RETURNING state",
    )
    .bind(ack.node_id)
    .bind(&ack.request_id)
    .bind(hash)
    .bind(&ack.signed_ack_bytes)
    .bind(ack.from_epoch)
    .bind(ack.to_epoch)
    .fetch_optional(&mut *tx)
    .await?
    .context("permit already spent, expired or altered before DB commit")?;
    let state: String = recorded.try_get("state")?;
    if state != "ack_verified" {
        bail!("ACK did not reach verified ledger state");
    }

    // The only durable success boundary here is a committed DB transaction.
    // Receipt signing is a separate required operation, not faked as success.
    tx.commit().await?;
    Ok(StagingACKCommit {
        node_id: ack.node_id,
        request_id: ack.request_id,
        from_epoch: ack.from_epoch,
        to_epoch: ack.to_epoch,
        signed_ack_envelope_sha256_hex: ack.signed_ack_envelope_sha256_hex,
    })
}


/// Internal, database-only witness to a previously committed ACK.
/// NOT a signed server receipt, network response, permission to retire keys,
/// or proof that the Node has a durable vault or rollback-resistant epoch.
pub struct StagingStoredACKEvidence {
    pub node_id: i64,
    pub request_id: String,
    pub from_epoch: i64,
    pub to_epoch: i64,
    pub canonical_permit_sha256_hex: String,
    pub signed_ack_envelope_sha256_hex: String,
}

/// Read-only recovery of the EXACT earlier dual-signed ACK after its DB commit.
///
/// The suite row is locked first so this cannot race a new epoch CAS. This
/// function never calls the fresh ACK writer and never advances an epoch.
/// The historical permit and ACK are reverified cryptographically using the
/// immutable signed envelopes, independently pinned panel public keys, and
/// BOTH exact public-key epochs kept in PostgreSQL. It checks the durable
/// one-use nonce, original ledger digest/bindings, and committed suite epoch.
///
/// Freshness is checked against the **database-recorded ACK commit time**,
/// NOT against caller-provided historical time and NOT against the retry time.
/// A lost response may be recovered after a signed envelope's TTL expires.
/// A future signed commit receipt is still mandatory before Node can finalize.
///
/// # Errors
/// Refuses missing/uncommitted/expired-at-commit ledger state, mismatched
/// request/Node, tampered envelope or digest, bad Ed25519 or ML-DSA-65
/// signatures, changed historical keysets, missing replay nonce, revoked
/// public keys, changed epoch or a non-staging suite. No SQL writes occur.
#[expect(clippy::too_many_lines, reason = "locked historical signed ACK verification boundary")]
pub async fn readback_committed_applied_ack_staging(
    pool: &PgPool,
    authenticated_node_id: i64,
    request_id: &str,
    signed_ack_bytes: &[u8],
    pinned_panel: &TrustedPublic,
) -> Result<StagingStoredACKEvidence> {
    if authenticated_node_id <= 0
        || request_id.is_empty()
        || request_id.len() > 64
        || !request_id.bytes().all(|b| b.is_ascii_graphic())
        || signed_ack_bytes.is_empty()
        || signed_ack_bytes.len() > 16 * 1024
    {
        bail!("invalid ACK readback authentication context or envelope");
    }
    let mut tx = pool.begin().await?;
    // Always take the suite lock FIRST, just as in the new-ACK commit path.
    let suite = sqlx::query(
        "SELECT minimum_suite,activation_phase,key_epoch
         FROM node_xsp_suite_state WHERE node_id=$1 FOR UPDATE",
    )
    .bind(authenticated_node_id)
    .fetch_optional(&mut *tx)
    .await?
    .context("missing XSP-v2 suite for committed ACK readback")?;
    let floor: i16 = suite.try_get("minimum_suite")?;
    let phase: String = suite.try_get("activation_phase")?;
    let active_epoch: i64 = suite.try_get("key_epoch")?;
    if floor != 1 || !matches!(phase.as_str(), "dual_enrolled" | "shadow") {
        bail!("committed ACK readback requires a non-strict staging suite");
    }

    let ledger = sqlx::query(
        "SELECT state,from_epoch,to_epoch,candidate_sha256,
                permit_nonce,permit_input_sha256,signed_permit,
                signed_applied_ack,applied_ack_sha256,
                (EXTRACT(EPOCH FROM issued_at)*1000)::bigint AS issued_ms,
                (EXTRACT(EPOCH FROM expires_at)*1000)::bigint AS expires_ms,
                (EXTRACT(EPOCH FROM ack_verified_at)*1000)::bigint AS verified_ms
         FROM node_xsp_cutover_permit_ledger
         WHERE node_id=$1 AND request_id=$2 FOR UPDATE",
    )
    .bind(authenticated_node_id)
    .bind(request_id)
    .fetch_optional(&mut *tx)
    .await?
    .context("no previously committed ACK for this request")?;
    let state: String = ledger.try_get("state")?;
    // 'receipt_sent' requires an independently designed, signed receipt
    // and will only be supported by its own reviewed recovery protocol.
    if state != "ack_verified" {
        bail!("ACK has not reached the exact committed staging state");
    }
    let from_epoch: i64 = ledger.try_get("from_epoch")?;
    let to_epoch: i64 = ledger.try_get("to_epoch")?;
    if from_epoch <= 0
        || from_epoch.checked_add(1) != Some(to_epoch)
        || active_epoch != to_epoch
    {
        bail!("ACK ledger epoch does not match current staging suite");
    }
    let stored_ack: Vec<u8> = ledger.try_get("signed_applied_ack")?;
    let stored_hash: Vec<u8> = ledger.try_get("applied_ack_sha256")?;
    let exact_digest = Sha256::digest(signed_ack_bytes);
    if stored_ack != signed_ack_bytes || stored_hash.as_slice() != exact_digest.as_slice() {
        bail!("ACK retry is not the exact previously committed signed envelope");
    }
    let issued_ms: i64 = ledger.try_get("issued_ms")?;
    let expires_ms: i64 = ledger.try_get("expires_ms")?;
    let committed_ms: i64 = ledger.try_get("verified_ms")?;
    if committed_ms <= 0 || issued_ms <= 0 || expires_ms <= issued_ms {
        bail!("invalid committed ACK historical timestamps");
    }

    // The prior and new PUBLIC verification keys are the durable historical
    // keysets; the mutable 'pending' preparation must NOT be trusted for a
    // replay after it may have been consumed or replaced.
    let pair = sqlx::query(
        "SELECT key_epoch,ed25519_key_id,mldsa65_key_id,
                ed25519_public,mldsa65_public
         FROM node_xsp_public_keysets
         WHERE node_id=$1 AND purpose='node_request'
           AND key_epoch IN ($2,$3) AND revoked_at IS NULL
         ORDER BY key_epoch FOR SHARE",
    )
    .bind(authenticated_node_id)
    .bind(from_epoch)
    .bind(to_epoch)
    .fetch_all(&mut *tx)
    .await?;
    if pair.len() != 2 {
        bail!("missing or revoked historical public keysets");
    }
    let old = &pair[0];
    let new = &pair[1];
    let old_epoch: i64 = old.try_get("key_epoch")?;
    let new_epoch: i64 = new.try_get("key_epoch")?;
    if old_epoch != from_epoch || new_epoch != to_epoch {
        bail!("wrong historical public key epochs");
    }
    let material = CandidatePublic {
        node_id: u64::try_from(authenticated_node_id)?,
        from_epoch: u64::try_from(from_epoch)?,
        to_epoch: u64::try_from(to_epoch)?,
        purpose: "node_request".into(),
        from_ed_key_id: old.try_get("ed25519_key_id")?,
        from_pq_key_id: old.try_get("mldsa65_key_id")?,
        to_ed_key_id: new.try_get("ed25519_key_id")?,
        to_pq_key_id: new.try_get("mldsa65_key_id")?,
        active_ed_public: old.try_get("ed25519_public")?,
        active_pq_public: old.try_get("mldsa65_public")?,
        pending_ed_public: new.try_get("ed25519_public")?,
        pending_pq_public: new.try_get("mldsa65_public")?,
    };
    let candidate_hash = candidate_sha256(&material).map_err(anyhow::Error::msg)?;
    let stored_candidate: Vec<u8> = ledger.try_get("candidate_sha256")?;
    if candidate_hash.as_slice() != stored_candidate.as_slice() {
        bail!("historical public keys no longer match the signed candidate");
    }

    let expected = ExpectedPermit {
        node_id: material.node_id,
        from_epoch: material.from_epoch,
        to_epoch: material.to_epoch,
        request_id: request_id.into(),
        from_ed_key_id: material.from_ed_key_id.clone(),
        from_pq_key_id: material.from_pq_key_id.clone(),
        to_ed_key_id: material.to_ed_key_id.clone(),
        to_pq_key_id: material.to_pq_key_id.clone(),
        candidate_sha256_hex: hex::encode(candidate_hash),
    };
    let signed_permit: Vec<u8> = ledger.try_get("signed_permit")?;
    let verified_permit =
        verify_signed_permit(&signed_permit, pinned_panel, &expected, committed_ms)
            .map_err(anyhow::Error::msg)?;
    let permit = verified_permit.message();
    let persisted_permit_hash: Vec<u8> = ledger.try_get("permit_input_sha256")?;
    let persisted_permit_nonce: Vec<u8> = ledger.try_get("permit_nonce")?;
    if hex::decode(verified_permit.canonical_sha256_hex())? != persisted_permit_hash
        || hex::decode(&permit.permit_nonce_hex)? != persisted_permit_nonce
        || permit.issued_at_ms != issued_ms
        || permit.expires_at_ms != expires_ms
    {
        bail!("committed permit differs from its original signed ledger bindings");
    }
    let trusted_next = TrustedPublic {
        purpose: "node_request".into(),
        issuer_id: format!("node-{authenticated_node_id}"),
        node_id: material.node_id,
        ed_key_id: material.to_ed_key_id,
        pq_key_id: material.to_pq_key_id,
        ed_public: material.pending_ed_public,
        pq_public: material.pending_pq_public,
    };
    verify_signed_applied_ack(&stored_ack, &verified_permit, &trusted_next, committed_ms)
        .map_err(anyhow::Error::msg)?;
    let nonce = checked_ack_nonce(&stored_ack)?;
    let used_request: String = sqlx::query_scalar(
        "SELECT request_id FROM node_xsp_replay_nonces
         WHERE node_id=$1 AND key_epoch=$2 AND direction=1 AND nonce=$3",
    )
    .bind(authenticated_node_id)
    .bind(to_epoch)
    .bind(nonce.as_slice())
    .fetch_optional(&mut *tx)
    .await?
    .context("authenticated ACK nonce missing from committed replay ledger")?;
    if used_request != request_id {
        bail!("committed ACK replay nonce belongs to another request");
    }
    // This commit merely releases the read locks. No INSERT or UPDATE occurs.
    tx.commit().await?;
    Ok(StagingStoredACKEvidence {
        node_id: authenticated_node_id,
        request_id: request_id.into(),
        from_epoch,
        to_epoch,
        canonical_permit_sha256_hex: verified_permit.canonical_sha256_hex().into(),
        signed_ack_envelope_sha256_hex: hex::encode(exact_digest),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reject_noncanonical_ack_nonce_metadata() {
        assert_eq!(
            checked_ack_nonce(br#"{"message":{"nonceHex":"00112233445566778899aabbccddeeff"}}"#)
                .unwrap()
                .len(),
            16
        );
        for value in [
            r#"{"message":{"nonceHex":"00"}}"#,
            r#"{"message":{"nonceHex":"ZZ112233445566778899aabbccddeeff"}}"#,
            r#"{"message":{"nonceHex":"00000000000000000000000000000000"}}"#,
            r#"{"message":{"nonceHex":"00112233445566778899AABBCCDDEEFF"}}"#,
        ] {
            assert!(checked_ack_nonce(value.as_bytes()).is_err());
        }
    }
}
