//! Experimental XSP-v2 signed commit receipt outbox (NO API route).
//!
//! Caller-supplied bytes are NEVER a receipt unless both independently pinned
//! Nexus signatures match exact cryptographically reverified PostgreSQL ACK
//! history. An identical retry gets the original saved envelope, not another
//! signing operation. This has no network authentication, protected signer,
//! key retirement, KMS or production activation.
#![allow(dead_code)]
use crate::{
    xsp_v2_ack_epoch_commit::readback_committed_applied_ack_staging,
    xsp_v2_commit_receipt::verify_staging_commit_receipt, xsp_v2_signed_cutover::TrustedPublic,
};
use anyhow::{Context as _, Result, bail};
use sha2::{Digest as _, Sha256};
use sqlx::{PgPool, Row};

/// Persist and return the EXACT verified signed Nexus receipt for a previously
/// committed ACK. Both signatures are mandatory, including on every retry.
///
/// The separate readback validates stored Node signatures, original permit,
/// historical dual public keys, replay nonce and suite epoch. This writer
/// rechecks the relational ledger and suite under the same lock order before
/// inserting an immutable row; a concurrent epoch or ledger transition fails
/// closed. The signed receipt must refer to the exact ACK bytes and DB commit.
///
/// This is not an HTTP handler. A future transport MUST obtain the Node ID
/// from authenticated and PQ-protected context and use a separately protected
/// signer. It may only deliver these bytes after verifying its own TLS hop,
/// authorization, and replay-safe request identity.
#[expect(
    clippy::too_many_lines,
    reason = "locked cryptographic receipt and immutable PostgreSQL outbox trust boundary"
)]
pub async fn store_or_load_signed_receipt_staging(
    pool: &PgPool,
    authenticated_node_id: i64,
    request_id: &str,
    signed_ack_bytes: &[u8],
    signed_receipt_bytes: &[u8],
    pinned_panel: &TrustedPublic,
) -> Result<Vec<u8>> {
    if signed_receipt_bytes.is_empty() || signed_receipt_bytes.len() > 16 * 1024 {
        bail!("invalid signed Nexus receipt size");
    }
    let evidence = readback_committed_applied_ack_staging(
        pool,
        authenticated_node_id,
        request_id,
        signed_ack_bytes,
        pinned_panel,
    )
    .await?;
    verify_staging_commit_receipt(signed_receipt_bytes, pinned_panel, &evidence)
        .map_err(anyhow::Error::msg)?;

    let mut tx = pool.begin().await?;
    // Same suite-before-ledger lock order as the commit/readback helpers.
    let suite = sqlx::query(
        "SELECT minimum_suite,activation_phase,key_epoch
         FROM node_xsp_suite_state WHERE node_id=$1 FOR SHARE",
    )
    .bind(authenticated_node_id)
    .fetch_optional(&mut *tx)
    .await?
    .context("signed receipt outbox requires known Node suite")?;
    let floor: i16 = suite.try_get("minimum_suite")?;
    let phase: String = suite.try_get("activation_phase")?;
    let epoch: i64 = suite.try_get("key_epoch")?;
    if floor != 1
        || !matches!(phase.as_str(), "dual_enrolled" | "shadow")
        || epoch != evidence.to_epoch
    {
        bail!("signed receipt outbox suite epoch or activation changed");
    }
    let ledger = sqlx::query(
        "SELECT state,from_epoch,to_epoch,permit_input_sha256,
                applied_ack_sha256,signed_applied_ack
         FROM node_xsp_cutover_permit_ledger
         WHERE node_id=$1 AND request_id=$2 FOR SHARE",
    )
    .bind(authenticated_node_id)
    .bind(request_id)
    .fetch_optional(&mut *tx)
    .await?
    .context("signed receipt outbox requires an exact committed ACK")?;
    let state: String = ledger.try_get("state")?;
    let from_epoch: i64 = ledger.try_get("from_epoch")?;
    let to_epoch: i64 = ledger.try_get("to_epoch")?;
    let permit_digest: Vec<u8> = ledger.try_get("permit_input_sha256")?;
    let ack_digest: Vec<u8> = ledger.try_get("applied_ack_sha256")?;
    let stored_ack: Vec<u8> = ledger.try_get("signed_applied_ack")?;
    let expected_permit = hex::decode(&evidence.canonical_permit_sha256_hex)?;
    let expected_ack = Sha256::digest(signed_ack_bytes);
    if state != "ack_verified"
        || from_epoch != evidence.from_epoch
        || to_epoch != evidence.to_epoch
        || permit_digest != expected_permit
        || ack_digest.as_slice() != expected_ack.as_slice()
        || stored_ack != signed_ack_bytes
    {
        bail!("ledger changed since independently verified signed receipt");
    }

    let receipt_digest = Sha256::digest(signed_receipt_bytes);
    // A conflicting concurrent receipt MUST NOT overwrite the first
    // successful signed envelope. The insert trigger additionally enforces
    // immutable ledger bindings for direct SQL callers.
    sqlx::query(
        "INSERT INTO node_xsp_signed_commit_receipt_outbox
            (node_id,request_id,from_epoch,to_epoch,
             permit_input_sha256,applied_ack_sha256,
             signed_receipt_sha256,signed_receipt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (node_id,request_id) DO NOTHING",
    )
    .bind(authenticated_node_id)
    .bind(request_id)
    .bind(from_epoch)
    .bind(to_epoch)
    .bind(&permit_digest)
    .bind(&ack_digest)
    .bind(receipt_digest.as_slice())
    .bind(signed_receipt_bytes)
    .execute(&mut *tx)
    .await?;

    let stored = sqlx::query(
        "SELECT from_epoch,to_epoch,permit_input_sha256,
                applied_ack_sha256,signed_receipt_sha256,signed_receipt
         FROM node_xsp_signed_commit_receipt_outbox
         WHERE node_id=$1 AND request_id=$2 FOR SHARE",
    )
    .bind(authenticated_node_id)
    .bind(request_id)
    .fetch_one(&mut *tx)
    .await?;
    let stored_receipt: Vec<u8> = stored.try_get("signed_receipt")?;
    let stored_receipt_digest: Vec<u8> = stored.try_get("signed_receipt_sha256")?;
    let stored_permit: Vec<u8> = stored.try_get("permit_input_sha256")?;
    let stored_ack_digest: Vec<u8> = stored.try_get("applied_ack_sha256")?;
    let saved_from: i64 = stored.try_get("from_epoch")?;
    let saved_to: i64 = stored.try_get("to_epoch")?;

    if stored_receipt != signed_receipt_bytes
        || stored_receipt_digest.as_slice() != receipt_digest.as_slice()
        || stored_permit != permit_digest
        || stored_ack_digest != ack_digest
        || saved_from != from_epoch
        || saved_to != to_epoch
    {
        bail!("a different or corrupt signed receipt already exists");
    }
    // A storage row or digest alone is NOT proof: always check both signatures
    // and the complete historical DB evidence, even for an identical retry.
    verify_staging_commit_receipt(&stored_receipt, pinned_panel, &evidence)
        .map_err(anyhow::Error::msg)?;
    tx.commit().await?;
    Ok(stored_receipt)
}

/// Read back the ORIGINAL immutable Nexus receipt after a lost response.
///
/// Unlike the insert helper, this path requires no signer and never creates
/// another receipt or repeats the key-epoch CAS. Its caller MUST already
/// have authenticated the Node over an independently verified PQ-only TLS
/// channel and provisioned the panel's trusted public keys out of band.
/// Caller-provided ACK bytes and node ID are NOT transport authentication.
///
/// # Errors
/// Fail closed on missing receipt, invalid or changed committed ACK evidence,
/// mismatched epoch, request, digest, or either panel receipt signature.
pub async fn load_committed_signed_receipt_staging(
    pool: &PgPool,
    authenticated_node_id: i64,
    request_id: &str,
    signed_ack_bytes: &[u8],
    pinned_panel: &TrustedPublic,
) -> Result<Vec<u8>> {
    // The independent readback checks both signed Node ACK and panel permit,
    // the historical keysets, recorded nonce, and the precise committed epoch.
    let evidence = readback_committed_applied_ack_staging(
        pool,
        authenticated_node_id,
        request_id,
        signed_ack_bytes,
        pinned_panel,
    )
    .await?;

    let mut tx = pool.begin().await?;
    // Maintain suite -> ledger -> receipt lock order; recheck that the
    // committed state has not changed after the independent readback.
    let suite = sqlx::query(
        "SELECT minimum_suite,activation_phase,key_epoch
         FROM node_xsp_suite_state WHERE node_id=$1 FOR SHARE",
    )
    .bind(authenticated_node_id)
    .fetch_optional(&mut *tx)
    .await?
    .context("no suite for durable receipt readback")?;
    let floor: i16 = suite.try_get("minimum_suite")?;
    let phase: String = suite.try_get("activation_phase")?;
    let epoch: i64 = suite.try_get("key_epoch")?;
    if floor != 1
        || !matches!(phase.as_str(), "dual_enrolled" | "shadow")
        || epoch != evidence.to_epoch
    {
        bail!("receipt readback suite or epoch has changed");
    }
    let ledger = sqlx::query(
        "SELECT state,from_epoch,to_epoch,permit_input_sha256,
                applied_ack_sha256,signed_applied_ack
         FROM node_xsp_cutover_permit_ledger
         WHERE node_id=$1 AND request_id=$2 FOR SHARE",
    )
    .bind(authenticated_node_id)
    .bind(request_id)
    .fetch_optional(&mut *tx)
    .await?
    .context("no committed ACK for durable receipt")?;
    let state: String = ledger.try_get("state")?;
    let from_epoch: i64 = ledger.try_get("from_epoch")?;
    let to_epoch: i64 = ledger.try_get("to_epoch")?;
    let permit_digest: Vec<u8> = ledger.try_get("permit_input_sha256")?;
    let ack_digest: Vec<u8> = ledger.try_get("applied_ack_sha256")?;
    let stored_ack: Vec<u8> = ledger.try_get("signed_applied_ack")?;
    let expected_permit = hex::decode(&evidence.canonical_permit_sha256_hex)?;
    let expected_ack = Sha256::digest(signed_ack_bytes);
    if state != "ack_verified"
        || from_epoch != evidence.from_epoch
        || to_epoch != evidence.to_epoch
        || permit_digest != expected_permit
        || ack_digest.as_slice() != expected_ack.as_slice()
        || stored_ack != signed_ack_bytes
    {
        bail!("committed ACK changed since signed receipt readback");
    }

    let row = sqlx::query(
        "SELECT from_epoch,to_epoch,permit_input_sha256,
                applied_ack_sha256,signed_receipt_sha256,signed_receipt
         FROM node_xsp_signed_commit_receipt_outbox
         WHERE node_id=$1 AND request_id=$2 FOR SHARE",
    )
    .bind(authenticated_node_id)
    .bind(request_id)
    .fetch_optional(&mut *tx)
    .await?
    .context("no durable signed receipt: never infer one from ACK or HTTP status")?;
    let receipt: Vec<u8> = row.try_get("signed_receipt")?;
    let receipt_digest: Vec<u8> = row.try_get("signed_receipt_sha256")?;
    let saved_permit: Vec<u8> = row.try_get("permit_input_sha256")?;
    let saved_ack_digest: Vec<u8> = row.try_get("applied_ack_sha256")?;
    let saved_from: i64 = row.try_get("from_epoch")?;
    let saved_to: i64 = row.try_get("to_epoch")?;
    if receipt.is_empty()
        || receipt.len() > 16 * 1024
        || receipt_digest.as_slice() != Sha256::digest(&receipt).as_slice()
        || saved_permit != permit_digest
        || saved_ack_digest != ack_digest
        || saved_from != from_epoch
        || saved_to != to_epoch
    {
        bail!("signed receipt outbox row is corrupt or mismatched");
    }
    // An exact DB row or digest is never sufficient: verify both independently
    // pinned Ed25519 AND ML-DSA-65 signatures on the original signed bytes.
    verify_staging_commit_receipt(&receipt, pinned_panel, &evidence).map_err(anyhow::Error::msg)?;
    tx.commit().await?;
    Ok(receipt)
}


/// Complete a previously committed ACK into exactly one durable signed
/// receipt, or recover the original bytes after a lost network response.
///
/// The signing callback is an **injected staging boundary**, NOT a signer
/// implementation: the eventual caller must use a separately protected
/// panel_response signing service with independently pinned public keys.
/// The API process must never hold, import or log private signing keys.
/// Neither this helper nor signed ACK bytes authenticate a network caller:
/// the calling route must independently establish a PQ-only TLS hop and
/// authenticated/authorized Node identity before reaching this helper.
///
/// Only a separately verified committed DB ACK can reach the signer. An
/// existing outbox row always goes through full historical DB and BOTH panel
/// signature verification, and never calls the signer again. Concurrent
/// insertion of another valid receipt is resolved by returning the original
/// independently verified durable bytes; all other failures remain closed.
///
/// # Errors
/// Rejects uncommitted or forged ACK, mismatched Node/request/epoch, missing
/// public pins, corrupt durable receipt, untrusted signature or DB failures.
pub async fn issue_or_recover_signed_receipt_staging<F>(
    pool: &PgPool,
    authenticated_node_id: i64,
    request_id: &str,
    signed_ack_bytes: &[u8],
    pinned_panel: &TrustedPublic,
    sign_from_verified_commit: F,
) -> Result<Vec<u8>>
where
    F: FnOnce(&crate::xsp_v2_ack_epoch_commit::StagingStoredACKEvidence) -> Result<Vec<u8>>,
{
    // Only this opaque, nonconstructible DB witness can be passed to the
    // signing callback. No caller-supplied epoch/digest authorizes signing.
    let evidence = readback_committed_applied_ack_staging(
        pool,
        authenticated_node_id,
        request_id,
        signed_ack_bytes,
        pinned_panel,
    )
    .await?;

    let existing: bool = sqlx::query_scalar(
        "SELECT EXISTS (
           SELECT 1 FROM node_xsp_signed_commit_receipt_outbox
           WHERE node_id=$1 AND request_id=$2
         )",
    )
    .bind(authenticated_node_id)
    .bind(request_id)
    .fetch_one(pool)
    .await?;
    if existing {
        // Never trust an outbox existence bit alone, never re-sign on retries.
        return load_committed_signed_receipt_staging(
            pool,
            authenticated_node_id,
            request_id,
            signed_ack_bytes,
            pinned_panel,
        )
        .await;
    }

    let signed_bytes = sign_from_verified_commit(&evidence)?;
    // This validates both signatures and locked relational evidence before
    // durable insert. Signatures alone never commit or switch the epoch.
    match store_or_load_signed_receipt_staging(
        pool,
        authenticated_node_id,
        request_id,
        signed_ack_bytes,
        &signed_bytes,
        pinned_panel,
    )
    .await
    {
        Ok(saved) => Ok(saved),
        Err(original_error) => {
            // A concurrent writer may have won with different exact signed
            // bytes (e.g. randomized PQ signatures). A safe retry must use
            // the first durable receipt, never overwrite it or sign again.
            // If the stored receipt is missing/invalid, this fails closed.
            load_committed_signed_receipt_staging(
                pool,
                authenticated_node_id,
                request_id,
                signed_ack_bytes,
                pinned_panel,
            )
            .await
            .with_context(|| {
                format!("signed receipt insertion failed: {original_error:#}")
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn outbox_rejects_missing_signed_receipt_before_database_access() {
        let result = store_or_load_signed_receipt_staging(
            &PgPool::connect_lazy("postgres://nobody:unused@localhost/nonexistent").unwrap(),
            1,
            "uncommitted",
            b"untrusted-ack",
            b"",
            &TrustedPublic {
                purpose: "panel_response".into(),
                issuer_id: "not-a-real-signer".into(),
                node_id: 1,
                ed_key_id: "bad".into(),
                pq_key_id: "bad".into(),
                ed_public: vec![],
                pq_public: vec![],
            },
        )
        .await;
        assert!(result.is_err());
    }
}
