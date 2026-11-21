//! One-shot preparation for a newly created staging Node. This receipt
//! carries zero authority. A future data-plane protocol must independently
//! attest the process, bind a signed policy and lease, and activate metering.
use crate::{ApiError, AppState, node_auth};
use axum::http::{HeaderMap, StatusCode};
use serde_json::{Value, json};
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
    // Run even with the gate off. A temporarily disabled staging feature must
    // not forget that the ordinary policy path served this installation.
    sqlx::query(
        "UPDATE quota_v2_xray_genesis SET policy_path_used=TRUE
         WHERE node_id=$1 AND NOT policy_path_used",
    )
    .bind(node_id)
    .execute(pool)
    .await?;
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
