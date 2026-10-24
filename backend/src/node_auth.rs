//! Per-node proof-of-possession authentication for telemetry.
//! Ed25519 keys are registered by an authenticated owner; only public keys
//! are stored. Only signed requests can authenticate telemetry.
//! The signed message binds method, path, node, timestamp, nonce and raw body.
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
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_CLOCK_SKEW_SECONDS: i64 = 120;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnrollKey {
    public_key: String,
}

fn error(message: &'static str) -> ApiError {
    ApiError::new(StatusCode::UNAUTHORIZED, message)
}

pub fn canonical_for(path: &str, node_id: i64, timestamp: i64, nonce: &str, body: &[u8]) -> String {
    let digest = hex::encode(Sha256::digest(body));
    format!("XMESH1\nPOST\n{path}\n{node_id}\n{timestamp}\n{nonce}\n{digest}\n")
}

#[cfg(test)]
pub(crate) fn canonical(node_id: i64, timestamp: i64, nonce: &str, body: &[u8]) -> String {
    canonical_for("/api/v1/metrics/ingest", node_id, timestamp, nonce, body)
}

fn valid_nonce(nonce: &str) -> bool {
    nonce.len() == 32
        && nonce
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
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
        .and_then(|x| x.to_str().ok())
        .ok_or_else(|| error("Требуется подписанный запрос от узла."))?;
    // Canonical decimal timestamp; reject whitespace, signs, leading zeroes.
    if timestamp_raw.is_empty()
        || timestamp_raw.len() > 16
        || !timestamp_raw.bytes().all(|b| b.is_ascii_digit())
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
        .and_then(|x| x.to_str().ok())
        .filter(|x| valid_nonce(x))
        .ok_or_else(|| error("Недопустимый одноразовый идентификатор запроса."))?;
    let signature_hex = headers
        .get("x-xmesh-signature")
        .and_then(|x| x.to_str().ok())
        .filter(|x| x.len() == 128 && x.bytes().all(|b| b.is_ascii_hexdigit()))
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
    let signature = Signature::from_bytes(&signature_data);
    verifying_key
        .verify(
            canonical_for(path, node_id, timestamp, nonce, raw_body).as_bytes(),
            &signature,
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
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Публичный Ed25519-ключ должен состоять из 64 строчных hex-символов.",
        ));
    }
    let raw: [u8; 32] = hex::decode(&request.public_key)
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Некорректный публичный ключ."))?;
    VerifyingKey::from_bytes(&raw)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Неверный публичный Ed25519-ключ."))?;
    let mut tx = state.pool.begin().await?;
    // Serialize enrollment and key rotation on the node row.
    let exists =
        sqlx::query("SELECT id FROM panel_records WHERE collection='nodes' AND id=$1 FOR UPDATE")
            .bind(node_id)
            .fetch_optional(&mut *tx)
            .await?;
    if exists.is_none() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Узел не найден."));
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
        json!({"algorithm":"Ed25519"}),
    )
    .await;
    Ok((
        StatusCode::CREATED,
        Json(json!({"nodeId":node_id,"authentication":"ed25519"})),
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
    let deleted = sqlx::query("DELETE FROM node_metric_keys WHERE node_id=$1")
        .bind(node_id)
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
        "node_metrics.key_revoked",
        Some("nodes"),
        Some(node_id),
        json!({"allCredentialsRevoked":true}),
    )
    .await;
    Ok(Json(
        json!({"revoked":deleted.rows_affected()>0,"allCredentialsRevoked":true}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
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
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let public = hex::encode(signing.verifying_key().to_bytes());
        let timestamp = 1_800_000_000;
        let nonce = "00112233445566778899aabbccddeeff";
        let raw = br#"{"node_id":42}"#;
        let signed = canonical(42, timestamp, nonce, raw);
        let sig = signing.sign(signed.as_bytes());
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
