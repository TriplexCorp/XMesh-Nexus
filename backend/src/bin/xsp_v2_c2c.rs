#![cfg(feature = "xsp-v2-experimental")]

#[path = "../xsp_v2_ack_epoch_commit.rs"]
mod xsp_v2_ack_epoch_commit;
#[path = "../xsp_v2_ack_ledger_validator.rs"]
mod xsp_v2_ack_ledger_validator;
#[path = "../xsp_v2_candidate_binding.rs"]
mod xsp_v2_candidate_binding;
#[path = "../xsp_v2_commit_receipt.rs"]
mod xsp_v2_commit_receipt;
#[path = "../xsp_v2_db_candidate_snapshot.rs"]
mod xsp_v2_db_candidate_snapshot;
#[path = "../xsp_v2_permit_ledger_writer.rs"]
mod xsp_v2_permit_ledger_writer;
#[path = "../xsp_v2_signed_cutover.rs"]
mod xsp_v2_signed_cutover;
#[path = "../xsp_v2_signed_receipt_outbox.rs"]
mod xsp_v2_signed_receipt_outbox;
#[path = "../xsp_v2_signer_client.rs"]
mod xsp_v2_signer;

use anyhow::{Context as _, Result, ensure};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::VerifyingKey;
use openssl::pkey::{KeyType, PKey};
use serde::Deserialize;
use sha2::{Digest as _, Sha256};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{
    env, fs,
    os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt},
    path::PathBuf,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{UnixListener, UnixStream},
    time::timeout,
};

use xsp_v2_signed_cutover::{Cutover, TrustedPublic};

const REQUEST_MAGIC: &[u8; 8] = b"XSP2C2C1";
const RECOVERY_REQUEST_MAGIC: &[u8; 8] = b"XSP2C2H1";
const RESPONSE_MAGIC: &[u8; 8] = b"XSP2C2R1";
const MAX_ACK_BYTES: usize = 16 * 1024;
const MAX_REQUEST_BYTES: usize = 8 + 8 + 4 + MAX_ACK_BYTES;
const MAX_RECEIPT_BYTES: usize = 16 * 1024;
const ORIGIN_UID: u32 = 10_004;
const ORIGIN_GID: u32 = 10_003;
const SERVICE_UID: u32 = 10_001;
const SOCKET_GROUP: u32 = 10_003;
const SOCKET_PATH_DEFAULT: &str = "/run/xmesh-c2c/c2c.sock";
const SIGNER_SOCKET_DEFAULT: &str = "/run/xmesh-signer/signer.sock";
const PANEL_PIN_DEFAULT: &str = "/run/xmesh-c2c-public/panel-pin.json";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PanelPinFile {
    issuer_id: String,
    ed25519_key_id: String,
    mldsa65_key_id: String,
    ed25519_public_b64: String,
    mldsa65_public_b64: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AckSignatures {
    ed25519: String,
    mldsa65: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AckEnvelope {
    message: Cutover,
    signatures: AckSignatures,
}

struct Config {
    pool: PgPool,
    panel_template: TrustedPublic,
    signer_socket: PathBuf,
}

fn decode_canonical_b64(value: &str, exact: usize) -> Result<Vec<u8>> {
    let bytes = STANDARD
        .decode(value)
        .context("invalid public-key Base64")?;
    ensure!(
        bytes.len() == exact && STANDARD.encode(&bytes) == value,
        "noncanonical public-key Base64"
    );
    Ok(bytes)
}

fn key_id(prefix: &str, raw: &[u8]) -> String {
    format!("{prefix}{}", hex::encode(&Sha256::digest(raw)[..12]))
}

fn load_panel_pin() -> Result<TrustedPublic> {
    let path = env::var_os("XSP_V2_C2C_PANEL_PIN_FILE")
        .map_or_else(|| PathBuf::from(PANEL_PIN_DEFAULT), PathBuf::from);
    let metadata = fs::symlink_metadata(&path)
        .with_context(|| format!("inspect C2-C panel pin file {}", path.display()))?;
    ensure!(
        metadata.file_type().is_file(),
        "panel pin must be a regular file"
    );
    ensure!(metadata.uid() == 0, "panel pin file must be root-owned");
    ensure!(
        metadata.permissions().mode() & 0o022 == 0,
        "panel pin file must not be group/world writable"
    );
    ensure!(metadata.len() <= 16 * 1024, "panel pin file too large");
    let raw = fs::read(&path).context("read C2-C panel pin file")?;
    let pin: PanelPinFile = serde_json::from_slice(&raw).context("invalid panel pin JSON")?;
    ensure!(
        !pin.issuer_id.is_empty()
            && pin.issuer_id.len() <= 64
            && pin.issuer_id.bytes().all(|byte| byte.is_ascii_graphic()),
        "invalid panel issuer ID"
    );
    let ed_public = decode_canonical_b64(&pin.ed25519_public_b64, 32)?;
    let pq_public = decode_canonical_b64(&pin.mldsa65_public_b64, 1952)?;
    let ed_array: [u8; 32] = ed_public
        .as_slice()
        .try_into()
        .context("Ed25519 public length")?;
    VerifyingKey::from_bytes(&ed_array).context("invalid Ed25519 panel public key")?;
    PKey::public_key_from_raw_bytes_ex(None, KeyType::ML_DSA_65, None, &pq_public)
        .context("invalid ML-DSA-65 panel public key/provider")?;
    ensure!(
        pin.ed25519_key_id == key_id("ed-", &ed_public)
            && pin.mldsa65_key_id == key_id("pq-", &pq_public),
        "panel pin key IDs do not match exact public bytes"
    );
    Ok(TrustedPublic {
        purpose: "panel_response".into(),
        issuer_id: pin.issuer_id,
        node_id: 1,
        ed_key_id: pin.ed25519_key_id,
        pq_key_id: pin.mldsa65_key_id,
        ed_public,
        pq_public,
    })
}

fn panel_pin_for_node(template: &TrustedPublic, node_id: i64) -> Result<TrustedPublic> {
    ensure!(node_id > 0, "invalid trusted Node ID");
    let node = u64::try_from(node_id).context("trusted Node ID overflow")?;
    ensure!(
        template.issuer_id != format!("node-{node}"),
        "panel identity must not impersonate Node"
    );
    Ok(TrustedPublic {
        purpose: template.purpose.clone(),
        issuer_id: template.issuer_id.clone(),
        node_id: node,
        ed_key_id: template.ed_key_id.clone(),
        pq_key_id: template.pq_key_id.clone(),
        ed_public: template.ed_public.clone(),
        pq_public: template.pq_public.clone(),
    })
}

async fn connect_pool() -> Result<PgPool> {
    let database_url =
        env::var("XSP_V2_C2C_DATABASE_URL").context("XSP_V2_C2C_DATABASE_URL is required")?;
    ensure!(
        !database_url.trim().is_empty(),
        "C2-C database URL is empty"
    );
    PgPoolOptions::new()
        .max_connections(8)
        .acquire_timeout(Duration::from_secs(5))
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::query("SET statement_timeout='4s'")
                    .execute(&mut *connection)
                    .await?;
                sqlx::query("SET lock_timeout='2s'")
                    .execute(connection)
                    .await?;
                Ok(())
            })
        })
        .connect(&database_url)
        .await
        .context("connect C2-C PostgreSQL role")
}

async fn validate_database_role(pool: &PgPool) -> Result<()> {
    let current_role: String = sqlx::query_scalar("SELECT current_user")
        .fetch_one(pool)
        .await?;
    ensure!(
        current_role == "xmesh_c2c_writer",
        "C2-C database role must be xmesh_c2c_writer"
    );
    let privileged: bool = sqlx::query_scalar(
        "SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
         FROM pg_roles WHERE rolname=current_user",
    )
    .fetch_one(pool)
    .await?;
    ensure!(!privileged, "C2-C database role has privileged attributes");
    let memberships: bool = sqlx::query_scalar(
        "SELECT EXISTS (
           SELECT 1 FROM pg_auth_members
           WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)
         )",
    )
    .fetch_one(pool)
    .await?;
    ensure!(
        !memberships,
        "C2-C database role must not inherit or SET ROLE"
    );
    let excessive: bool = sqlx::query_scalar(
        "SELECT has_database_privilege(current_database(), 'CREATE')
          OR has_database_privilege(current_database(), 'TEMP')
          OR has_schema_privilege('public', 'CREATE')
          OR EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
              AND ((c.relname NOT IN ('node_xsp_suite_state','node_xsp_public_keysets',
                     'node_xsp_rotation_preparations','node_xsp_replay_nonces',
                     'node_xsp_cutover_permit_ledger','node_xsp_signed_commit_receipt_outbox')
                    AND (has_table_privilege(c.oid,'SELECT') OR has_any_column_privilege(c.oid,'SELECT')))
                OR has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
          OR EXISTS (
            SELECT 1 FROM pg_attribute a
            JOIN pg_class c ON c.oid=a.attrelid
            JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind IN ('r','p')
              AND a.attnum>0 AND NOT a.attisdropped
              AND ((has_column_privilege(c.oid,a.attnum,'UPDATE') AND NOT (
                    (c.relname='node_xsp_suite_state' AND a.attname='key_epoch') OR
                    (c.relname='node_xsp_cutover_permit_ledger' AND a.attname IN
                       ('state','applied_ack_sha256','signed_applied_ack','ack_verified_at'))))
                OR (has_column_privilege(c.oid,a.attnum,'INSERT') AND NOT (
                    (c.relname='node_xsp_public_keysets' AND a.attname IN
                       ('node_id','purpose','key_epoch','ed25519_key_id','mldsa65_key_id','ed25519_public','mldsa65_public')) OR
                    (c.relname='node_xsp_replay_nonces' AND a.attname IN
                       ('node_id','key_epoch','direction','nonce','request_id')) OR
                    (c.relname='node_xsp_signed_commit_receipt_outbox' AND a.attname IN
                       ('node_id','request_id','from_epoch','to_epoch','permit_input_sha256',
                        'applied_ack_sha256','signed_receipt_sha256','signed_receipt'))))))
          OR EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind='S'
              AND CASE WHEN c.relkind='S'
                  THEN has_sequence_privilege(c.oid,'USAGE,SELECT,UPDATE') ELSE false END)
          OR EXISTS (
            SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege(p.oid,'EXECUTE'))",
    )
    .fetch_one(pool)
    .await?;
    ensure!(
        !excessive,
        "C2-C database role has excessive effective privileges"
    );
    Ok(())
}

fn bind_socket() -> Result<(PathBuf, UnixListener)> {
    let socket_path = env::var_os("XSP_V2_C2C_SOCKET_PATH")
        .map_or_else(|| PathBuf::from(SOCKET_PATH_DEFAULT), PathBuf::from);
    ensure!(
        socket_path.is_absolute(),
        "C2-C socket path must be absolute"
    );
    let parent = socket_path
        .parent()
        .context("C2-C socket requires parent")?;
    let metadata = fs::symlink_metadata(parent).context("inspect C2-C socket directory")?;
    ensure!(
        metadata.file_type().is_dir()
            && metadata.uid() == SERVICE_UID
            && metadata.gid() == SOCKET_GROUP
            && metadata.permissions().mode() & 0o7777 == 0o2750,
        "C2-C socket directory must be service-owned 2750 with origin group"
    );
    match fs::symlink_metadata(&socket_path) {
        Ok(existing) => {
            ensure!(
                existing.file_type().is_socket()
                    && existing.uid() == SERVICE_UID
                    && existing.gid() == SOCKET_GROUP,
                "existing C2-C socket path is not owned protected socket"
            );
            fs::remove_file(&socket_path).context("remove stale C2-C socket")?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error).context("inspect old C2-C socket"),
    }
    let listener = UnixListener::bind(&socket_path).context("bind C2-C socket")?;
    fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o660))
        .context("set C2-C socket permissions")?;
    let socket_meta = fs::symlink_metadata(&socket_path)?;
    ensure!(
        socket_meta.uid() == SERVICE_UID && socket_meta.gid() == SOCKET_GROUP,
        "C2-C socket did not inherit protected origin group"
    );
    Ok((socket_path, listener))
}

fn parse_request(raw: &[u8]) -> Result<(i64, Vec<u8>, bool)> {
    ensure!(
        raw.len() >= 20 && raw.len() <= MAX_REQUEST_BYTES,
        "invalid C2-C request size"
    );
    let recovery = if &raw[..8] == RECOVERY_REQUEST_MAGIC {
        true
    } else {
        ensure!(&raw[..8] == REQUEST_MAGIC, "invalid C2-C request domain");
        false
    };
    let node_raw: [u8; 8] = raw[8..16].try_into().context("invalid Node field")?;
    let node_u64 = u64::from_be_bytes(node_raw);
    let node_id = i64::try_from(node_u64).context("trusted Node ID exceeds PostgreSQL range")?;
    ensure!(node_id > 0, "invalid trusted Node ID");
    let len_raw: [u8; 4] = raw[16..20].try_into().context("invalid ACK length")?;
    let ack_len = usize::try_from(u32::from_be_bytes(len_raw)).context("ACK length overflow")?;
    ensure!(
        ack_len > 0 && ack_len <= MAX_ACK_BYTES,
        "invalid ACK length"
    );
    ensure!(
        raw.len() == 20 + ack_len,
        "trailing or truncated C2-C request bytes"
    );
    Ok((node_id, raw[20..].to_vec(), recovery))
}

fn ack_context(raw: &[u8], trusted_node_id: i64) -> Result<String> {
    let envelope: AckEnvelope = serde_json::from_slice(raw).context("invalid signed ACK JSON")?;
    ensure!(
        !envelope.signatures.ed25519.is_empty() && !envelope.signatures.mldsa65.is_empty(),
        "ACK signatures missing"
    );
    let message = envelope.message;
    let trusted_u64 = u64::try_from(trusted_node_id).context("trusted Node ID conversion")?;
    ensure!(
        message.kind == "ack"
            && message.node_id == trusted_u64
            && message.issuer_id == format!("node-{trusted_u64}")
            && message.method == "POST"
            && message.path == "/api/v2/node/keys/rotation/ack"
            && !message.request_id.is_empty()
            && message.request_id.len() <= 64
            && message
                .request_id
                .bytes()
                .all(|byte| byte.is_ascii_graphic()),
        "ACK is not bound to trusted local transport identity"
    );
    Ok(message.request_id)
}

fn now_ms() -> Result<i64> {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .context("system clock before Unix epoch")?
            .as_millis(),
    )
    .context("system time overflow")
}

async fn authorize_and_receipt(config: &Config, node_id: i64, ack: &[u8]) -> Result<Vec<u8>> {
    let request_id = ack_context(ack, node_id)?;
    let pin = panel_pin_for_node(&config.panel_template, node_id)?;
    let current_ms = now_ms()?;
    match xsp_v2_ack_epoch_commit::commit_fresh_applied_ack_staging(
        &config.pool,
        node_id,
        &request_id,
        ack,
        &pin,
        current_ms,
    )
    .await
    {
        Ok(_) => {}
        Err(fresh_error) => {
            xsp_v2_ack_epoch_commit::readback_committed_applied_ack_staging(
                &config.pool,
                node_id,
                &request_id,
                ack,
                &pin,
            )
            .await
            .with_context(|| format!("fresh ACK commit rejected: {fresh_error:#}"))?;
        }
    }
    xsp_v2_signed_receipt_outbox::issue_or_recover_via_protected_signer_staging(
        &config.pool,
        node_id,
        &request_id,
        ack,
        &pin,
        &config.signer_socket,
    )
    .await
}

async fn recover_durable_receipt(config: &Config, node_id: i64, ack: &[u8]) -> Result<Vec<u8>> {
    let request_id = ack_context(ack, node_id)?;
    let pin = panel_pin_for_node(&config.panel_template, node_id)?;
    xsp_v2_signed_receipt_outbox::load_committed_signed_receipt_staging(
        &config.pool,
        node_id,
        &request_id,
        ack,
        &pin,
    )
    .await
}

fn response(ok: bool, payload: &[u8]) -> Result<Vec<u8>> {
    ensure!(
        payload.len() <= MAX_RECEIPT_BYTES,
        "C2-C response payload too large"
    );
    let mut out = Vec::with_capacity(13 + payload.len());
    out.extend_from_slice(RESPONSE_MAGIC);
    out.push(u8::from(ok));
    out.extend_from_slice(&u32::try_from(payload.len())?.to_be_bytes());
    out.extend_from_slice(payload);
    Ok(out)
}

async fn serve_connection(mut stream: UnixStream, config: Arc<Config>) -> Result<()> {
    let peer = stream
        .peer_cred()
        .context("read C2-C origin peer credentials")?;
    ensure!(
        peer.uid() == ORIGIN_UID && peer.gid() == ORIGIN_GID,
        "unexpected process credentials on C2-C socket"
    );
    let mut raw = Vec::new();
    {
        let mut limited = (&mut stream).take((MAX_REQUEST_BYTES + 1) as u64);
        timeout(Duration::from_secs(3), limited.read_to_end(&mut raw))
            .await
            .context("C2-C request read timeout")??;
    }
    let outcome = async {
        let (node_id, ack, recovery) = parse_request(&raw)?;
        timeout(Duration::from_secs(10), async {
            if recovery {
                recover_durable_receipt(&config, node_id, &ack).await
            } else {
                authorize_and_receipt(&config, node_id, &ack).await
            }
        })
        .await
        .context("C2-C authorization deadline exceeded")?
    }
    .await;
    let bytes = match outcome {
        Ok(receipt) => response(true, &receipt)?,
        Err(_) => response(false, &[])?,
    };
    timeout(Duration::from_secs(3), async {
        stream.write_all(&bytes).await?;
        stream.shutdown().await
    })
    .await
    .context("C2-C response write timeout")??;
    Ok(())
}

async fn run() -> Result<()> {
    ensure!(
        env::var("XSP_V2_C2C_ACK_AUTH").as_deref() == Ok("staging-only"),
        "C2-C service requires XSP_V2_C2C_ACK_AUTH=staging-only"
    );
    let panel_template = load_panel_pin()?;
    let pool = connect_pool().await?;
    validate_database_role(&pool).await?;
    let signer_socket = env::var_os("XSP_V2_SIGNER_SOCKET_PATH")
        .map_or_else(|| PathBuf::from(SIGNER_SOCKET_DEFAULT), PathBuf::from);
    ensure!(
        signer_socket.is_absolute(),
        "signer socket path must be absolute"
    );
    let (socket_path, listener) = bind_socket()?;
    let config = Arc::new(Config {
        pool,
        panel_template,
        signer_socket,
    });
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init()
        .ok();
    tracing::info!(socket = %socket_path.display(), "XSP-v2 C2-C local authorization service ready");
    loop {
        let (stream, _) = listener.accept().await.context("accept C2-C connection")?;
        let config = Arc::clone(&config);
        tokio::spawn(async move {
            if serve_connection(stream, config).await.is_err() {
                tracing::warn!("XSP-v2 C2-C local request rejected");
            }
        });
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    run().await
}
