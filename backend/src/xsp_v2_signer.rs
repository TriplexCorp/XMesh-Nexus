//! Isolated XSP-v2 panel-response receipt signer sidecar.
//!
//! This module is compiled only with xsp-v2-experimental. The sidecar is a
//! dedicated process/container, not an HTTP route. It accepts local Unix-socket
//! requests only from the `XMesh` API UID/GID, independently reads and verifies
//! the committed ACK using the `xmesh_signer_reader` SELECT-only database role,
//! and signs only after that database readback succeeds.
//!
//! The default panel image does not compile this feature and never receives
//! either private key file. The optional Compose profile is disabled by
//! default; absent key files, owner-approved key IDs, read-only DB role or
//! protected socket directory cause startup to fail closed.
use anyhow::{Context, Result, ensure};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::SigningKey;
use openssl::pkey::{KeyType, PKey, Private};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{
    env, fs,
    os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{UnixListener, UnixStream},
    time::timeout,
};

use crate::{
    xsp_v2_ack_epoch_commit::readback_committed_applied_ack_signer_staging,
    xsp_v2_commit_receipt::sign_staging_commit_receipt, xsp_v2_signed_cutover::TrustedPublic,
};

const SOCKET_PATH_DEFAULT: &str = "/run/xmesh-signer/signer.sock";
const ED25519_KEY_PATH_DEFAULT: &str = "/run/xmesh-signer-keys/panel-ed25519.pem";
const MLDSA65_KEY_PATH_DEFAULT: &str = "/run/xmesh-signer-keys/panel-mldsa65.pem";
const MAX_SIGN_REQUEST_BYTES: usize = 32 * 1024;
const MAX_SIGN_RESPONSE_BYTES: usize = 24 * 1024;
const MAX_ACK_BYTES: usize = 16 * 1024;
const SIGNER_UID: u32 = 10_002;
const SHARED_GID: u32 = 10_001;
const API_UID: u32 = 10_001;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignRequest {
    protocol: String,
    action: String,
    node_id: i64,
    request_id: String,
    signed_ack_b64: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignResponse {
    protocol: String,
    action: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    signed_receipt_b64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
}

struct SigningMaterial {
    ed25519: SigningKey,
    mldsa65: PKey<Private>,
    panel_pin_template: TrustedPublic,
}

fn signer_key_id(prefix: &str, public: &[u8]) -> String {
    format!("{prefix}{}", hex::encode(&Sha256::digest(public)[..12]))
}

fn read_private_key_file(path: &Path) -> Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("inspect signer key file {}", path.display()))?;
    ensure!(
        metadata.file_type().is_file(),
        "signer key path must be a regular file, not a symlink or special file"
    );
    ensure!(
        metadata.uid() == 0 && metadata.gid() == SHARED_GID,
        "signer key file must be root-owned and assigned to the signer group"
    );
    let mode = metadata.permissions().mode() & 0o777;
    ensure!(
        mode & 0o027 == 0 && mode & 0o0100 == 0 && mode & 0o0040 != 0,
        "signer key file must be group-readable only, not group/world writable or world-accessible"
    );
    ensure!(
        metadata.nlink() == 1,
        "signer key file must not have additional hard links"
    );
    fs::read(path).with_context(|| format!("read signer key file {}", path.display()))
}

fn load_signing_material(check_pins: bool) -> Result<SigningMaterial> {
    let ed_path = env::var_os("XSP_V2_SIGNER_ED25519_KEY_FILE")
        .map_or_else(|| PathBuf::from(ED25519_KEY_PATH_DEFAULT), PathBuf::from);
    let pq_path = env::var_os("XSP_V2_SIGNER_MLDSA65_KEY_FILE")
        .map_or_else(|| PathBuf::from(MLDSA65_KEY_PATH_DEFAULT), PathBuf::from);

    let ed_pem = read_private_key_file(&ed_path)?;
    let ed_key = PKey::private_key_from_pem(&ed_pem).context("load Ed25519 signer PEM")?;
    let ed_seed: [u8; 32] = ed_key
        .raw_private_key()
        .context("extract Ed25519 seed")?
        .try_into()
        .map_err(|_| anyhow::anyhow!("Ed25519 signer seed must be exactly 32 bytes"))?;
    let ed25519 = SigningKey::from_bytes(&ed_seed);
    let ed_public = ed25519.verifying_key().to_bytes().to_vec();
    ensure!(
        ed_key.raw_public_key().context("read Ed25519 public key")? == ed_public,
        "Ed25519 signer PEM does not contain the expected Ed25519 private/public pair"
    );

    let pq_pem = read_private_key_file(&pq_path)?;
    let mldsa65 = PKey::private_key_from_pem(&pq_pem).context("load ML-DSA-65 signer PEM")?;
    let public_der = mldsa65
        .public_key_to_der()
        .context("derive ML-DSA-65 public key")?;
    ensure!(
        public_der.len() >= 1952,
        "ML-DSA-65 public key DER is too short"
    );
    let pq_public = public_der[public_der.len() - 1952..].to_vec();
    PKey::public_key_from_raw_bytes_ex(None, KeyType::ML_DSA_65, None, &pq_public)
        .context("validate ML-DSA-65 public key with configured provider")?;

    let ed_key_id = signer_key_id("ed-", &ed_public);
    let pq_key_id = signer_key_id("pq-", &pq_public);
    if check_pins {
        ensure!(
            env::var("XSP_V2_SIGNER_EXPECTED_ED_KEY_ID")
                .as_deref()
                .is_ok_and(|pin| pin == ed_key_id),
            "loaded Ed25519 signer does not match the owner-approved public-key ID pin"
        );
        ensure!(
            env::var("XSP_V2_SIGNER_EXPECTED_PQ_KEY_ID")
                .as_deref()
                .is_ok_and(|pin| pin == pq_key_id),
            "loaded ML-DSA-65 signer does not match the owner-approved public-key ID pin"
        );
    }
    let issuer_id = if check_pins {
        env::var("XSP_V2_SIGNER_ISSUER_ID").context("XSP_V2_SIGNER_ISSUER_ID is required")?
    } else {
        env::var("XSP_V2_SIGNER_ISSUER_ID").unwrap_or_else(|_| "xmesh-nexus-panel".to_owned())
    };
    ensure!(
        !issuer_id.is_empty()
            && issuer_id.len() <= 64
            && issuer_id.bytes().all(|byte| byte.is_ascii_graphic()),
        "signer issuer ID must be 1..64 printable ASCII bytes"
    );

    Ok(SigningMaterial {
        ed25519,
        mldsa65,
        panel_pin_template: TrustedPublic {
            purpose: "panel_response".into(),
            issuer_id,
            node_id: 1,
            ed_key_id,
            pq_key_id,
            ed_public,
            pq_public,
        },
    })
}

/// Print only public key IDs so an operator can approve and pin them out of
/// band. This one-shot mode never connects to PostgreSQL or starts the socket.
pub fn print_identity() -> Result<()> {
    let keys = load_signing_material(false)?;
    println!(
        "XSP_V2_SIGNER_EXPECTED_ED_KEY_ID={}",
        keys.panel_pin_template.ed_key_id
    );
    println!(
        "XSP_V2_SIGNER_EXPECTED_PQ_KEY_ID={}",
        keys.panel_pin_template.pq_key_id
    );
    Ok(())
}

fn validate_request(request: &SignRequest) -> Result<Vec<u8>> {
    ensure!(request.protocol == "XSP/2", "invalid signer protocol");
    ensure!(
        request.action == "sign-committed-receipt",
        "invalid signer operation"
    );
    ensure!(
        request.node_id > 0
            && !request.request_id.is_empty()
            && request.request_id.len() <= 64
            && request
                .request_id
                .bytes()
                .all(|byte| byte.is_ascii_graphic()),
        "invalid node or request identity"
    );
    ensure!(
        !request.signed_ack_b64.is_empty()
            && request.signed_ack_b64.len() <= MAX_ACK_BYTES.div_ceil(3) * 4,
        "invalid signed ACK size"
    );
    let ack = STANDARD
        .decode(&request.signed_ack_b64)
        .context("invalid signed ACK Base64")?;
    ensure!(
        !ack.is_empty()
            && ack.len() <= MAX_ACK_BYTES
            && STANDARD.encode(&ack) == request.signed_ack_b64,
        "noncanonical signed ACK Base64"
    );
    Ok(ack)
}

fn panel_pin_for_node(template: &TrustedPublic, node_id: i64) -> Result<TrustedPublic> {
    ensure!(node_id > 0, "invalid node ID");
    let node_id = u64::try_from(node_id).context("node ID out of range")?;
    let pin = TrustedPublic {
        purpose: template.purpose.clone(),
        issuer_id: template.issuer_id.clone(),
        node_id,
        ed_key_id: template.ed_key_id.clone(),
        pq_key_id: template.pq_key_id.clone(),
        ed_public: template.ed_public.clone(),
        pq_public: template.pq_public.clone(),
    };
    ensure!(
        pin.issuer_id != format!("node-{node_id}"),
        "panel signer issuer must not impersonate a Node"
    );
    // Recalculate fingerprints instead of trusting key IDs copied from config.
    ensure!(
        pin.ed_key_id == signer_key_id("ed-", &pin.ed_public)
            && pin.pq_key_id == signer_key_id("pq-", &pin.pq_public),
        "signer public keys do not match their calculated fingerprints"
    );
    Ok(pin)
}

async fn sign_committed_ack(
    pool: &PgPool,
    keys: &SigningMaterial,
    request: &SignRequest,
    ack: &[u8],
) -> Result<Vec<u8>> {
    let pin = panel_pin_for_node(&keys.panel_pin_template, request.node_id)?;
    // This code path contains only SELECT queries. The dedicated DB role is
    // additionally configured with default_transaction_read_only=on and no
    // write privileges; the API later rechecks state under locks before insert.
    let evidence = readback_committed_applied_ack_signer_staging(
        pool,
        request.node_id,
        &request.request_id,
        ack,
        &pin,
    )
    .await?;
    sign_staging_commit_receipt(&evidence, &pin, &keys.ed25519, &keys.mldsa65)
        .map_err(anyhow::Error::msg)
}

async fn serve_connection(
    mut stream: UnixStream,
    pool: &PgPool,
    keys: &SigningMaterial,
) -> Result<()> {
    let peer = stream
        .peer_cred()
        .context("read signer socket peer credentials")?;
    ensure!(
        peer.uid() == API_UID && peer.gid() == SHARED_GID,
        "unexpected process credentials on signer socket"
    );

    let mut raw = Vec::new();
    {
        let mut limited = (&mut stream).take((MAX_SIGN_REQUEST_BYTES + 1) as u64);
        timeout(Duration::from_secs(3), limited.read_to_end(&mut raw))
            .await
            .context("signer request read timeout")??;
    }
    ensure!(
        !raw.is_empty() && raw.len() <= MAX_SIGN_REQUEST_BYTES,
        "invalid signer request size"
    );
    let request: SignRequest =
        serde_json::from_slice(&raw).context("invalid signer request JSON")?;
    let result = async {
        let ack = validate_request(&request)?;
        sign_committed_ack(pool, keys, &request, &ack).await
    }
    .await;

    let response = result.map_or_else(
        |_| {
            tracing::warn!("XSP-v2 signer rejected a request");
            SignResponse {
                protocol: "XSP/2".into(),
                action: "sign-committed-receipt-result".into(),
                ok: false,
                signed_receipt_b64: None,
                error_code: Some("request_rejected".into()),
            }
        },
        |receipt| SignResponse {
            protocol: "XSP/2".into(),
            action: "sign-committed-receipt-result".into(),
            ok: true,
            signed_receipt_b64: Some(STANDARD.encode(receipt)),
            error_code: None,
        },
    );
    let response_bytes = serde_json::to_vec(&response)?;
    ensure!(
        response_bytes.len() <= MAX_SIGN_RESPONSE_BYTES,
        "signer response exceeds size limit"
    );
    timeout(Duration::from_secs(3), async {
        stream.write_all(&response_bytes).await?;
        stream.shutdown().await
    })
    .await
    .context("signer response write timeout")??;
    Ok(())
}

/// Dedicated entrypoint selected only by the explicit signer command argument.
pub async fn run() -> Result<()> {
    let keys = load_signing_material(true)?;
    let database_url =
        env::var("XSP_V2_SIGNER_DATABASE_URL").context("XSP_V2_SIGNER_DATABASE_URL is required")?;
    ensure!(
        !database_url.trim().is_empty(),
        "XSP_V2_SIGNER_DATABASE_URL must target xmesh_signer_reader"
    );
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&database_url)
        .await
        .context("connect signer read-only PostgreSQL role")?;

    let current_role: String = sqlx::query_scalar("SELECT current_user")
        .fetch_one(&pool)
        .await?;
    ensure!(
        current_role == "xmesh_signer_reader",
        "signer database role must be xmesh_signer_reader"
    );
    let is_read_only: bool =
        sqlx::query_scalar("SELECT current_setting('transaction_read_only') = 'on'")
            .fetch_one(&pool)
            .await?;
    ensure!(
        is_read_only,
        "signer database sessions must default to read-only"
    );
    let privileged: bool = sqlx::query_scalar(
        "SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication
         FROM pg_roles WHERE rolname=current_user",
    )
    .fetch_one(&pool)
    .await?;
    ensure!(
        !privileged,
        "signer database role has privileged attributes"
    );

    let socket_path = env::var_os("XSP_V2_SIGNER_SOCKET_PATH")
        .map_or_else(|| PathBuf::from(SOCKET_PATH_DEFAULT), PathBuf::from);
    ensure!(
        socket_path.is_absolute(),
        "signer socket path must be absolute"
    );
    let parent = socket_path
        .parent()
        .context("signer socket path must have a parent directory")?;
    let parent_metadata =
        fs::symlink_metadata(parent).context("inspect protected signer socket directory")?;
    ensure!(
        parent_metadata.file_type().is_dir()
            && parent_metadata.uid() == SIGNER_UID
            && parent_metadata.gid() == SHARED_GID
            && parent_metadata.permissions().mode() & 0o777 == 0o750,
        "signer socket directory must be a non-symlink signer-owned 0750 directory"
    );

    match fs::symlink_metadata(&socket_path) {
        Ok(metadata) => {
            ensure!(
                metadata.file_type().is_socket()
                    && metadata.uid() == SIGNER_UID
                    && metadata.gid() == SHARED_GID,
                "existing signer socket path is not an owned Unix socket"
            );
            fs::remove_file(&socket_path).context("remove stale signer socket")?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error).context("inspect previous signer socket"),
    }
    let listener = UnixListener::bind(&socket_path).context("bind protected signer socket")?;
    fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o660))
        .context("set protected signer socket permissions")?;

    tracing::info!(
        socket = %socket_path.display(),
        ed_key_id = %keys.panel_pin_template.ed_key_id,
        pq_key_id = %keys.panel_pin_template.pq_key_id,
        "XSP-v2 isolated receipt signer ready"
    );

    loop {
        let (stream, _) = listener
            .accept()
            .await
            .context("accept signer connection")?;
        if serve_connection(stream, &pool, &keys).await.is_err() {
            // Never log request bodies, receipts, signatures, private material or DB URLs.
            tracing::warn!("XSP-v2 signer connection rejected");
        }
    }
}

/// Client used by the experimental API process. The service's peer UID/GID is
/// checked before any bytes are sent; the caller's outbox layer independently
/// verifies both signatures and all DB bindings before persisting the receipt.
pub async fn issue_or_recover_via_socket(
    pool: &PgPool,
    authenticated_node_id: i64,
    request_id: &str,
    signed_ack_bytes: &[u8],
    pinned_panel: &TrustedPublic,
    socket_path: &Path,
) -> Result<Vec<u8>> {
    crate::xsp_v2_signed_receipt_outbox::issue_or_recover_signed_receipt_staging(
        pool,
        authenticated_node_id,
        request_id,
        signed_ack_bytes,
        pinned_panel,
        |_| async {
            request_receipt_from_socket(
                socket_path,
                authenticated_node_id,
                request_id,
                signed_ack_bytes,
            )
            .await
        },
    )
    .await
}

async fn request_receipt_from_socket(
    socket_path: &Path,
    node_id: i64,
    request_id: &str,
    signed_ack_bytes: &[u8],
) -> Result<Vec<u8>> {
    ensure!(
        node_id > 0
            && !request_id.is_empty()
            && request_id.len() <= 64
            && request_id.bytes().all(|byte| byte.is_ascii_graphic())
            && !signed_ack_bytes.is_empty()
            && signed_ack_bytes.len() <= MAX_ACK_BYTES,
        "invalid local signer request"
    );
    let request = SignRequest {
        protocol: "XSP/2".into(),
        action: "sign-committed-receipt".into(),
        node_id,
        request_id: request_id.into(),
        signed_ack_b64: STANDARD.encode(signed_ack_bytes),
    };
    let raw_request = serde_json::to_vec(&request)?;
    ensure!(
        raw_request.len() <= MAX_SIGN_REQUEST_BYTES,
        "local signer request exceeds size limit"
    );

    let mut stream = timeout(Duration::from_secs(3), UnixStream::connect(socket_path))
        .await
        .context("signer socket connect timeout")??;
    let peer = stream.peer_cred().context("read signer peer credentials")?;
    ensure!(
        peer.uid() == SIGNER_UID && peer.gid() == SHARED_GID,
        "unexpected peer on signer socket"
    );
    timeout(Duration::from_secs(3), async {
        stream.write_all(&raw_request).await?;
        stream.shutdown().await
    })
    .await
    .context("signer request write timeout")??;

    let mut raw_response = Vec::new();
    {
        let mut limited = (&mut stream).take((MAX_SIGN_RESPONSE_BYTES + 1) as u64);
        timeout(
            Duration::from_secs(5),
            limited.read_to_end(&mut raw_response),
        )
        .await
        .context("signer response read timeout")??;
    }
    ensure!(
        !raw_response.is_empty() && raw_response.len() <= MAX_SIGN_RESPONSE_BYTES,
        "invalid signer response size"
    );
    let response: SignResponse =
        serde_json::from_slice(&raw_response).context("invalid signer response JSON")?;
    ensure!(
        response.protocol == "XSP/2"
            && response.action == "sign-committed-receipt-result"
            && response.ok
            && response.error_code.is_none(),
        "protected signer rejected the request"
    );
    let signed_receipt = response
        .signed_receipt_b64
        .context("protected signer omitted signed receipt")?;
    let bytes = STANDARD
        .decode(&signed_receipt)
        .context("protected signer receipt encoding is invalid")?;
    ensure!(
        !bytes.is_empty()
            && bytes.len() <= MAX_ACK_BYTES
            && STANDARD.encode(&bytes) == signed_receipt,
        "protected signer returned noncanonical receipt bytes"
    );
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn signer_request_parser_is_strict_and_canonical() {
        let ack = br#"{"message":{"nodeId":17}}"#;
        let valid = SignRequest {
            protocol: "XSP/2".into(),
            action: "sign-committed-receipt".into(),
            node_id: 17,
            request_id: "req-17".into(),
            signed_ack_b64: STANDARD.encode(ack),
        };
        assert_eq!(validate_request(&valid).unwrap(), ack);
        let mut invalid = valid;
        invalid.node_id = 0;
        assert!(validate_request(&invalid).is_err());
        invalid.node_id = 17;
        invalid.signed_ack_b64 = "Zh==".into();
        assert!(validate_request(&invalid).is_err());
        invalid.signed_ack_b64 = STANDARD.encode(ack);
        invalid.request_id = "has space".into();
        assert!(validate_request(&invalid).is_err());
        let unknown = json!({
            "protocol":"XSP/2","action":"sign-committed-receipt",
            "nodeId":17,"requestId":"req-17","signedAckB64":STANDARD.encode(ack),
            "privateKey":"must-not-be-accepted"
        });
        assert!(serde_json::from_value::<SignRequest>(unknown).is_err());
    }

    #[test]
    fn signer_key_id_is_stable_and_separated_by_algorithm() {
        assert_ne!(
            signer_key_id("ed-", &[7u8; 32]),
            signer_key_id("pq-", &[7u8; 32])
        );
        assert_eq!(signer_key_id("ed-", &[7u8; 32]).len(), 27);
        assert!(signer_key_id("ed-", &[7u8; 32]).starts_with("ed-"));
    }
}
