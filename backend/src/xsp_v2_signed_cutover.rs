//! Staging-only, independent XSP-v2 signed permit and applied ACK primitives.
//! No API route, issuer key storage, replay database or active key switching.
use serde::{Deserialize, Serialize};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, Signer as _, SigningKey, Verifier as _, VerifyingKey};
use openssl::{pkey::{KeyType, PKey, Private}, sign::{Signer as PQSigner, Verifier as PQVerifier}};
use sha2::{Digest, Sha256};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Cutover {
    kind: String,
    issuer_id: String,
    signer_ed_key_id: String,
    #[serde(rename = "signerPQKeyId")]
    signer_pq_key_id: String,
    node_id: u64,
    from_epoch: u64,
    to_epoch: u64,
    request_id: String,
    from_ed_key_id: String,
    #[serde(rename = "fromPQKeyId")]
    from_pq_key_id: String,
    to_ed_key_id: String,
    #[serde(rename = "toPQKeyId")]
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

#[derive(Deserialize, Serialize)]
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


#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DualSignatures {
    ed25519: String,
    mldsa65: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedCutover {
    message: Cutover,
    signatures: DualSignatures,
}
#[derive(Clone)]
pub struct TrustedPublic {
    pub purpose: String,
    pub issuer_id: String,
    pub node_id: u64,
    pub ed_key_id: String,
    pub pq_key_id: String,
    pub ed_public: Vec<u8>,
    pub pq_public: Vec<u8>,
}
pub struct ExpectedPermit {
    pub node_id: u64,
    pub from_epoch: u64,
    pub to_epoch: u64,
    pub request_id: String,
    pub from_ed_key_id: String,
    pub from_pq_key_id: String,
    pub to_ed_key_id: String,
    pub to_pq_key_id: String,
    pub candidate_sha256_hex: String,
}
pub struct VerifiedPermit {
    message: Cutover,
    input_hash: String,
}
fn key_id(prefix: &str, raw: &[u8]) -> String {
    let hash = Sha256::digest(raw);
    format!("{prefix}{}", hex::encode(&hash[..12]))
}
fn validate_pin(p: &TrustedPublic, m: &Cutover, purpose: &str) -> Result<(), &'static str> {
    if p.purpose != purpose
        || p.issuer_id != m.issuer_id
        || p.node_id != m.node_id
        || p.ed_key_id != m.signer_ed_key_id
        || p.pq_key_id != m.signer_pq_key_id
        || p.ed_public.len() != 32
        || p.pq_public.len() != 1952
        || p.ed_key_id != key_id("ed-", &p.ed_public)
        || p.pq_key_id != key_id("pq-", &p.pq_public)
    {
        return Err("untrusted cutover signer purpose or key");
    }
    Ok(())
}
fn time_ok(m: &Cutover, now_ms: i64) -> Result<(), &'static str> {
    if now_ms <= 0
        || now_ms > m.expires_at_ms
        || (now_ms as i128 - m.issued_at_ms as i128).abs() > 120_000
    {
        return Err("expired or future signed cutover message");
    }
    Ok(())
}
fn strict_signature(input: &str, exact: usize) -> Result<Vec<u8>, &'static str> {
    if input.len() != exact.div_ceil(3) * 4 {
        return Err("invalid signature size");
    }
    let raw = STANDARD.decode(input).map_err(|_| "invalid base64")?;
    if raw.len() != exact || STANDARD.encode(&raw) != input {
        return Err("noncanonical signature");
    }
    Ok(raw)
}
fn verify_both_signed(signed: &SignedCutover, trusted: &TrustedPublic) -> Result<Vec<u8>, &'static str> {
    let input = signing_input(&signed.message)?;
    let ed: [u8; 32] = trusted.ed_public.as_slice().try_into().map_err(|_| "bad Ed public")?;
    let ed_sig: [u8; 64] = strict_signature(&signed.signatures.ed25519, 64)?
        .try_into()
        .map_err(|_| "bad Ed signature")?;
    let pq_sig = strict_signature(&signed.signatures.mldsa65, 3309)?;
    let ed_public = VerifyingKey::from_bytes(&ed).map_err(|_| "invalid Ed public")?;
    ed_public
        .verify(&input, &Signature::from_bytes(&ed_sig))
        .map_err(|_| "invalid Ed25519 signature")?;
    let pq_public = PKey::public_key_from_raw_bytes_ex(None, KeyType::ML_DSA_65, None, &trusted.pq_public)
        .map_err(|_| "invalid PQ public")?;
    let mut verify = PQVerifier::new_without_digest(&pq_public).map_err(|_| "PQ verifier unavailable")?;
    if !verify.verify_oneshot(&pq_sig, &input).map_err(|_| "PQ verification failure")? {
        return Err("invalid ML-DSA-65 signature");
    }
    Ok(input)
}
fn parse_signed(raw: &[u8]) -> Result<SignedCutover, &'static str> {
    if raw.is_empty() || raw.len() > 16 * 1024 {
        return Err("signed cutover envelope too large");
    }
    // Derived Serde structs reject duplicate and unknown fields, including nested signatures.
    let signed: SignedCutover = serde_json::from_slice(raw).map_err(|_| "invalid signed cutover JSON")?;
    signing_input(&signed.message)?;
    Ok(signed)
}
fn permit_matches(m: &Cutover, want: &ExpectedPermit) -> bool {
    m.node_id == want.node_id
        && m.from_epoch == want.from_epoch
        && m.to_epoch == want.to_epoch
        && m.request_id == want.request_id
        && m.from_ed_key_id == want.from_ed_key_id
        && m.from_pq_key_id == want.from_pq_key_id
        && m.to_ed_key_id == want.to_ed_key_id
        && m.to_pq_key_id == want.to_pq_key_id
        && m.candidate_sha256_hex == want.candidate_sha256_hex
}
/// Verifies a dual-signed panel permit against an *independently* pinned panel_response pair
/// and expected frozen owner-approved proposal. Caller MUST persist anti-replay state
/// and establish local vault floor before any activation.
pub fn verify_signed_permit(
    raw: &[u8],
    pin: &TrustedPublic,
    expected: &ExpectedPermit,
    now_ms: i64,
) -> Result<VerifiedPermit, &'static str> {
    let signed = parse_signed(raw)?;
    if signed.message.kind != "permit" || !permit_matches(&signed.message, expected) {
        return Err("unapproved permit candidate");
    }
    validate_pin(pin, &signed.message, "panel_response")?;
    time_ok(&signed.message, now_ms)?;
    let canonical = verify_both_signed(&signed, pin)?;
    Ok(VerifiedPermit {
        message: signed.message,
        input_hash: digest(&canonical),
    })
}
/// Verifies an ACK signed by the *next prepared pair* with both algorithms.
/// Caller MUST load the originally issued permit from durable PostgreSQL state;
/// accepting an attacker-supplied permit as trusted would invalidate the design.
/// This helper DOES NOT advance DB epochs or retire old keys.
pub fn verify_signed_applied_ack(
    raw: &[u8],
    permit: &VerifiedPermit,
    next: &TrustedPublic,
    now_ms: i64,
) -> Result<(), &'static str> {
    let signed = parse_signed(raw)?;
    if permit.input_hash.is_empty()
        || !ack_matches(&permit.message, &signed.message)
        || next.ed_key_id != permit.message.to_ed_key_id
        || next.pq_key_id != permit.message.to_pq_key_id
    {
        return Err("unbound cutover ACK");
    }
    validate_pin(next, &signed.message, "node_request")?;
    time_ok(&signed.message, now_ms)?;
    verify_both_signed(&signed, next)?;
    Ok(())
}
/// OFFLINE/STAGING ONLY. The caller supplies an already protected independent signer.
/// It MUST independently enforce owner approval and persist the signed permit before delivery.
/// Never accept signer bytes or public-key pins from a network request.
pub fn sign_staging_permit(
    message: &Cutover,
    trusted: &TrustedPublic,
    ed: &SigningKey,
    pq: &PKey<Private>,
) -> Result<Vec<u8>, &'static str> {
    if message.kind != "permit" {
        return Err("only permit issuance permitted");
    }
    validate_pin(trusted, message, "panel_response")?;
    let input = signing_input(message)?;
    let mut pq_signer = PQSigner::new_without_digest(pq).map_err(|_| "PQ signer unavailable")?;
    let pq_sig = pq_signer.sign_oneshot_to_vec(&input).map_err(|_| "PQ signing failed")?;
    let signed = SignedCutover {
        message: message.clone(),
        signatures: DualSignatures {
            ed25519: STANDARD.encode(ed.sign(&input).to_bytes()),
            mldsa65: STANDARD.encode(&pq_sig),
        },
    };
    verify_both_signed(&signed, trusted)?;
    serde_json::to_vec(&signed).map_err(|_| "serialization failed")
}

#[cfg(test)]
mod signed_tests {
    use super::*;

    fn key_pair(ed_seed: u8, pq_seed: u8, purpose: &str, issuer: &str, node: u64)
        -> (SigningKey, PKey<Private>, TrustedPublic)
    {
        let ed = SigningKey::from_bytes(&[ed_seed; 32]);
        let pq = PKey::private_key_from_seed(None, KeyType::ML_DSA_65, None, &[pq_seed; 32])
            .expect("OpenSSL 3.5 ML-DSA-65 unavailable");
        let der = pq.public_key_to_der().unwrap();
        let pq_pub = der[der.len()-1952..].to_vec();
        let ed_pub = ed.verifying_key().to_bytes().to_vec();
        let pin = TrustedPublic {
            purpose: purpose.into(), issuer_id: issuer.into(), node_id: node,
            ed_key_id: key_id("ed-", &ed_pub),
            pq_key_id: key_id("pq-", &pq_pub),
            ed_public: ed_pub, pq_public: pq_pub,
        };
        (ed,pq,pin)
    }
    fn signed_with(s: &Cutover, ed: &SigningKey, pq: &PKey<Private>) -> Vec<u8> {
        let input = signing_input(s).unwrap();
        let mut signer = PQSigner::new_without_digest(pq).unwrap();
        let pq_sig = signer.sign_oneshot_to_vec(&input).unwrap();
        serde_json::to_vec(&SignedCutover{
            message:s.clone(), signatures: DualSignatures{
                ed25519:STANDARD.encode(ed.sign(&input).to_bytes()),
                mldsa65:STANDARD.encode(pq_sig),
            }
        }).unwrap()
    }
    #[test]
    fn real_dual_signature_permit_and_ack_fail_closed() {
        let f: ContractFixture = serde_json::from_str(include_str!("../../docs/XSP_V2_CUTOVER_CONTRACT_VECTORS.json")).unwrap();
        let (ed, pq, pin) = key_pair(7,9,"panel_response", &f.permit.issuer_id, f.permit.node_id);
        let (next_ed, next_pq, next_pin) = key_pair(8,10,"node_request", &f.ack.issuer_id, f.ack.node_id);
        let mut permit = f.permit.clone();
        permit.signer_ed_key_id = pin.ed_key_id.clone();
        permit.signer_pq_key_id = pin.pq_key_id.clone();
        permit.to_ed_key_id = next_pin.ed_key_id.clone();
        permit.to_pq_key_id = next_pin.pq_key_id.clone();
        let approved = ExpectedPermit {
            node_id:permit.node_id,from_epoch:permit.from_epoch,to_epoch:permit.to_epoch,
            request_id:permit.request_id.clone(),from_ed_key_id:permit.from_ed_key_id.clone(),
            from_pq_key_id:permit.from_pq_key_id.clone(),
            to_ed_key_id:permit.to_ed_key_id.clone(),to_pq_key_id:permit.to_pq_key_id.clone(),
            candidate_sha256_hex:permit.candidate_sha256_hex.clone(),
        };
        let signed = sign_staging_permit(&permit,&pin,&ed,&pq).unwrap();
        let verified = verify_signed_permit(&signed,&pin,&approved,permit.issued_at_ms+1000).unwrap();
        let mut ack=f.ack.clone();
        ack.to_ed_key_id = next_pin.ed_key_id.clone();
        ack.to_pq_key_id = next_pin.pq_key_id.clone();
        ack.signer_ed_key_id = next_pin.ed_key_id.clone();
        ack.signer_pq_key_id = next_pin.pq_key_id.clone();
        ack.permit_sha256_hex = verified.input_hash.clone();
        let ack_bytes = signed_with(&ack,&next_ed,&next_pq);
        assert!(verify_signed_applied_ack(&ack_bytes,&verified,&next_pin,ack.issued_at_ms+1000).is_ok());
        assert!(verify_signed_applied_ack(&ack_bytes,&verified,&pin,ack.issued_at_ms+1000).is_err());
        assert!(verify_signed_applied_ack(&ack_bytes,&verified,&next_pin,ack.expires_at_ms+1).is_err());
        let mut corrupt = parse_signed(&signed).unwrap();
        corrupt.message.request_id="tampered".into();
        let tampered=serde_json::to_vec(&corrupt).unwrap();
        assert!(verify_signed_permit(&tampered,&pin,&approved,permit.issued_at_ms+1000).is_err());
        let mut missing = parse_signed(&signed).unwrap();
        missing.signatures.mldsa65=STANDARD.encode([0u8;3309]);
        assert!(verify_signed_permit(&serde_json::to_vec(&missing).unwrap(),&pin,&approved,permit.issued_at_ms+1000).is_err());
        missing=parse_signed(&signed).unwrap();
        missing.signatures.ed25519=STANDARD.encode([0u8;64]);
        assert!(verify_signed_permit(&serde_json::to_vec(&missing).unwrap(),&pin,&approved,permit.issued_at_ms+1000).is_err());
        let mut wrong_ack=ack.clone();
        wrong_ack.request_id="replayed-request".into();
        let wrong=signed_with(&wrong_ack,&next_ed,&next_pq);
        assert!(verify_signed_applied_ack(&wrong,&verified,&next_pin,ack.issued_at_ms+1).is_err());
        let mut invalid=ack.clone();
        invalid.candidate_sha256_hex = digest(b"not approved");
        let wrong=signed_with(&invalid,&next_ed,&next_pq);
        assert!(verify_signed_applied_ack(&wrong,&verified,&next_pin,ack.issued_at_ms+1).is_err());
        assert!(verify_signed_permit(&signed,&pin,&approved,permit.expires_at_ms+1).is_err());
    }
}
