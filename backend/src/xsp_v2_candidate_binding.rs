//! Experimental cutover candidate digest from independently sourced public keys.
//! This code does NOT prove owner approval or dual-PoP, and is never called by
//! live routes. Caller must obtain current and pending keys from locked state.
#![allow(dead_code)]
use sha2::{Digest, Sha256};

/// The exact, fixed public material of a single staged epoch transition.
/// Private keys, signed permits, and claimed digests must NEVER be sources.
#[derive(Clone)]
pub struct CandidatePublic {
    pub node_id: u64,
    pub from_epoch: u64,
    pub to_epoch: u64,
    pub purpose: String,
    pub from_ed_key_id: String,
    pub from_pq_key_id: String,
    pub to_ed_key_id: String,
    pub to_pq_key_id: String,
    pub active_ed_public: Vec<u8>,
    pub active_pq_public: Vec<u8>,
    pub pending_ed_public: Vec<u8>,
    pub pending_pq_public: Vec<u8>,
}

fn bounded_ascii(bytes: &mut Vec<u8>, value: &str, limit: usize) -> Result<(), &'static str> {
    if value.is_empty() || value.len() > limit || !value.bytes().all(|b| b.is_ascii_graphic()) {
        return Err("invalid candidate identifier");
    }
    let size = u32::try_from(value.len()).map_err(|_| "candidate identifier too long")?;
    bytes.extend_from_slice(&size.to_be_bytes());
    bytes.extend_from_slice(value.as_bytes());
    Ok(())
}

/// Reproduces `XSP2-CUTOVER-CANDIDATE-V1` bytes without JSON canonicalization.
///
/// # Errors
/// Rejects invalid node/epoch, wrong purpose, bad ASCII metadata, incorrect
/// fixed key sizes, or all-zero public key blobs. It DOES NOT validate the
/// cryptographic public keys or establish owner approval.
pub fn canonical_candidate(candidate: &CandidatePublic) -> Result<Vec<u8>, &'static str> {
    if candidate.node_id == 0
        || candidate.from_epoch == 0
        || candidate.from_epoch.checked_add(1) != Some(candidate.to_epoch)
        || candidate.purpose != "node_request"
    {
        return Err("invalid candidate node/purpose/epoch");
    }
    let keys: [(&[u8], usize); 4] = [
        (&candidate.active_ed_public, 32),
        (&candidate.active_pq_public, 1952),
        (&candidate.pending_ed_public, 32),
        (&candidate.pending_pq_public, 1952),
    ];
    if keys
        .iter()
        .any(|(raw, length)| raw.len() != *length || raw.iter().all(|b| *b == 0))
    {
        return Err("invalid candidate public material");
    }

    let mut result = b"XSP2-CUTOVER-CANDIDATE-V1\0".to_vec();
    result.push(1);
    for value in [
        candidate.node_id,
        candidate.from_epoch,
        candidate.to_epoch,
    ] {
        result.extend_from_slice(&value.to_be_bytes());
    }
    bounded_ascii(&mut result, &candidate.purpose, 12)?;
    for name in [
        &candidate.from_ed_key_id,
        &candidate.from_pq_key_id,
        &candidate.to_ed_key_id,
        &candidate.to_pq_key_id,
    ] {
        bounded_ascii(&mut result, name, 64)?;
    }
    for (raw, _) in &keys {
        result.extend_from_slice(raw);
    }
    Ok(result)
}

/// SHA-256 of exact active+pending candidate signing bytes.
///
/// # Errors
/// Forwards validation failures from `canonical_candidate`.
pub fn candidate_sha256(candidate: &CandidatePublic) -> Result<[u8; 32], &'static str> {
    Ok(Sha256::digest(canonical_candidate(candidate)?).into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Fixture {
        schema: String,
        node_id: u64,
        from_epoch: u64,
        to_epoch: u64,
        purpose: String,
        from_ed_key_id: String,
        #[serde(rename = "fromPQKeyId")]
        from_pq_key_id: String,
        to_ed_key_id: String,
        #[serde(rename = "toPQKeyId")]
        to_pq_key_id: String,
        old_ed_byte_hex: String,
        #[serde(rename = "oldPQByteHex")]
        old_pq_byte_hex: String,
        new_ed_byte_hex: String,
        #[serde(rename = "newPQByteHex")]
        new_pq_byte_hex: String,
        candidate_sha256_hex: String,
        canonical_length: usize,
    }
    fn repeated(byte: &str, size: usize) -> Vec<u8> {
        vec![u8::from_str_radix(byte, 16).unwrap(); size]
    }
    fn load() -> (CandidatePublic, Fixture) {
        let f: Fixture = serde_json::from_str(include_str!(
            "../../docs/XSP_V2_CUTOVER_CANDIDATE_VECTORS.json"
        ))
        .unwrap();
        assert_eq!(f.schema, "xsp2-cutover-candidate-public-binding-1");
        let c = CandidatePublic {
            node_id: f.node_id,
            from_epoch: f.from_epoch,
            to_epoch: f.to_epoch,
            purpose: f.purpose.clone(),
            from_ed_key_id: f.from_ed_key_id.clone(),
            from_pq_key_id: f.from_pq_key_id.clone(),
            to_ed_key_id: f.to_ed_key_id.clone(),
            to_pq_key_id: f.to_pq_key_id.clone(),
            active_ed_public: repeated(&f.old_ed_byte_hex, 32),
            active_pq_public: repeated(&f.old_pq_byte_hex, 1952),
            pending_ed_public: repeated(&f.new_ed_byte_hex, 32),
            pending_pq_public: repeated(&f.new_pq_byte_hex, 1952),
        };
        (c, f)
    }
    #[test]
    fn staging_digest_matches_independent_rust_go_fixture() {
        let (candidate, fixture) = load();
        let bytes = canonical_candidate(&candidate).unwrap();
        assert_eq!(bytes.len(), fixture.canonical_length);
        let digest = candidate_sha256(&candidate).unwrap();
        assert_eq!(hex::encode(digest), fixture.candidate_sha256_hex);
    }
    #[test]
    fn staging_digest_changes_on_trusted_public_material() {
        let (base, _) = load();
        let expected = candidate_sha256(&base).unwrap();
        let mut changed = base.clone();
        changed.active_ed_public[0] ^= 1;
        assert_ne!(candidate_sha256(&changed).unwrap(), expected);
        changed = base.clone();
        changed.pending_pq_public[1951] ^= 1;
        assert_ne!(candidate_sha256(&changed).unwrap(), expected);
        changed = base.clone();
        changed.from_ed_key_id.push('x');
        assert_ne!(candidate_sha256(&changed).unwrap(), expected);
        changed = base.clone();
        changed.to_pq_key_id.push('x');
        assert_ne!(candidate_sha256(&changed).unwrap(), expected);
        changed = base.clone();
        changed.node_id += 1;
        assert_ne!(candidate_sha256(&changed).unwrap(), expected);
        changed = base.clone();
        changed.from_epoch += 1;
        assert!(candidate_sha256(&changed).is_err());
        changed = base.clone();
        changed.to_epoch += 1;
        assert!(candidate_sha256(&changed).is_err());
    }
    #[test]
    fn staging_digest_rejects_unapproved_shape() {
        let (base, _) = load();
        let mut bad = base.clone();
        bad.purpose = "panel_response".into();
        assert!(candidate_sha256(&bad).is_err());
        bad = base.clone();
        bad.active_ed_public.fill(0);
        assert!(candidate_sha256(&bad).is_err());
        bad = base.clone();
        bad.pending_pq_public.truncate(1951);
        assert!(candidate_sha256(&bad).is_err());
        bad = base;
        bad.to_ed_key_id = "unexpected space".into();
        assert!(candidate_sha256(&bad).is_err());
    }
}
