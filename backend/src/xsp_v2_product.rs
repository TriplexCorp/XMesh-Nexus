use crate::{ApiError, AppState};
use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::env;
use subtle::ConstantTimeEq;

const PRODUCT_VERSION: &str = "control-v6.0.0";
const ENROLL_DOMAIN: &[u8] = b"XSP2-PRODUCT-ENROLL-V1\0";
const INTERNAL_HEADER: &str = "x-xsp-product-internal";

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseIdentity {
    pub version: String,
    pub source_revision: String,
    pub artifact_sha256: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductEnrollRequest {
    pub token: String,
    pub node_id: i64,
    pub purpose: String,
    pub key_epoch: i64,
    pub challenge_hex: String,
    pub ed25519_key_id: String,
    pub mldsa65_key_id: String,
    pub ed25519_public_b64: String,
    pub mldsa65_public_b64: String,
    pub ed25519_signature_b64: String,
    pub mldsa65_signature_b64: String,
    pub tls_public_key_b64: String,
    pub release_identity: ReleaseIdentity,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GatewayEnrollResponse {
    node_id: i64,
    tls_spki_sha256: String,
    client_certificate_pem: String,
    server_ca_pem: String,
    endpoint_address: String,
    server_name: String,
    panel_pin: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeLookupRequest {
    pub node_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NonceRequest {
    pub node_id: i64,
    pub key_epoch: i64,
    pub direction: i16,
    pub nonce_hex: String,
    pub request_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationPrepareRequest {
    pub node_id: i64,
    pub key_epoch: i64,
    pub request_id: String,
    pub request_sha256: String,
    pub tls_spki_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationCommitRequest {
    pub node_id: i64,
    pub key_epoch: i64,
    pub request_id: String,
    pub request_sha256: String,
    pub tls_spki_sha256: String,
    pub receipt_sha256: String,
    pub receipt_envelope_b64: String,
}

fn unauthorized(message: &'static str) -> ApiError {
    ApiError::new(StatusCode::UNAUTHORIZED, message)
}

fn internal_secret() -> Result<String, ApiError> {
    let value = env::var("XSP_V2_PRODUCT_INTERNAL_TOKEN")
        .map_err(|_| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "Strict-PQ product gateway is not configured."))?;
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Strict-PQ product gateway secret is invalid.",
        ));
    }
    Ok(value)
}

fn require_internal(headers: &HeaderMap) -> Result<(), ApiError> {
    let expected = internal_secret()?;
    let supplied = headers
        .get(INTERNAL_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| unauthorized("Strict-PQ internal authorization required."))?;
    if supplied.len() != expected.len()
        || expected.as_bytes().ct_eq(supplied.as_bytes()).unwrap_u8() != 1
    {
        return Err(unauthorized("Strict-PQ internal authorization rejected."));
    }
    Ok(())
}

fn strict_hex(value: &str, bytes: usize) -> Result<Vec<u8>, ApiError> {
    if value.len() != bytes * 2
        || !value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Noncanonical strict-PQ digest."));
    }
    hex::decode(value).map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid strict-PQ digest."))
}

fn strict_b64(value: &str, bytes: usize) -> Result<Vec<u8>, ApiError> {
    let decoded = STANDARD
        .decode(value)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid strict-PQ Base64 field."))?;
    if decoded.len() != bytes || STANDARD.encode(&decoded) != value {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Noncanonical strict-PQ Base64 field.",
        ));
    }
    Ok(decoded)
}

fn validate_id(prefix: &str, id: &str, public: &[u8]) -> Result<(), ApiError> {
    let digest = Sha256::digest(public);
    let expected = format!("{prefix}{}", hex::encode(&digest[..12]));
    if expected != id {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Strict-PQ public key identifier mismatch.",
        ));
    }
    Ok(())
}

fn validate_release(identity: &ReleaseIdentity) -> Result<(), ApiError> {
    if identity.version != PRODUCT_VERSION
        || identity.source_revision.len() != 40
        || identity.artifact_sha256.len() != 64
        || !identity
            .source_revision
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        || !identity
            .artifact_sha256
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Node is not an authenticated XMesh v6 POSTQUANTUM release.",
        ));
    }
    Ok(())
}

fn enrollment_challenge(token: &str, node_id: i64) -> Result<String, ApiError> {
    let token_bytes = strict_hex(token, 32)?;
    let mut hash = Sha256::new();
    hash.update(ENROLL_DOMAIN);
    hash.update(token_bytes);
    hash.update(node_id.to_be_bytes());
    Ok(hex::encode(hash.finalize()))
}

fn gateway_url() -> String {
    env::var("XSP_V2_PRODUCT_GATEWAY_URL")
        .unwrap_or_else(|_| "http://xsp-v2-product-gateway:8081".to_owned())
}

pub async fn enroll(
    State(state): State<AppState>,
    Json(request): Json<ProductEnrollRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if request.node_id <= 0 || request.purpose != "node_request" || request.key_epoch != 1 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid strict-PQ enrollment subject."));
    }
    validate_release(&request.release_identity)?;
    let ed = strict_b64(&request.ed25519_public_b64, 32)?;
    let pq = strict_b64(&request.mldsa65_public_b64, 1952)?;
    let _ = strict_b64(&request.ed25519_signature_b64, 64)?;
    let _ = strict_b64(&request.mldsa65_signature_b64, 3309)?;
    validate_id("ed-", &request.ed25519_key_id, &ed)?;
    validate_id("pq-", &request.mldsa65_key_id, &pq)?;
    let expected_challenge = enrollment_challenge(&request.token, request.node_id)?;
    if request.challenge_hex != expected_challenge {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Strict-PQ enrollment challenge mismatch."));
    }
    let token_hash = hex::encode(Sha256::digest(request.token.as_bytes()));
    let token_node = sqlx::query_scalar::<_, i64>(
        "SELECT node_id FROM node_enrollment_tokens
         WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>NOW()",
    )
    .bind(&token_hash)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "Enrollment token is invalid or expired."))?;
    if token_node != request.node_id {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Enrollment token belongs to another node."));
    }

    let secret = internal_secret()?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "Cannot initialize strict-PQ enrollment verifier."))?;
    let response = client
        .post(format!("{}/internal/enroll/verify-issue", gateway_url()))
        .header("X-XSP-Product-Internal", secret)
        .json(&request)
        .send()
        .await
        .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "Strict-PQ enrollment verifier unavailable."))?;
    if !response.status().is_success() {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Dual-key enrollment proof rejected."));
    }
    let issued: GatewayEnrollResponse = response
        .json()
        .await
        .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "Invalid strict-PQ enrollment verifier response."))?;
    if issued.node_id != request.node_id {
        return Err(ApiError::new(StatusCode::BAD_GATEWAY, "Strict-PQ issuer node binding mismatch."));
    }
    let tls_spki = strict_hex(&issued.tls_spki_sha256, 32)?;

    let mut tx = state.pool.begin().await?;
    let locked = sqlx::query_scalar::<_, i64>(
        "SELECT node_id FROM node_enrollment_tokens
         WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>NOW() FOR UPDATE",
    )
    .bind(&token_hash)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "Enrollment token was already consumed."))?;
    if locked != request.node_id {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Enrollment token node binding changed."));
    }
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM panel_records WHERE collection='nodes' AND id=$1 FOR UPDATE",
    )
    .bind(request.node_id)
    .fetch_optional(&mut *tx)
    .await?;
    if exists.is_none() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Node not found."));
    }
    let active_existing = sqlx::query_scalar::<_, String>(
        "SELECT state FROM node_xsp_product_nodes WHERE node_id=$1 FOR UPDATE",
    )
    .bind(request.node_id)
    .fetch_optional(&mut *tx)
    .await?;
    if active_existing.as_deref() == Some("active") {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Strict-PQ node is already active; explicit revocation is required before re-enrollment.",
        ));
    }

    sqlx::query(
        "INSERT INTO node_metric_keys(node_id,public_key,enrolled_at,last_seen_at)
         VALUES($1,$2,NOW(),NULL)
         ON CONFLICT(node_id) DO UPDATE SET public_key=EXCLUDED.public_key,enrolled_at=NOW(),last_seen_at=NULL",
    )
    .bind(request.node_id)
    .bind(hex::encode(&ed))
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM node_metric_nonces WHERE node_id=$1")
        .bind(request.node_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM node_xsp_public_keysets WHERE node_id=$1")
        .bind(request.node_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO node_xsp_public_keysets
         (node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public)
         VALUES($1,'node_request',1,$2,$3,$4,$5)",
    )
    .bind(request.node_id)
    .bind(&request.ed25519_key_id)
    .bind(&request.mldsa65_key_id)
    .bind(&ed)
    .bind(&pq)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO node_xsp_suite_state(node_id,minimum_suite,activation_phase,key_epoch)
         VALUES($1,1,'dual_enrolled',1)
         ON CONFLICT(node_id) DO UPDATE SET minimum_suite=1,activation_phase='dual_enrolled',key_epoch=1",
    )
    .bind(request.node_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM node_xsp_product_nodes WHERE node_id=$1")
        .bind(request.node_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO node_xsp_product_nodes
         (node_id,state,key_epoch,ed25519_key_id,mldsa65_key_id,tls_spki_sha256,
          release_version,release_source_revision,release_artifact_sha256)
         VALUES($1,'enrolled',1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(request.node_id)
    .bind(&request.ed25519_key_id)
    .bind(&request.mldsa65_key_id)
    .bind(&tls_spki)
    .bind(&request.release_identity.version)
    .bind(&request.release_identity.source_revision)
    .bind(&request.release_identity.artifact_sha256)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE node_enrollment_tokens SET consumed_at=NOW() WHERE token_hash=$1")
        .bind(&token_hash)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "nodeId":issued.node_id,
            "state":"enrolled",
            "strictPQEnabled":false,
            "tlsSpkiSha256":issued.tls_spki_sha256,
            "clientCertificatePem":issued.client_certificate_pem,
            "serverCaPem":issued.server_ca_pem,
            "endpointAddress":issued.endpoint_address,
            "serverName":issued.server_name,
            "panelPin":issued.panel_pin
        })),
    ))
}

pub async fn product_state(pool: &sqlx::PgPool, node_id: i64) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>("SELECT state FROM node_xsp_product_nodes WHERE node_id=$1")
        .bind(node_id)
        .fetch_optional(pool)
        .await
}

pub async fn lookup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<NodeLookupRequest>,
) -> Result<Json<Value>, ApiError> {
    require_internal(&headers)?;
    let row = sqlx::query(
        "SELECT p.state,p.key_epoch,p.ed25519_key_id,p.mldsa65_key_id,
                encode(p.tls_spki_sha256,'hex') AS tls_spki,
                k.ed25519_public,k.mldsa65_public,p.receipt_envelope
         FROM node_xsp_product_nodes p
         JOIN node_xsp_public_keysets k ON k.node_id=p.node_id AND k.purpose='node_request' AND k.key_epoch=p.key_epoch
         WHERE p.node_id=$1",
    )
    .bind(request.node_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Strict-PQ product node not found."))?;
    let receipt: Option<Vec<u8>> = row.try_get("receipt_envelope")?;
    Ok(Json(json!({
        "nodeId":request.node_id,
        "state":row.try_get::<String,_>("state")?,
        "keyEpoch":row.try_get::<i64,_>("key_epoch")?,
        "ed25519KeyId":row.try_get::<String,_>("ed25519_key_id")?,
        "mldsa65KeyId":row.try_get::<String,_>("mldsa65_key_id")?,
        "ed25519PublicB64":STANDARD.encode(row.try_get::<Vec<u8>,_>("ed25519_public")?),
        "mldsa65PublicB64":STANDARD.encode(row.try_get::<Vec<u8>,_>("mldsa65_public")?),
        "tlsSpkiSha256":row.try_get::<String,_>("tls_spki")?,
        "receiptEnvelopeB64":receipt.map(|v| STANDARD.encode(v))
    })))
}

pub async fn record_nonce(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<NonceRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    require_internal(&headers)?;
    if request.node_id <= 0 || request.key_epoch <= 0 || !matches!(request.direction, 1 | 2) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid strict-PQ replay subject."));
    }
    let nonce = strict_hex(&request.nonce_hex, 16)?;
    if request.request_id.is_empty() || request.request_id.len() > 64 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid strict-PQ request ID."));
    }
    let inserted = sqlx::query(
        "INSERT INTO node_xsp_product_nonces(node_id,key_epoch,direction,nonce,request_id)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
    )
    .bind(request.node_id)
    .bind(request.key_epoch)
    .bind(request.direction)
    .bind(nonce)
    .bind(&request.request_id)
    .execute(&state.pool)
    .await?;
    if inserted.rows_affected() != 1 {
        return Err(ApiError::new(StatusCode::CONFLICT, "Strict-PQ replay rejected."));
    }
    sqlx::query("DELETE FROM node_xsp_product_nonces WHERE used_at<NOW()-INTERVAL '10 minutes'")
        .execute(&state.pool)
        .await?;
    Ok((StatusCode::CREATED, Json(json!({"accepted":true}))))
}

pub async fn activation_prepare(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ActivationPrepareRequest>,
) -> Result<Json<Value>, ApiError> {
    require_internal(&headers)?;
    let request_sha = strict_hex(&request.request_sha256, 32)?;
    let tls_spki = strict_hex(&request.tls_spki_sha256, 32)?;
    if request.node_id <= 0 || request.key_epoch <= 0 || request.request_id.is_empty() || request.request_id.len() > 64 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid strict-PQ activation request."));
    }
    let mut tx = state.pool.begin().await?;
    let row = sqlx::query(
        "SELECT state,key_epoch,tls_spki_sha256,activation_request_id,activation_request_sha256,receipt_envelope
         FROM node_xsp_product_nodes WHERE node_id=$1 FOR UPDATE",
    )
    .bind(request.node_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Strict-PQ product node not enrolled."))?;
    let state_name: String = row.try_get("state")?;
    if state_name == "revoked" || row.try_get::<i64,_>("key_epoch")? != request.key_epoch
        || row.try_get::<Vec<u8>,_>("tls_spki_sha256")? != tls_spki {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "Strict-PQ activation identity rejected."));
    }
    if state_name == "active" {
        let existing_id: Option<String> = row.try_get("activation_request_id")?;
        let existing_sha: Option<Vec<u8>> = row.try_get("activation_request_sha256")?;
        if existing_id.as_deref() != Some(request.request_id.as_str()) || existing_sha.as_deref() != Some(request_sha.as_slice()) {
            return Err(ApiError::new(StatusCode::CONFLICT, "Strict-PQ node is active under another receipt."));
        }
        let receipt: Vec<u8> = row.try_get::<Option<Vec<u8>>,_>("receipt_envelope")?
            .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Active strict-PQ receipt missing."))?;
        tx.commit().await?;
        return Ok(Json(json!({"state":"active","receiptEnvelopeB64":STANDARD.encode(receipt)})));
    }
    let old_id: Option<String> = row.try_get("activation_request_id")?;
    let old_sha: Option<Vec<u8>> = row.try_get("activation_request_sha256")?;
    if old_id.as_ref().is_some_and(|v| v != &request.request_id)
        || old_sha.as_ref().is_some_and(|v| v.as_slice() != request_sha.as_slice()) {
        return Err(ApiError::new(StatusCode::CONFLICT, "Another strict-PQ activation is already prepared."));
    }
    sqlx::query(
        "UPDATE node_xsp_product_nodes SET activation_request_id=$2,activation_request_sha256=$3
         WHERE node_id=$1 AND state='enrolled'",
    )
    .bind(request.node_id)
    .bind(&request.request_id)
    .bind(&request_sha)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"state":"prepared"})))
}

pub async fn activation_commit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ActivationCommitRequest>,
) -> Result<Json<Value>, ApiError> {
    require_internal(&headers)?;
    let request_sha = strict_hex(&request.request_sha256, 32)?;
    let tls_spki = strict_hex(&request.tls_spki_sha256, 32)?;
    let receipt_sha = strict_hex(&request.receipt_sha256, 32)?;
    let receipt = STANDARD
        .decode(&request.receipt_envelope_b64)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid strict-PQ receipt encoding."))?;
    if receipt.is_empty() || receipt.len() > 1_048_576 || STANDARD.encode(&receipt) != request.receipt_envelope_b64 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Noncanonical strict-PQ receipt encoding."));
    }
    if Sha256::digest(&receipt).as_slice() != receipt_sha.as_slice() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Strict-PQ receipt digest mismatch."));
    }
    let mut tx = state.pool.begin().await?;
    let row = sqlx::query(
        "SELECT state,key_epoch,tls_spki_sha256,activation_request_id,activation_request_sha256,receipt_sha256
         FROM node_xsp_product_nodes WHERE node_id=$1 FOR UPDATE",
    )
    .bind(request.node_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Strict-PQ product node not enrolled."))?;
    if row.try_get::<i64,_>("key_epoch")? != request.key_epoch
        || row.try_get::<Vec<u8>,_>("tls_spki_sha256")? != tls_spki
        || row.try_get::<Option<String>,_>("activation_request_id")?.as_deref() != Some(request.request_id.as_str())
        || row.try_get::<Option<Vec<u8>>,_>("activation_request_sha256")?.as_deref() != Some(request_sha.as_slice()) {
        return Err(ApiError::new(StatusCode::CONFLICT, "Strict-PQ activation commit binding mismatch."));
    }
    let state_name: String = row.try_get("state")?;
    if state_name == "active" {
        if row.try_get::<Option<Vec<u8>>,_>("receipt_sha256")?.as_deref() != Some(receipt_sha.as_slice()) {
            return Err(ApiError::new(StatusCode::CONFLICT, "Strict-PQ activation receipt differs from durable state."));
        }
        tx.commit().await?;
        return Ok(Json(json!({"productionActivation":true,"strictPQEnabled":true,"duplicate":true})));
    }
    if state_name != "enrolled" {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "Strict-PQ product node cannot be activated."));
    }
    sqlx::query(
        "UPDATE node_xsp_product_nodes SET state='active',receipt_sha256=$2,receipt_envelope=$3,activated_at=NOW()
         WHERE node_id=$1 AND state='enrolled'",
    )
    .bind(request.node_id)
    .bind(&receipt_sha)
    .bind(&receipt)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE node_xsp_suite_state SET minimum_suite=2,activation_phase='strict',key_epoch=$2 WHERE node_id=$1",
    )
    .bind(request.node_id)
    .bind(request.key_epoch)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"productionActivation":true,"strictPQEnabled":true,"duplicate":false})))
}

pub async fn activation_recover(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<NodeLookupRequest>,
) -> Result<Json<Value>, ApiError> {
    require_internal(&headers)?;
    let row = sqlx::query("SELECT state,receipt_envelope FROM node_xsp_product_nodes WHERE node_id=$1")
        .bind(request.node_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Strict-PQ product node not found."))?;
    if row.try_get::<String,_>("state")? != "active" {
        return Err(ApiError::new(StatusCode::CONFLICT, "Strict-PQ node is not active."));
    }
    let receipt = row.try_get::<Option<Vec<u8>>,_>("receipt_envelope")?
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Strict-PQ receipt missing."))?;
    Ok(Json(json!({"receiptEnvelopeB64":STANDARD.encode(receipt)})))
}

pub async fn internal_forward_allowed(
    pool: &sqlx::PgPool,
    headers: &HeaderMap,
    node_id: i64,
) -> Result<bool, ApiError> {
    let Some(state_name) = product_state(pool, node_id).await? else {
        return Ok(false);
    };
    if state_name != "active" {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "Strict-PQ product node is not active."));
    }
    require_internal(headers)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn product_challenge_binds_token_and_node() {
        let token = "11".repeat(32);
        let a = enrollment_challenge(&token, 7).unwrap();
        let b = enrollment_challenge(&token, 8).unwrap();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert!(enrollment_challenge("AA", 7).is_err());
    }
}
