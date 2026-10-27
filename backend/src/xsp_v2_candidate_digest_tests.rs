//! Test-only v1 cutover candidate public-keyset hash binding.
//! This module does not read the DB, approve keys, sign permits or switch epochs.
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Clone)]
struct Candidate {
    node_id: u64,
    from_epoch: u64,
    to_epoch: u64,
    purpose: String,
    from_ed_key_id: String,
    from_pq_key_id: String,
    to_ed_key_id: String,
    to_pq_key_id: String,
    from_ed_public: Vec<u8>,
    from_pq_public: Vec<u8>,
    to_ed_public: Vec<u8>,
    to_pq_public: Vec<u8>,
}

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

fn write_text(bytes: &mut Vec<u8>, s: &str, max: usize) -> Result<(), &'static str> {
    if s.is_empty() || s.len() > max || !s.bytes().all(|b| b.is_ascii_graphic()) {
        return Err("invalid candidate identifier");
    }
    let n = u32::try_from(s.len()).map_err(|_| "length overflows u32")?;
    bytes.extend_from_slice(&n.to_be_bytes());
    bytes.extend_from_slice(s.as_bytes());
    Ok(())
}

fn canonical(c: &Candidate) -> Result<Vec<u8>, &'static str> {
    if c.node_id == 0
        || c.from_epoch == 0
        || c.from_epoch.checked_add(1) != Some(c.to_epoch)
        || c.purpose != "node_request"
    {
        return Err("invalid node/purpose/epoch");
    }
    let keys: [(&[u8], usize); 4] = [
        (&c.from_ed_public, 32),
        (&c.from_pq_public, 1952),
        (&c.to_ed_public, 32),
        (&c.to_pq_public, 1952),
    ];
    for (key, expected) in &keys {
        if key.len() != *expected || key.iter().all(|b| *b == 0) {
            return Err("invalid public key blob");
        }
    }
    let mut bytes = b"XSP2-CUTOVER-CANDIDATE-V1\0".to_vec();
    bytes.push(1);
    for n in [c.node_id, c.from_epoch, c.to_epoch] {
        bytes.extend_from_slice(&n.to_be_bytes());
    }
    write_text(&mut bytes, &c.purpose, 12)?;
    for s in [
        &c.from_ed_key_id,
        &c.from_pq_key_id,
        &c.to_ed_key_id,
        &c.to_pq_key_id,
    ] {
        write_text(&mut bytes, s, 64)?;
    }
    for (key, _) in &keys {
        bytes.extend_from_slice(key);
    }
    Ok(bytes)
}

fn digest(c: &Candidate) -> Result<String, &'static str> {
    Ok(hex::encode(Sha256::digest(canonical(c)?)))
}
fn repeated_byte(s: &str, size: usize) -> Vec<u8> {
    assert_eq!(s.len(), 2);
    vec![u8::from_str_radix(s, 16).unwrap(); size]
}
fn fixture() -> (Candidate, Fixture) {
    let v: Fixture = serde_json::from_str(include_str!(
        "../../docs/XSP_V2_CUTOVER_CANDIDATE_VECTORS.json"
    ))
    .unwrap();
    assert_eq!(v.schema, "xsp2-cutover-candidate-public-binding-1");
    let c = Candidate {
        node_id: v.node_id,
        from_epoch: v.from_epoch,
        to_epoch: v.to_epoch,
        purpose: v.purpose.clone(),
        from_ed_key_id: v.from_ed_key_id.clone(),
        from_pq_key_id: v.from_pq_key_id.clone(),
        to_ed_key_id: v.to_ed_key_id.clone(),
        to_pq_key_id: v.to_pq_key_id.clone(),
        from_ed_public: repeated_byte(&v.old_ed_byte_hex, 32),
        from_pq_public: repeated_byte(&v.old_pq_byte_hex, 1952),
        to_ed_public: repeated_byte(&v.new_ed_byte_hex, 32),
        to_pq_public: repeated_byte(&v.new_pq_byte_hex, 1952),
    };
    assert_eq!(canonical(&c).unwrap().len(), v.canonical_length);
    assert_eq!(digest(&c).unwrap(), v.candidate_sha256_hex);
    (c, v)
}

fn assert_changed(base: &Candidate, mutated: &Candidate) {
    let initial = digest(base).unwrap();
    assert_ne!(digest(mutated).ok().as_deref(), Some(initial.as_str()));
}

#[test]
fn candidate_digest_golden_and_identity_tamper_tests() {
    let (base, _) = fixture();
    let mut changed = base.clone();
    changed.node_id += 1;
    assert_changed(&base, &changed);
    changed = base.clone();
    changed.from_epoch += 1;
    assert_changed(&base, &changed);
    changed = base.clone();
    changed.to_epoch += 1;
    assert_changed(&base, &changed);
    changed = base.clone();
    changed.purpose = "panel_response".into();
    assert_changed(&base, &changed);
    for target in 0..4 {
        changed = base.clone();
        match target {
            0 => changed.from_ed_key_id.push('x'),
            1 => changed.from_pq_key_id.push('x'),
            2 => changed.to_ed_key_id.push('x'),
            _ => changed.to_pq_key_id.push('x'),
        }
        assert_changed(&base, &changed);
    }
    for target in 0..4 {
        changed = base.clone();
        match target {
            0 => changed.from_ed_public[0] ^= 1,
            1 => changed.from_pq_public[0] ^= 1,
            2 => changed.to_ed_public[0] ^= 1,
            _ => changed.to_pq_public[0] ^= 1,
        }
        assert_changed(&base, &changed);
    }
}

#[test]
fn candidate_rejects_invalid_public_material() {
    let (base, _) = fixture();
    let mut invalid = base.clone();
    invalid.node_id = 0;
    assert!(canonical(&invalid).is_err());
    invalid = base.clone();
    invalid.from_epoch = u64::MAX;
    invalid.to_epoch = 0;
    assert!(canonical(&invalid).is_err());
    invalid = base.clone();
    invalid.to_epoch = invalid.from_epoch;
    assert!(canonical(&invalid).is_err());
    invalid = base.clone();
    invalid.from_pq_key_id = "has space".into();
    assert!(canonical(&invalid).is_err());
    invalid = base.clone();
    invalid.to_ed_key_id = "x".repeat(65);
    assert!(canonical(&invalid).is_err());
    invalid = base.clone();
    invalid.to_pq_key_id.clear();
    assert!(canonical(&invalid).is_err());
    invalid = base.clone();
    invalid.to_ed_public.truncate(31);
    assert!(canonical(&invalid).is_err());
    invalid = base.clone();
    invalid.to_pq_public.truncate(1951);
    assert!(canonical(&invalid).is_err());
    invalid = base.clone();
    invalid.from_ed_public.fill(0);
    assert!(canonical(&invalid).is_err());
    invalid = base.clone();
    invalid.from_pq_public.fill(0);
    assert!(canonical(&invalid).is_err());
}
