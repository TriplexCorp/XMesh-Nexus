//! Test-only XSP-v2 signed cutover/ACK candidate contract.
//! No signing keys, DB effects, API routes or production activation.
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cutover {
    kind: String,
    issuer_id: String,
    signer_ed_key_id: String,
    signer_pq_key_id: String,
    node_id: u64,
    from_epoch: u64,
    to_epoch: u64,
    request_id: String,
    from_ed_key_id: String,
    from_pq_key_id: String,
    to_ed_key_id: String,
    to_pq_key_id: String,
    method: String,
    path: String,
    issued_at_ms: i64,
    expires_at_ms: i64,
    permit_nonce_hex: String,
    nonce_hex: String,
    candidate_sha256_hex: String,
    permit_sha256_hex: String,
    applied_state_sha256_hex: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContractFixture {
    schema: String,
    permit: Cutover,
    ack: Cutover,
    permit_input_sha256_hex: String,
    ack_input_sha256_hex: String,
    state_digest_sha256_hex: String,
}

fn ascii(out: &mut Vec<u8>, s: &str, max: usize) -> Result<(), &'static str> {
    if s.is_empty() || s.len() > max || !s.bytes().all(|b| b.is_ascii_graphic()) {
        return Err("invalid ASCII metadata");
    }
    let n = u32::try_from(s.len()).map_err(|_| "length overflow")?;
    out.extend_from_slice(&n.to_be_bytes());
    out.extend_from_slice(s.as_bytes());
    Ok(())
}

fn hex_bytes(s: &str, size: usize) -> Result<Vec<u8>, &'static str> {
    if s.len() != size * 2 {
        return Err("invalid hex length");
    }
    let raw = hex::decode(s).map_err(|_| "invalid hex")?;
    if hex::encode(&raw) != s {
        return Err("noncanonical hex");
    }
    Ok(raw)
}

fn nonzero(b: &[u8]) -> bool {
    b.iter().any(|v| *v != 0)
}

fn signing_input(v: &Cutover) -> Result<Vec<u8>, &'static str> {
    let (domain, direction): (&[u8], u8) = match v.kind.as_str() {
        "permit" => {
            if v.path != "/api/v2/node/keys/rotation/permit"
                || v.issuer_id == format!("node-{}", v.node_id)
                || v.signer_ed_key_id == v.to_ed_key_id
                || v.signer_pq_key_id == v.to_pq_key_id
            {
                return Err("invalid permit issuer/key role");
            }
            (b"XSP2-CUTOVER-PERMIT-V1\0", 2)
        }
        "ack" => {
            if v.path != "/api/v2/node/keys/rotation/ack"
                || v.issuer_id != format!("node-{}", v.node_id)
                || v.signer_ed_key_id != v.to_ed_key_id
                || v.signer_pq_key_id != v.to_pq_key_id
            {
                return Err("invalid ACK issuer/key role");
            }
            (b"XSP2-CUTOVER-APPLIED-ACK-V1\0", 1)
        }
        _ => return Err("unknown rotation message"),
    };
    if v.node_id == 0
        || v.from_epoch == 0
        || v.from_epoch.checked_add(1) != Some(v.to_epoch)
        || v.issued_at_ms <= 0
        || v.expires_at_ms <= v.issued_at_ms
        || v.expires_at_ms
            .checked_sub(v.issued_at_ms)
            .is_none_or(|ms| ms > 60_000)
        || v.method != "POST"
    {
        return Err("invalid epoch, method or TTL");
    }
    let permit_nonce = hex_bytes(&v.permit_nonce_hex, 16)?;
    let nonce = hex_bytes(&v.nonce_hex, 16)?;
    let candidate = hex_bytes(&v.candidate_sha256_hex, 32)?;
    let permit_hash = hex_bytes(&v.permit_sha256_hex, 32)?;
    let state_hash = hex_bytes(&v.applied_state_sha256_hex, 32)?;
    if !nonzero(&permit_nonce) || !nonzero(&nonce) || !nonzero(&candidate) {
        return Err("missing nonce or candidate");
    }
    if v.kind == "permit" {
        if nonce != permit_nonce || nonzero(&permit_hash) || nonzero(&state_hash) {
            return Err("untrusted applied state in permit");
        }
    } else if nonce == permit_nonce || !nonzero(&permit_hash) || !nonzero(&state_hash) {
        return Err("unbound applied ACK");
    }

    let mut out = domain.to_vec();
    out.extend_from_slice(&[1, direction]);
    for n in [v.node_id, v.from_epoch, v.to_epoch] {
        out.extend_from_slice(&n.to_be_bytes());
    }
    for (s, max) in [
        (v.request_id.as_str(), 64),
        (v.issuer_id.as_str(), 64),
        (v.signer_ed_key_id.as_str(), 64),
        (v.signer_pq_key_id.as_str(), 64),
        (v.from_ed_key_id.as_str(), 64),
        (v.from_pq_key_id.as_str(), 64),
        (v.to_ed_key_id.as_str(), 64),
        (v.to_pq_key_id.as_str(), 64),
        (v.method.as_str(), 8),
        (v.path.as_str(), 256),
    ] {
        ascii(&mut out, s, max)?;
    }
    out.extend_from_slice(&v.issued_at_ms.to_be_bytes());
    out.extend_from_slice(&v.expires_at_ms.to_be_bytes());
    for raw in [permit_nonce, nonce, candidate, permit_hash, state_hash] {
        out.extend_from_slice(&raw);
    }
    Ok(out)
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn state_digest(v: &Cutover) -> Result<String, &'static str> {
    let mut bytes = b"XSP2-APPLIED-STATE-V1\0".to_vec();
    bytes.extend_from_slice(&v.node_id.to_be_bytes());
    bytes.extend_from_slice(&v.to_epoch.to_be_bytes());
    bytes.extend_from_slice(&hex_bytes(&v.candidate_sha256_hex, 32)?);
    Ok(digest(&bytes))
}

fn ack_matches(permit: &Cutover, ack: &Cutover) -> bool {
    let (Ok(permit_input), Ok(_)) = (signing_input(permit), signing_input(ack)) else {
        return false;
    };
    permit.kind == "permit"
        && ack.kind == "ack"
        && permit.node_id == ack.node_id
        && permit.from_epoch == ack.from_epoch
        && permit.to_epoch == ack.to_epoch
        && permit.request_id == ack.request_id
        && permit.permit_nonce_hex == ack.permit_nonce_hex
        && permit.candidate_sha256_hex == ack.candidate_sha256_hex
        && permit.from_ed_key_id == ack.from_ed_key_id
        && permit.from_pq_key_id == ack.from_pq_key_id
        && permit.to_ed_key_id == ack.to_ed_key_id
        && permit.to_pq_key_id == ack.to_pq_key_id
        && ack.permit_sha256_hex == digest(&permit_input)
        && state_digest(ack).ok().as_deref() == Some(ack.applied_state_sha256_hex.as_str())
        && ack.issued_at_ms >= permit.issued_at_ms
}

#[test]
fn xsp_v2_cutover_contract_vectors_and_negative_cases() {
    let f: ContractFixture = serde_json::from_str(include_str!(
        "../../docs/XSP_V2_CUTOVER_CONTRACT_VECTORS.json"
    ))
    .expect("cutover fixture");
    assert_eq!(f.schema, "xsp2-cutover-contract-1");

    let permit = signing_input(&f.permit).expect("permit input");
    let ack = signing_input(&f.ack).expect("ACK input");
    assert_eq!(digest(&permit), f.permit_input_sha256_hex);
    assert_eq!(digest(&ack), f.ack_input_sha256_hex);
    assert_eq!(state_digest(&f.ack).unwrap(), f.state_digest_sha256_hex);
    assert!(ack_matches(&f.permit, &f.ack));

    let mut invalid = f.permit.clone();
    invalid.kind = "ack".into();
    assert!(signing_input(&invalid).is_err(), "role reflection");

    invalid = f.permit.clone();
    invalid.issuer_id = "node-13".into();
    assert!(signing_input(&invalid).is_err(), "wrong permit issuer");

    invalid = f.permit.clone();
    invalid.signer_ed_key_id = f.ack.signer_ed_key_id.clone();
    assert!(signing_input(&invalid).is_err(), "wrong permit key role");

    invalid = f.permit.clone();
    invalid.path = "/api/v2/node/keys/rotation/prove".into();
    assert!(signing_input(&invalid).is_err(), "endpoint replay");

    invalid = f.permit.clone();
    invalid.method = "GET".into();
    assert!(signing_input(&invalid).is_err(), "wrong method");

    invalid = f.permit.clone();
    invalid.to_epoch = invalid.from_epoch;
    assert!(signing_input(&invalid).is_err(), "nonmonotonic epoch");

    invalid = f.permit.clone();
    invalid.expires_at_ms = invalid.issued_at_ms + 60_001;
    assert!(signing_input(&invalid).is_err(), "overlong TTL");

    invalid = f.permit.clone();
    invalid.nonce_hex = "ZZ".to_string() + &invalid.nonce_hex[2..];
    assert!(signing_input(&invalid).is_err(), "noncanonical nonce");

    invalid = f.permit.clone();
    invalid.candidate_sha256_hex = "00".repeat(32);
    assert!(signing_input(&invalid).is_err(), "empty candidate");

    invalid = f.permit.clone();
    invalid.permit_sha256_hex = f.permit_input_sha256_hex.clone();
    assert!(
        signing_input(&invalid).is_err(),
        "pre-authorized applied claim"
    );

    let mut changed = f.permit.clone();
    changed.request_id = "other-valid-request".into();
    assert_ne!(
        signing_input(&changed).unwrap(),
        permit,
        "request ID binding"
    );

    for candidate in [
        Cutover {
            request_id: "other".into(),
            ..f.ack.clone()
        },
        Cutover {
            from_ed_key_id: "other".into(),
            ..f.ack.clone()
        },
        Cutover {
            permit_nonce_hex: "102132435465768798a9bacbdcedfe0f".into(),
            ..f.ack.clone()
        },
        Cutover {
            candidate_sha256_hex: f.permit_input_sha256_hex.clone(),
            ..f.ack.clone()
        },
        Cutover {
            permit_sha256_hex: f.state_digest_sha256_hex.clone(),
            ..f.ack.clone()
        },
        Cutover {
            applied_state_sha256_hex: f.permit_input_sha256_hex.clone(),
            ..f.ack.clone()
        },
        Cutover {
            nonce_hex: f.ack.permit_nonce_hex.clone(),
            ..f.ack.clone()
        },
    ] {
        assert!(!ack_matches(&f.permit, &candidate), "tampered ACK accepted");
    }
}
