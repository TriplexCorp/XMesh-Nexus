//! Per-node authentication boundary.
//!
//! Legacy nodes retain the reviewed Ed25519/XMESH1 request format only for
//! compatibility. `XMesh` v6 product nodes are different: once enrolled in
//! `node_xsp_product_nodes`, operational requests are accepted exclusively
//! from the local strict-PQ gateway after durable product activation.
use crate::{ApiError, AppState, auth::AuthUser};
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode},
};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::{
    env,
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_CLOCK_SKEW_SECONDS: i64 = 120;
const PRODUCT_SECRET_HEADER: &str = "x-xsp-product-internal";
const PRODUCT_NODE_HEADER: &str = "x-xsp-product-node-id";
const PRODUCT_PATH_HEADER: &str = "x-xsp-product-path";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnrollKey {
    public_key: String,
}

fn error(message: &'static str) -> ApiError {
    ApiError::new(StatusCode::UNAUTHORIZED, message)
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0_u8;
    for (&a, &b) in left.iter().zip(right) {
        difference |= a ^ b;
    }
    difference == 0
}

fn product_secret() -> Result<String, ApiError> {
    let value = env::var("XSP_V2_PRODUCT_INTERNAL_TOKEN").map_err(|_| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Strict-PQ product authorization is not configured.",
        )
    })?;
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Strict-PQ product authorization is invalid.",
        ));
    }
    Ok(value)
}

async fn authenticate_product_gateway(
    state: &AppState,
    headers: &HeaderMap,
    node_id: i64,
    path: &str,
) -> Result<bool, ApiError> {
    let product_state = sqlx::query_scalar::<_, String>(
        "SELECT state FROM node_xsp_product_nodes WHERE node_id=$1",
    )
    .bind(node_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some(product_state) = product_state else {
        return Ok(false);
    };
    if product_state != "active" {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Strict-PQ product node is not active.",
        ));
    }

    let expected = product_secret()?;
    let supplied = headers
        .get(PRODUCT_SECRET_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                "Strict-PQ product gateway authorization required.",
            )
        })?;
    if !constant_time_equal(expected.as_bytes(), supplied.as_bytes()) {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Strict-PQ product gateway authorization rejected.",
        ));
    }
    if headers
        .get(PRODUCT_NODE_HEADER)
        .and_then(|value| value.to_str().ok())
        != Some(node_id.to_string().as_str())
        || headers
            .get(PRODUCT_PATH_HEADER)
            .and_then(|value| value.to_str().ok())
            != Some(path)
    {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Strict-PQ product gateway binding mismatch.",
        ));
    }

    sqlx::query("UPDATE node_metric_keys SET last_seen_at=NOW() WHERE node_id=$1")
        .bind(node_id)
        .execute(&state.pool)
        .await?;
    Ok(true)
}

pub fn canonical_for(path: &str, node_id: i64, timestamp: i64, nonce: &str, body: &[u8]) -> String {
    let digest = hex::encode(Sha256::digest(body));
    format!("XMESH1\nPOST\n{path}\n{node_id}\n{timestamp}\n{nonce}\n{digest}\n")
}

#[cfg(test)]
pub fn canonical(node_id: i64, timestamp: i64, nonce: &str, body: &[u8]) -> String {
    canonical_for("/api/v1/metrics/ingest", node_id, timestamp, nonce, body)
}

fn valid_nonce(nonce: &str) -> bool {
    nonce.len() == 32
        && nonce
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

const fn check_timestamp(timestamp: i64, now: i64) -> bool {
    timestamp.abs_diff(now) <= MAX_CLOCK_SKEW_SECONDS as u64
}

fn verified_signature(
    public_key: &str,
    headers: &HeaderMap,
    node_id: i64,
    raw_body: &[u8],
    now: i64,
    path: &str,
) -> Result<String, ApiError> {
    let timestamp_raw = headers
        .get("x-xmesh-timestamp")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| error("Требуется подписанный запрос от узла."))?;
    if timestamp_raw.is_empty()
        || timestamp_raw.len() > 16
        || !timestamp_raw.bytes().all(|byte| byte.is_ascii_digit())
        || (timestamp_raw.len() > 1 && timestamp_raw.starts_with('0'))
    {
        return Err(error("Недопустимая метка времени агента."));
    }
    let timestamp = timestamp_raw
        .parse::<i64>()
        .map_err(|_| error("Некорректное время агента."))?;
    if !check_timestamp(timestamp, now) {
        return Err(error(
            "Время запроса узла истекло. Проверьте синхронизацию NTP.",
        ));
    }
    let nonce = headers
        .get("x-xmesh-nonce")
        .and_then(|value| value.to_str().ok())
        .filter(|value| valid_nonce(value))
        .ok_or_else(|| error("Недопустимый одноразовый идентификатор запроса."))?;
    let signature_hex = headers
        .get("x-xmesh-signature")
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.len() == 128 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| error("Недопустимая подпись запроса."))?;
    let key: [u8; 32] = hex::decode(public_key)
        .ok()
        .and_then(|data| data.try_into().ok())
        .ok_or_else(|| error("Ключ узла повреждён."))?;
    let verifying_key =
        VerifyingKey::from_bytes(&key).map_err(|_| error("Ключ узла недействителен."))?;
    let signature_data: [u8; 64] = hex::decode(signature_hex)
        .ok()
        .and_then(|data| data.try_into().ok())
        .ok_or_else(|| error("Недопустимая подпись запроса."))?;
    verifying_key
        .verify(
            canonical_for(path, node_id, timestamp, nonce, raw_body).as_bytes(),
            &Signature::from_bytes(&signature_data),
        )
        .map_err(|_| error("Подпись запроса не прошла проверку."))?;
    Ok(nonce.to_owned())
}

pub async fn authenticate(
    state: &AppState,
    headers: &HeaderMap,
    node_id: i64,
    raw_body: &[u8],
) -> Result<(), ApiError> {
    authenticate_for(state, headers, node_id, raw_body, "/api/v1/metrics/ingest").await
}

pub async fn authenticate_for(
    state: &AppState,
    headers: &HeaderMap,
    node_id: i64,
    raw_body: &[u8],
    path: &str,
) -> Result<(), ApiError> {
    if authenticate_product_gateway(state, headers, node_id, path).await? {
        return Ok(());
    }

    let row = sqlx::query("SELECT public_key FROM node_metric_keys WHERE node_id=$1")
        .bind(node_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| error("Для узла не зарегистрирован публичный Ed25519-ключ."))?;
    let key: String = row.try_get("public_key")?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| error("Ошибка времени сервера."))?
        .as_secs()
        .try_into()
        .map_err(|_| error("Ошибка времени сервера."))?;
    let nonce = verified_signature(&key, headers, node_id, raw_body, now, path)?;
    let inserted = sqlx::query(
        "INSERT INTO node_metric_nonces(node_id, nonce) VALUES($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(node_id)
    .bind(nonce)
    .execute(&state.pool)
    .await?;
    if inserted.rows_affected() != 1 {
        return Err(error(
            "Повторное использование подписанного запроса запрещено.",
        ));
    }
    sqlx::query("UPDATE node_metric_keys SET last_seen_at=NOW() WHERE node_id=$1")
        .bind(node_id)
        .execute(&state.pool)
        .await?;
    sqlx::query("DELETE FROM node_metric_nonces WHERE used_at<NOW()-INTERVAL '10 minutes'")
        .execute(&state.pool)
        .await?;
    Ok(())
}

pub async fn enroll(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(node_id): Path<i64>,
    Json(request): Json<EnrollKey>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    crate::require_owner(&actor)?;
    if node_id <= 0 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Некорректный идентификатор узла.",
        ));
    }
    if request.public_key.len() != 64
        || !request
            .public_key
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Публичный Ed25519-ключ должен состоять из 64 строчных hex-символов.",
        ));
    }
    let raw: [u8; 32] = hex::decode(&request.public_key)
        .ok()
        .and_then(|value| value.try_into().ok())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Некорректный публичный ключ."))?;
    VerifyingKey::from_bytes(&raw)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Неверный публичный Ed25519-ключ."))?;
    let mut tx = state.pool.begin().await?;
    let exists =
        sqlx::query("SELECT id FROM panel_records WHERE collection='nodes' AND id=$1 FOR UPDATE")
            .bind(node_id)
            .fetch_optional(&mut *tx)
            .await?;
    if exists.is_none() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Узел не найден."));
    }
    if sqlx::query_scalar::<_, i64>("SELECT node_id FROM node_xsp_product_nodes WHERE node_id=$1")
        .bind(node_id)
        .fetch_optional(&mut *tx)
        .await?
        .is_some()
    {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "XMesh v6 strict-PQ node cannot be downgraded to legacy Ed25519 enrollment.",
        ));
    }
    sqlx::query(
        "INSERT INTO node_metric_keys(node_id,public_key) VALUES($1,$2)
         ON CONFLICT(node_id) DO UPDATE SET public_key=EXCLUDED.public_key,
            enrolled_at=NOW(),last_seen_at=NULL",
    )
    .bind(node_id)
    .bind(&request.public_key)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM node_metric_nonces WHERE node_id=$1")
        .bind(node_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    crate::audit(
        &state.pool,
        &actor.username,
        "node_metrics.key_enrolled",
        Some("nodes"),
        Some(node_id),
        json!({"algorithm":"Ed25519","legacyOnly":true}),
    )
    .await;
    Ok((
        StatusCode::CREATED,
        Json(json!({"nodeId":node_id,"authentication":"ed25519","legacyOnly":true})),
    ))
}

pub async fn revoke(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(node_id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    crate::require_owner(&actor)?;
    if node_id <= 0 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Некорректный идентификатор узла.",
        ));
    }
    let mut tx = state.pool.begin().await?;
    let product = sqlx::query_scalar::<_, String>(
        "SELECT state FROM node_xsp_product_nodes WHERE node_id=$1 FOR UPDATE",
    )
    .bind(node_id)
    .fetch_optional(&mut *tx)
    .await?;
    let revoked = if product.is_some() {
        let result = sqlx::query(
            "UPDATE node_xsp_product_nodes SET state='revoked',revoked_at=NOW(),activated_at=NULL,
             receipt_sha256=NULL,receipt_envelope=NULL WHERE node_id=$1",
        )
        .bind(node_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM node_xsp_product_nonces WHERE node_id=$1")
            .bind(node_id)
            .execute(&mut *tx)
            .await?;
        result.rows_affected() > 0
    } else {
        let deleted = sqlx::query("DELETE FROM node_metric_keys WHERE node_id=$1")
            .bind(node_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM node_metric_nonces WHERE node_id=$1")
            .bind(node_id)
            .execute(&mut *tx)
            .await?;
        deleted.rows_affected() > 0
    };
    tx.commit().await?;
    crate::audit(
        &state.pool,
        &actor.username,
        "node_metrics.key_revoked",
        Some("nodes"),
        Some(node_id),
        json!({"allCredentialsRevoked":true,"strictPQ":product.is_some()}),
    )
    .await;
    Ok(Json(
        json!({"revoked":revoked,"allCredentialsRevoked":true}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn product_secret_comparison_is_exact() {
        assert!(constant_time_equal(b"abc", b"abc"));
        assert!(!constant_time_equal(b"abc", b"abd"));
        assert!(!constant_time_equal(b"abc", b"ab"));
    }

    #[test]
    fn message_binds_method_path_identity_nonce_timestamp_and_body() {
        let a = canonical(
            42,
            1_800_000_000,
            "00112233445566778899aabbccddeeff",
            br#"{"node_id":42}"#,
        );
        assert!(a.starts_with("XMESH1\nPOST\n/api/v1/metrics/ingest\n42\n1800000000\n"));
        assert_ne!(
            a,
            canonical(
                43,
                1_800_000_000,
                "00112233445566778899aabbccddeeff",
                br#"{"node_id":42}"#
            )
        );
        assert_ne!(
            a,
            canonical(
                42,
                1_800_000_000,
                "00112233445566778899aabbccddeeff",
                br#"{"node_id":43}"#
            )
        );
        assert!(valid_nonce("00112233445566778899aabbccddeeff"));
        assert!(!valid_nonce("00112233445566778899AAbbccddeeff"));
        assert!(check_timestamp(100, 220));
        assert!(!check_timestamp(100, 221));
    }

    #[test]
    fn signature_rejects_tampered_payload_and_reused_identity() {
        let signing = SigningKey::from_bytes(&[7_u8; 32]);
        let public = hex::encode(signing.verifying_key().to_bytes());
        let timestamp = 1_800_000_000;
        let nonce = "00112233445566778899aabbccddeeff";
        let raw = br#"{"node_id":42}"#;
        let sig = signing.sign(canonical(42, timestamp, nonce, raw).as_bytes());
        let mut headers = HeaderMap::new();
        headers.insert("x-xmesh-timestamp", timestamp.to_string().parse().unwrap());
        headers.insert("x-xmesh-nonce", nonce.parse().unwrap());
        headers.insert(
            "x-xmesh-signature",
            hex::encode(sig.to_bytes()).parse().unwrap(),
        );
        assert!(
            verified_signature(
                &public,
                &headers,
                42,
                raw,
                timestamp,
                "/api/v1/metrics/ingest"
            )
            .is_ok()
        );
        assert!(
            verified_signature(
                &public,
                &headers,
                43,
                raw,
                timestamp,
                "/api/v1/metrics/ingest"
            )
            .is_err()
        );
        assert!(
            verified_signature(
                &public,
                &headers,
                42,
                br#"{"node_id":43}"#,
                timestamp,
                "/api/v1/metrics/ingest"
            )
            .is_err()
        );
        assert!(
            verified_signature(
                &public,
                &headers,
                42,
                raw,
                timestamp + 121,
                "/api/v1/metrics/ingest"
            )
            .is_err()
        );
    }
}
