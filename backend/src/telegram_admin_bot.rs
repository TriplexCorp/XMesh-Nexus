//! Owner-configured built-in Telegram administrator bot.
//! The BotFather credential is encrypted at rest and never serialized or logged.
//! Telegram long polling needs no externally accessible webhook/extra container.
use crate::{ApiError, AppState, auth::AuthUser};
use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, OsRng, Payload, rand_core::RngCore},
};
use axum::{
    Json,
    extract::{Extension, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::time::{SystemTime, UNIX_EPOCH};

const AAD: &[u8] = b"xmesh-nexus:telegram-admin-bot:credential:v1";
pub(crate) const LEADER_LOCK_ID: i64 = 0x584d_4553_4854_4742;

fn bad(message: &'static str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, message)
}

fn secret_cipher(state: &AppState) -> Aes256Gcm {
    // Domain-separated from public subscription-token ciphertexts.
    let mut digest = Sha256::new();
    digest.update(AAD);
    digest.update(state.subscription_key);
    let key = digest.finalize();
    Aes256Gcm::new_from_slice(&key).expect("SHA-256 always produces 256-bit keys")
}

fn encrypt(state: &AppState, token: &str) -> Result<Vec<u8>, ApiError> {
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = secret_cipher(state)
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: token.as_bytes(),
                aad: AAD,
            },
        )
        .map_err(|_| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "Не удалось сохранить токен бота.",
            )
        })?;
    let mut bytes = nonce.to_vec();
    bytes.extend(ciphertext);
    Ok(bytes)
}

pub(crate) fn decrypt(state: &AppState, ciphertext: &[u8]) -> Result<String, ApiError> {
    if ciphertext.len() < 29 {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Зашифрованный токен бота повреждён.",
        ));
    }
    let plaintext = secret_cipher(state)
        .decrypt(
            Nonce::from_slice(&ciphertext[..12]),
            Payload {
                msg: &ciphertext[12..],
                aad: AAD,
            },
        )
        .map_err(|_| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "Не удалось расшифровать токен бота.",
            )
        })?;
    String::from_utf8(plaintext).map_err(|_| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Зашифрованный токен бота повреждён.",
        )
    })
}

pub(crate) fn validate_token(token: &str) -> bool {
    let Some((id, secret)) = token.split_once(':') else {
        return false;
    };
    (5..=16).contains(&id.len())
        && id.bytes().all(|b| b.is_ascii_digit())
        && (30..=96).contains(&secret.len())
        && secret
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}

fn validate_ids(ids: &[i64], enabled: bool) -> Result<(), ApiError> {
    if ids.len() > 50 || (enabled && ids.is_empty()) || ids.iter().any(|id| *id <= 0) {
        return Err(bad(
            "Укажите от 1 до 50 корректных Telegram ID администраторов.",
        ));
    }
    let mut sorted = ids.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    if sorted.len() != ids.len() {
        return Err(bad("Telegram ID администраторов не должны повторяться."));
    }
    Ok(())
}

#[derive(Clone)]
pub(crate) struct BotConfig {
    pub enabled: bool,
    pub admins: Vec<i64>,
    pub ciphertext: Option<Vec<u8>>,
    pub revision: i64,
    pub last_update_id: i64,
}

pub(crate) async fn load(state: &AppState) -> Result<BotConfig, ApiError> {
    let row = sqlx::query(
        "SELECT enabled,admin_ids,token_ciphertext,revision,last_update_id
         FROM telegram_admin_bot WHERE singleton=TRUE",
    )
    .fetch_one(&state.pool)
    .await?;
    Ok(BotConfig {
        enabled: row.try_get("enabled")?,
        admins: row.try_get("admin_ids")?,
        ciphertext: row.try_get("token_ciphertext")?,
        revision: row.try_get("revision")?,
        last_update_id: row.try_get("last_update_id")?,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BotSave {
    enabled: bool,
    admin_ids: Vec<i64>,
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    clear_token: bool,
}

pub(crate) async fn status(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Value>, ApiError> {
    crate::require_owner(&actor)?;
    let row = sqlx::query(
        "SELECT enabled,admin_ids,token_ciphertext IS NOT NULL AS configured,
                bot_username,bot_id,last_error,revision,
                (EXTRACT(EPOCH FROM last_connected_at)*1000)::BIGINT AS connected_at_ms,
                last_connected_at > NOW() - INTERVAL '90 seconds' AS recently_connected
         FROM telegram_admin_bot WHERE singleton=TRUE",
    )
    .fetch_one(&state.pool)
    .await?;
    let enabled: bool = row.try_get("enabled")?;
    let configured: bool = row.try_get("configured")?;
    let recently_connected: Option<bool> = row.try_get("recently_connected")?;
    let error: Option<String> = row.try_get("last_error")?;
    Ok(Json(json!({
        "enabled":enabled,
        "tokenConfigured":configured,
        "adminIds":row.try_get::<Vec<i64>,_>("admin_ids")?,
        "botUsername":row.try_get::<Option<String>,_>("bot_username")?,
        "botId":row.try_get::<Option<i64>,_>("bot_id")?,
        "connected":enabled && recently_connected == Some(true),
        "lastConnectedAtMs":row.try_get::<Option<i64>,_>("connected_at_ms")?,
        "lastError":error,
        "revision":row.try_get::<i64,_>("revision")?
    })))
}

pub(crate) async fn save(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<BotSave>,
) -> Result<Json<Value>, ApiError> {
    crate::require_owner(&actor)?;
    validate_ids(&body.admin_ids, body.enabled)?;
    if body.clear_token && body.token.is_some() {
        return Err(bad("Нельзя одновременно установить и удалить токен."));
    }
    let requested_token = body.token.as_deref().map(str::trim);
    if requested_token.is_some_and(|token| !validate_token(token)) {
        return Err(bad("Неверный формат токена BotFather."));
    }
    let mut tx = state.pool.begin().await?;
    let row = sqlx::query(
        "SELECT token_ciphertext,token_fingerprint FROM telegram_admin_bot
         WHERE singleton=TRUE FOR UPDATE",
    )
    .fetch_one(&mut *tx)
    .await?;
    let original: Option<Vec<u8>> = row.try_get("token_ciphertext")?;
    let old_fingerprint: Option<String> = row.try_get("token_fingerprint")?;
    let fingerprint = requested_token.map(|token| hex::encode(Sha256::digest(token.as_bytes())));
    let rotated = body.clear_token
        || fingerprint
            .as_ref()
            .is_some_and(|value| old_fingerprint.as_ref() != Some(value));
    let next_token = if body.clear_token {
        None
    } else if let Some(token) = requested_token {
        if !rotated {
            original.clone()
        } else {
            Some(encrypt(&state, token)?)
        }
    } else {
        original.clone()
    };
    if body.enabled && next_token.is_none() {
        return Err(bad("Укажите токен BotFather перед включением бота."));
    }
    // Never expose a token in returned JSON, status, SQL audit or tracing logs.
    sqlx::query(
        "UPDATE telegram_admin_bot SET enabled=$1,admin_ids=$2,token_ciphertext=$3,
                token_fingerprint=$4,revision=revision+1,updated_at=NOW(),
                bot_id=CASE WHEN $5 THEN NULL ELSE bot_id END,
                bot_username=CASE WHEN $5 THEN NULL ELSE bot_username END,
                last_update_id=CASE WHEN $5 THEN 0 ELSE last_update_id END,
                last_connected_at=NULL,last_error=NULL
         WHERE singleton=TRUE",
    )
    .bind(body.enabled && next_token.is_some())
    .bind(&body.admin_ids)
    .bind(&next_token)
    .bind(if body.clear_token {
        None
    } else {
        fingerprint.or(old_fingerprint)
    })
    .bind(rotated)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    crate::audit(
        &state.pool,
        &actor.username,
        "telegram_bot.configuration_updated",
        None,
        None,
        json!({
            "enabled":body.enabled,
            "adminCount":body.admin_ids.len(),
            "tokenChanged":rotated
        }),
    )
    .await;
    Ok(Json(
        json!({"saved":true,"enabled":body.enabled,"tokenConfigured":next_token.is_some()}),
    ))
}

pub(crate) fn spawn_worker(state: AppState) {
    tokio::spawn(async move {
        crate::telegram_admin_bot_worker::run(state).await;
    });
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bot_tokens_and_admin_ids_are_strict() {
        assert!(validate_token(&format!("123456789:{}", "A".repeat(35))));
        for raw in ["", "1234:1234", "abc:whatever", "12345:hello", "1:xxx"] {
            assert!(!validate_token(raw), "{raw}");
        }
        assert!(validate_ids(&[1, 2, 3], true).is_ok());
        assert!(validate_ids(&[], true).is_err());
        assert!(validate_ids(&[2, 2], true).is_err());
        assert!(validate_ids(&[-1001], true).is_err());
    }
}
