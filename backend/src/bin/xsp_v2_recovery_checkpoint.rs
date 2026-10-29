#![forbid(unsafe_code)]

use anyhow::{Context as _, Result, bail, ensure};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, Verifier as _, VerifyingKey};
use openssl::{
    pkey::{KeyType, PKey},
    sign::Verifier as PqVerifier,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write as _,
    os::unix::fs::OpenOptionsExt as _,
    path::Path,
};

const CHECKPOINT_SCHEMA: &str = "xsp2-owner-offhost-recovery-checkpoint-1";
const RECEIPT_DOMAIN: &[u8] = b"XSP2-CUTOVER-COMMIT-RECEIPT-V1\0";
const MAX_RECEIPT_BYTES: usize = 16 * 1024;
const MAX_CHECKPOINT_BYTES: usize = 32 * 1024;
const MAX_PIN_BYTES: usize = 16 * 1024;
const MAX_LOCAL_STATE_BYTES: usize = 4 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommitReceipt {
    protocol: String,
    kind: String,
    issuer_id: String,
    signer_ed_key_id: String,
    #[serde(rename = "signerPQKeyId")]
    signer_pq_key_id: String,
    node_id: u64,
    from_epoch: u64,
    to_epoch: u64,
    request_id: String,
    committed_at_ms: i64,
    ack_nonce_hex: String,
    #[serde(rename = "candidateSHA256Hex")]
    candidate_sha256_hex: String,
    #[serde(rename = "permitSHA256Hex")]
    permit_sha256_hex: String,
    #[serde(rename = "signedACKSHA256Hex")]
    signed_ack_sha256_hex: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct DualSignatures {
    ed25519: String,
    mldsa65: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SignedReceipt {
    message: CommitReceipt,
    signatures: DualSignatures,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PanelPin {
    purpose: String,
    issuer_id: String,
    node_id: u64,
    ed_key_id: String,
    #[serde(rename = "pqKeyId")]
    pq_key_id: String,
    ed25519_public_base64: String,
    mldsa65_public_base64: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecoveryCheckpoint {
    schema: String,
    node_id: u64,
    minimum_epoch: u64,
    receipt_sha256_hex: String,
    signed_receipt_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalRecoveryState {
    node_id: u64,
    key_epoch: u64,
    current_receipt_sha256_hex: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VerificationResult {
    status: &'static str,
    node_id: u64,
    local_epoch: u64,
    minimum_epoch: u64,
    checkpoint_receipt_sha256_hex: String,
}

fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>> {
    let metadata = fs::metadata(path).with_context(|| format!("stat {}", path.display()))?;
    ensure!(metadata.is_file(), "{} is not a regular file", path.display());
    let length = usize::try_from(metadata.len()).context("input file too large")?;
    ensure!(length > 0 && length <= limit, "{} has invalid size", path.display());
    let bytes = fs::read(path).with_context(|| format!("read {}", path.display()))?;
    ensure!(bytes.len() == length, "{} changed while reading", path.display());
    Ok(bytes)
}

fn strict_hex(value: &str, count: usize, label: &str) -> Result<Vec<u8>> {
    ensure!(value.len() == count * 2, "{label} has invalid length");
    let raw = hex::decode(value).with_context(|| format!("{label} is not hex"))?;
    ensure!(hex::encode(&raw) == value, "{label} is not canonical lowercase hex");
    ensure!(raw.iter().any(|byte| *byte != 0), "{label} must not be all-zero");
    Ok(raw)
}

fn exact_base64(value: &str, count: usize, label: &str) -> Result<Vec<u8>> {
    let raw = STANDARD
        .decode(value)
        .with_context(|| format!("{label} is not Base64"))?;
    ensure!(raw.len() == count, "{label} has invalid decoded length");
    ensure!(STANDARD.encode(&raw) == value, "{label} is not canonical Base64");
    Ok(raw)
}

fn ascii(out: &mut Vec<u8>, value: &str, max: usize) -> Result<()> {
    ensure!(
        !value.is_empty() && value.len() <= max && value.bytes().all(|byte| byte.is_ascii_graphic()),
        "invalid receipt ASCII field"
    );
    let length = u32::try_from(value.len()).context("receipt field length overflow")?;
    out.extend_from_slice(&length.to_be_bytes());
    out.extend_from_slice(value.as_bytes());
    Ok(())
}

fn receipt_signing_input(message: &CommitReceipt) -> Result<Vec<u8>> {
    ensure!(
        message.protocol == "XSP/2"
            && message.kind == "commit_receipt"
            && message.issuer_id != format!("node-{}", message.node_id)
            && message.node_id > 0
            && message.node_id <= i64::MAX as u64
            && message.from_epoch > 0
            && message.from_epoch.checked_add(1) == Some(message.to_epoch)
            && message.committed_at_ms > 0,
        "invalid commit receipt role, version, epoch or timestamp"
    );

    let nonce = strict_hex(&message.ack_nonce_hex, 16, "receipt ACK nonce")?;
    let candidate = strict_hex(&message.candidate_sha256_hex, 32, "candidate digest")?;
    let permit = strict_hex(&message.permit_sha256_hex, 32, "permit digest")?;
    let ack = strict_hex(&message.signed_ack_sha256_hex, 32, "signed ACK digest")?;

    let mut bytes = RECEIPT_DOMAIN.to_vec();
    bytes.extend_from_slice(&[1, 2]);
    for number in [message.node_id, message.from_epoch, message.to_epoch] {
        bytes.extend_from_slice(&number.to_be_bytes());
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

fn trusted_key_id(prefix: &str, public: &[u8]) -> String {
    let digest = Sha256::digest(public);
    format!("{prefix}{}", hex::encode(&digest[..12]))
}

fn decode_pin(pin: &PanelPin) -> Result<(Vec<u8>, Vec<u8>)> {
    ensure!(pin.purpose == "panel_response", "pin purpose must be panel_response");
    ensure!(pin.node_id > 0, "pin node ID is invalid");
    ensure!(
        !pin.issuer_id.is_empty() && pin.issuer_id.len() <= 64,
        "pin issuer ID is invalid"
    );
    let ed_public = exact_base64(&pin.ed25519_public_base64, 32, "Ed25519 public key")?;
    let pq_public = exact_base64(&pin.mldsa65_public_base64, 1952, "ML-DSA-65 public key")?;
    ensure!(
        pin.ed_key_id == trusted_key_id("ed-", &ed_public),
        "Ed25519 key ID does not match pinned public key"
    );
    ensure!(
        pin.pq_key_id == trusted_key_id("pq-", &pq_public),
        "ML-DSA-65 key ID does not match pinned public key"
    );
    Ok((ed_public, pq_public))
}

fn verify_signed_receipt(raw: &[u8], pin: &PanelPin) -> Result<CommitReceipt> {
    ensure!(
        !raw.is_empty() && raw.len() <= MAX_RECEIPT_BYTES,
        "invalid signed receipt size"
    );
    let signed: SignedReceipt = serde_json::from_slice(raw).context("invalid signed receipt JSON")?;
    let input = receipt_signing_input(&signed.message)?;
    let (ed_public, pq_public) = decode_pin(pin)?;
    ensure!(
        signed.message.node_id == pin.node_id
            && signed.message.issuer_id == pin.issuer_id
            && signed.message.signer_ed_key_id == pin.ed_key_id
            && signed.message.signer_pq_key_id == pin.pq_key_id,
        "receipt is not bound to independently pinned panel_response identity"
    );

    let ed_bytes: [u8; 32] = ed_public
        .as_slice()
        .try_into()
        .map_err(|_| anyhow::anyhow!("bad Ed25519 public key"))?;
    let ed_verifier = VerifyingKey::from_bytes(&ed_bytes).context("invalid Ed25519 public key")?;
    let ed_signature: [u8; 64] = exact_base64(&signed.signatures.ed25519, 64, "Ed25519 signature")?
        .try_into()
        .map_err(|_| anyhow::anyhow!("bad Ed25519 signature"))?;
    ed_verifier
        .verify(&input, &Signature::from_bytes(&ed_signature))
        .context("receipt Ed25519 signature invalid")?;

    let pq_signature = exact_base64(&signed.signatures.mldsa65, 3309, "ML-DSA-65 signature")?;
    let pq_key = PKey::public_key_from_raw_bytes_ex(None, KeyType::ML_DSA_65, None, &pq_public)
        .context("invalid ML-DSA-65 public key")?;
    let mut verifier = PqVerifier::new_without_digest(&pq_key).context("ML-DSA-65 verifier unavailable")?;
    ensure!(
        verifier
            .verify_oneshot(&pq_signature, &input)
            .context("ML-DSA-65 verification error")?,
        "receipt ML-DSA-65 signature invalid"
    );
    Ok(signed.message)
}

fn build_checkpoint(signed_receipt: &[u8], pin: &PanelPin) -> Result<RecoveryCheckpoint> {
    let receipt = verify_signed_receipt(signed_receipt, pin)?;
    let digest = hex::encode(Sha256::digest(signed_receipt));
    Ok(RecoveryCheckpoint {
        schema: CHECKPOINT_SCHEMA.to_owned(),
        node_id: receipt.node_id,
        minimum_epoch: receipt.to_epoch,
        receipt_sha256_hex: digest,
        signed_receipt_base64: STANDARD.encode(signed_receipt),
    })
}

fn verify_checkpoint(
    checkpoint_bytes: &[u8],
    pin: &PanelPin,
    local: &LocalRecoveryState,
) -> Result<VerificationResult> {
    ensure!(
        !checkpoint_bytes.is_empty() && checkpoint_bytes.len() <= MAX_CHECKPOINT_BYTES,
        "invalid recovery checkpoint size"
    );
    let checkpoint: RecoveryCheckpoint =
        serde_json::from_slice(checkpoint_bytes).context("invalid recovery checkpoint JSON")?;
    ensure!(checkpoint.schema == CHECKPOINT_SCHEMA, "unsupported recovery checkpoint schema");
    ensure!(checkpoint.node_id > 0 && checkpoint.minimum_epoch > 0, "invalid checkpoint identity or epoch");
    strict_hex(&checkpoint.receipt_sha256_hex, 32, "checkpoint receipt digest")?;

    let signed_receipt = STANDARD
        .decode(&checkpoint.signed_receipt_base64)
        .context("checkpoint receipt is not Base64")?;
    ensure!(
        !signed_receipt.is_empty() && signed_receipt.len() <= MAX_RECEIPT_BYTES,
        "checkpoint receipt has invalid size"
    );
    ensure!(
        STANDARD.encode(&signed_receipt) == checkpoint.signed_receipt_base64,
        "checkpoint receipt is not canonical Base64"
    );
    let receipt_digest = hex::encode(Sha256::digest(&signed_receipt));
    ensure!(
        receipt_digest == checkpoint.receipt_sha256_hex,
        "checkpoint receipt digest mismatch"
    );
    let receipt = verify_signed_receipt(&signed_receipt, pin)?;
    ensure!(
        receipt.node_id == checkpoint.node_id && receipt.to_epoch == checkpoint.minimum_epoch,
        "checkpoint identity or monotonic epoch is not derived from its dual-signed receipt"
    );
    ensure!(local.node_id == checkpoint.node_id, "local state belongs to a different Node");
    ensure!(
        local.key_epoch >= checkpoint.minimum_epoch,
        "coordinated rollback detected: local epoch is below the off-host recovery floor"
    );

    if local.key_epoch == checkpoint.minimum_epoch {
        let local_digest = local
            .current_receipt_sha256_hex
            .as_deref()
            .context("same-epoch recovery requires the exact local authoritative receipt digest")?;
        strict_hex(local_digest, 32, "local authoritative receipt digest")?;
        ensure!(
            local_digest == checkpoint.receipt_sha256_hex,
            "same-epoch local receipt differs from the off-host authoritative witness"
        );
    }

    Ok(VerificationResult {
        status: "verified",
        node_id: checkpoint.node_id,
        local_epoch: local.key_epoch,
        minimum_epoch: checkpoint.minimum_epoch,
        checkpoint_receipt_sha256_hex: checkpoint.receipt_sha256_hex,
    })
}

fn parse_flag(args: &[String], flag: &str) -> Result<String> {
    let index = args
        .iter()
        .position(|arg| arg == flag)
        .with_context(|| format!("missing required {flag}"))?;
    let value = args
        .get(index + 1)
        .with_context(|| format!("missing value for {flag}"))?;
    ensure!(!value.starts_with("--"), "missing value for {flag}");
    Ok(value.clone())
}

fn ensure_exact_flags(args: &[String], flags: &[&str]) -> Result<()> {
    ensure!(args.len() == flags.len() * 2, "unexpected command arguments");
    for flag in flags {
        ensure!(args.iter().filter(|arg| arg.as_str() == *flag).count() == 1, "{flag} must appear exactly once");
    }
    Ok(())
}

fn load_pin(path: &Path) -> Result<PanelPin> {
    serde_json::from_slice(&read_bounded(path, MAX_PIN_BYTES)?)
        .with_context(|| format!("parse independently provisioned pin {}", path.display()))
}

fn create_command(args: &[String]) -> Result<()> {
    ensure_exact_flags(args, &["--pin", "--receipt", "--out"])?;
    let pin_path = parse_flag(args, "--pin")?;
    let receipt_path = parse_flag(args, "--receipt")?;
    let out_path = parse_flag(args, "--out")?;
    let pin = load_pin(Path::new(&pin_path))?;
    let receipt = read_bounded(Path::new(&receipt_path), MAX_RECEIPT_BYTES)?;
    let checkpoint = build_checkpoint(&receipt, &pin)?;
    let output = serde_json::to_vec_pretty(&checkpoint).context("serialize recovery checkpoint")?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&out_path)
        .with_context(|| format!("create new checkpoint {out_path}; refusing overwrite"))?;
    file.write_all(&output).context("write recovery checkpoint")?;
    file.write_all(b"\n").context("finish recovery checkpoint")?;
    file.sync_all().context("fsync recovery checkpoint")?;
    println!("created node={} minimumEpoch={} receiptSha256={}", checkpoint.node_id, checkpoint.minimum_epoch, checkpoint.receipt_sha256_hex);
    Ok(())
}

fn verify_command(args: &[String]) -> Result<()> {
    ensure_exact_flags(args, &["--pin", "--checkpoint", "--local-state"])?;
    let pin_path = parse_flag(args, "--pin")?;
    let checkpoint_path = parse_flag(args, "--checkpoint")?;
    let local_path = parse_flag(args, "--local-state")?;
    let pin = load_pin(Path::new(&pin_path))?;
    let checkpoint = read_bounded(Path::new(&checkpoint_path), MAX_CHECKPOINT_BYTES)?;
    let local: LocalRecoveryState = serde_json::from_slice(&read_bounded(
        Path::new(&local_path),
        MAX_LOCAL_STATE_BYTES,
    )?)
    .with_context(|| format!("parse local recovery state {local_path}"))?;
    let verified = verify_checkpoint(&checkpoint, &pin, &local)?;
    println!("{}", serde_json::to_string(&verified).context("serialize verification result")?);
    Ok(())
}

fn run() -> Result<()> {
    let mut args = env::args().skip(1);
    let command = args.next().context(
        "usage: xsp-v2-recovery-checkpoint <create|verify> --pin ...",
    )?;
    let rest: Vec<String> = args.collect();
    match command.as_str() {
        "create" => create_command(&rest),
        "verify" => verify_command(&rest),
        _ => bail!("unsupported command; expected create or verify"),
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("xsp-v2 recovery checkpoint: {error:#}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer as _, SigningKey};
    use openssl::{
        pkey::{KeyType, PKey, Private},
        sign::Signer as PqSigner,
    };

    fn test_material() -> (SigningKey, PKey<Private>, PanelPin) {
        let ed = SigningKey::from_bytes(&[7_u8; 32]);
        let pq = PKey::private_key_from_seed(None, KeyType::ML_DSA_65, None, &[9_u8; 32])
            .expect("OpenSSL 3.5 ML-DSA-65 provider missing");
        let pq_der = pq.public_key_to_der().expect("ML-DSA public DER");
        let pq_public = pq_der[pq_der.len() - 1952..].to_vec();
        let ed_public = ed.verifying_key().to_bytes().to_vec();
        let pin = PanelPin {
            purpose: "panel_response".into(),
            issuer_id: "nexus-test".into(),
            node_id: 13,
            ed_key_id: trusted_key_id("ed-", &ed_public),
            pq_key_id: trusted_key_id("pq-", &pq_public),
            ed25519_public_base64: STANDARD.encode(ed_public),
            mldsa65_public_base64: STANDARD.encode(pq_public),
        };
        (ed, pq, pin)
    }

    fn signed_receipt(ed: &SigningKey, pq: &PKey<Private>, pin: &PanelPin) -> Vec<u8> {
        let message = CommitReceipt {
            protocol: "XSP/2".into(),
            kind: "commit_receipt".into(),
            issuer_id: pin.issuer_id.clone(),
            signer_ed_key_id: pin.ed_key_id.clone(),
            signer_pq_key_id: pin.pq_key_id.clone(),
            node_id: pin.node_id,
            from_epoch: 4,
            to_epoch: 5,
            request_id: "e3a-checkpoint-test".into(),
            committed_at_ms: 1_798_000_000_000,
            ack_nonce_hex: "11".repeat(16),
            candidate_sha256_hex: "22".repeat(32),
            permit_sha256_hex: "33".repeat(32),
            signed_ack_sha256_hex: "44".repeat(32),
        };
        let input = receipt_signing_input(&message).expect("canonical receipt");
        let mut pq_signer = PqSigner::new_without_digest(pq).expect("PQ signer");
        let pq_signature = pq_signer
            .sign_oneshot_to_vec(&input)
            .expect("PQ signature");
        serde_json::to_vec(&SignedReceipt {
            message,
            signatures: DualSignatures {
                ed25519: STANDARD.encode(ed.sign(&input).to_bytes()),
                mldsa65: STANDARD.encode(pq_signature),
            },
        })
        .expect("signed receipt JSON")
    }

    #[test]
    fn checkpoint_rejects_coordinated_old_restore_and_same_epoch_divergence() {
        let (ed, pq, pin) = test_material();
        let receipt = signed_receipt(&ed, &pq, &pin);
        let checkpoint = build_checkpoint(&receipt, &pin).expect("checkpoint");
        let checkpoint_bytes = serde_json::to_vec(&checkpoint).unwrap();

        let exact = LocalRecoveryState {
            node_id: 13,
            key_epoch: 5,
            current_receipt_sha256_hex: Some(checkpoint.receipt_sha256_hex.clone()),
        };
        assert!(verify_checkpoint(&checkpoint_bytes, &pin, &exact).is_ok());

        let rolled_back = LocalRecoveryState {
            node_id: 13,
            key_epoch: 4,
            current_receipt_sha256_hex: None,
        };
        let error = verify_checkpoint(&checkpoint_bytes, &pin, &rolled_back)
            .expect_err("coordinated old restore must fail closed");
        assert!(error.to_string().contains("coordinated rollback detected"));

        let divergent = LocalRecoveryState {
            node_id: 13,
            key_epoch: 5,
            current_receipt_sha256_hex: Some("55".repeat(32)),
        };
        assert!(verify_checkpoint(&checkpoint_bytes, &pin, &divergent).is_err());

        let ahead = LocalRecoveryState {
            node_id: 13,
            key_epoch: 6,
            current_receipt_sha256_hex: None,
        };
        assert!(verify_checkpoint(&checkpoint_bytes, &pin, &ahead).is_ok());
    }

    #[test]
    fn checkpoint_tampering_wrong_node_and_bad_signatures_fail_closed() {
        let (ed, pq, pin) = test_material();
        let receipt = signed_receipt(&ed, &pq, &pin);
        let checkpoint = build_checkpoint(&receipt, &pin).expect("checkpoint");
        let local = LocalRecoveryState {
            node_id: 13,
            key_epoch: 5,
            current_receipt_sha256_hex: Some(checkpoint.receipt_sha256_hex.clone()),
        };

        let mut tampered = checkpoint.clone();
        tampered.minimum_epoch = 4;
        assert!(verify_checkpoint(&serde_json::to_vec(&tampered).unwrap(), &pin, &local).is_err());

        tampered = checkpoint.clone();
        tampered.receipt_sha256_hex = "66".repeat(32);
        assert!(verify_checkpoint(&serde_json::to_vec(&tampered).unwrap(), &pin, &local).is_err());

        let wrong_node = LocalRecoveryState {
            node_id: 14,
            key_epoch: 5,
            current_receipt_sha256_hex: Some(checkpoint.receipt_sha256_hex.clone()),
        };
        assert!(verify_checkpoint(&serde_json::to_vec(&checkpoint).unwrap(), &pin, &wrong_node).is_err());

        let mut signed: SignedReceipt = serde_json::from_slice(&receipt).unwrap();
        signed.message.request_id = "tampered-request".into();
        let bad_receipt = serde_json::to_vec(&signed).unwrap();
        assert!(build_checkpoint(&bad_receipt, &pin).is_err());
    }
}
