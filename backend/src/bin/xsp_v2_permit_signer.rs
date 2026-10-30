#![cfg(feature = "xsp-v2-experimental")]

#[path = "../xsp_v2_candidate_binding.rs"]
mod xsp_v2_candidate_binding;
#[path = "../xsp_v2_signed_cutover.rs"]
mod xsp_v2_signed_cutover;

use anyhow::{Context, Result, ensure};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{SigningKey, VerifyingKey};
use openssl::pkey::{KeyType, PKey, Private};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use std::{
    env, fs,
    os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{UnixListener, UnixStream},
    time::timeout,
};
use uuid::Uuid;

use xsp_v2_candidate_binding::{CandidatePublic, candidate_sha256};
use xsp_v2_signed_cutover::{Cutover, TrustedPublic, sign_staging_permit};

const SOCKET_PATH_DEFAULT: &str = "/run/xmesh-permit-signer/permit.sock";
const ED25519_KEY_PATH_DEFAULT: &str = "/run/xmesh-signer-keys/panel-ed25519.pem";
const MLDSA65_KEY_PATH_DEFAULT: &str = "/run/xmesh-signer-keys/panel-mldsa65.pem";
const MAX_REQUEST_BYTES: usize = 8 * 1024;
const MAX_RESPONSE_BYTES: usize = 24 * 1024;
const SIGNER_UID: u32 = 10_006;
const SIGNER_KEY_GID: u32 = 10_001;
const OPERATOR_UID: u32 = 10_007;
const OPERATOR_GID: u32 = 10_005;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignRequest {
    protocol: String,
    action: String,
    node_id: i64,
    request_id: String,
    authenticated_owner: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignResponse {
    protocol: String,
    action: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    signed_permit_b64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
}

struct SigningMaterial {
    ed25519: SigningKey,
    mldsa65: PKey<Private>,
    panel_pin_template: TrustedPublic,
}

struct ApprovedCandidate {
    material: CandidatePublic,
    candidate_sha256_hex: String,
    preparation_expires_at_ms: i64,
}

fn key_id(prefix: &str, public: &[u8]) -> String {
    format!("{prefix}{}", hex::encode(&Sha256::digest(public)[..12]))
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

fn read_private_key_file(path: &Path) -> Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("inspect permit signer key file {}", path.display()))?;
    ensure!(
        metadata.file_type().is_file(),
        "permit signer key path must be a regular file"
    );
    ensure!(
        metadata.uid() == 0 && metadata.gid() == SIGNER_KEY_GID,
        "permit signer key file must be root-owned and assigned to xmesh signer group"
    );
    let mode = metadata.permissions().mode() & 0o777;
    ensure!(
        mode & 0o027 == 0 && mode & 0o0100 == 0 && mode & 0o0040 != 0,
        "permit signer key file must be group-readable only"
    );
    ensure!(
        metadata.nlink() == 1,
        "permit signer key file must have one hard link"
    );
    fs::read(path).with_context(|| format!("read permit signer key file {}", path.display()))
}

fn load_signing_material() -> Result<SigningMaterial> {
    let ed_path = env::var_os("XSP_V2_PERMIT_SIGNER_ED25519_KEY_FILE")
        .map_or_else(|| PathBuf::from(ED25519_KEY_PATH_DEFAULT), PathBuf::from);
    let pq_path = env::var_os("XSP_V2_PERMIT_SIGNER_MLDSA65_KEY_FILE")
        .map_or_else(|| PathBuf::from(MLDSA65_KEY_PATH_DEFAULT), PathBuf::from);

    let ed_pem = read_private_key_file(&ed_path)?;
    let ed_key = PKey::private_key_from_pem(&ed_pem).context("load permit Ed25519 PEM")?;
    let ed_seed: [u8; 32] = ed_key
        .raw_private_key()
        .context("extract permit Ed25519 seed")?
        .try_into()
        .map_err(|_| anyhow::anyhow!("permit Ed25519 seed must be 32 bytes"))?;
    let ed25519 = SigningKey::from_bytes(&ed_seed);
    let ed_public = ed25519.verifying_key().to_bytes().to_vec();
    ensure!(
        ed_key
            .raw_public_key()
            .context("read permit Ed25519 public key")?
            == ed_public,
        "permit Ed25519 PEM pair mismatch"
    );

    let pq_pem = read_private_key_file(&pq_path)?;
    let mldsa65 = PKey::private_key_from_pem(&pq_pem).context("load permit ML-DSA-65 PEM")?;
    let public_der = mldsa65
        .public_key_to_der()
        .context("derive permit ML-DSA public key")?;
    ensure!(
        public_der.len() >= 1952,
        "permit ML-DSA public DER too short"
    );
    let pq_public = public_der[public_der.len() - 1952..].to_vec();
    PKey::public_key_from_raw_bytes_ex(None, KeyType::ML_DSA_65, None, &pq_public)
        .context("validate permit ML-DSA-65 public key")?;

    let ed_key_id = key_id("ed-", &ed_public);
    let pq_key_id = key_id("pq-", &pq_public);
    ensure!(
        env::var("XSP_V2_PERMIT_SIGNER_EXPECTED_ED_KEY_ID")
            .as_deref()
            .is_ok_and(|value| value == ed_key_id),
        "permit signer Ed25519 key ID does not match owner-approved pin"
    );
    ensure!(
        env::var("XSP_V2_PERMIT_SIGNER_EXPECTED_PQ_KEY_ID")
            .as_deref()
            .is_ok_and(|value| value == pq_key_id),
        "permit signer ML-DSA key ID does not match owner-approved pin"
    );
    let issuer_id = env::var("XSP_V2_PERMIT_SIGNER_ISSUER_ID")
        .context("XSP_V2_PERMIT_SIGNER_ISSUER_ID is required")?;
    ensure!(
        !issuer_id.is_empty()
            && issuer_id.len() <= 64
            && issuer_id.bytes().all(|byte| byte.is_ascii_graphic()),
        "invalid permit signer issuer ID"
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

fn panel_pin_for_node(template: &TrustedPublic, node_id: i64) -> Result<TrustedPublic> {
    ensure!(node_id > 0, "invalid permit Node ID");
    let node_id = u64::try_from(node_id).context("permit Node ID overflow")?;
    ensure!(
        template.issuer_id != format!("node-{node_id}"),
        "panel issuer impersonates Node"
    );
    Ok(TrustedPublic {
        purpose: template.purpose.clone(),
        issuer_id: template.issuer_id.clone(),
        node_id,
        ed_key_id: template.ed_key_id.clone(),
        pq_key_id: template.pq_key_id.clone(),
        ed_public: template.ed_public.clone(),
        pq_public: template.pq_public.clone(),
    })
}

fn validate_public(ed: &[u8], pq: &[u8], ed_id: &str, pq_id: &str) -> Result<()> {
    ensure!(
        ed.len() == 32 && pq.len() == 1952,
        "invalid candidate public key lengths"
    );
    ensure!(
        key_id("ed-", ed) == ed_id && key_id("pq-", pq) == pq_id,
        "candidate public key fingerprint mismatch"
    );
    let ed_array: [u8; 32] = ed.try_into().context("candidate Ed25519 length")?;
    VerifyingKey::from_bytes(&ed_array).context("candidate Ed25519 invalid")?;
    PKey::public_key_from_raw_bytes_ex(None, KeyType::ML_DSA_65, None, pq)
        .context("candidate ML-DSA-65 invalid")?;
    Ok(())
}

async fn load_approved_candidate(
    pool: &PgPool,
    node_id: i64,
    authenticated_owner: &str,
) -> Result<ApprovedCandidate> {
    let row = sqlx::query(
        "SELECT s.minimum_suite,s.activation_phase,s.key_epoch,
                a.ed25519_key_id AS from_ed_key_id,
                a.mldsa65_key_id AS from_pq_key_id,
                a.ed25519_public AS from_ed_public,
                a.mldsa65_public AS from_pq_public,
                p.from_epoch,p.to_epoch,
                p.ed25519_key_id AS to_ed_key_id,
                p.mldsa65_key_id AS to_pq_key_id,
                p.ed25519_public AS to_ed_public,
                p.mldsa65_public AS to_pq_public,
                p.approved_by,
                floor(EXTRACT(EPOCH FROM p.expires_at)*1000)::bigint AS prep_expires_ms
         FROM node_xsp_suite_state s
         JOIN node_xsp_public_keysets a
           ON a.node_id=s.node_id AND a.purpose='node_request'
          AND a.key_epoch=s.key_epoch AND a.revoked_at IS NULL
         JOIN node_xsp_rotation_preparations p
           ON p.node_id=s.node_id AND p.purpose='node_request'
          AND p.from_epoch=s.key_epoch AND p.to_epoch=s.key_epoch+1
          AND p.proved_at IS NOT NULL AND p.expires_at>NOW()
         WHERE s.node_id=$1",
    )
    .bind(node_id)
    .fetch_optional(pool)
    .await?
    .context("approved proved candidate is absent or expired")?;

    let floor: i16 = row.try_get("minimum_suite")?;
    let phase: String = row.try_get("activation_phase")?;
    let from_epoch: i64 = row.try_get("from_epoch")?;
    let to_epoch: i64 = row.try_get("to_epoch")?;
    let suite_epoch: i64 = row.try_get("key_epoch")?;
    let approved_by: String = row.try_get("approved_by")?;
    ensure!(
        floor == 1
            && matches!(phase.as_str(), "dual_enrolled" | "shadow")
            && from_epoch == suite_epoch
            && from_epoch > 0
            && from_epoch.checked_add(1) == Some(to_epoch),
        "candidate suite state is not eligible for staged permit"
    );
    ensure!(
        approved_by == authenticated_owner,
        "permit owner differs from approved candidate owner"
    );

    let from_ed_key_id: String = row.try_get("from_ed_key_id")?;
    let from_pq_key_id: String = row.try_get("from_pq_key_id")?;
    let to_ed_key_id: String = row.try_get("to_ed_key_id")?;
    let to_pq_key_id: String = row.try_get("to_pq_key_id")?;
    let from_ed_public: Vec<u8> = row.try_get("from_ed_public")?;
    let from_pq_public: Vec<u8> = row.try_get("from_pq_public")?;
    let to_ed_public: Vec<u8> = row.try_get("to_ed_public")?;
    let to_pq_public: Vec<u8> = row.try_get("to_pq_public")?;
    ensure!(
        from_ed_key_id != to_ed_key_id && from_pq_key_id != to_pq_key_id,
        "candidate reuses active key IDs"
    );
    validate_public(
        &from_ed_public,
        &from_pq_public,
        &from_ed_key_id,
        &from_pq_key_id,
    )?;
    validate_public(&to_ed_public, &to_pq_public, &to_ed_key_id, &to_pq_key_id)?;

    let material = CandidatePublic {
        node_id: u64::try_from(node_id)?,
        from_epoch: u64::try_from(from_epoch)?,
        to_epoch: u64::try_from(to_epoch)?,
        purpose: "node_request".into(),
        from_ed_key_id,
        from_pq_key_id,
        to_ed_key_id,
        to_pq_key_id,
        active_ed_public: from_ed_public,
        active_pq_public: from_pq_public,
        pending_ed_public: to_ed_public,
        pending_pq_public: to_pq_public,
    };
    let candidate_sha256_hex =
        hex::encode(candidate_sha256(&material).map_err(anyhow::Error::msg)?);
    let preparation_expires_at_ms: i64 = row.try_get("prep_expires_ms")?;
    Ok(ApprovedCandidate {
        material,
        candidate_sha256_hex,
        preparation_expires_at_ms,
    })
}

fn validate_request(request: &SignRequest) -> Result<()> {
    ensure!(
        request.protocol == "XSP/2",
        "invalid permit signer protocol"
    );
    ensure!(
        request.action == "sign-approved-permit",
        "invalid permit signer action"
    );
    ensure!(
        request.node_id > 0
            && !request.request_id.is_empty()
            && request.request_id.len() <= 64
            && request
                .request_id
                .bytes()
                .all(|byte| byte.is_ascii_graphic()),
        "invalid permit request identity"
    );
    ensure!(
        !request.authenticated_owner.is_empty()
            && request.authenticated_owner.len() <= 128
            && request
                .authenticated_owner
                .bytes()
                .all(|byte| byte.is_ascii_graphic()),
        "invalid authenticated owner identity"
    );
    Ok(())
}

async fn sign_approved_permit(
    pool: &PgPool,
    keys: &SigningMaterial,
    request: &SignRequest,
) -> Result<Vec<u8>> {
    validate_request(request)?;
    let candidate =
        load_approved_candidate(pool, request.node_id, &request.authenticated_owner).await?;

    if let Some(existing) = sqlx::query(
        "SELECT signed_permit,issued_by,state
         FROM node_xsp_cutover_permit_ledger
         WHERE node_id=$1 AND request_id=$2",
    )
    .bind(request.node_id)
    .bind(&request.request_id)
    .fetch_optional(pool)
    .await?
    {
        let issued_by: String = existing.try_get("issued_by")?;
        let state: String = existing.try_get("state")?;
        let signed_permit: Vec<u8> = existing.try_get("signed_permit")?;
        ensure!(
            issued_by == request.authenticated_owner && state != "aborted",
            "stored permit is not reusable"
        );
        ensure!(
            !signed_permit.is_empty() && signed_permit.len() <= 16 * 1024,
            "stored permit invalid"
        );
        return Ok(signed_permit);
    }

    let other_issued: bool = sqlx::query_scalar(
        "SELECT EXISTS(
           SELECT 1 FROM node_xsp_cutover_permit_ledger
           WHERE node_id=$1 AND state='issued'
         )",
    )
    .bind(request.node_id)
    .fetch_one(pool)
    .await?;
    ensure!(
        !other_issued,
        "another cutover permit is already issued for this Node"
    );

    let issued_at_ms = now_ms()?;
    let expires_at_ms = issued_at_ms
        .checked_add(60_000)
        .context("permit expiry overflow")?
        .min(candidate.preparation_expires_at_ms);
    ensure!(
        expires_at_ms >= issued_at_ms + 10_000,
        "approved preparation has too little validity remaining"
    );
    let nonce_hex = hex::encode(Uuid::new_v4().as_bytes());
    let pin = panel_pin_for_node(&keys.panel_pin_template, request.node_id)?;
    let message = Cutover {
        kind: "permit".into(),
        issuer_id: pin.issuer_id.clone(),
        signer_ed_key_id: pin.ed_key_id.clone(),
        signer_pq_key_id: pin.pq_key_id.clone(),
        node_id: candidate.material.node_id,
        from_epoch: candidate.material.from_epoch,
        to_epoch: candidate.material.to_epoch,
        request_id: request.request_id.clone(),
        from_ed_key_id: candidate.material.from_ed_key_id.clone(),
        from_pq_key_id: candidate.material.from_pq_key_id.clone(),
        to_ed_key_id: candidate.material.to_ed_key_id.clone(),
        to_pq_key_id: candidate.material.to_pq_key_id.clone(),
        method: "POST".into(),
        path: "/api/v2/node/keys/rotation/permit".into(),
        issued_at_ms,
        expires_at_ms,
        permit_nonce_hex: nonce_hex.clone(),
        nonce_hex,
        candidate_sha256_hex: candidate.candidate_sha256_hex,
        permit_sha256_hex: "00".repeat(32),
        applied_state_sha256_hex: "00".repeat(32),
    };
    sign_staging_permit(&message, &pin, &keys.ed25519, &keys.mldsa65).map_err(anyhow::Error::msg)
}

async fn connect_pool() -> Result<PgPool> {
    let database_url = env::var("XSP_V2_PERMIT_SIGNER_DATABASE_URL")
        .context("XSP_V2_PERMIT_SIGNER_DATABASE_URL is required")?;
    PgPoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(5))
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::query("SET statement_timeout='2s'")
                    .execute(&mut *connection)
                    .await?;
                sqlx::query("SET lock_timeout='1s'")
                    .execute(connection)
                    .await?;
                Ok(())
            })
        })
        .connect(&database_url)
        .await
        .context("connect permit signer read-only PostgreSQL role")
}

async fn validate_database_role(pool: &PgPool) -> Result<()> {
    let current_role: String = sqlx::query_scalar("SELECT current_user")
        .fetch_one(pool)
        .await?;
    ensure!(
        current_role == "xmesh_permit_signer_reader",
        "wrong permit signer DB role"
    );
    let read_only: bool =
        sqlx::query_scalar("SELECT current_setting('transaction_read_only')='on'")
            .fetch_one(pool)
            .await?;
    ensure!(
        read_only,
        "permit signer database role must default read-only"
    );
    let privileged: bool = sqlx::query_scalar(
        "SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
         FROM pg_roles WHERE rolname=current_user",
    )
    .fetch_one(pool)
    .await?;
    ensure!(!privileged, "permit signer database role is privileged");
    let memberships: bool = sqlx::query_scalar(
        "SELECT EXISTS(
           SELECT 1 FROM pg_auth_members
           WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)
         )",
    )
    .fetch_one(pool)
    .await?;
    ensure!(!memberships, "permit signer DB role has memberships");
    let excessive: bool = sqlx::query_scalar(
        "SELECT has_database_privilege(current_database(),'CREATE')
          OR has_database_privilege(current_database(),'TEMP')
          OR has_schema_privilege('public','CREATE')
          OR EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
              AND (has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                OR has_any_column_privilege(c.oid,'INSERT,UPDATE,REFERENCES')
                OR (c.relname NOT IN ('node_xsp_suite_state','node_xsp_public_keysets',
                     'node_xsp_rotation_preparations','node_xsp_cutover_permit_ledger')
                    AND (has_table_privilege(c.oid,'SELECT')
                      OR has_any_column_privilege(c.oid,'SELECT')))))
          OR EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind='S'
              AND has_sequence_privilege(c.oid,'USAGE,SELECT,UPDATE'))",
    )
    .fetch_one(pool)
    .await?;
    ensure!(!excessive, "permit signer DB role has excessive privileges");
    Ok(())
}

fn bind_socket() -> Result<(PathBuf, UnixListener)> {
    let socket_path = env::var_os("XSP_V2_PERMIT_SIGNER_SOCKET_PATH")
        .map_or_else(|| PathBuf::from(SOCKET_PATH_DEFAULT), PathBuf::from);
    ensure!(
        socket_path.is_absolute(),
        "permit signer socket path must be absolute"
    );
    let parent = socket_path
        .parent()
        .context("permit signer socket parent missing")?;
    let metadata =
        fs::symlink_metadata(parent).context("inspect permit signer socket directory")?;
    ensure!(
        metadata.file_type().is_dir()
            && metadata.uid() == SIGNER_UID
            && metadata.gid() == OPERATOR_GID
            && metadata.permissions().mode() & 0o7777 == 0o2750,
        "permit signer socket directory must be signer-owned 2750 with operator group"
    );
    match fs::symlink_metadata(&socket_path) {
        Ok(existing) => {
            ensure!(
                existing.file_type().is_socket()
                    && existing.uid() == SIGNER_UID
                    && existing.gid() == OPERATOR_GID,
                "existing permit signer socket is not protected"
            );
            fs::remove_file(&socket_path).context("remove stale permit signer socket")?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error).context("inspect old permit signer socket"),
    }
    let listener = UnixListener::bind(&socket_path).context("bind permit signer socket")?;
    fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o660))
        .context("set permit signer socket permissions")?;
    let socket_meta = fs::symlink_metadata(&socket_path)?;
    ensure!(
        socket_meta.uid() == SIGNER_UID && socket_meta.gid() == OPERATOR_GID,
        "permit signer socket did not inherit protected group"
    );
    Ok((socket_path, listener))
}

async fn serve_connection(
    mut stream: UnixStream,
    pool: &PgPool,
    keys: &SigningMaterial,
) -> Result<()> {
    let peer = stream
        .peer_cred()
        .context("read permit operator peer credentials")?;
    ensure!(
        peer.uid() == OPERATOR_UID && peer.gid() == OPERATOR_GID,
        "unexpected process credentials on permit signer socket"
    );
    let mut raw = Vec::new();
    {
        let mut limited = (&mut stream).take((MAX_REQUEST_BYTES + 1) as u64);
        timeout(Duration::from_secs(3), limited.read_to_end(&mut raw))
            .await
            .context("permit signer request read timeout")??;
    }
    ensure!(
        !raw.is_empty() && raw.len() <= MAX_REQUEST_BYTES,
        "invalid permit signer request size"
    );
    let request: SignRequest =
        serde_json::from_slice(&raw).context("invalid permit signer request JSON")?;
    let result = timeout(
        Duration::from_secs(5),
        sign_approved_permit(pool, keys, &request),
    )
    .await
    .context("permit signer database/signing deadline exceeded")?;
    let response = match result {
        Ok(permit) => SignResponse {
            protocol: "XSP/2".into(),
            action: "sign-approved-permit-result".into(),
            ok: true,
            signed_permit_b64: Some(STANDARD.encode(permit)),
            error_code: None,
        },
        Err(_) => {
            tracing::warn!("XSP-v2 permit signer rejected a request");
            SignResponse {
                protocol: "XSP/2".into(),
                action: "sign-approved-permit-result".into(),
                ok: false,
                signed_permit_b64: None,
                error_code: Some("request_rejected".into()),
            }
        }
    };
    let response_bytes = serde_json::to_vec(&response)?;
    ensure!(
        response_bytes.len() <= MAX_RESPONSE_BYTES,
        "permit signer response too large"
    );
    timeout(Duration::from_secs(3), async {
        stream.write_all(&response_bytes).await?;
        stream.shutdown().await
    })
    .await
    .context("permit signer response write timeout")??;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    ensure!(
        env::var("XSP_V2_PROTECTED_PERMIT_ISSUER").as_deref() == Ok("staging-only"),
        "permit signer requires XSP_V2_PROTECTED_PERMIT_ISSUER=staging-only"
    );
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init()
        .ok();
    let keys = load_signing_material()?;
    let pool = connect_pool().await?;
    validate_database_role(&pool).await?;
    let (socket_path, listener) = bind_socket()?;
    tracing::info!(
        socket = %socket_path.display(),
        ed_key_id = %keys.panel_pin_template.ed_key_id,
        pq_key_id = %keys.panel_pin_template.pq_key_id,
        "XSP-v2 protected permit signer ready"
    );
    loop {
        let (stream, _) = listener
            .accept()
            .await
            .context("accept permit signer connection")?;
        if serve_connection(stream, &pool, &keys).await.is_err() {
            tracing::warn!("XSP-v2 permit signer connection rejected");
        }
    }
}
