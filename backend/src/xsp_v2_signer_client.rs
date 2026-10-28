//! Client-only protected Unix-socket boundary to the isolated XSP-v2 signer.
//!
//! This module deliberately contains no signer private-key loading, signer DB
//! role, listener, or daemon entrypoint. It exists so the C2-C authorization
//! process can request a receipt without compiling signer-only authority into
//! its address space.
use anyhow::{Context, Result, ensure};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::{path::Path, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixStream,
    time::timeout,
};

use crate::xsp_v2_signed_cutover::TrustedPublic;

const MAX_SIGN_REQUEST_BYTES: usize = 32 * 1024;
const MAX_SIGN_RESPONSE_BYTES: usize = 24 * 1024;
const MAX_ACK_BYTES: usize = 16 * 1024;
const SIGNER_UID: u32 = 10_002;
const SHARED_GID: u32 = 10_001;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignRequest {
    protocol: String,
    action: String,
    node_id: i64,
    request_id: String,
    signed_ack_b64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignResponse {
    protocol: String,
    action: String,
    ok: bool,
    signed_receipt_b64: Option<String>,
    error_code: Option<String>,
}

/// Client used by the experimental C2-C process. The signer's peer UID/GID is
/// checked before any ACK bytes are sent; the outbox layer independently
/// verifies both panel signatures and locked DB bindings before persistence.
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
