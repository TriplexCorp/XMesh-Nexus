//! Production-compatible byte contract for a *future* Quota V2 public TLS issuer.
//!
//! No HTTP route calls this module. A signature is never a spending permit.
//! The caller must first hold an authenticated strict-PQ Node activation,
//! immutable original Genesis policy, measured runtime, current signed cap
//! and verified public certificate ownership, with durable revocation.
//! We intentionally leave the constructor private until the database-backed
//! admission check and installed two-node TLS proof are implemented.
use crate::node_policy::PolicySigner;
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::collections::HashSet;

#[derive(Clone)]
struct GenesisBinding {
    node_id: i64,
    activation_receipt_sha256: String,
    genesis_policy_sha256: String,
    runtime_id: String,
    profile_revision: String,
}

#[derive(Clone, Debug)]
struct PublicListener {
    tag: String,
    domain: String,
    port: u16,
}

fn hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn domain(value: &str) -> bool {
    let bytes = value.as_bytes();
    if !(4..=253).contains(&bytes.len()) {
        return false;
    }
    let labels: Vec<&str> = value.split('.').collect();
    if labels.len() < 2 {
        return false;
    }
    let Some(last) = labels.last() else { return false };
    if !last.as_bytes().first().is_some_and(u8::is_ascii_lowercase) {
        return false;
    }
    labels.into_iter().all(|label| {
        let part = label.as_bytes();
        !part.is_empty()
            && part.len() <= 63
            && part
                .first()
                .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
            && part
                .last()
                .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
            && part
                .iter()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
    })
}

/// No public API may call this until it has an independently checked SQL
/// admission and a root-owned TLS certificate life-cycle. Binding the *exact*
/// original runtime and canonical raw VLESS profile blocks a signed approval
/// from silently migrating to a fresh unmetered Xray process or modified roster.
fn policy(
    source: &GenesisBinding,
    bindings: &[PublicListener],
    issued_at_ms: i64,
    valid_until_ms: i64,
) -> Result<Value> {
    ensure!(source.node_id > 0, "invalid signed TLS node");
    for digest in [
        &source.activation_receipt_sha256,
        &source.genesis_policy_sha256,
        &source.runtime_id,
        &source.profile_revision,
    ] {
        ensure!(hex64(digest), "unbound signed TLS identity");
    }
    ensure!(
        issued_at_ms > 0
            && valid_until_ms > issued_at_ms
            && valid_until_ms - issued_at_ms <= 120_000,
        "invalid public TLS authorization lifetime"
    );
    ensure!(
        (1..=2).contains(&bindings.len()),
        "public TLS requires one or two recognized signed aliases"
    );
    let mut tags = HashSet::new();
    let mut ports = HashSet::new();
    let mut configured = Vec::with_capacity(bindings.len());
    for listener in bindings {
        ensure!(
            matches!(listener.tag.as_str(), "vless-main" | "vless-cdn")
                && tags.insert(listener.tag.as_str())
                && listener.port > 0
                && ports.insert(listener.port)
                && domain(&listener.domain),
            "duplicate, foreign or unsafe public TLS listener"
        );
        configured.push(json!({
            "tag": listener.tag, "port": listener.port, "domain": listener.domain,
        }));
    }
    Ok(json!({
        "schemaVersion": 1,
        "kind": "xmesh.quota-v2.public-tls-ingress",
        "nodeId": source.node_id,
        "activationReceiptSha256": source.activation_receipt_sha256,
        "genesisPolicySha256": source.genesis_policy_sha256,
        "runtimeId": source.runtime_id,
        "profileRevision": source.profile_revision,
        "issuedAtMs": issued_at_ms,
        "validUntilMs": valid_until_ms,
        "canServePublic": true,
        "bindings": configured,
    }))
}

/// Generate canonical JSON/Ed25519 envelope bytes for interoperability with
/// the measured Node's strict \`public_tls_frontend.verify_signed_public_tls\`.
/// Deliberately private: this creates *only* signature bytes; it proves neither
/// that a cap was installed nor that the public TLS port may yet be opened.
fn sign(
    signer: &PolicySigner,
    source: &GenesisBinding,
    bindings: &[PublicListener],
    issued_at_ms: i64,
    valid_until_ms: i64,
) -> Result<Vec<u8>> {
    let payload = policy(source, bindings, issued_at_ms, valid_until_ms)?;
    let signature = signer.sign(&payload)?;
    let bytes = serde_json::to_vec(&json!({
        "algorithm": "Ed25519",
        "payload": payload,
        "signature": signature,
    }))?;
    ensure!(bytes.len() <= 8192, "signed public TLS policy too large");
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    fn source() -> GenesisBinding {
        GenesisBinding {
            node_id: 47,
            activation_receipt_sha256: "a".repeat(64),
            genesis_policy_sha256: "b".repeat(64),
            runtime_id: "c".repeat(64),
            profile_revision: "d".repeat(64),
        }
    }
    fn listeners() -> Vec<PublicListener> {
        vec![
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
        ]
    }
    #[test]
    fn real_panel_policy_signer_creates_exact_node_ed25519_envelope() {
        let key_path = std::env::temp_dir().join(format!(
            "xmesh-ephemeral-public-tls-key-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let signer = PolicySigner::load(&key_path).unwrap();
        std::fs::remove_file(key_path).unwrap();
        let raw = sign(&signer, &source(), &listeners(), 1_800_000_000_000, 1_800_000_060_000)
            .unwrap();
        let envelope: Value = serde_json::from_slice(&raw).unwrap();
        assert_eq!(envelope["algorithm"], "Ed25519");
        assert_eq!(envelope["payload"]["kind"], "xmesh.quota-v2.public-tls-ingress");
        assert_eq!(envelope["payload"]["runtimeId"], "c".repeat(64));
        assert_eq!(envelope["payload"]["profileRevision"], "d".repeat(64));
        assert_eq!(envelope["payload"]["canServePublic"], true);
        assert_eq!(envelope["payload"]["bindings"][0]["port"], 443);
        let signature: [u8; 64] = hex::decode(envelope["signature"].as_str().unwrap())
            .unwrap().try_into().unwrap();
        let public: [u8; 32] = hex::decode(signer.public_key()).unwrap().try_into().unwrap();
        let key = VerifyingKey::from_bytes(&public).unwrap();
        let payload = serde_json::to_vec(&envelope["payload"]).unwrap();
        key.verify(&payload, &Signature::from_bytes(&signature)).unwrap();
        let mut replaced = envelope["payload"].clone();
        replaced["runtimeId"] = json!("f".repeat(64));
        assert!(
            key.verify(&serde_json::to_vec(&replaced).unwrap(),
                       &Signature::from_bytes(&signature)).is_err()
        );
        assert_eq!(serde_json::to_vec(&envelope).unwrap(), raw);
    }
    #[test]
    fn deny_malformed_source_aliases_hosts_and_oversize_lifetime() {
        let good = source();
        let bindings = listeners();
        let issued = 1_800_000_000_000_i64;
        assert!(policy(&good, &bindings, issued, issued + 60_000).is_ok());
        let mut bad = good.clone();
        bad.runtime_id = "E".repeat(64);
        assert!(policy(&bad, &bindings, issued, issued + 60_000).is_err());
        bad = good.clone();
        bad.profile_revision = "f".repeat(63);
        assert!(policy(&bad, &bindings, issued, issued + 60_000).is_err());
        bad = good.clone();
        bad.node_id = 0;
        assert!(policy(&bad, &bindings, issued, issued + 60_000).is_err());
        for expiry in [issued, issued - 1, issued + 120_001] {
            assert!(policy(&good, &bindings, issued, expiry).is_err());
        }
        for domain in [
            "*.example.com", "../example.com", "UPPER.example.com",
            "127.0.0.1", "localhost", "bad..example.com",
            "bad-.example.com", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ] {
            let mut invalid = bindings.clone();
            invalid[0].domain = domain.to_string();
            assert!(policy(&good, &invalid, issued, issued + 60_000).is_err());
        }
        for (tag, port) in [
            ("vless-foreign", 443),
            ("vless-main", 443),
            ("vless-cdn", 8443),
            ("vless-cdn", 0),
        ] {
            let mut invalid = bindings.clone();
            invalid[0].tag = tag.into();
            invalid[0].port = port;
            assert!(policy(&good, &invalid, issued, issued + 60_000).is_err());
        }
        assert!(policy(&good, &[], issued, issued + 60_000).is_err());
        assert!(policy(&good, &vec![bindings[0].clone(); 3], issued, issued + 60_000).is_err());
    }
}
