//! One-shot preparation for a newly created staging Node. This receipt
//! carries zero authority. A future data-plane protocol must independently
//! attest the process, bind a signed policy and lease, and activate metering.
use crate::{ApiError, AppState, node_auth};
use axum::http::{HeaderMap, StatusCode};
use serde_json::{Value, json};
use sha2::Digest;
use sqlx::{PgConnection, PgPool};

const FEATURE: &str = "XMESH_QUOTA_V2_XRAY_GENESIS_STAGING";
const DOMAIN: &[u8] = b"XMESH_XRAY_GENESIS_PREPARED_V1\0";
const VALID_MS: i64 = 120_000;

#[derive(sqlx::FromRow)]
struct Genesis {
    runtime_id: Option<String>,
    challenge: Option<String>,
    first_activation_sha256: Option<String>,
    prepared_ms: Option<i64>,
    receipt_signature: Option<String>,
    policy_path_used: bool,
}

fn enabled() -> bool {
    std::env::var(FEATURE).is_ok_and(|v| v == "1")
        && std::env::var("XMESH_QUOTA_V2_WAL_TRANSPORT").is_ok_and(|v| v == "1")
}

/// Separate opt-in first-genesis handoff. Ordinary desired-config continues
/// to *permanently* mark policy_path_used=true; it cannot masquerade as a
/// clean new Xray. This stage only saves a signed, zero-spend policy and
/// never starts Xray or issues an actual reservation.
pub fn quarantine_enabled() -> bool {
    enabled()
        && std::env::var("XMESH_QUOTA_V2_GENESIS_QUARANTINE_STAGING")
            .is_ok_and(|value| value == "1")
}

pub struct QuarantinePrepared {
    pub prepared_ms: i64,
    pub activation_sha256: String,
}

/// Require the real strict product-gateway's authenticated Node/activation
/// on the existing desired-config URL. This is *not* the final independent
/// process attestation or the future positive XSP/2 issuer.
pub async fn quarantine_prepared(
    state: &AppState,
    headers: &HeaderMap,
    node_id: i64,
    runtime_id: &str,
    challenge: &str,
) -> Result<QuarantinePrepared, ApiError> {
    if !quarantine_enabled() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "Quota-v2 first-genesis quarantine staging is disabled.",
        ));
    }
    if node_id <= 0 || !digest(runtime_id) || !digest(challenge) || runtime_id == challenge {
        return Err(unavailable());
    }
    let activation = node_auth::authenticate_product_activation(
        state,
        headers,
        node_id,
        "/api/v1/node/desired-config",
    )
    .await?;
    let record: Genesis = sqlx::query_as(
        "SELECT runtime_id,challenge,first_activation_sha256,prepared_ms,
                receipt_signature,policy_path_used
           FROM quota_v2_xray_genesis WHERE node_id=$1",
    )
    .bind(node_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(unavailable)?;
    let now: i64 = sqlx::query_scalar(
        "SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint",
    )
    .fetch_one(&state.pool)
    .await?;
    let prepared_ms = record.prepared_ms.ok_or_else(unavailable)?;
    if record.policy_path_used
        || record.runtime_id.as_deref() != Some(runtime_id)
        || record.challenge.as_deref() != Some(challenge)
        || record.first_activation_sha256.as_deref() != Some(activation)
        || record.receipt_signature.is_none()
        || prepared_ms > now
        || now >= prepared_ms.saturating_add(120_000)
    {
        return Err(unavailable());
    }
    Ok(QuarantinePrepared {
        prepared_ms,
        activation_sha256: activation.to_owned(),
    })
}

pub struct QuarantineSignedPolicy {
    pub policy: Value,
    pub signature: String,
    pub sha256: String,
}

/// PostgreSQL checks the first ever prepared Genesis, current strict
/// activation and NO prior desired policy/WAL/reservations under locks.
/// Immutable exact bytes + Ed25519 signature are fsynced before returning.
pub async fn stage_quarantine_policy(
    state: &AppState,
    node_id: i64,
    prepared: &QuarantinePrepared,
    runtime_id: &str,
    challenge: &str,
    revision: &str,
    policy: &Value,
) -> Result<QuarantineSignedPolicy, ApiError> {
    let bytes = serde_json::to_vec(policy).map_err(|_| unavailable())?;
    let signature = state
        .node_policy_signer
        .sign(policy)
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Quarantine signing failed."))?;
    let public = state.node_policy_signer.public_key();
    let saved: (Vec<u8>, String, String) = sqlx::query_as(
        "SELECT signed_policy_bytes,policy_signature,policy_sha256
           FROM quota_v2_stage_genesis_quarantine_policy(
                $1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(node_id)
    .bind(&prepared.activation_sha256)
    .bind(runtime_id)
    .bind(challenge)
    .bind(revision)
    .bind(bytes.as_slice())
    .bind(signature.as_str())
    .bind(public.as_str())
    .fetch_one(&state.pool)
    .await?;
    // Never serve bytes other than the ones the existing pinned signer
    // actually signed and the immutable PostgreSQL record committed.
    if saved.0 != bytes || saved.1 != signature
        || saved.2 != hex::encode(sha2::Sha256::digest(&bytes))
    {
        return Err(unavailable());
    }
    let signed = serde_json::from_slice(&saved.0).map_err(|_| unavailable())?;
    Ok(QuarantineSignedPolicy {
        policy: signed,
        signature: saved.1,
        sha256: saved.2,
    })
}

pub async fn record_creation(conn: &mut PgConnection, node_id: i64) -> Result<(), ApiError> {
    if enabled() {
        sqlx::query("INSERT INTO quota_v2_xray_genesis(node_id) VALUES($1)")
            .bind(node_id)
            .execute(conn)
            .await?;
    }
    Ok(())
}

pub async fn close_for_policy(pool: &PgPool, node_id: i64) -> Result<(), ApiError> {
    // Permanently close Genesis for normal desired-config as before.
    // Serialize with the special zero-spend stage: whichever path acquires
    // the Genesis row lock first wins. Once a quarantined policy exists,
    // a LEGACY desired-config must not re-enable offline budgets while the
    // installed Xray awaits a separately proven positive admission.
    let mut tx = pool.begin().await?;
    let used: Option<bool> = sqlx::query_scalar(
        "SELECT policy_path_used FROM quota_v2_xray_genesis
          WHERE node_id=$1 FOR UPDATE",
    )
    .bind(node_id)
    .fetch_optional(&mut *tx)
    .await?;
    if used == Some(false) {
        let quarantined: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM quota_v2_genesis_quarantine_policies
             WHERE node_id=$1)",
        )
        .bind(node_id)
        .fetch_one(&mut *tx)
        .await?;
        if quarantined {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "Node has a quarantined first-genesis policy: ordinary desired-config cannot activate it.",
            ));
        }
    }
    sqlx::query(
        "UPDATE quota_v2_xray_genesis SET policy_path_used=TRUE
         WHERE node_id=$1 AND NOT policy_path_used",
    )
    .bind(node_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

fn unavailable() -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        "Xray genesis preparation unavailable.",
    )
}

fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

async fn lock_active_node(
    conn: &mut PgConnection,
    node_id: i64,
    activation: &str,
) -> Result<(), ApiError> {
    let active: Option<String> = sqlx::query_scalar(
        "SELECT encode(p.receipt_sha256,'hex')
           FROM panel_records n JOIN node_xsp_product_nodes p ON p.node_id=n.id
          WHERE n.id=$1 AND n.collection='nodes' AND p.state='active'
            AND (n.data->'disabled') IS DISTINCT FROM 'true'::jsonb
          FOR UPDATE OF n,p",
    )
    .bind(node_id)
    .fetch_optional(conn)
    .await?;
    if active.as_deref() != Some(activation) {
        return Err(unavailable());
    }
    Ok(())
}

pub async fn prepare(
    state: &AppState,
    headers: &HeaderMap,
    node_id: i64,
    runtime_id: &str,
    challenge: &str,
) -> Result<Value, ApiError> {
    if !enabled() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "Xray genesis disabled.",
        ));
    }
    if !digest(runtime_id) || !digest(challenge) || runtime_id == challenge {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid Xray genesis request.",
        ));
    }
    let activation = node_auth::authenticate_product_activation(
        state,
        headers,
        node_id,
        crate::quota_wal_transport::PATH,
    )
    .await?;
    let mut tx = state.pool.begin().await?;
    lock_active_node(&mut tx, node_id, activation).await?;
    let record: Genesis = sqlx::query_as(
        "SELECT runtime_id,challenge,first_activation_sha256,prepared_ms,receipt_signature,policy_path_used
           FROM quota_v2_xray_genesis WHERE node_id=$1 FOR UPDATE",
    )
    .bind(node_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(unavailable)?;
    let history: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM quota_v2_external_wal_birth_anchors WHERE node_id=$1)
             OR EXISTS(SELECT 1 FROM quota_v2_reservations WHERE node_id=$1)
             OR EXISTS(SELECT 1 FROM user_node_quota_lifetime WHERE node_id=$1)
             OR EXISTS(SELECT 1 FROM verified_traffic_deltas WHERE node_id=$1)
             OR EXISTS(SELECT 1 FROM node_desired_revisions WHERE node_id=$1)",
    )
    .bind(node_id)
    .fetch_one(&mut *tx)
    .await?;
    if record.policy_path_used
        || history
        || record.first_activation_sha256.as_deref() != Some(activation)
    {
        return Err(unavailable());
    }
    let now: i64 =
        sqlx::query_scalar("SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint")
            .fetch_one(&mut *tx)
            .await?;
    let prepared = if let Some(prepared) = record.prepared_ms {
        if record.runtime_id.as_deref() != Some(runtime_id)
            || record.challenge.as_deref() != Some(challenge)
            || now < prepared
            || now >= prepared.saturating_add(VALID_MS)
        {
            return Err(unavailable());
        }
        prepared
    } else {
        now
    };
    let payload = json!({
        "schemaVersion":1, "kind":"xmesh.xray.genesis-prepared",
        "nodeId":node_id, "activationReceiptSha256":activation,
        "candidateRuntimeId":runtime_id, "challenge":challenge,
        "preparedAtMs":prepared, "validUntilMs":prepared.saturating_add(VALID_MS),
        "authorizedBytes":0, "canStart":false, "canResume":false
    });
    let signature = if let Some(signature) = record.receipt_signature {
        signature
    } else {
        let signature = state
            .node_policy_signer
            .sign_domain(DOMAIN, &payload)
            .map_err(|_| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Xray genesis signing failed.",
                )
            })?;
        sqlx::query("SET LOCAL synchronous_commit TO on")
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "UPDATE quota_v2_xray_genesis SET runtime_id=$2,challenge=$3,
                 prepared_ms=$4,receipt_signature=$5 WHERE node_id=$1",
        )
        .bind(node_id)
        .bind(runtime_id)
        .bind(challenge)
        .bind(prepared)
        .bind(&signature)
        .execute(&mut *tx)
        .await?;
        signature
    };
    tx.commit().await?;
    Ok(json!({"algorithm":"Ed25519", "payload":payload, "signature":signature}))
}
