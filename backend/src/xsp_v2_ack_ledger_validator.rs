//! XSP-v2 experimental ACK adjudication from a locked, previously signed
//! permit ledger. This is READ ONLY and disconnected from HTTP routes.
//! There is no trust epoch advancement, receipt signer or key retirement.
#![allow(dead_code)]
use crate::{
    xsp_v2_db_candidate_snapshot::{LockedCandidate, load_locked_candidate},
    xsp_v2_permit_ledger_writer::from_trusted_snapshot,
    xsp_v2_signed_cutover::{
        Cutover, TrustedPublic, verify_signed_applied_ack, verify_signed_permit,
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
    permit: &Cutover,
    canonical_sha256_hex: &str,
) -> Result<()> {
    let p = permit;
    if stored.state != "issued"
        || stored.issued_by != snapshot.approved_by
        || stored.from_epoch != i64::try_from(p.from_epoch)?
        || stored.to_epoch != i64::try_from(p.to_epoch)?
        || stored.candidate_sha256 != hex::decode(&snapshot.candidate_sha256_hex)?
        || stored.permit_input_sha256 != hex::decode(canonical_sha256_hex)?
        || stored.permit_nonce != hex::decode(&p.permit_nonce_hex)?
    {
        bail!("untrusted, replayed, altered or non-issued cutover ledger entry");
    }
    Ok(())
}

/// Authenticates the ACK under **new prepared public keys read from locked DB**
/// and matches it to the EXACT signed permit persisted by Nexus.
///
/// The caller must obtain `node_id` from authenticated node context
/// and the pinned panel-response keypair from independently trusted config.
/// Owner approval is established by the locked database row, NOT the ACK.
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
    request_id: &str,
    signed_ack_bytes: &[u8],
    pinned_panel: &TrustedPublic,
    now_ms: i64,
) -> Result<AdjudicatedACK> {
    if node_id <= 0 || request_id.is_empty() || request_id.len() > 64
        || !request_id.bytes().all(|b| b.is_ascii_graphic())
        || signed_ack_bytes.is_empty() || signed_ack_bytes.len() > 16 * 1024
        || now_ms <= 0
    {
        bail!("invalid ACK request context or envelope length");
    }

    // Lock ordering is exactly the same as permit issuance: suite row,
    // old keyset, pending keyset, then cutover ledger row. Do not invert it.
    let snapshot = load_locked_candidate(tx, node_id).await?;
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
    check_issued_record(&stored, &snapshot, verified.message(), verified.canonical_sha256_hex())?;

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
    fn ledger_metadata_must_match_signed_permit_and_owner_approved_keys() {
        let vector: serde_json::Value = serde_json::from_str(include_str!(
            "../../docs/XSP_V2_CUTOVER_CONTRACT_VECTORS.json"
        )).unwrap();
        let p: Cutover = serde_json::from_value(vector["permit"].clone()).unwrap();
        let snapshot = LockedCandidate {
            material: CandidatePublic {
                node_id: p.node_id, from_epoch: p.from_epoch, to_epoch: p.to_epoch,
                purpose: "node_request".into(),
                from_ed_key_id: p.from_ed_key_id.clone(),
                from_pq_key_id: p.from_pq_key_id.clone(),
                to_ed_key_id: p.to_ed_key_id.clone(),
                to_pq_key_id: p.to_pq_key_id.clone(),
                active_ed_public: vec![1; 32], active_pq_public: vec![2; 1952],
                pending_ed_public: vec![3; 32], pending_pq_public: vec![4; 1952],
            },
            candidate_sha256_hex: p.candidate_sha256_hex.clone(),
            approved_by: "owner-42".into(),
        };
        let hash = vector["permitInputSha256Hex"].as_str().unwrap();
        let row = LedgerRecord {
            state: "issued".into(),
            issued_by: snapshot.approved_by.clone(),
            from_epoch: i64::try_from(p.from_epoch).unwrap(),
            to_epoch: i64::try_from(p.to_epoch).unwrap(),
            signed_permit: vec![1; 300],
            candidate_sha256: hex::decode(&p.candidate_sha256_hex).unwrap(),
            permit_input_sha256: hex::decode(hash).unwrap(),
            permit_nonce: hex::decode(&p.permit_nonce_hex).unwrap(),
        };
        assert!(check_issued_record(&row,&snapshot,&p,hash).is_ok());
        let mut bad = clone_for_test(&row);
        bad.state="ack_verified".into();
        assert!(check_issued_record(&bad,&snapshot,&p,hash).is_err());
        bad.state="aborted".into();
        assert!(check_issued_record(&bad,&snapshot,&p,hash).is_err());
        bad=clone_for_test(&row);bad.issued_by="attacker".into();
        assert!(check_issued_record(&bad,&snapshot,&p,hash).is_err());
        bad=clone_for_test(&row);bad.from_epoch+=1;
        assert!(check_issued_record(&bad,&snapshot,&p,hash).is_err());
        bad=clone_for_test(&row);bad.permit_nonce[0]^=1;
        assert!(check_issued_record(&bad,&snapshot,&p,hash).is_err());
        bad=clone_for_test(&row);bad.permit_input_sha256[0]^=1;
        assert!(check_issued_record(&bad,&snapshot,&p,hash).is_err());
        bad=clone_for_test(&row);bad.candidate_sha256[0]^=1;
        assert!(check_issued_record(&bad,&snapshot,&p,hash).is_err());
        let mut incorrect=p.clone();incorrect.from_epoch+=1;
        assert!(check_issued_record(&row,&snapshot,&incorrect,hash).is_err());
    }
    fn clone_for_test(row:&LedgerRecord)->LedgerRecord {
        LedgerRecord {
            state:row.state.clone(),issued_by:row.issued_by.clone(),
            from_epoch:row.from_epoch,to_epoch:row.to_epoch,
            signed_permit:row.signed_permit.clone(),
            candidate_sha256:row.candidate_sha256.clone(),
            permit_input_sha256:row.permit_input_sha256.clone(),
            permit_nonce:row.permit_nonce.clone(),
        }
    }
}
