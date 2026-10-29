#![cfg(feature = "xsp-v2-experimental")]

#[path = "../xsp_v2_candidate_binding.rs"]
mod xsp_v2_candidate_binding;
#[path = "../xsp_v2_permit_ledger_writer.rs"]
mod xsp_v2_permit_ledger_writer;
#[path = "../xsp_v2_signed_cutover.rs"]
mod xsp_v2_signed_cutover;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::SigningKey;
use openssl::{
    pkey::{Id, PKey, Private},
};
use serde::Deserialize;
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentPublicFile {
    node_id: u64,
    old: AgentPublic,
    next: AgentPublic,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentPublic {
    key_epoch: u64,
    ed_key_id: String,
    pq_key_id: String,
    ed_public_b64: String,
    pq_public_b64: String,
}

fn required(name: &str) -> String {
    env::var(name).expect("required P0-E3a fixture setting missing")
}

fn key_id(prefix: &str, raw: &[u8]) -> String {
    format!("{prefix}{}", hex::encode(&Sha256::digest(raw)[..12]))
}

fn decode_agent(node: u64, raw: AgentPublic) -> TrustedPublic {
    let ed_public = STANDARD.decode(raw.ed_public_b64).expect("Agent Ed25519 public key invalid");
    let pq_public = STANDARD.decode(raw.pq_public_b64).expect("Agent ML-DSA-65 public key invalid");
    assert_eq!(raw.ed_key_id, key_id("ed-", &ed_public), "Agent Ed25519 key ID mismatch");
    assert_eq!(raw.pq_key_id, key_id("pq-", &pq_public), "Agent ML-DSA-65 key ID mismatch");
    TrustedPublic {
        purpose: "node_request".into(),
        issuer_id: format!("node-{node}"),
        node_id: node,
        ed_key_id: raw.ed_key_id,
        pq_key_id: raw.pq_key_id,
        ed_public,
        pq_public,
    }
}

fn panel_pair(node: u64) -> (SigningKey, PKey<Private>, TrustedPublic) {
    let ed = SigningKey::from_bytes(&[73; 32]);
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
        purpose: "panel_response".into(),
        issuer_id: "p0e3a-ci-panel".into(),
        node_id: node,
        ed_key_id: key_id("ed-", &ed_public),
        pq_key_id: key_id("pq-", &pq_public),
        ed_public,
        pq_public,
    };
    (ed, pq, pin)
}

fn write_root_group_file(path: &Path, bytes: &[u8], mode: u32) {
    fs::write(path, bytes).unwrap();
    chown(path, Some(0), Some(10_001)).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}

#[tokio::main]
async fn main() {
    assert_eq!(
        env::var("XSP_V2_P0E3A_FIXTURE").as_deref(),
        Ok("1"),
        "disposable P0-E3a fixture harness required"
    );
    let agent_raw = fs::read(required("XSP_V2_P0E3A_AGENT_PUBLIC_FILE")).unwrap();
    let agent: AgentPublicFile = serde_json::from_slice(&agent_raw).unwrap();
    assert!(agent.node_id > 0 && agent.node_id <= i64::MAX as u64);
    assert_eq!(agent.old.key_epoch, 1, "P0-E3a fixture requires epoch-1 snapshot base");
    assert_eq!(agent.next.key_epoch, 2, "P0-E3a fixture requires one prepared rotation");
    let node = agent.node_id;
    let node_id = i64::try_from(node).unwrap();
    let old_pin = decode_agent(node, agent.old);
    let next_pin = decode_agent(node, agent.next);
    let (panel_ed, panel_pq, panel_pin) = panel_pair(node);

    let pool = PgPool::connect(&required("XSP_V2_C2C_ADMIN_DATABASE_URL"))
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    let owner = "p0e3a-ci-owner";
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
    let candidate_hash = hex::encode(xsp_v2_candidate_binding::candidate_sha256(&material).unwrap());

    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO node_metric_keys(node_id,public_key) VALUES($1,$2)")
        .bind(node_id)
        .bind(hex::encode(Sha256::digest(node.to_be_bytes())))
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO node_xsp_suite_state(node_id,minimum_suite,activation_phase,key_epoch) VALUES($1,1,'dual_enrolled',1)",
    )
    .bind(node_id)
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO node_xsp_public_keysets (node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public) VALUES($1,'node_request',1,$2,$3,$4,$5)",
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
        "INSERT INTO node_xsp_rotation_preparations (node_id,from_epoch,to_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public,challenge_sha256,approved_by,expires_at,proved_at) VALUES($1,1,2,$2,$3,$4,$5,decode(repeat('66',32),'hex'),$6,NOW()+INTERVAL '9 minutes',NOW())",
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

    let now = i64::try_from(SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis()).unwrap();
    let permit = Cutover {
        kind: "permit".into(),
        issuer_id: panel_pin.issuer_id.clone(),
        signer_ed_key_id: panel_pin.ed_key_id.clone(),
        signer_pq_key_id: panel_pin.pq_key_id.clone(),
        node_id: node,
        from_epoch: 1,
        to_epoch: 2,
        request_id: "p0e3a-coordinated-rollback-1".into(),
        from_ed_key_id: old_pin.ed_key_id.clone(),
        from_pq_key_id: old_pin.pq_key_id.clone(),
        to_ed_key_id: next_pin.ed_key_id.clone(),
        to_pq_key_id: next_pin.pq_key_id.clone(),
        method: "POST".into(),
        path: "/api/v2/node/keys/rotation/permit".into(),
        issued_at_ms: now - 2_000,
        expires_at_ms: now + 55_000,
        permit_nonce_hex: "81".repeat(16),
        nonce_hex: "81".repeat(16),
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
        "requestId": permit.request_id,
        "edId": pin_json["ed25519KeyId"],
        "pqId": pin_json["mldsa65KeyId"],
        "issuer": pin_json["issuerId"],
    });
    fs::write(public.join("panel-pin.json"), serde_json::to_vec(&pin_json).unwrap()).unwrap();
    fs::write(public.join("fixture-p0e3a.json"), serde_json::to_vec(&fixture_json).unwrap()).unwrap();
    fs::set_permissions(public.join("panel-pin.json"), fs::Permissions::from_mode(0o444)).unwrap();
    fs::set_permissions(public.join("fixture-p0e3a.json"), fs::Permissions::from_mode(0o444)).unwrap();

    let epoch: i64 = sqlx::query_scalar("SELECT key_epoch FROM node_xsp_suite_state WHERE node_id=$1")
        .bind(node_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(epoch, 1, "fixture must leave Agent-generated candidate uncommitted");
    let state: String = sqlx::query_scalar(
        "SELECT state FROM node_xsp_cutover_permit_ledger WHERE node_id=$1 AND request_id=$2",
    )
    .bind(node_id)
    .bind(&permit.request_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(state, "issued");
    println!("P0-E3A FIXTURE: PASS");
}
