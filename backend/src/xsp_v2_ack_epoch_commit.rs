//! Experimental, disconnected XSP-v2 atomic DB **candidate** ACK commit.
//! No route, protected signer, receipt or production suite activation.
//! This helper is intentionally UNCALLED until database fault-injection review.
#![allow(dead_code)]
use crate::{
    xsp_v2_ack_ledger_validator::adjudicate_new_applied_ack, xsp_v2_signed_cutover::TrustedPublic,
};
use anyhow::{Context as _, Result, bail};
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
    bytes.try_into().map_err(|_| anyhow::anyhow!("ACK nonce length"))
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
