//! Experimental XSP/2 commit receipt: database-confirmed, dual-signed proof.
//! NOT a live API route, a key-custody mechanism, or Node key-retirement consent.
#![allow(dead_code)]
use crate::{
    xsp_v2_ack_epoch_commit::StagingStoredACKEvidence, xsp_v2_signed_cutover::TrustedPublic,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, Signer as _, SigningKey, Verifier as _, VerifyingKey};
use openssl::{
    pkey::{KeyType, PKey, Private},
    sign::{Signer as PQSigner, Verifier as PQVerifier},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

const DOMAIN: &[u8] = b"XSP2-CUTOVER-COMMIT-RECEIPT-V1\0";

/// A receipt has NO short message TTL: unlike a command, it is immutable
/// historical commit evidence, reusable only against the exact saved ACK.
/// Its signed DB commit time must fall within the original accepted ACK TTL.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitReceipt {
    pub protocol: String,
    pub kind: String,
    pub issuer_id: String,
    pub signer_ed_key_id: String,
    #[serde(rename = "signerPQKeyId")]
    pub signer_pq_key_id: String,
    pub node_id: u64,
    pub from_epoch: u64,
    pub to_epoch: u64,
    pub request_id: String,
    pub committed_at_ms: i64,
    pub ack_nonce_hex: String,
    #[serde(rename = "candidateSHA256Hex")]
    pub candidate_sha256_hex: String,
    #[serde(rename = "permitSHA256Hex")]
    pub permit_sha256_hex: String,
    #[serde(rename = "signedACKSHA256Hex")]
    pub signed_ack_sha256_hex: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct DualSignatures {
    ed25519: String,
    mldsa65: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SignedReceipt {
    message: CommitReceipt,
    signatures: DualSignatures,
}
#[derive(Deserialize)]
struct Golden {
    schema: String,
    message: CommitReceipt,
    signing_input_hex: String,
    signing_input_sha256_hex: String,
}
fn ascii(out: &mut Vec<u8>, value: &str, max: usize) -> Result<(), &'static str> {
    if value.is_empty() || value.len() > max || !value.bytes().all(|b| b.is_ascii_graphic()) {
        return Err("invalid receipt ASCII field");
    }
    out.extend_from_slice(
        &u32::try_from(value.len())
            .map_err(|_| "length")?
            .to_be_bytes(),
    );
    out.extend_from_slice(value.as_bytes());
    Ok(())
}
fn strict_hex(value: &str, count: usize) -> Result<Vec<u8>, &'static str> {
    if value.len() != count * 2 {
        return Err("invalid receipt digest or nonce length");
    }
    let b = hex::decode(value).map_err(|_| "invalid receipt hex")?;
    if hex::encode(&b) != value || b.iter().all(|x| *x == 0) {
        return Err("noncanonical or zero receipt digest/nonce");
    }
    Ok(b)
}
pub fn canonical(message: &CommitReceipt) -> Result<Vec<u8>, &'static str> {
    if message.protocol != "XSP/2"
        || message.kind != "commit_receipt"
        || message.issuer_id == format!("node-{}", message.node_id)
        || message.node_id == 0
        || message.node_id > i64::MAX as u64
        || message.from_epoch == 0
        || message.from_epoch.checked_add(1) != Some(message.to_epoch)
        || message.committed_at_ms <= 0
    {
        return Err("invalid commit receipt role, version, epoch or timestamp");
    }
    let nonce = strict_hex(&message.ack_nonce_hex, 16)?;
    let candidate = strict_hex(&message.candidate_sha256_hex, 32)?;
    let permit = strict_hex(&message.permit_sha256_hex, 32)?;
    let ack = strict_hex(&message.signed_ack_sha256_hex, 32)?;
    let mut bytes = DOMAIN.to_vec();
    bytes.extend_from_slice(&[1, 2]); // commit receipt V1, Nexus -> Node
    for n in [message.node_id, message.from_epoch, message.to_epoch] {
        bytes.extend_from_slice(&n.to_be_bytes());
    }
    for (value, max) in [
        (message.request_id.as_str(), 64),
        (message.issuer_id.as_str(), 64),
        (message.signer_ed_key_id.as_str(), 64),
        (message.signer_pq_key_id.as_str(), 64),
    ] {
        ascii(&mut bytes, value, max)?;
    }
    bytes.extend_from_slice(&message.committed_at_ms.to_be_bytes());
    for raw in [&nonce, &candidate, &permit, &ack] {
        bytes.extend_from_slice(raw);
    }
    Ok(bytes)
}
fn trusted_key_id(prefix: &str, pub_bytes: &[u8]) -> String {
    let digest = Sha256::digest(pub_bytes);
    format!("{prefix}{}", hex::encode(&digest[..12]))
}
fn validated_pin(pin: &TrustedPublic, msg: &CommitReceipt) -> Result<(), &'static str> {
    if pin.purpose != "panel_response"
        || pin.node_id != msg.node_id
        || pin.issuer_id != msg.issuer_id
        || pin.ed_key_id != msg.signer_ed_key_id
        || pin.pq_key_id != msg.signer_pq_key_id
        || pin.ed_public.len() != 32
        || pin.pq_public.len() != 1952
        || pin.ed_key_id != trusted_key_id("ed-", &pin.ed_public)
        || pin.pq_key_id != trusted_key_id("pq-", &pin.pq_public)
    {
        return Err("receipt panel_response pin is not independently trusted");
    }
    Ok(())
}
fn exact_b64(value: &str, count: usize) -> Result<Vec<u8>, &'static str> {
    if value.len() != count.div_ceil(3) * 4 {
        return Err("bad receipt signature length");
    }
    let raw = STANDARD.decode(value).map_err(|_| "bad receipt Base64")?;
    if raw.len() != count || STANDARD.encode(&raw) != value {
        return Err("noncanonical receipt signature");
    }
    Ok(raw)
}
fn matches_evidence(msg: &CommitReceipt, evidence: &StagingStoredACKEvidence) -> bool {
    msg.node_id == u64::try_from(evidence.node_id).unwrap_or(0)
        && msg.from_epoch == u64::try_from(evidence.from_epoch).unwrap_or(0)
        && msg.to_epoch == u64::try_from(evidence.to_epoch).unwrap_or(0)
        && msg.request_id == evidence.request_id
        && msg.committed_at_ms == evidence.committed_at_ms
        && msg.ack_nonce_hex == evidence.ack_nonce_hex
        && msg.candidate_sha256_hex == evidence.candidate_sha256_hex
        && msg.permit_sha256_hex == evidence.canonical_permit_sha256_hex
        && msg.signed_ack_sha256_hex == evidence.signed_ack_envelope_sha256_hex
}
fn from_verified_db(
    evidence: &StagingStoredACKEvidence,
    panel_pin: &TrustedPublic,
) -> Result<CommitReceipt, &'static str> {
    let msg = CommitReceipt {
        protocol: "XSP/2".into(),
        kind: "commit_receipt".into(),
        issuer_id: panel_pin.issuer_id.clone(),
        signer_ed_key_id: panel_pin.ed_key_id.clone(),
        signer_pq_key_id: panel_pin.pq_key_id.clone(),
        node_id: u64::try_from(evidence.node_id).map_err(|_| "bad node ID")?,
        from_epoch: u64::try_from(evidence.from_epoch).map_err(|_| "bad from epoch")?,
        to_epoch: u64::try_from(evidence.to_epoch).map_err(|_| "bad to epoch")?,
        request_id: evidence.request_id.clone(),
        committed_at_ms: evidence.committed_at_ms,
        ack_nonce_hex: evidence.ack_nonce_hex.clone(),
        candidate_sha256_hex: evidence.candidate_sha256_hex.clone(),
        permit_sha256_hex: evidence.canonical_permit_sha256_hex.clone(),
        signed_ack_sha256_hex: evidence.signed_ack_envelope_sha256_hex.clone(),
    };
    canonical(&msg)?;
    validated_pin(panel_pin, &msg)?;
    Ok(msg)
}
/// Only consumes the opaque verified **database readback** witness.
/// Caller must provision an independently protected panel signer. No private
/// keys, signer provisioning, API handler, outbox or receipt delivery here.
pub fn sign_staging_commit_receipt(
    evidence: &StagingStoredACKEvidence,
    panel_pin: &TrustedPublic,
    ed: &SigningKey,
    pq: &PKey<Private>,
) -> Result<Vec<u8>, &'static str> {
    let msg = from_verified_db(evidence, panel_pin)?;
    if ed.verifying_key().to_bytes().as_slice() != panel_pin.ed_public {
        return Err("panel Ed25519 signing key does not match the pinned identity");
    }
    let input = canonical(&msg)?;
    let mut pq_signer = PQSigner::new_without_digest(pq).map_err(|_| "PQ signer unavailable")?;
    let pq_sig = pq_signer
        .sign_oneshot_to_vec(&input)
        .map_err(|_| "PQ signing failed")?;
    let signed = SignedReceipt {
        message: msg,
        signatures: DualSignatures {
            ed25519: STANDARD.encode(ed.sign(&input).to_bytes()),
            mldsa65: STANDARD.encode(&pq_sig),
        },
    };
    let bytes = serde_json::to_vec(&signed).map_err(|_| "receipt serialization failed")?;
    verify_staging_commit_receipt(&bytes, panel_pin, evidence)?;
    Ok(bytes)
}
/// Verify both signatures and EVERY bit of the original DB commit witness.
/// This is an internal test boundary; the Go Node verifier independently binds
/// the receipt to its saved permit and signed ACK without consulting the DB.
pub fn verify_staging_commit_receipt(
    raw: &[u8],
    panel_pin: &TrustedPublic,
    evidence: &StagingStoredACKEvidence,
) -> Result<(), &'static str> {
    if raw.is_empty() || raw.len() > 16 * 1024 {
        return Err("invalid signed receipt size");
    }
    let signed: SignedReceipt = serde_json::from_slice(raw).map_err(|_| "invalid receipt JSON")?;
    let input = canonical(&signed.message)?;
    if !matches_evidence(&signed.message, evidence) {
        return Err("receipt not bound to committed ledger evidence");
    }
    validated_pin(panel_pin, &signed.message)?;
    let ed_bytes: [u8; 32] = panel_pin
        .ed_public
        .as_slice()
        .try_into()
        .map_err(|_| "bad Ed key")?;
    let ed_verifier = VerifyingKey::from_bytes(&ed_bytes).map_err(|_| "bad Ed25519 public")?;
    let ed_sig: [u8; 64] = exact_b64(&signed.signatures.ed25519, 64)?
        .try_into()
        .map_err(|_| "bad Ed signature")?;
    ed_verifier
        .verify(&input, &Signature::from_bytes(&ed_sig))
        .map_err(|_| "receipt Ed25519 verification failed")?;
    let pq_sig = exact_b64(&signed.signatures.mldsa65, 3309)?;
    let pq_public =
        PKey::public_key_from_raw_bytes_ex(None, KeyType::ML_DSA_65, None, &panel_pin.pq_public)
            .map_err(|_| "bad panel ML-DSA public key")?;
    let mut pq_verifier =
        PQVerifier::new_without_digest(&pq_public).map_err(|_| "PQ verifier unavailable")?;
    if !pq_verifier
        .verify_oneshot(&pq_sig, &input)
        .map_err(|_| "PQ receipt verification error")?
    {
        return Err("receipt ML-DSA-65 signature invalid");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_receipt_v1_golden_and_negative_fields() {
        let fixture: Golden = serde_json::from_str(include_str!(
            "../../docs/XSP_V2_COMMIT_RECEIPT_VECTORS.json"
        ))
        .unwrap();
        assert_eq!(fixture.schema, "xsp2-commit-receipt-1");
        let input = canonical(&fixture.message).unwrap();
        assert_eq!(hex::encode(&input), fixture.signing_input_hex);
        assert_eq!(
            hex::encode(Sha256::digest(&input)),
            fixture.signing_input_sha256_hex
        );
        let mut wrong = fixture.message.clone();
        wrong.protocol = "XMESH1".into();
        assert!(canonical(&wrong).is_err());
        wrong = fixture.message.clone();
        wrong.kind = "ack".into();
        assert!(canonical(&wrong).is_err());
        wrong = fixture.message.clone();
        wrong.from_epoch = 2;
        assert!(canonical(&wrong).is_err());
        wrong = fixture.message.clone();
        wrong.ack_nonce_hex = "00".repeat(16);
        assert!(canonical(&wrong).is_err());
        wrong = fixture.message.clone();
        wrong.permit_sha256_hex = "11".repeat(32);
        assert_ne!(canonical(&wrong).unwrap(), input);
        wrong = fixture.message.clone();
        wrong.request_id.push('!');
        assert_ne!(canonical(&wrong).unwrap(), input);
        wrong = fixture.message.clone();
        wrong.committed_at_ms = 0;
        assert!(canonical(&wrong).is_err());
        let mut value = serde_json::to_value(&fixture.message).unwrap();
        value["legacy"] = serde_json::json!(true);
        assert!(serde_json::from_value::<CommitReceipt>(value).is_err());
    }
}
