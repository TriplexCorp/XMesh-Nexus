use crate::{ApiError, AppState};
use axum::{
    Json,
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};

const STALE_AFTER_DAYS: i64 = 45;
const TOUCH_AFTER_MINUTES: i64 = 5;

#[derive(Debug, Clone)]
struct DeviceClaim {
    canonical_hwid: String,
    platform: &'static str,
    device_os: String,
    os_version: String,
    model: String,
    app: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Unlimited,
    Allowed {
        limit: i64,
        count: i64,
        replaced_stale: bool,
    },
    Missing {
        limit: i64,
        count: i64,
        invalid: bool,
    },
    LimitReached {
        limit: i64,
        count: i64,
    },
}

fn bounded_header(headers: &HeaderMap, name: &'static str, maximum: usize) -> String {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(maximum)
        .collect()
}

fn canonical_hwid(raw: &str) -> Option<String> {
    let value = raw.trim();
    if !(10..=64).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'=' | b'-'))
    {
        return None;
    }
    let bytes = value.as_bytes();
    let uuid_like = value.len() == 36
        && [8, 13, 18, 23]
            .into_iter()
            .all(|index| bytes.get(index) == Some(&b'-'))
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit());
    if uuid_like {
        Some(
            value
                .bytes()
                .filter(|byte| *byte != b'-')
                .map(char::from)
                .collect::<String>()
                .to_ascii_lowercase(),
        )
    } else {
        Some(value.to_owned())
    }
}

fn app_from_user_agent(user_agent: &str) -> String {
    let lowered = user_agent.to_ascii_lowercase();
    for (needle, label) in [
        ("shadowrocket", "Shadowrocket"),
        ("streisand", "Streisand"),
        ("v2raytun", "v2rayTun"),
        ("v2rayng", "v2rayNG"),
        ("v2rayn", "v2rayN"),
        ("nekobox", "NekoBox"),
        ("hiddify", "Hiddify"),
        ("sing-box", "sing-box"),
        ("singbox", "sing-box"),
        ("mihomo", "Mihomo"),
        ("clash", "Clash"),
        ("v2box", "V2Box"),
        ("incy", "Incy"),
        ("happ", "Happ"),
    ] {
        if lowered.contains(needle) {
            return label.to_owned();
        }
    }
    "Unknown client".to_owned()
}

fn platform_from(device_os: &str, user_agent: &str) -> &'static str {
    let value = format!("{device_os} {user_agent}").to_ascii_lowercase();
    if value.contains("iphone")
        || value.contains("ipad")
        || value.contains("ios")
        || value.contains("cfnetwork")
    {
        "ios"
    } else if value.contains("android") {
        "android"
    } else if value.contains("windows") || value.contains("win64") || value.contains("win32") {
        "windows"
    } else if value.contains("macos")
        || value.contains("mac os")
        || value.contains("macintosh")
        || value.contains("darwin")
    {
        "macos"
    } else if value.contains("linux") {
        "linux"
    } else {
        "unknown"
    }
}

fn device_claim(headers: &HeaderMap) -> Result<DeviceClaim, bool> {
    let raw = bounded_header(headers, "x-hwid", 80);
    if raw.is_empty() {
        return Err(false);
    }
    let Some(canonical_hwid) = canonical_hwid(&raw) else {
        return Err(true);
    };
    let device_os = bounded_header(headers, "x-device-os", 80);
    let os_version = bounded_header(headers, "x-ver-os", 80);
    let model = bounded_header(headers, "x-device-model", 160);
    let user_agent = bounded_header(headers, "user-agent", 256);
    Ok(DeviceClaim {
        canonical_hwid,
        platform: platform_from(&device_os, &user_agent),
        device_os,
        os_version,
        model,
        app: app_from_user_agent(&user_agent),
    })
}

fn device_key(user_id: i64, canonical_hwid: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"XMESH-SMART-HWID-V1\0");
    digest.update(user_id.to_be_bytes());
    digest.update(b"\0");
    digest.update(canonical_hwid.as_bytes());
    hex::encode(digest.finalize())
}

fn user_limit(user: &Value) -> i64 {
    user.get("hwid").and_then(Value::as_i64).unwrap_or(0).max(0)
}

async fn token_user_id(state: &AppState, token: &str) -> Result<Option<i64>, ApiError> {
    if token.len() != 64
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Ok(None);
    }
    let hash = hex::encode(Sha256::digest(token.as_bytes()));
    let id = sqlx::query_scalar::<_, i64>(
        "SELECT user_id FROM user_subscription_tokens WHERE token_hash=$1",
    )
    .bind(hash)
    .fetch_optional(&state.pool)
    .await?;
    Ok(id)
}

async fn count_devices(tx: &mut Transaction<'_, Postgres>, user_id: i64) -> Result<i64, ApiError> {
    Ok(sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::BIGINT FROM user_subscription_devices WHERE user_id=$1",
    )
    .bind(user_id)
    .fetch_one(&mut **tx)
    .await?)
}

async fn device_projection_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i64,
) -> Result<Vec<Value>, ApiError> {
    let rows = sqlx::query(
        "SELECT id,hwid_tag,platform,device_os,os_version,model,app,refresh_count,
                (EXTRACT(EPOCH FROM first_seen_at)*1000)::BIGINT AS first_ms,
                (EXTRACT(EPOCH FROM last_seen_at)*1000)::BIGINT AS last_ms
           FROM user_subscription_devices
          WHERE user_id=$1
          ORDER BY last_seen_at DESC,id DESC",
    )
    .bind(user_id)
    .fetch_all(&mut **tx)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(json!({
                "id": row.try_get::<i64,_>("id")?,
                "fingerprint": row.try_get::<String,_>("hwid_tag")?,
                "plat": row.try_get::<String,_>("platform")?,
                "os": row.try_get::<String,_>("device_os")?,
                "osVersion": row.try_get::<String,_>("os_version")?,
                "model": row.try_get::<String,_>("model")?,
                "app": row.try_get::<String,_>("app")?,
                "first": row.try_get::<i64,_>("first_ms")?,
                "last": row.try_get::<i64,_>("last_ms")?,
                "refreshes": row.try_get::<i64,_>("refresh_count")?
            }))
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(ApiError::from)
}

async fn sync_projection(
    tx: &mut Transaction<'_, Postgres>,
    user_id: i64,
) -> Result<(), ApiError> {
    let devices = device_projection_tx(tx, user_id).await?;
    sqlx::query(
        "UPDATE panel_records
            SET data=jsonb_set(data,'{devices}',$2,true)
          WHERE collection='users' AND id=$1",
    )
    .bind(user_id)
    .bind(Value::Array(devices))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[expect(
    clippy::too_many_lines,
    reason = "Slot allocation is intentionally one transaction so the lock and capacity decision remain auditable"
)]
pub async fn authorize_feed(
    state: &AppState,
    token: &str,
    headers: &HeaderMap,
) -> Result<Decision, ApiError> {
    let Some(user_id) = token_user_id(state, token).await? else {
        return Ok(Decision::Unlimited);
    };
    let mut tx = state.pool.begin().await?;
    let row = sqlx::query(
        "SELECT data FROM panel_records
          WHERE collection='users' AND id=$1 FOR UPDATE",
    )
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        tx.rollback().await?;
        return Ok(Decision::Unlimited);
    };
    let user: Value = row.try_get("data")?;
    let limit = user_limit(&user);
    if limit == 0 {
        tx.commit().await?;
        return Ok(Decision::Unlimited);
    }
    let claim = match device_claim(headers) {
        Ok(claim) => claim,
        Err(invalid) => {
            let count = count_devices(&mut tx, user_id).await?;
            tx.commit().await?;
            return Ok(Decision::Missing {
                limit,
                count,
                invalid,
            });
        }
    };
    let key = device_key(user_id, &claim.canonical_hwid);
    let tag = key[..12].to_owned();
    let existing = sqlx::query(
        "SELECT platform,device_os,os_version,model,app,
                last_seen_at < NOW() - INTERVAL '5 minutes' AS needs_touch
           FROM user_subscription_devices
          WHERE user_id=$1 AND device_key=$2",
    )
    .bind(user_id)
    .bind(&key)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(existing) = existing {
        let metadata_changed = existing.try_get::<String, _>("platform")? != claim.platform
            || existing.try_get::<String, _>("device_os")? != claim.device_os
            || existing.try_get::<String, _>("os_version")? != claim.os_version
            || existing.try_get::<String, _>("model")? != claim.model
            || existing.try_get::<String, _>("app")? != claim.app;
        let needs_touch: bool = existing.try_get("needs_touch")?;
        if needs_touch || metadata_changed {
            sqlx::query(
                "UPDATE user_subscription_devices
                    SET platform=$3,device_os=$4,os_version=$5,model=$6,app=$7,
                        last_seen_at=NOW(),refresh_count=refresh_count+1
                  WHERE user_id=$1 AND device_key=$2",
            )
            .bind(user_id)
            .bind(&key)
            .bind(claim.platform)
            .bind(&claim.device_os)
            .bind(&claim.os_version)
            .bind(&claim.model)
            .bind(&claim.app)
            .execute(&mut *tx)
            .await?;
            sync_projection(&mut tx, user_id).await?;
        }
        let count = count_devices(&mut tx, user_id).await?;
        tx.commit().await?;
        return Ok(Decision::Allowed {
            limit,
            count,
            replaced_stale: false,
        });
    }

    let mut count = count_devices(&mut tx, user_id).await?;
    let mut replaced_stale = false;
    if count >= limit {
        let stale = sqlx::query_scalar::<_, i64>(
            "SELECT id FROM user_subscription_devices
              WHERE user_id=$1 AND last_seen_at < NOW() - INTERVAL '45 days'
              ORDER BY last_seen_at ASC,id ASC LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(stale_id) = stale {
            sqlx::query("DELETE FROM user_subscription_devices WHERE user_id=$1 AND id=$2")
                .bind(user_id)
                .bind(stale_id)
                .execute(&mut *tx)
                .await?;
            count -= 1;
            replaced_stale = true;
        }
    }
    if count >= limit {
        tx.commit().await?;
        return Ok(Decision::LimitReached { limit, count });
    }
    sqlx::query(
        "INSERT INTO user_subscription_devices
             (user_id,device_key,hwid_tag,platform,device_os,os_version,model,app)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(user_id)
    .bind(&key)
    .bind(&tag)
    .bind(claim.platform)
    .bind(&claim.device_os)
    .bind(&claim.os_version)
    .bind(&claim.model)
    .bind(&claim.app)
    .execute(&mut *tx)
    .await?;
    count += 1;
    sync_projection(&mut tx, user_id).await?;
    tx.commit().await?;
    if replaced_stale {
        tracing::info!(
            user_id,
            device_tag = %tag,
            stale_after_days = STALE_AFTER_DAYS,
            "Replaced stale subscription device slot"
        );
    }
    Ok(Decision::Allowed {
        limit,
        count,
        replaced_stale,
    })
}

fn insert_header(response: &mut Response, name: &'static str, value: &str) {
    if let (Ok(name), Ok(value)) = (
        HeaderName::from_bytes(name.as_bytes()),
        HeaderValue::from_str(value),
    ) {
        response.headers_mut().insert(name, value);
    }
}

fn announcement(headers: &HeaderMap, code: &str) -> String {
    let english = headers
        .get(header::ACCEPT_LANGUAGE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.trim().to_ascii_lowercase().starts_with("en"));
    let text = match (code, english) {
        ("device_limit_reached", true) => {
            "Device limit reached. Remove an old device or ask support to reset device slots."
        }
        ("device_limit_reached", false) => {
            "Достигнут лимит устройств. Удалите старое устройство или попросите поддержку сбросить слоты."
        }
        ("device_id_invalid", true) => {
            "The VPN client sent an invalid HWID. Update or reinstall the client."
        }
        ("device_id_invalid", false) => {
            "VPN-клиент передал некорректный HWID. Обновите или переустановите клиент."
        }
        (_, true) => "This subscription requires a client that sends a device HWID.",
        (_, false) => "Для этой подписки нужен клиент, который передаёт HWID устройства.",
    };
    format!("base64:{}", STANDARD.encode(text.as_bytes()))
}

fn hwid_headers(response: &mut Response, limit: i64, count: i64) {
    insert_header(response, "x-hwid-active", "true");
    insert_header(response, "x-hwid-limit", &limit.to_string());
    insert_header(response, "x-hwid-device-count", &count.to_string());
    insert_header(response, "subscription-always-hwid-enable", "1");
}

pub fn apply_decision(
    response: Response,
    decision: Decision,
    request_headers: &HeaderMap,
) -> Response {
    match decision {
        Decision::Unlimited => response,
        Decision::Allowed {
            limit,
            count,
            replaced_stale,
        } => {
            let mut response = response;
            hwid_headers(&mut response, limit, count);
            if replaced_stale {
                insert_header(&mut response, "x-hwid-stale-slot-replaced", "true");
            }
            response
        }
        Decision::Missing {
            limit,
            count,
            invalid,
        } => {
            let code = if invalid {
                "device_id_invalid"
            } else {
                "device_id_required"
            };
            let mut response = (
                StatusCode::FORBIDDEN,
                Json(json!({
                    "error": if invalid {"Invalid device HWID"} else {"Device HWID required"},
                    "code":code,
                    "deviceLimit":{"limit":limit,"registered":count,"staleAfterDays":STALE_AFTER_DAYS}
                })),
            )
                .into_response();
            hwid_headers(&mut response, limit, count);
            insert_header(&mut response, "x-hwid-not-supported", "true");
            insert_header(&mut response, "profile-update-interval", "1");
            insert_header(
                &mut response,
                "announce",
                &announcement(request_headers, code),
            );
            response
        }
        Decision::LimitReached { limit, count } => {
            let mut response = (
                StatusCode::FORBIDDEN,
                Json(json!({
                    "error":"Device limit reached",
                    "code":"device_limit_reached",
                    "deviceLimit":{"limit":limit,"registered":count,"staleAfterDays":STALE_AFTER_DAYS}
                })),
            )
                .into_response();
            hwid_headers(&mut response, limit, count);
            insert_header(&mut response, "x-hwid-max-devices-reached", "true");
            insert_header(&mut response, "profile-update-interval", "1");
            insert_header(
                &mut response,
                "announce",
                &announcement(request_headers, "device_limit_reached"),
            );
            response
        }
    }
}

pub async fn admin_status(state: &AppState, user_id: i64) -> Result<Value, ApiError> {
    let row = sqlx::query("SELECT data FROM panel_records WHERE collection='users' AND id=$1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "User not found"))?;
    let user: Value = row.try_get("data")?;
    let limit = user_limit(&user);
    let mut tx = state.pool.begin().await?;
    let devices = device_projection_tx(&mut tx, user_id).await?;
    tx.commit().await?;
    Ok(json!({
        "enabled":limit>0,
        "mode":"smart-hwid-v1",
        "limit":limit,
        "count":devices.len(),
        "staleAfterDays":STALE_AFTER_DAYS,
        "touchIntervalMinutes":TOUCH_AFTER_MINUTES,
        "devices":devices
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_hwid_is_canonical_across_dash_and_case_variants() {
        assert_eq!(
            canonical_hwid("550E8400-E29B-41D4-A716-446655440000").as_deref(),
            Some("550e8400e29b41d4a716446655440000")
        );
        assert_eq!(
            canonical_hwid("550e8400e29b41d4a716446655440000").as_deref(),
            Some("550e8400e29b41d4a716446655440000")
        );
    }

    #[test]
    fn rejects_short_or_unsafe_device_ids() {
        assert!(canonical_hwid("short").is_none());
        assert!(canonical_hwid("valid-looking-but/unsafe").is_none());
        assert!(canonical_hwid("0123456789abcdef").is_some());
    }

    #[test]
    fn same_hwid_is_scoped_per_user_without_storing_raw_identifier() {
        let raw = "550e8400e29b41d4a716446655440000";
        let first = device_key(7, raw);
        let second = device_key(8, raw);
        assert_eq!(first.len(), 64);
        assert_ne!(first, second);
        assert!(!first.contains(raw));
    }

    #[test]
    fn metadata_changes_do_not_change_device_identity() {
        let raw = canonical_hwid("AABBCCDDEEFF0011").unwrap();
        let key = device_key(9, &raw);
        assert_eq!(key, device_key(9, &raw));
        assert_eq!(platform_from("iOS", "Happ/1"), "ios");
        assert_eq!(platform_from("Android", "Happ/1"), "android");
        assert_eq!(app_from_user_agent("Mozilla Happ/3.3"), "Happ");
    }
}
