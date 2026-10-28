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
    raw.extend_from_slice(&value.to_epoch.to_be_bytes());
    raw.extend_from_slice(&hex_exact(&value.candidate_sha256_hex, 32));
    hex::encode(Sha256::digest(raw))
}

fn sign_ack(value: &Cutover, ed: &SigningKey, pq: &PKey<Private>) -> Vec<u8> {
    let input = ack_signing_input(value);
    let mut pq_signer = PqSigner::new_without_digest(pq).unwrap();
    let pq_sig = pq_signer.sign_oneshot_to_vec(&input).unwrap();
    serde_json::to_vec(&serde_json::json!({
        "message": value,
        "signatures": {
            "ed25519": STANDARD.encode(ed.sign(&input).to_bytes()),
            "mldsa65": STANDARD.encode(pq_sig),
        }
    }))
    .unwrap()
}

fn write_root_group_file(path: &Path, bytes: &[u8], mode: u32) {
    fs::write(path, bytes).unwrap();
    chown(path, Some(0), Some(10_001)).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}

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
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
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
        active_ed_public: old_pin.ed_public.clone(),
        active_pq_public: old_pin.pq_public.clone(),
        pending_ed_public: next_pin.ed_public.clone(),
        pending_pq_public: next_pin.pq_public.clone(),
    };
    let candidate_hash =
        hex::encode(xsp_v2_candidate_binding::candidate_sha256(&material).unwrap());

    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO node_metric_keys(node_id,public_key) VALUES($1,$2)")
        .bind(node_id)
        .bind(hex::encode(Sha256::digest(node.to_be_bytes())))
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO node_xsp_suite_state(node_id,minimum_suite,activation_phase,key_epoch)
         VALUES($1,1,'dual_enrolled',1)",
    )
    .bind(node_id)
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO node_xsp_public_keysets
         (node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public)
         VALUES($1,'node_request',1,$2,$3,$4,$5)",
    )
    .bind(node_id)
    .bind(&old_pin.ed_key_id)
    .bind(&old_pin.pq_key_id)
    .bind(&old_pin.ed_public)
    .bind(&old_pin.pq_public)
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO node_xsp_rotation_preparations
         (node_id,from_epoch,to_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,
          mldsa65_public,challenge_sha256,approved_by,expires_at,proved_at)
         VALUES($1,1,2,$2,$3,$4,$5,decode(repeat('66',32),'hex'),$6,
                NOW()+INTERVAL '9 minutes',NOW())",
    )
    .bind(node_id)
    .bind(&next_pin.ed_key_id)
    .bind(&next_pin.pq_key_id)
    .bind(&next_pin.ed_public)
    .bind(&next_pin.pq_public)
    .bind(owner)
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let now = i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    )
    .unwrap();
    let permit = Cutover {
        kind: "permit".into(),
        issuer_id: panel_pin.issuer_id.clone(),
        signer_ed_key_id: panel_pin.ed_key_id.clone(),
        signer_pq_key_id: panel_pin.pq_key_id.clone(),
        node_id: node,
        from_epoch: 1,
        to_epoch: 2,
        request_id: "c2c-process-e2e-1".into(),
        from_ed_key_id: old_pin.ed_key_id.clone(),
        from_pq_key_id: old_pin.pq_key_id.clone(),
        to_ed_key_id: next_pin.ed_key_id.clone(),
        to_pq_key_id: next_pin.pq_key_id.clone(),
        method: "POST".into(),
        path: "/api/v2/node/keys/rotation/permit".into(),
        issued_at_ms: now - 2_000,
        expires_at_ms: now + 50_000,
        permit_nonce_hex: "71".repeat(16),
        nonce_hex: "71".repeat(16),
        candidate_sha256_hex: candidate_hash,
        permit_sha256_hex: "00".repeat(32),
        applied_state_sha256_hex: "00".repeat(32),
    };
    let signed_permit = sign_staging_permit(&permit, &panel_pin, &panel_ed, &panel_pq).unwrap();
    let mut permit_tx = pool.begin().await.unwrap();
    let stored = xsp_v2_permit_ledger_writer::persist_verified_permit(
        &mut permit_tx,
        node_id,
        owner,
        &permit.request_id,
        &signed_permit,
        &panel_pin,
        now,
    )
    .await
    .unwrap();
    assert!(!stored.reused);
    permit_tx.commit().await.unwrap();

    let mut ack = Cutover {
        kind: "ack".into(),
        issuer_id: format!("node-{node}"),
        signer_ed_key_id: next_pin.ed_key_id.clone(),
        signer_pq_key_id: next_pin.pq_key_id.clone(),
        node_id: node,
        from_epoch: 1,
        to_epoch: 2,
        request_id: permit.request_id.clone(),
        from_ed_key_id: old_pin.ed_key_id.clone(),
        from_pq_key_id: old_pin.pq_key_id.clone(),
        to_ed_key_id: next_pin.ed_key_id.clone(),
        to_pq_key_id: next_pin.pq_key_id.clone(),
        method: "POST".into(),
        path: "/api/v2/node/keys/rotation/ack".into(),
        issued_at_ms: now - 1_000,
        expires_at_ms: now + 50_000,
        permit_nonce_hex: permit.permit_nonce_hex.clone(),
        nonce_hex: "72".repeat(16),
        candidate_sha256_hex: permit.candidate_sha256_hex.clone(),
        permit_sha256_hex: stored.canonical_sha256_hex,
        applied_state_sha256_hex: String::new(),
    };
    ack.applied_state_sha256_hex = applied_state_digest(&ack);
    let signed_ack = sign_ack(&ack, &next_ed, &next_pq);

    let keys = PathBuf::from(required("XSP_V2_C2C_KEYS_DIR"));
    let public = PathBuf::from(required("XSP_V2_C2C_PUBLIC_DIR"));
    let ed_pem = PKey::private_key_from_raw_bytes(&panel_ed.to_bytes(), Id::ED25519)
        .unwrap()
        .private_key_to_pem_pkcs8()
        .unwrap();
    write_root_group_file(&keys.join("panel-ed25519.pem"), &ed_pem, 0o440);
    write_root_group_file(
        &keys.join("panel-mldsa65.pem"),
        &panel_pq.private_key_to_pem_pkcs8().unwrap(),
        0o440,
    );
    let pin_json = serde_json::json!({
        "issuerId": panel_pin.issuer_id,
        "ed25519KeyId": panel_pin.ed_key_id,
        "mldsa65KeyId": panel_pin.pq_key_id,
        "ed25519PublicB64": STANDARD.encode(&panel_pin.ed_public),
        "mldsa65PublicB64": STANDARD.encode(&panel_pin.pq_public),
    });
    let fixture_json = serde_json::json!({
        "nodeId": node_id,
        "requestId": ack.request_id,
        "ackB64": STANDARD.encode(&signed_ack),
        "edId": pin_json["ed25519KeyId"],
        "pqId": pin_json["mldsa65KeyId"],
        "issuer": pin_json["issuerId"],
    });
    fs::write(
        public.join("panel-pin.json"),
        serde_json::to_vec(&pin_json).unwrap(),
    )
    .unwrap();
    fs::write(
        public.join("fixture.json"),
        serde_json::to_vec(&fixture_json).unwrap(),
    )
    .unwrap();
    fs::set_permissions(
        public.join("panel-pin.json"),
        fs::Permissions::from_mode(0o444),
    )
    .unwrap();
    fs::set_permissions(
        public.join("fixture.json"),
        fs::Permissions::from_mode(0o444),
    )
    .unwrap();

    let epoch: i64 =
        sqlx::query_scalar("SELECT key_epoch FROM node_xsp_suite_state WHERE node_id=$1")
            .bind(node_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(epoch, 1, "fixture must leave ACK uncommitted");
    let state: String = sqlx::query_scalar(
        "SELECT state FROM node_xsp_cutover_permit_ledger WHERE node_id=$1 AND request_id=$2",
    )
    .bind(node_id)
    .bind(&permit.request_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(state, "issued");
    println!("C2-C FIXTURE: PASS");
    println!("1 passed; 0 failed");
}
