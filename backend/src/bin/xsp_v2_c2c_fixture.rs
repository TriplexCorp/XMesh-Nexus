#![cfg(feature = "xsp-v2-experimental")]

#[path = "../xsp_v2_candidate_binding.rs"]
mod xsp_v2_candidate_binding;
#[path = "../xsp_v2_db_candidate_snapshot.rs"]
mod xsp_v2_db_candidate_snapshot;
#[path = "../xsp_v2_permit_ledger_writer.rs"]
mod xsp_v2_permit_ledger_writer;
#[path = "../xsp_v2_signed_cutover.rs"]
mod xsp_v2_signed_cutover;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer as _, SigningKey};
use openssl::{
    pkey::{Id, PKey, Private},
    sign::Signer as PqSigner,
};
use sha2::{Digest as _, Sha256};
use sqlx::PgPool;
use std::{
    env, fs,
    os::unix::fs::{PermissionsExt, chown},
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use xsp_v2_signed_cutover::{Cutover, TrustedPublic, sign_staging_permit};

fn required(name: &str) -> String {
    env::var(name).expect("required C2-C fixture setting missing")
}

fn key_id(prefix: &str, raw: &[u8]) -> String {
    format!("{prefix}{}", hex::encode(&Sha256::digest(raw)[..12]))
}

fn key_pair(
    seed: u8,
    purpose: &str,
    issuer: &str,
    node: u64,
) -> (SigningKey, PKey<Private>, TrustedPublic) {
    let ed = SigningKey::from_bytes(&[seed; 32]);
    let generated = Command::new("openssl")
        .args(["genpkey", "-algorithm", "ML-DSA-65"])
        .output()
        .expect("OpenSSL CLI unavailable");
    assert!(generated.status.success(), "ML-DSA-65 provider unavailable");
    let pq = PKey::private_key_from_pem(&generated.stdout).expect("generated ML-DSA key invalid");
    let der = pq.public_key_to_der().unwrap();
    let pq_public = der[der.len() - 1952..].to_vec();
    let ed_public = ed.verifying_key().to_bytes().to_vec();
    let pin = TrustedPublic {
        purpose: purpose.into(),
        issuer_id: issuer.into(),
        node_id: node,
        ed_key_id: key_id("ed-", &ed_public),
        pq_key_id: key_id("pq-", &pq_public),
        ed_public,
        pq_public,
    };
    (ed, pq, pin)
}

fn ascii(out: &mut Vec<u8>, value: &str, max: usize) {
    assert!(!value.is_empty() && value.len() <= max && value.bytes().all(|b| b.is_ascii_graphic()));
    out.extend_from_slice(&u32::try_from(value.len()).unwrap().to_be_bytes());
    out.extend_from_slice(value.as_bytes());
}

fn hex_exact(value: &str, bytes: usize) -> Vec<u8> {
    assert_eq!(value.len(), bytes * 2);
    let decoded = hex::decode(value).unwrap();
    assert_eq!(hex::encode(&decoded), value);
    decoded
}

fn ack_signing_input(value: &Cutover) -> Vec<u8> {
    assert_eq!(value.kind, "ack");
    assert_eq!(value.path, "/api/v2/node/keys/rotation/ack");
    assert_eq!(value.issuer_id, format!("node-{}", value.node_id));
    assert_eq!(value.signer_ed_key_id, value.to_ed_key_id);
    assert_eq!(value.signer_pq_key_id, value.to_pq_key_id);
    assert_eq!(value.to_epoch, value.from_epoch + 1);
    assert_eq!(value.method, "POST");
    let mut out = b"XSP2-CUTOVER-APPLIED-ACK-V1\0".to_vec();
    out.extend_from_slice(&[1, 1]);
    for number in [value.node_id, value.from_epoch, value.to_epoch] {
        out.extend_from_slice(&number.to_be_bytes());
    }
    for (text, max) in [
        (value.request_id.as_str(), 64),
        (value.issuer_id.as_str(), 64),
        (value.signer_ed_key_id.as_str(), 64),
        (value.signer_pq_key_id.as_str(), 64),
        (value.from_ed_key_id.as_str(), 64),
        (value.from_pq_key_id.as_str(), 64),
        (value.to_ed_key_id.as_str(), 64),
        (value.to_pq_key_id.as_str(), 64),
        (value.method.as_str(), 8),
        (value.path.as_str(), 256),
    ] {
        ascii(&mut out, text, max);
    }
    out.extend_from_slice(&value.issued_at_ms.to_be_bytes());
    out.extend_from_slice(&value.expires_at_ms.to_be_bytes());
    for raw in [
        hex_exact(&value.permit_nonce_hex, 16),
        hex_exact(&value.nonce_hex, 16),
        hex_exact(&value.candidate_sha256_hex, 32),
        hex_exact(&value.permit_sha256_hex, 32),
        hex_exact(&value.applied_state_sha256_hex, 32),
    ] {
        out.extend_from_slice(&raw);
    }
    out
}

fn applied_state_digest(value: &Cutover) -> String {
    let mut raw = b"XSP2-APPLIED-STATE-V1\0".to_vec();
    raw.extend_from_slice(&value.node_id.to_be_bytes());
    raw.extend_from_slice(&value.from_epoch.to_be_bytes());
    raw.extend_from_slice(&value.to_epoch.to_be_bytes());
    ascii(&mut raw, &value.request_id, 64);
    ascii(&mut raw, &value.from_ed_key_id, 64);
    ascii(&mut raw, &value.from_pq_key_id, 64);
    ascii(&mut raw, &value.to_ed_key_id, 64);
    ascii(&mut raw, &value.to_pq_key_id, 64);
    raw.extend_from_slice(&hex_exact(&value.candidate_sha256_hex, 32));
    hex::encode(Sha256::digest(raw))
}

fn sign_pq(key: &PKey<Private>, input: &[u8]) -> Vec<u8> {
    assert_eq!(key.id(), Id::from_raw(0));
    let mut signer = PqSigner::new_without_digest(key).unwrap();
    signer.sign_oneshot_to_vec(input).unwrap()
}

fn save_private(path: &Path, bytes: &[u8]) {
    fs::write(path, bytes).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
    chown(path, Some(10002), Some(10002)).unwrap();
}

#[expect(
    clippy::too_many_lines,
    reason = "linear disposable C2-C cryptographic fixture setup"
)]
#[tokio::main]
async fn main() {
    assert_eq!(
        env::var("XSP_V2_C2C_FIXTURE").as_deref(),
        Ok("1"),
        "disposable C2-C fixture harness required"
    );
    let pool = PgPool::connect(&required("XSP_V2_C2C_ADMIN_DATABASE_URL"))
        .await
        .unwrap();
    sqlx::migrate!("../migrations").run(&pool).await.unwrap();
    let node: u64 = 812_345_678_901;
    let node_id = i64::try_from(node).unwrap();
    let owner = "c2c-ci-owner";
    let (old_ed, old_pq, old_pin) = key_pair(41, "node_request", &format!("node-{node}"), node);
    let (next_ed, next_pq, next_pin) = key_pair(42, "node_request", &format!("node-{node}"), node);
    let (panel_ed, panel_pq, panel_pin) = key_pair(43, "panel_response", "c2c-ci-panel", node);
    let _ = (old_ed, old_pq);

    let material = xsp_v2_candidate_binding::CandidatePublic {
        node_id: node,
        from_epoch: 1,
        to_epoch: 2,
        purpose: "node_request".into(),
        from_ed_key_id: old_pin.ed_key_id.clone(),
        from_pq_key_id: old_pin.pq_key_id.clone(),
        to_ed_key_id: next_pin.ed_key_id.clone(),
        to_pq_key_id: next_pin.pq_key_id.clone(),
        to_ed_public_b64: STANDARD.encode(&next_pin.ed_public),
        to_pq_public_b64: STANDARD.encode(&next_pin.pq_public),
    };
    let candidate = xsp_v2_candidate_binding::candidate_digest(&material).unwrap();
    let issued_at_ms = i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    )
    .unwrap();
    let expires_at_ms = issued_at_ms + 60_000;
    let permit_nonce = "00112233445566778899aabbccddeeff";
    let ack_nonce = "ffeeddccbbaa99887766554433221100";
    let request_id = "c2c-e2e-request";

    sqlx::query("INSERT INTO nodes (id,name,address,port,api_port,public_key,enabled,status,last_seen,created_at,updated_at) VALUES ($1,'c2c-e2e','127.0.0.1',443,443,'legacy',TRUE,'online',NOW(),NOW(),NOW())")
        .bind(node_id).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO node_xsp_suite_state (node_id,key_epoch,suite,state_updated_at) VALUES ($1,1,'xsp-v2-pq','now')")
        .bind(node_id).execute(&pool).await.unwrap();
    for (epoch, pin) in [(1_i64, &old_pin), (2_i64, &next_pin)] {
        sqlx::query("INSERT INTO node_xsp_public_keysets (node_id,key_epoch,purpose,issuer_id,ed_key_id,pq_key_id,ed_public,pq_public,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())")
            .bind(node_id).bind(epoch).bind(&pin.purpose).bind(&pin.issuer_id).bind(&pin.ed_key_id).bind(&pin.pq_key_id).bind(&pin.ed_public).bind(&pin.pq_public).execute(&pool).await.unwrap();
    }
    sqlx::query("INSERT INTO node_xsp_rotation_preparations (node_id,from_epoch,to_epoch,request_id,candidate_sha256_hex,from_ed_key_id,from_pq_key_id,to_ed_key_id,to_pq_key_id,to_ed_public,to_pq_public,state,created_at,updated_at) VALUES ($1,1,2,$2,$3,$4,$5,$6,$7,$8,$9,'prepared',NOW(),NOW())")
        .bind(node_id).bind(request_id).bind(&candidate).bind(&old_pin.ed_key_id).bind(&old_pin.pq_key_id).bind(&next_pin.ed_key_id).bind(&next_pin.pq_key_id).bind(&next_pin.ed_public).bind(&next_pin.pq_public).execute(&pool).await.unwrap();

    let permit = xsp_v2_signed_cutover::Permit {
        kind: "permit".into(),
        issuer_id: owner.into(),
        signer_ed_key_id: "owner-ed".into(),
        signer_pq_key_id: "owner-pq".into(),
        node_id: node,
        from_epoch: 1,
        to_epoch: 2,
        request_id: request_id.into(),
        candidate_sha256_hex: candidate.clone(),
        permit_nonce_hex: permit_nonce.into(),
        issued_at_ms,
        expires_at_ms,
    };
    let permit_bytes = serde_json::to_vec(&permit).unwrap();
    let permit_sha = hex::encode(Sha256::digest(&permit_bytes));
    sqlx::query("INSERT INTO node_xsp_cutover_permit_ledger (node_id,request_id,from_epoch,to_epoch,candidate_sha256_hex,permit_nonce_hex,permit_sha256_hex,issued_at_ms,expires_at_ms,state,owner_issuer_id,created_at,updated_at) VALUES ($1,$2,1,2,$3,$4,$5,$6,$7,'issued',$8,NOW(),NOW())")
        .bind(node_id).bind(request_id).bind(&candidate).bind(permit_nonce).bind(&permit_sha).bind(issued_at_ms).bind(expires_at_ms).bind(owner).execute(&pool).await.unwrap();

    let mut ack = Cutover {
        kind: "ack".into(),
        issuer_id: format!("node-{node}"),
        signer_ed_key_id: next_pin.ed_key_id.clone(),
        signer_pq_key_id: next_pin.pq_key_id.clone(),
        node_id: node,
        from_epoch: 1,
        to_epoch: 2,
        request_id: request_id.into(),
        from_ed_key_id: old_pin.ed_key_id.clone(),
        from_pq_key_id: old_pin.pq_key_id.clone(),
        to_ed_key_id: next_pin.ed_key_id.clone(),
        to_pq_key_id: next_pin.pq_key_id.clone(),
        method: "POST".into(),
        path: "/api/v2/node/keys/rotation/ack".into(),
        issued_at_ms,
        expires_at_ms,
        permit_nonce_hex: permit_nonce.into(),
        nonce_hex: ack_nonce.into(),
        candidate_sha256_hex: candidate,
        permit_sha256_hex: permit_sha,
        applied_state_sha256_hex: String::new(),
    };
    ack.applied_state_sha256_hex = applied_state_digest(&ack);
    let signing_input = ack_signing_input(&ack);
    let ed_signature = next_ed.sign(&signing_input).to_bytes().to_vec();
    let pq_signature = sign_pq(&next_pq, &signing_input);
    let envelope = serde_json::json!({
        "message": ack,
        "signatures": {
            "ed25519": STANDARD.encode(ed_signature),
            "mldsa65": STANDARD.encode(pq_signature),
        }
    });
    let ack_bytes = serde_json::to_vec(&envelope).unwrap();

    let keys_dir = PathBuf::from(required("XSP_V2_C2C_KEYS_DIR"));
    let public_dir = PathBuf::from(required("XSP_V2_C2C_PUBLIC_DIR"));
    fs::create_dir_all(&keys_dir).unwrap();
    fs::create_dir_all(&public_dir).unwrap();
    save_private(&keys_dir.join("panel-ed25519.pem"), &panel_ed.to_bytes());
    save_private(&keys_dir.join("panel-mldsa65.pem"), &panel_pq.private_key_to_pem_pkcs8().unwrap());
    let panel_pin_json = serde_json::json!({
        "purpose": panel_pin.purpose,
        "issuerId": panel_pin.issuer_id,
        "nodeId": panel_pin.node_id,
        "edKeyId": panel_pin.ed_key_id,
        "pqKeyId": panel_pin.pq_key_id,
        "edPublicB64": STANDARD.encode(panel_pin.ed_public),
        "pqPublicB64": STANDARD.encode(panel_pin.pq_public),
    });
    fs::write(public_dir.join("panel-pin.json"), serde_json::to_vec(&panel_pin_json).unwrap()).unwrap();
    fs::write(public_dir.join("request.ack"), &ack_bytes).unwrap();
    let fixture = serde_json::json!({
        "nodeId": node_id,
        "requestId": request_id,
        "ackB64": STANDARD.encode(ack_bytes),
        "issuer": panel_pin_json["issuerId"],
        "edId": panel_pin_json["edKeyId"],
        "pqId": panel_pin_json["pqKeyId"],
    });
    fs::write(public_dir.join("fixture.json"), serde_json::to_vec(&fixture).unwrap()).unwrap();
    println!("1 passed; 0 failed");
}
