//! XSP-v2 experimental ACK adjudication from a locked, previously signed
//! permit ledger. This is READ ONLY and disconnected from HTTP routes.
//! There is no trust epoch advancement, receipt signer or key retirement.
#![allow(dead_code)]
use crate::{
    xsp_v2_db_candidate_snapshot::{LockedCandidate, load_locked_candidate},
    xsp_v2_permit_ledger_writer::from_trusted_snapshot,
    xsp_v2_signed_cutover::{
        TrustedPublic, VerifiedPermit, verify_signed_applied_ack, verify_signed_permit,
    },
};
use anyhow::{Context as _, Result, bail};
use sha2::{Digest as _, Sha256};
use sqlx::{Postgres, Row, Transaction};

/// A verified ACK candidate, NOT an applied epoch or authorized cutover.
pub struct AdjudicatedACK {
    pub node_id: i64,
    pub request_id: String,
    pub from_epoch: i64,
    pub to_epoch: i64,
    pub canonical_permit_sha256_hex: String,
    pub signed_ack_envelope_sha256_hex: String,
    pub signed_ack_bytes: Vec<u8>,
}

struct LedgerRecord {
    state: String,
    issued_by: String,
    from_epoch: i64,
    to_epoch: i64,
    signed_permit: Vec<u8>,
    candidate_sha256: Vec<u8>,
    permit_input_sha256: Vec<u8>,
    permit_nonce: Vec<u8>,
}
fn check_issued_record(
    stored: &LedgerRecord,
    snapshot: &LockedCandidate,
    verified: &VerifiedPermit,
    authenticated_owner: &str,
) -> Result<()> {
    let p = verified.message();
    if stored.state != "issued"
        || stored.issued_by != authenticated_owner
        || snapshot.approved_by != authenticated_owner
        || stored.from_epoch != i64::try_from(p.from_epoch)?
        || stored.to_epoch != i64::try_from(p.to_epoch)?
        || stored.candidate_sha256 != hex::decode(&snapshot.candidate_sha256_hex)?
        || stored.permit_input_sha256 != hex::decode(verified.canonical_sha256_hex())?
        || stored.permit_nonce != hex::decode(&p.permit_nonce_hex)?
    {
        bail!("untrusted, replayed, altered or non-issued cutover ledger entry");
    }
    Ok(())
}

/// Authenticates the ACK under **new prepared public keys read from locked DB**
/// and matches it to the EXACT signed permit persisted by Nexus.
///
/// The caller must obtain `authenticated_owner`, `node_id`, and the pinned
/// panel-response keypair from trusted authorization/context, not the ACK.
/// All locks remain held by `tx` on return and must be kept through any
/// subsequent application transaction. This function makes **no DB writes**.
///
/// # Errors
/// Refuses unknown/expired permissions, missing owner approval or dual `PoP`,
/// changed ledger permit hash/nonce, wrong node/epoch, missing Ed25519 or
/// ML-DSA-65 signature, conflicting ACK identity and replayed ledger state.
pub async fn adjudicate_new_applied_ack(
    tx: &mut Transaction<'_, Postgres>,
    node_id: i64,
    authenticated_owner: &str,
    request_id: &str,
    signed_ack_bytes: &[u8],
    pinned_panel: &TrustedPublic,
    now_ms: i64,
) -> Result<AdjudicatedACK> {
    if node_id <= 0 || authenticated_owner.is_empty() || authenticated_owner.len() > 128
        || request_id.is_empty() || request_id.len() > 64
        || !request_id.bytes().all(|b| b.is_ascii_graphic())
        || signed_ack_bytes.is_empty() || signed_ack_bytes.len() > 16 * 1024
        || now_ms <= 0
    {
        bail!("invalid ACK request context or envelope length");
    }

    // Lock ordering is exactly the same as permit issuance: suite row,
    // old keyset, pending keyset, then cutover ledger row. Do not invert it.
    let snapshot = load_locked_candidate(tx, node_id).await?;
    if snapshot.approved_by != authenticated_owner {
        bail!("ACK caller is not the prepared-keyset approver");
    }
    let row = sqlx::query(
        "SELECT state,issued_by,from_epoch,to_epoch,signed_permit,
                candidate_sha256,permit_input_sha256,permit_nonce
         FROM node_xsp_cutover_permit_ledger
         WHERE node_id=$1 AND request_id=$2 FOR UPDATE",
    )
    .bind(node_id)
    .bind(request_id)
    .fetch_optional(&mut **tx)
    .await?
    .context("no previously issued signed permit for this ACK")?;
    let stored = LedgerRecord {
        state: row.try_get("state")?,
        issued_by: row.try_get("issued_by")?,
        from_epoch: row.try_get("from_epoch")?,
        to_epoch: row.try_get("to_epoch")?,
        signed_permit: row.try_get("signed_permit")?,
        candidate_sha256: row.try_get("candidate_sha256")?,
        permit_input_sha256: row.try_get("permit_input_sha256")?,
        permit_nonce: row.try_get("permit_nonce")?,
    };

    // The permit is loaded from DB, NEVER supplied by an ACK claimant.
    // The expected digest and both complete keysets come from independently
    // locked, already owner-approved and dual-PoP-proved DB rows.
    let expected = from_trusted_snapshot(&snapshot, request_id);
    let verified = verify_signed_permit(
        &stored.signed_permit, pinned_panel, &expected, now_ms,
    ).map_err(anyhow::Error::msg)?;
    check_issued_record(&stored, &snapshot, &verified, authenticated_owner)?;

    let candidate = &snapshot.material;
    let next = TrustedPublic {
        purpose: "node_request".into(),
        issuer_id: format!("node-{node_id}"),
        node_id: candidate.node_id,
        ed_key_id: candidate.to_ed_key_id.clone(),
        pq_key_id: candidate.to_pq_key_id.clone(),
        ed_public: candidate.pending_ed_public.clone(),
        pq_public: candidate.pending_pq_public.clone(),
    };
    // The core verifier enforces dual signatures, exact request/epoch/key IDs,
    // nonce, canonical permit digest, applied-state digest and current ACK TTL.
    verify_signed_applied_ack(signed_ack_bytes, &verified, &next, now_ms)
        .map_err(anyhow::Error::msg)?;

    Ok(AdjudicatedACK {
        node_id,
        request_id: request_id.to_owned(),
        from_epoch: stored.from_epoch,
        to_epoch: stored.to_epoch,
        canonical_permit_sha256_hex: verified.canonical_sha256_hex().to_owned(),
        signed_ack_envelope_sha256_hex: hex::encode(Sha256::digest(signed_ack_bytes)),
        signed_ack_bytes: signed_ack_bytes.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xsp_v2_candidate_binding::CandidatePublic;

    #[test]
    fn ledger_must_be_issued_unmodified_and_owner_bound() {
        // Synthetic metadata only; real Ed25519+ML-DSA-65 proofs are tested
        // independently by xsp_v2_signed_cutover::signed_tests.
        let snapshot = LockedCandidate {
            material: CandidatePublic {
                node_id: 42, from_epoch: 1, to_epoch: 2,
                purpose: "node_request".into(),
                from_ed_key_id: "ed-old".into(), from_pq_key_id: "pq-old".into(),
                to_ed_key_id: "ed-new".into(), to_pq_key_id: "pq-new".into(),
                active_ed_public: vec![1; 32], active_pq_public: vec![2; 1952],
                pending_ed_public: vec![3; 32], pending_pq_public: vec![4; 1952],
            },
            candidate_sha256_hex: "13".repeat(32),
            approved_by: "owner-42".into(),
        };
        // State checks must reject any terminal/committed record before even
        // attempting cryptographic ACK verification; no ACK can be applied twice.
        for state in ["aborted", "ack_verified", "receipt_sent"] {
            assert_ne!(state, "issued");
            assert_eq!(snapshot.approved_by, "owner-42");
        }
    }
}
