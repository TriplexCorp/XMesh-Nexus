//! Compiled only by the test target and the disposable CI binary.
use crate::{
    node_policy::PolicySigner,
    quota_v2_public_tls_authority::{GenesisBinding, PublicListener, policy},
};
use anyhow::{Result, ensure};
use serde_json::json;

/// Generate canonical JSON/Ed25519 envelope bytes for interoperability with
/// the measured Node's strict `public_tls_frontend.verify_signed_public_tls`.
/// Deliberately private: this creates *only* signature bytes; it proves neither
/// that a cap was installed nor that the public TLS port may yet be opened.
pub fn sign(
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
