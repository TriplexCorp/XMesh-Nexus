//! Per-user, per-node public address rotation.
//! The selection is transactional so simultaneous subscription refreshes cannot
//! accidentally reuse the same cursor. This module does not change server IPs.
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::{StatusCode, header},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use std::{collections::HashSet, net::IpAddr};

use crate::{ApiError, AppState, auth, user_status};

const MAX_POOL: usize = 256;

fn invalid(message: &str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, message)
}

pub(crate) fn parse_pool(value: &Value) -> Result<Vec<IpAddr>, ApiError> {
    let Some(raw) = value.get("rotationIps") else {
        return Ok(Vec::new());
    };
    let source = raw
        .as_str()
        .ok_or_else(|| invalid("Пул ротации должен быть текстом: один IP в каждой строке."))?;
    if source.len() > 16384 {
        return Err(invalid("Слишком большой список IP-адресов (максимум 256)."));
    }
    let mut seen = HashSet::new();
    let mut addresses = Vec::new();
    for line in source.lines() {
        let entry = line.trim();
        if entry.is_empty() {
            continue;
        }
        let ip: IpAddr = entry.parse().map_err(|_| {
            invalid("Пул ротации принимает только IP-адреса, по одному на строку, без портов.")
        })?;
        if ip.is_unspecified() || ip.is_loopback() || ip.is_multicast() {
            return Err(invalid(
                "В пуле запрещены локальные, групповые и неопределённые IP-адреса.",
            ));
        }
        if !seen.insert(ip) {
            return Err(invalid("В пуле ротации есть повторяющиеся IP-адреса."));
        }
        addresses.push(ip);
        if addresses.len() > MAX_POOL {
            return Err(invalid(
                "В пуле ротации допускается не более 256 IP-адресов.",
            ));
        }
    }
    Ok(addresses)
}

pub(crate) fn validate_node(value: &Value) -> Result<(), ApiError> {
    let enabled = match value.get("rotationEnabled") {
        None => false,
        Some(Value::Bool(value)) => *value,
        _ => return Err(invalid("Ротация IP должна быть включена или выключена.")),
    };
    if let Some(value) = value.get("rotationIntervalHours") {
        let hours = value
            .as_i64()
            .ok_or_else(|| invalid("Интервал IP-ротации должен быть целым числом часов."))?;
        if !(1..=720).contains(&hours) {
            return Err(invalid(
                "Интервал IP-ротации должен быть от 1 до 720 часов.",
            ));
        }
    }
    let pool = parse_pool(value)?;
    if enabled && pool.len() < 2 {
        return Err(invalid(
            "Для включения ротации укажите хотя бы два различных IP-адреса.",
        ));
    }
    Ok(())
}

fn choose(pool: &[IpAddr], cursor: i64, last_ip: &str) -> (usize, String) {
    let mut index = cursor.rem_euclid(pool.len() as i64) as usize;
    if pool.len() > 1 && pool[index].to_string() == last_ip {
        index = (index + 1) % pool.len();
    }
    (index, pool[index].to_string())
}

/// Called exactly once per *actual subscription refresh* by a subscription
/// generator. Safe across panel replicas; do not call it for UI previews.
pub(crate) async fn resolve_address(
    state: &AppState,
    node_id: i64,
    user_id: i64,
) -> Result<(String, bool, usize), ApiError> {
    resolve_address_inner(state, node_id, user_id, false).await
}

/// Public subscriptions are sticky for a bounded interval, while the
/// administrator's explicit /rotation/next endpoint advances immediately.
/// The same row lock serializes all selections across replicas.
pub(crate) async fn resolve_subscription_address(
    state: &AppState,
    node_id: i64,
    user_id: i64,
) -> Result<String, ApiError> {
    Ok(resolve_address_inner(state, node_id, user_id, true)
        .await?
        .0)
}

fn interval_hours(node: &Value) -> i64 {
    node.get("rotationIntervalHours")
        .and_then(Value::as_i64)
        .filter(|hours| (1..=720).contains(hours))
        .unwrap_or(24)
}

fn reusable_address(pool: &[IpAddr], previous: &str, elapsed_seconds: i64, hours: i64) -> bool {
    elapsed_seconds >= 0
        && elapsed_seconds < hours * 3600
        && pool.iter().any(|ip| ip.to_string() == previous)
}

async fn resolve_address_inner(
    state: &AppState,
    node_id: i64,
    user_id: i64,
    sticky: bool,
) -> Result<(String, bool, usize), ApiError> {
    let node_row = sqlx::query("SELECT data FROM panel_records WHERE collection='nodes' AND id=$1")
        .bind(node_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Узел не найден."))?;
    let node: Value = node_row.try_get("data")?;
    if node.get("disabled").and_then(Value::as_bool) == Some(true) {
        return Err(ApiError::new(StatusCode::CONFLICT, "Узел отключён."));
    }
    let user_row = sqlx::query("SELECT data FROM panel_records WHERE collection='users' AND id=$1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Пользователь не найден."))?;
    let user: Value = user_row.try_get("data")?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    if user_status(&user, now_ms) != "ACTIVE" {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Подписка пользователя неактивна.",
        ));
    }

    let primary = node
        .get("addr")
        .and_then(Value::as_str)
        .filter(|address| !address.trim().is_empty())
        .ok_or_else(|| invalid("У узла отсутствует основной адрес."))?;
    let pool = parse_pool(&node)?;
    if node.get("rotationEnabled").and_then(Value::as_bool) != Some(true) {
        return Ok((primary.to_owned(), false, pool.len()));
    }
    // Validation also protects pre-existing JSON records, not only new updates.
    validate_node(&node)?;

    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO node_ip_rotation_cursors (node_id, user_id, next_index, last_ip) \
         VALUES ($1, $2, 0, '') ON CONFLICT (node_id, user_id) DO NOTHING",
    )
    .bind(node_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    let row = sqlx::query(
        "SELECT next_index, last_ip, EXTRACT(EPOCH FROM (NOW()-updated_at))::BIGINT AS elapsed_seconds FROM node_ip_rotation_cursors \
         WHERE node_id=$1 AND user_id=$2 FOR UPDATE",
    )
    .bind(node_id)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;
    let index: i64 = row.try_get("next_index")?;
    let last_ip: String = row.try_get("last_ip")?;
    let elapsed: i64 = row.try_get("elapsed_seconds")?;
    if sticky && reusable_address(&pool, &last_ip, elapsed, interval_hours(&node)) {
        tx.commit().await?;
        return Ok((last_ip, true, pool.len()));
    }
    let (chosen_index, address) = choose(&pool, index, &last_ip);
    sqlx::query(
        "UPDATE node_ip_rotation_cursors SET next_index=$3, last_ip=$4, updated_at=NOW() \
         WHERE node_id=$1 AND user_id=$2",
    )
    .bind(node_id)
    .bind(user_id)
    .bind((chosen_index as i64) + 1)
    .bind(&address)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((address, true, pool.len()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RotateRequest {
    user_id: i64,
}

/// Session-protected integration endpoint; never publicly expose IDs as access tokens.
/// The subscription server must call the resolver on an authenticated code path.
pub(crate) async fn rotate_next(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
    Path(node_id): Path<i64>,
    Json(request): Json<RotateRequest>,
) -> Result<impl axum::response::IntoResponse, ApiError> {
    super::require_mutation(&actor)?;
    let (address, enabled, pool_size) = resolve_address(&state, node_id, request.user_id).await?;
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(json!({
            "nodeId": node_id,
            "userId": request.user_id,
            "address": address,
            "rotationEnabled": enabled,
            "poolSize": pool_size,
        })),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_and_duplicate_pools() {
        assert!(parse_pool(&json!({"rotationIps":"1.1.1.1\n1.1.1.1"})).is_err());
        assert!(parse_pool(&json!({"rotationIps":"example.com"})).is_err());
        assert!(parse_pool(&json!({"rotationIps":"127.0.0.1"})).is_err());
        assert!(validate_node(&json!({"rotationEnabled":true,"rotationIps":"1.1.1.1"})).is_err());
        assert!(
            validate_node(&json!({"rotationEnabled":true,"rotationIps":"1.1.1.1\n9.9.9.9"}))
                .is_ok()
        );
        assert!(validate_node(&json!({"rotationIntervalHours":0})).is_err());
        assert!(validate_node(&json!({"rotationIntervalHours":721})).is_err());
        assert!(validate_node(&json!({"rotationIntervalHours":24})).is_ok());
    }
    #[test]
    fn sticky_lease_reuses_until_expiry_or_pool_change() {
        let pool = parse_pool(&json!({"rotationIps":"13.143.175.129\n13.143.175.130"})).unwrap();
        assert!(reusable_address(&pool, "13.143.175.129", 3599, 1));
        assert!(!reusable_address(&pool, "13.143.175.129", 3600, 1));
        assert!(!reusable_address(&pool, "13.143.175.131", 60, 24));
        assert!(!reusable_address(&pool, "", 60, 24));
        assert_eq!(interval_hours(&json!({})), 24);
        assert_eq!(interval_hours(&json!({"rotationIntervalHours":12})), 12);
        assert_eq!(interval_hours(&json!({"rotationIntervalHours":0})), 24);
    }
    #[test]
    fn rotates_without_repeating_last_address() {
        let pool =
            parse_pool(&json!({"rotationIps":"1.1.1.1\n9.9.9.9\n2606:4700:4700::1111"})).unwrap();
        let mut index = 0;
        let mut previous = String::new();
        for _ in 0..20 {
            let (selected, address) = choose(&pool, index, &previous);
            assert_ne!(address, previous);
            previous = address;
            index = selected as i64 + 1;
        }
        // Even after a pool edit, a stale cursor cannot immediately repeat.
        let reduced = &pool[..2];
        assert_ne!(choose(reduced, 2, "1.1.1.1").1, "1.1.1.1");
    }
}
