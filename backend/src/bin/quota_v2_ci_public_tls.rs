//! Ephemeral GitHub-hosted CI bridge: real Nexus `PolicySigner` -> strict Node TLS.
//! This target does not belong to the production Docker image. It cannot read
//! production PostgreSQL, install a certificate or enable an ingress.
#[path = "../node_policy.rs"]
mod node_policy;
#[path = "../quota_v2_public_tls_authority.rs"]
mod quota_v2_public_tls_authority;

use anyhow::{Result, ensure};
use quota_v2_public_tls_authority::{GenesisBinding, PublicListener, sign};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::Write,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

fn run() -> Result<()> {
    ensure!(
        env::var("GITHUB_ACTIONS").as_deref() == Ok("true")
            && env::var("RUNNER_ENVIRONMENT").as_deref() == Ok("github-hosted")
            && env::var("XMESH_AUDIT_DISPOSABLE").as_deref() == Ok("1"),
        "public TLS signer fixture may run only in disposable hosted CI"
    );
    let args: Vec<String> = env::args().skip(1).collect();
    ensure!(
        args.len() == 2,
        "usage: cli PROFILE_SHA256 RUNNER_OUTPUT_DIR"
    );
    let revision = &args[0];
    ensure!(
        revision.len() == 64
            && revision
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "invalid canonical Xray profile digest"
    );
    let output = PathBuf::from(&args[1]).canonicalize()?;
    let runner = PathBuf::from(env::var("RUNNER_TEMP")?).canonicalize()?;
    ensure!(
        output.starts_with(&runner) && output != runner,
        "fixture output must be a dedicated hosted-runner directory"
    );
    let key = node_policy::PolicySigner::load(&output.join("policy-signer.key"))?;
    let source = GenesisBinding {
        node_id: 47,
        activation_receipt_sha256: "a".repeat(64),
        genesis_policy_sha256: "b".repeat(64),
        runtime_id: "c".repeat(64),
        profile_revision: revision.clone(),
    };
    let listeners = vec![
        PublicListener {
            tag: "vless-cdn".into(),
            port: 443,
            domain: "cdn.example.com".into(),
        },
        PublicListener {
            tag: "vless-main".into(),
            port: 8443,
            domain: "vpn.example.com".into(),
        },
    ];
    let signed = sign(
        &key,
        &source,
        &listeners,
        1_800_000_000_000,
        1_800_000_060_000,
    )?;
    let result = output.join("public-tls-authority.json");
    let public_key = output.join("policy-public-key.txt");
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create_new(true);
    opts.open(&result)?.write_all(&signed)?;
    opts.open(&public_key)?
        .write_all(key.public_key().as_bytes())?;

    // Disposable-only positive revocation *fixture* for testing strict
    // Node parsing. This signature is NOT backed by a SQL revocation lock,
    // authenticated active Node/Xray/WAL or production admission, and is
    // never issued by a production Nexus route.
    let now_ms: i64 = SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .try_into()?;
    let public_tls_hash = hex::encode(Sha256::digest(&signed));
    let witness = json!({
        "schemaVersion": 1,
        "kind": "xmesh.quota-v2.public-tls-revocation-witness",
        "nodeId": source.node_id,
        "activationReceiptSha256": source.activation_receipt_sha256,
        "genesisPolicySha256": source.genesis_policy_sha256,
        "runtimeId": source.runtime_id,
        "profileRevision": source.profile_revision,
        "authoritySha256": public_tls_hash,
        "capRosterSha256": "f".repeat(64),
        "challenge": "7".repeat(64),
        "issuedAtMs": now_ms,
        "validUntilMs": now_ms + 7_000,
        "revoked": false,
        "canServePublic": false,
        "canStart": false,
        "canResume": false,
    });
    let signed_witness = serde_json::to_vec(&json!({
        "algorithm": "Ed25519",
        "payload": witness,
        "signature": key.sign(&witness)?,
    }))?;
    ensure!(
        signed_witness.len() + 1 <= 4096,
        "disposable revocation fixture exceeds Node wire limit"
    );
    let mut revocation_file = opts.open(output.join("public-tls-revocation.json"))?;
    revocation_file.write_all(&signed_witness)?;
    revocation_file.write_all(b"\n")?;
    println!(
        "Signed isolated TLS authority for CI: {} bytes",
        signed.len()
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("quota-v2 public TLS CI fixture rejected: {error:#}");
        std::process::exit(1);
    }
}
