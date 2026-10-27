//! Experimental, disconnected PostgreSQL writer for dual-signed cutover permits.
//! There is deliberately NO API route, signer provisioning, epoch switch,
//! ACK acceptance or key retirement here. The caller owns and commits tx.
#![allow(dead_code)]
use crate::{
    xsp_v2_candidate_binding::CandidatePublic,
    xsp_v2_db_candidate_snapshot::{LockedCandidate, load_locked_candidate},
    xsp_v2_signed_cutover::{ExpectedPermit, TrustedPublic, verify_signed_permit},
};
use anyhow::{Result, bail};
use sqlx::{Postgres, Row, Transaction};

pub struct StoredPermit {
    pub signed_bytes: Vec<u8>,
    pub canonical_sha256_hex: String,
    pub reused: bool,
}

fn from_trusted_snapshot(s: &LockedCandidate, request_id: &str) -> ExpectedPermit {
    let m: &CandidatePublic = &s.material;
    ExpectedPermit {
        node_id: m.node_id,
        from_epoch: m.from_epoch,
        to_epoch: m.to_epoch,
        request_id: request_id.to_owned(),
        from_ed_key_id: m.from_ed_key_id.clone(),
        from_pq_key_id: m.from_pq_key_id.clone(),
        to_ed_key_id: m.to_ed_key_id.clone(),
        to_pq_key_id: m.to_pq_key_id.clone(),
        candidate_sha256_hex: s.candidate_sha256_hex.clone(),
    }
}

/// Staging ledger INSERT of an **already dual-signed** Nexus permit.
///
/// The transaction MUST be opened by a separately authenticated owner context,
/// and the panel signer public keys MUST be pinned outside the signed message.
/// A caller-provided digest, proof flag or signed JSON is NOT owner approval.
/// The caller must commit this same transaction BEFORE permit delivery.
///
/// # Errors
/// Rejects stale/expired approvals, missing dual `PoP`, wrong actor/request,
/// reused/conflicting nonce, changed permit envelope, or signature mismatch.
/// No key epoch or suite floor can change through this function.
pub async fn persist_verified_permit(
    tx: &mut Transaction<'_, Postgres>,
    node_id: i64,
    authenticated_owner: &str,
    expected_request_id: &str,
    signed_bytes: &[u8],
    pinned_panel: &TrustedPublic,
    now_ms: i64,
) -> Result<StoredPermit> {
    if node_id <= 0
        || authenticated_owner.is_empty()
        || authenticated_owner.len() > 128
        || expected_request_id.is_empty()
        || expected_request_id.len() > 64
        || !expected_request_id.bytes().all(|v| v.is_ascii_graphic())
        || signed_bytes.is_empty()
        || signed_bytes.len() > 16 * 1024
    {
        bail!("invalid owner, request identity or signed envelope");
    }

    // Locks suite, active old keys and proved, unexpired pending keys.
    // These locks must remain held until the caller commits/rolls back tx.
    let snapshot = load_locked_candidate(tx, node_id).await?;
    if snapshot.approved_by != authenticated_owner {
        bail!("authenticated owner differs from the recorded keyset approver");
    }
    let expected = from_trusted_snapshot(&snapshot, expected_request_id);
    let verified = verify_signed_permit(signed_bytes, pinned_panel, &expected, now_ms)
        .map_err(anyhow::Error::msg)?;
    let permit = verified.message();
    let candidate = hex::decode(&snapshot.candidate_sha256_hex)?;
    let permit_hash = hex::decode(verified.canonical_sha256_hex())?;
    let nonce = hex::decode(&permit.permit_nonce_hex)?;

    // Do not allow a permit to outlive the exact proved prepared keyset
    // which was locked and used to derive its cryptographic digest.
    let bounded: bool = sqlx::query_scalar(
        "SELECT EXISTS(
           SELECT 1 FROM node_xsp_rotation_preparations
           WHERE node_id=$1 AND purpose='node_request'
             AND from_epoch=$2 AND to_epoch=$3
             AND proved_at IS NOT NULL
             AND expires_at >= to_timestamp(($4::bigint / 1000)::double precision)
                 + (($4::bigint % 1000) * INTERVAL '1 millisecond')
         )",
    )
    .bind(node_id)
    .bind(i64::try_from(expected.from_epoch)?)
    .bind(i64::try_from(expected.to_epoch)?)
    .bind(permit.expires_at_ms)
    .fetch_one(&mut **tx)
    .await?;
    if !bounded {
        bail!("permit expires after approved prepared keyset");
    }

    // Unique (node_id,request_id), (node_id,nonce), and (node_id,hash)
    // constraints make conflicting replay fail closed. Identical retries
    // return the exact original stored signed envelope; never re-sign.
    let existing = sqlx::query(
        "SELECT signed_permit,permit_input_sha256,candidate_sha256,state
         FROM node_xsp_cutover_permit_ledger
         WHERE node_id=$1 AND request_id=$2 FOR UPDATE",
    )
    .bind(node_id)
    .bind(expected_request_id)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(row) = existing {
        let original: Vec<u8> = row.try_get("signed_permit")?;
        let original_hash: Vec<u8> = row.try_get("permit_input_sha256")?;
        let original_candidate: Vec<u8> = row.try_get("candidate_sha256")?;
        let state: String = row.try_get("state")?;
        if state == "aborted"
            || original.as_slice() != signed_bytes
            || original_hash != permit_hash
            || original_candidate != candidate
        {
            bail!("conflicting or aborted cutover request cannot be replayed");
        }
        return Ok(StoredPermit {
            signed_bytes: original,
            canonical_sha256_hex: verified.canonical_sha256_hex().to_owned(),
            reused: true,
        });
    }

    sqlx::query(
        "INSERT INTO node_xsp_cutover_permit_ledger
         (node_id,request_id,from_epoch,to_epoch,candidate_sha256,
          permit_nonce,permit_input_sha256,signed_permit,issued_at,
          expires_at,issued_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                 to_timestamp(($9::bigint / 1000)::double precision)
                 + (($9::bigint % 1000) * INTERVAL '1 millisecond'),
                 to_timestamp(($10::bigint / 1000)::double precision)
                 + (($10::bigint % 1000) * INTERVAL '1 millisecond'),$11)",
    )
    .bind(node_id)
    .bind(expected_request_id)
    .bind(i64::try_from(expected.from_epoch)?)
    .bind(i64::try_from(expected.to_epoch)?)
    .bind(candidate)
    .bind(nonce)
    .bind(permit_hash)
    .bind(signed_bytes)
    .bind(permit.issued_at_ms)
    .bind(permit.expires_at_ms)
    .bind(authenticated_owner)
    .execute(&mut **tx)
    .await?;

    Ok(StoredPermit {
        signed_bytes: signed_bytes.to_vec(),
        canonical_sha256_hex: verified.canonical_sha256_hex().to_owned(),
        reused: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expected_permit_must_come_from_independent_keyset_snapshot() {
        let material = CandidatePublic {
            node_id: 42,
            from_epoch: 3,
            to_epoch: 4,
            purpose: "node_request".into(),
            from_ed_key_id: "ed-prior".into(),
            from_pq_key_id: "pq-prior".into(),
            to_ed_key_id: "ed-next".into(),
            to_pq_key_id: "pq-next".into(),
            active_ed_public: vec![0x21; 32],
            active_pq_public: vec![0x22; 1952],
            pending_ed_public: vec![0x23; 32],
            pending_pq_public: vec![0x24; 1952],
        };
        let snapshot = LockedCandidate {
            material,
            candidate_sha256_hex: "f0".repeat(32),
            approved_by: "staging-owner".into(),
        };
        let expected = from_trusted_snapshot(&snapshot, "approved-request-42");
        assert_eq!(expected.node_id, 42);
        assert_eq!(expected.from_epoch, 3);
        assert_eq!(expected.to_epoch, 4);
        assert_eq!(expected.to_ed_key_id, "ed-next");
        assert_eq!(expected.from_pq_key_id, "pq-prior");
        assert_eq!(expected.candidate_sha256_hex, "f0".repeat(32));
        assert_eq!(expected.request_id, "approved-request-42");
    }
}
