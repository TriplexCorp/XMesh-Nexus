//! Experimental, read-only transaction-bound XSP-v2 candidate snapshot.
//! No permit signer, no network route, no epoch updates or key retirement.
//! The caller MUST keep this transaction open while authorizing/issuing any
//! future signed permit; returning a digest alone is not an authorization.
#![allow(dead_code)]
use crate::xsp_v2_candidate_binding::{CandidatePublic, candidate_sha256};
use anyhow::{Context as _, Result, bail};
use ed25519_dalek::VerifyingKey;
use openssl::pkey::{KeyType, PKey};
use sha2::{Digest as _, Sha256};
use sqlx::{Postgres, Row, Transaction};

/// Result from a frozen database snapshot; NOT a signed authorization token.
pub struct LockedCandidate {
    pub material: CandidatePublic,
    pub candidate_sha256_hex: String,
    pub approved_by: String,
}
fn fingerprint(prefix: &str, raw: &[u8]) -> String {
    let sum = Sha256::digest(raw);
    format!("{prefix}{}", hex::encode(&sum[..12]))
}
fn validate_public(ed: &[u8], pq: &[u8], ed_id: &str, pq_id: &str) -> Result<()> {
    if ed.len() != 32 || pq.len() != 1952 {
        bail!("invalid XSP-v2 public key lengths");
    }
    if fingerprint("ed-", ed) != ed_id || fingerprint("pq-", pq) != pq_id {
        bail!("public key fingerprint does not match owner-approved key ID");
    }
    let ed_array: [u8; 32] = ed.try_into().context("invalid Ed25519 public key")?;
    VerifyingKey::from_bytes(&ed_array).context("invalid Ed25519 curve public key")?;
    PKey::public_key_from_raw_bytes_ex(None, KeyType::ML_DSA_65, None, pq)
        .context("invalid ML-DSA-65 public key or staging OpenSSL 3.5 provider absent")?;
    Ok(())
}

/// Reads and locks the current suite, active old public keys, and proved new
/// owner-approved public keys in the same PostgreSQL transaction.
///
/// # Errors
/// Fails closed if the Node is not in the allowed staging phase, key epoch
/// skips, pending proof is absent or expired, current public keys are revoked,
/// public key IDs do not match their bytes, or a cryptographic key is invalid.
/// No permission to issue a permit is granted just by this returned digest.
pub async fn load_locked_candidate(
    tx: &mut Transaction<'_, Postgres>,
    node_id: i64,
) -> Result<LockedCandidate> {
    if node_id <= 0 {
        bail!("invalid Node identifier");
    }
    let suite = sqlx::query(
        "SELECT minimum_suite,activation_phase,key_epoch
         FROM node_xsp_suite_state WHERE node_id=$1 FOR UPDATE",
    )
    .bind(node_id)
    .fetch_optional(&mut **tx)
    .await?
    .context("Node has no XSP-v2 suite state")?;
    let floor: i16 = suite.try_get("minimum_suite")?;
    let phase: String = suite.try_get("activation_phase")?;
    let from: i64 = suite.try_get("key_epoch")?;
    if floor != 1 || !matches!(phase.as_str(), "dual_enrolled" | "shadow") || from <= 0 {
        bail!("Node not eligible for staging cutover");
    }
    let to = from.checked_add(1).context("key epoch overflow")?;

    let active = sqlx::query(
        "SELECT ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public
         FROM node_xsp_public_keysets
         WHERE node_id=$1 AND purpose='node_request' AND key_epoch=$2
         AND revoked_at IS NULL FOR UPDATE",
    )
    .bind(node_id)
    .bind(from)
    .fetch_optional(&mut **tx)
    .await?
    .context("active public keyset absent or revoked")?;

    let pending = sqlx::query(
        "SELECT ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public,
                approved_by
         FROM node_xsp_rotation_preparations
         WHERE node_id=$1 AND purpose='node_request'
         AND from_epoch=$2 AND to_epoch=$3
         AND proved_at IS NOT NULL AND expires_at>NOW() FOR UPDATE",
    )
    .bind(node_id)
    .bind(from)
    .bind(to)
    .fetch_optional(&mut **tx)
    .await?
    .context("pending keyset unproved, expired or absent")?;

    let from_ed_id: String = active.try_get("ed25519_key_id")?;
    let from_pq_id: String = active.try_get("mldsa65_key_id")?;
    let to_ed_id: String = pending.try_get("ed25519_key_id")?;
    let to_pq_id: String = pending.try_get("mldsa65_key_id")?;
    let active_ed: Vec<u8> = active.try_get("ed25519_public")?;
    let active_pq: Vec<u8> = active.try_get("mldsa65_public")?;
    let next_ed: Vec<u8> = pending.try_get("ed25519_public")?;
    let next_pq: Vec<u8> = pending.try_get("mldsa65_public")?;
    let approved_by: String = pending.try_get("approved_by")?;

    if approved_by.is_empty() || from_ed_id == to_ed_id || from_pq_id == to_pq_id {
        bail!("pending proposal not approved or key IDs reused");
    }
    validate_public(&active_ed, &active_pq, &from_ed_id, &from_pq_id)?;
    validate_public(&next_ed, &next_pq, &to_ed_id, &to_pq_id)?;
    let material = CandidatePublic {
        node_id: u64::try_from(node_id)?,
        from_epoch: u64::try_from(from)?,
        to_epoch: u64::try_from(to)?,
        purpose: "node_request".to_owned(),
        from_ed_key_id: from_ed_id,
        from_pq_key_id: from_pq_id,
        to_ed_key_id: to_ed_id,
        to_pq_key_id: to_pq_id,
        active_ed_public: active_ed,
        active_pq_public: active_pq,
        pending_ed_public: next_ed,
        pending_pq_public: next_pq,
    };
    let candidate_sha256_hex = hex::encode(candidate_sha256(&material)?);
    Ok(LockedCandidate {
        material,
        candidate_sha256_hex,
        approved_by,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn key_identifiers_are_digests_of_exact_bytes() {
        let ed = [0x13; 32];
        let pq = [0x24; 1952];
        let id = fingerprint("ed-", &ed);
        let pq_id = fingerprint("pq-", &pq);
        assert!(id.starts_with("ed-"));
        assert!(pq_id.starts_with("pq-"));
        assert_ne!(fingerprint("ed-", &[0x14; 32]), id);
        assert_ne!(fingerprint("pq-", &[0x25; 1952]), pq_id);
        // The synthetic repeated-byte fixture is not a valid ML-DSA key and
        // cannot pass provider-backed validation merely by matching a digest.
        assert!(validate_public(&ed, &pq, &id, &pq_id).is_err());
    }
}
