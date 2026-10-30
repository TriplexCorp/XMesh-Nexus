#![cfg(feature = "xsp-v2-experimental")]

#[path = "../xsp_v2_candidate_binding.rs"]
mod xsp_v2_candidate_binding;
#[path = "../xsp_v2_db_candidate_snapshot.rs"]
mod xsp_v2_db_candidate_snapshot;
#[path = "../xsp_v2_permit_ledger_writer.rs"]
mod xsp_v2_permit_ledger_writer;
#[path = "../xsp_v2_signed_cutover.rs"]
mod xsp_v2_signed_cutover;

use anyhow::{Context, Result, ensure};
use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordVerifier},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::VerifyingKey;
use openssl::pkey::{KeyType, PKey};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use std::{
    env, fs,
    io::{self, BufRead},
    os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixStream,
    time::timeout,
};
use uuid::Uuid;

use xsp_v2_db_candidate_snapshot::load_locked_candidate;
use xsp_v2_signed_cutover::TrustedPublic;

const SOCKET_PATH_DEFAULT: &str = "/run/xmesh-permit-signer/permit.sock";
const PANEL_PIN_DEFAULT: &str = "/run/xmesh-permit-public/panel-pin.json";
const MAX_REQUEST_BYTES: usize = 8 * 1024;
const MAX_RESPONSE_BYTES: usize = 24 * 1024;
const SIGNER_UID: u32 = 10_006;
const SIGNER_GID: u32 = 10_001;
const SOCKET_GROUP: u32 = 10_005;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignRequest {
    protocol: String,
    action: String,
    node_id: i64,
    request_id: String,
    authenticated_owner: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignResponse {
    protocol: String,
    action: String,
    ok: bool,
    signed_permit_b64: Option<String>,
    error_code: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PanelPinFile {
    issuer_id: String,
    ed25519_key_id: String,
    mldsa65_key_id: String,
    ed25519_public_b64: String,
    mldsa65_public_b64: String,
}

struct Args {
    node_id: i64,
    owner: String,
    request_id: String,
}

const fn usage() -> &'static str {
    "usage: xsp-v2-permit-operator --node NODE_ID --owner OWNER [--request-id ASCII_ID]\n\
Reads the owner password from stdin. Never pass the password as an argument or environment variable."
}

fn parse_args() -> Result<Args> {
    let mut values = env::args().skip(1);
    let mut node_id = None;
    let mut owner = None;
    let mut request_id = None;
    while let Some(flag) = values.next() {
        match flag.as_str() {
            "--node" => {
                let value = values.next().context("--node requires a value")?;
                node_id = Some(value.parse::<i64>().context("invalid --node")?);
            }
            "--owner" => owner = Some(values.next().context("--owner requires a value")?),
            "--request-id" => {
                request_id = Some(values.next().context("--request-id requires a value")?);
            }
            "--help" | "-h" => anyhow::bail!(usage()),
            _ => anyhow::bail!("unknown argument {flag}\n{}", usage()),
        }
    }
    let node_id = node_id.context("--node is required")?;
    let owner = owner.context("--owner is required")?;
    ensure!(node_id > 0, "Node ID must be positive");
    ensure!(
        !owner.is_empty()
            && owner.len() <= 128
            && owner.bytes().all(|byte| byte.is_ascii_graphic()),
        "owner must be 1..128 printable ASCII bytes"
    );
    let request_id = request_id.unwrap_or_else(|| format!("cutover-{}", Uuid::new_v4().simple()));
    ensure!(
        !request_id.is_empty()
            && request_id.len() <= 64
            && request_id.bytes().all(|byte| byte.is_ascii_graphic()),
        "request ID must be 1..64 printable ASCII bytes"
    );
    Ok(Args {
        node_id,
        owner,
        request_id,
    })
}

fn read_password() -> Result<String> {
    let mut password = String::new();
    io::stdin()
        .lock()
        .read_line(&mut password)
        .context("read owner password from stdin")?;
    while matches!(password.as_bytes().last(), Some(b'\n' | b'\r')) {
        password.pop();
    }
    ensure!(
        !password.is_empty() && password.len() <= 1024,
        "invalid owner password input"
    );
    Ok(password)
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

fn key_id(prefix: &str, public: &[u8]) -> String {
    format!("{prefix}{}", hex::encode(&Sha256::digest(public)[..12]))
}

fn decode_canonical_b64(value: &str, exact: usize) -> Result<Vec<u8>> {
    let raw = STANDARD.decode(value).context("invalid panel pin Base64")?;
    ensure!(
        raw.len() == exact && STANDARD.encode(&raw) == value,
        "noncanonical panel pin Base64"
    );
    Ok(raw)
}

fn load_panel_pin(path: &Path, node_id: i64) -> Result<TrustedPublic> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("inspect panel pin {}", path.display()))?;
    ensure!(
        metadata.file_type().is_file(),
        "panel pin must be a regular file"
    );
    ensure!(metadata.uid() == 0, "panel pin must be root-owned");
    ensure!(
        metadata.permissions().mode() & 0o022 == 0,
        "panel pin must not be group/world writable"
    );
    ensure!(metadata.len() <= 16 * 1024, "panel pin file too large");
    let pin: PanelPinFile = serde_json::from_slice(&fs::read(path).context("read panel pin")?)
        .context("invalid panel pin JSON")?;
    ensure!(
        !pin.issuer_id.is_empty()
            && pin.issuer_id.len() <= 64
            && pin.issuer_id.bytes().all(|byte| byte.is_ascii_graphic()),
        "invalid panel pin issuer"
    );
    let ed_public = decode_canonical_b64(&pin.ed25519_public_b64, 32)?;
    let pq_public = decode_canonical_b64(&pin.mldsa65_public_b64, 1952)?;
    let ed_array: [u8; 32] = ed_public
        .as_slice()
        .try_into()
        .context("panel Ed25519 length")?;
    VerifyingKey::from_bytes(&ed_array).context("invalid panel Ed25519 public key")?;
    PKey::public_key_from_raw_bytes_ex(None, KeyType::ML_DSA_65, None, &pq_public)
        .context("invalid panel ML-DSA-65 public key/provider")?;
    ensure!(
        pin.ed25519_key_id == key_id("ed-", &ed_public)
            && pin.mldsa65_key_id == key_id("pq-", &pq_public),
        "panel pin key IDs do not match exact public bytes"
    );
    let node_id = u64::try_from(node_id).context("panel pin Node ID overflow")?;
    ensure!(
        pin.issuer_id != format!("node-{node_id}"),
        "panel pin issuer impersonates Node"
    );
    Ok(TrustedPublic {
        purpose: "panel_response".into(),
        issuer_id: pin.issuer_id,
        node_id,
        ed_key_id: pin.ed25519_key_id,
        pq_key_id: pin.mldsa65_key_id,
        ed_public,
        pq_public,
    })
}

async fn connect_pool() -> Result<PgPool> {
    let database_url = env::var("DATABASE_URL").context("DATABASE_URL is required")?;
    PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::query("SET statement_timeout='5s'")
                    .execute(&mut *connection)
                    .await?;
                sqlx::query("SET lock_timeout='3s'")
                    .execute(connection)
                    .await?;
                Ok(())
            })
        })
        .connect(&database_url)
        .await
        .context("connect protected permit operator database")
}

async fn validate_database_identity(pool: &PgPool) -> Result<()> {
    let current_user: String = sqlx::query_scalar("SELECT current_user")
        .fetch_one(pool)
        .await?;
    ensure!(
        current_user == "xmesh_app",
        "protected permit operator must use xmesh_app database role"
    );
    let privileged: bool = sqlx::query_scalar(
        "SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
         FROM pg_roles WHERE rolname=current_user",
    )
    .fetch_one(pool)
    .await?;
    ensure!(
        !privileged,
        "protected permit operator database role is privileged"
    );
    Ok(())
}

fn inspect_socket(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("inspect permit signer socket {}", path.display()))?;
    ensure!(
        metadata.file_type().is_socket(),
        "permit signer path is not a Unix socket"
    );
    ensure!(
        metadata.uid() == SIGNER_UID
            && metadata.gid() == SOCKET_GROUP
            && metadata.permissions().mode() & 0o777 == 0o660,
        "permit signer socket ownership or mode is invalid"
    );
    Ok(())
}

async fn request_signed_permit(
    socket_path: &Path,
    node_id: i64,
    request_id: &str,
    owner: &str,
) -> Result<Vec<u8>> {
    inspect_socket(socket_path)?;
    let request = SignRequest {
        protocol: "XSP/2".into(),
        action: "sign-approved-permit".into(),
        node_id,
        request_id: request_id.into(),
        authenticated_owner: owner.into(),
    };
    let raw = serde_json::to_vec(&request)?;
    ensure!(
        raw.len() <= MAX_REQUEST_BYTES,
        "permit signer request too large"
    );
    let mut stream = timeout(Duration::from_secs(3), UnixStream::connect(socket_path))
        .await
        .context("permit signer socket connect timeout")??;
    let peer = stream
        .peer_cred()
        .context("read permit signer peer credentials")?;
    ensure!(
        peer.uid() == SIGNER_UID && peer.gid() == SIGNER_GID,
        "unexpected peer on permit signer socket"
    );
    timeout(Duration::from_secs(3), async {
        stream.write_all(&raw).await?;
        stream.shutdown().await
    })
    .await
    .context("permit signer request write timeout")??;
    let mut response_raw = Vec::new();
    {
        let mut limited = (&mut stream).take((MAX_RESPONSE_BYTES + 1) as u64);
        timeout(
            Duration::from_secs(6),
            limited.read_to_end(&mut response_raw),
        )
        .await
        .context("permit signer response read timeout")??;
    }
    ensure!(
        !response_raw.is_empty() && response_raw.len() <= MAX_RESPONSE_BYTES,
        "invalid permit signer response size"
    );
    let response: SignResponse =
        serde_json::from_slice(&response_raw).context("invalid permit signer response JSON")?;
    ensure!(
        response.protocol == "XSP/2"
            && response.action == "sign-approved-permit-result"
            && response.ok
            && response.error_code.is_none(),
        "protected permit signer rejected the request"
    );
    let encoded = response
        .signed_permit_b64
        .context("permit signer omitted signed permit")?;
    let permit = STANDARD
        .decode(&encoded)
        .context("invalid signed permit Base64")?;
    ensure!(
        !permit.is_empty() && permit.len() <= 16 * 1024 && STANDARD.encode(&permit) == encoded,
        "permit signer returned noncanonical permit bytes"
    );
    Ok(permit)
}

#[tokio::main]
async fn main() -> Result<()> {
    ensure!(
        env::var("XSP_V2_PROTECTED_PERMIT_OPERATOR").as_deref() == Ok("staging-only"),
        "operator requires XSP_V2_PROTECTED_PERMIT_OPERATOR=staging-only"
    );
    let args = parse_args()?;
    let mut password = read_password()?;
    let pool = connect_pool().await?;
    validate_database_identity(&pool).await?;
    let pin_path = env::var_os("XSP_V2_PERMIT_PANEL_PIN_FILE")
        .map_or_else(|| PathBuf::from(PANEL_PIN_DEFAULT), PathBuf::from);
    let signer_socket = env::var_os("XSP_V2_PERMIT_SIGNER_SOCKET_PATH")
        .map_or_else(|| PathBuf::from(SOCKET_PATH_DEFAULT), PathBuf::from);
    let panel_pin = load_panel_pin(&pin_path, args.node_id)?;

    let mut tx = pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut *tx)
        .await?;
    let account = sqlx::query(
        "SELECT username,role,password_hash,is_active
         FROM panel_auth_users WHERE username=$1 FOR UPDATE",
    )
    .bind(&args.owner)
    .fetch_optional(&mut *tx)
    .await?
    .context("owner account not found")?;
    let username: String = account.try_get("username")?;
    let role: String = account.try_get("role")?;
    let password_hash: String = account.try_get("password_hash")?;
    let active: bool = account.try_get("is_active")?;
    ensure!(
        active && role == "owner" && username == args.owner,
        "operator account is not an active owner"
    );
    let parsed_hash = PasswordHash::new(&password_hash)
        .map_err(|_| anyhow::anyhow!("invalid stored owner password hash"))?;
    let password_ok = Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok();
    password.clear();
    ensure!(password_ok, "owner authentication failed");

    let snapshot = load_locked_candidate(&mut tx, args.node_id).await?;
    ensure!(
        snapshot.approved_by == args.owner,
        "authenticated owner differs from candidate approver"
    );
    let from_epoch = snapshot.material.from_epoch;
    let to_epoch = snapshot.material.to_epoch;
    let candidate_sha256_hex = snapshot.candidate_sha256_hex.clone();

    let signed_permit =
        request_signed_permit(&signer_socket, args.node_id, &args.request_id, &args.owner).await?;
    let verified_at_ms = now_ms()?;
    let stored = xsp_v2_permit_ledger_writer::persist_verified_permit(
        &mut tx,
        args.node_id,
        &args.owner,
        &args.request_id,
        &signed_permit,
        &panel_pin,
        verified_at_ms,
    )
    .await?;
    tx.commit()
        .await
        .context("commit protected permit transaction")?;

    println!(
        "{}",
        serde_json::to_string(&json!({
            "schema":"xsp2-protected-permit-operator-result-1",
            "nodeId":args.node_id,
            "requestId":args.request_id,
            "approvedBy":args.owner,
            "fromEpoch":from_epoch,
            "toEpoch":to_epoch,
            "candidateSha256Hex":candidate_sha256_hex,
            "permitInputSha256Hex":stored.canonical_sha256_hex,
            "signedPermitB64":STANDARD.encode(&stored.signed_bytes),
            "reused":stored.reused,
            "cutoverAuthorized":true,
            "strictActivated":false,
            "productionActivation":false
        }))?
    );
    Ok(())
}
