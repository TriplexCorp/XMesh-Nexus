//! Per-user, per-node limits. These are independent of global user traffic,
//! CDN traffic and node-wide bandwidth limits. No inbound counters are ever
//! added to per-user counters, and no browser-supplied meter is trusted.
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
};
use serde_json::{Map, Value, json};
use sqlx::{PgPool, Row};
use std::collections::HashMap;

use crate::{ApiError, AppState, auth::AuthUser};

const MAX_NODE_POLICIES: usize = 256;
const MAX_LIMIT_GB: f64 = 1_000_000.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct QuotaRule {
    pub limit_bytes: i64,
    pub limit_gb: f64,
    pub period: &'static str,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NodeUsage {
    pub lifetime: i64,
    pub monthly: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Remaining {
    /// No per-node limit is configured.
    Unlimited,
    /// A limit is configured, but the authoritative meter is missing.
    Unavailable,
    /// Exact bytes, before rounding to a display label.
    Bytes(i64),
}

fn bad(message: &str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, message)
}

fn policy_map(user: &Value) -> Option<&Map<String, Value>> {
    user.get("nodeTrafficLimits").and_then(Value::as_object)
}

fn valid_id(key: &str) -> Option<i64> {
    key.parse::<i64>()
        .ok()
        .filter(|id| *id > 0 && id.to_string() == key)
}

fn parse_rule(entry: &Value) -> Result<QuotaRule, ()> {
    let object = entry.as_object().ok_or(())?;
    if object.len() != 2 || !object.contains_key("limitGb") || !object.contains_key("period") {
        return Err(());
    }
    let limit_gb = object.get("limitGb").and_then(Value::as_f64).ok_or(())?;
    if !limit_gb.is_finite() || !(0.0..=MAX_LIMIT_GB).contains(&limit_gb) || limit_gb == 0.0 {
        return Err(());
    }
    let limit_bytes = crate::gb_to_bytes_i64(limit_gb);
    if limit_bytes <= 0 {
        return Err(());
    }
    let period = match object.get("period").and_then(Value::as_str) {
        Some("monthly") => "monthly",
        Some("lifetime") => "lifetime",
        _ => return Err(()),
    };
    Ok(QuotaRule {
        limit_bytes,
        limit_gb,
        period,
    })
}

/// None means no configured quota. Err means malformed stored policy and
/// must never be treated as unlimited during authorization.
pub fn rule_for(user: &Value, node_id: i64) -> Result<Option<QuotaRule>, ()> {
    let Some(map) = policy_map(user) else {
        return if user.get("nodeTrafficLimits").is_some() {
            Err(())
        } else {
            Ok(None)
        };
    };
    map.get(&node_id.to_string()).map(parse_rule).transpose()
}

pub fn validate_user(user: &Value) -> Result<(), ApiError> {
    if user.get("nodeQuotaUsedBytes").is_some() || user.get("nodeQuotaRemainingBytes").is_some() {
        return Err(bad(
            "Расход квот нод рассчитывается сервером и не может быть изменён вручную.",
        ));
    }
    let Some(value) = user.get("nodeTrafficLimits") else {
        return Ok(());
    };
    let policies = value
        .as_object()
        .ok_or_else(|| bad("Квоты нод должны быть объектом."))?;
    if policies.len() > MAX_NODE_POLICIES {
        return Err(bad(
            "Для одного пользователя допускается не более 256 квот нод.",
        ));
    }
    for (key, entry) in policies {
        if valid_id(key).is_none() || parse_rule(entry).is_err() {
            return Err(bad(
                "Некорректная квота ноды: ID, положительный лимит ГБ и период monthly/lifetime обязательны.",
            ));
        }
    }
    Ok(())
}

/// Prevent typos or forged node identifiers. Use inside the user record
/// transaction, only when the quota map itself is newly created/changed.
pub async fn require_existing_nodes(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user: &Value,
) -> Result<(), ApiError> {
    let Some(map) = policy_map(user) else {
        return Ok(());
    };
    if map.is_empty() {
        return Ok(());
    }
    let ids = map.keys().filter_map(|id| valid_id(id)).collect::<Vec<_>>();
    let found = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM panel_records WHERE collection='nodes' AND id=ANY($1::BIGINT[])",
    )
    .bind(&ids)
    .fetch_all(&mut **tx)
    .await?;
    if found.len() != ids.len() {
        return Err(bad("Нельзя назначить квоту отсутствующей ноде."));
    }
    Ok(())
}

/// Authoritative per-user/node lifetime + UTC current-month readings in one
/// bounded pair of queries. Physical counter baseline resets cannot erase them.
pub async fn usage_for_user(
    pool: &PgPool,
    user_id: i64,
) -> Result<HashMap<i64, NodeUsage>, ApiError> {
    let mut usage = HashMap::<i64, NodeUsage>::new();
    let lifetime = sqlx::query(
        "SELECT node_id,(uplink_bytes+downlink_bytes)::BIGINT AS bytes
         FROM user_node_quota_lifetime WHERE user_id=$1",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    for row in lifetime {
        let id: i64 = row.try_get("node_id")?;
        let bytes: i64 = row.try_get("bytes")?;
        usage.entry(id).or_default().lifetime = bytes.max(0);
    }
    let monthly = sqlx::query(
        "SELECT node_id,(uplink_bytes+downlink_bytes)::BIGINT AS bytes
         FROM user_node_quota_monthly
         WHERE user_id=$1 AND month_start=date_trunc('month',NOW() AT TIME ZONE 'UTC')::date",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    for row in monthly {
        let id: i64 = row.try_get("node_id")?;
        let bytes: i64 = row.try_get("bytes")?;
        usage.entry(id).or_default().monthly = bytes.max(0);
    }
    Ok(usage)
}

/// Read the two node ledgers once each, not once per user. This function is
/// called exclusively in authenticated desired-config/preview compilation.
pub async fn attach_for_node(
    pool: &PgPool,
    node_id: i64,
    users: &mut [Value],
) -> Result<(), ApiError> {
    if !users
        .iter()
        .any(|user| rule_for(user, node_id).is_ok_and(|r| r.is_some()))
    {
        return Ok(());
    }
    let lifetime = sqlx::query(
        "SELECT user_id,(uplink_bytes+downlink_bytes)::BIGINT AS bytes
         FROM user_node_quota_lifetime WHERE node_id=$1",
    )
    .bind(node_id)
    .fetch_all(pool)
    .await?;
    let monthly = sqlx::query(
        "SELECT user_id,(uplink_bytes+downlink_bytes)::BIGINT AS bytes
         FROM user_node_quota_monthly
         WHERE node_id=$1 AND month_start=date_trunc('month',NOW() AT TIME ZONE 'UTC')::date",
    )
    .bind(node_id)
    .fetch_all(pool)
    .await?;
    let mut totals = HashMap::<i64, NodeUsage>::new();
    for row in lifetime {
        let id: i64 = row.try_get("user_id")?;
        let bytes: i64 = row.try_get("bytes")?;
        totals.entry(id).or_default().lifetime = bytes.max(0);
    }
    for row in monthly {
        let id: i64 = row.try_get("user_id")?;
        let bytes: i64 = row.try_get("bytes")?;
        totals.entry(id).or_default().monthly = bytes.max(0);
    }
    for user in users {
        // Never reuse an untrusted historical/cached value.
        if let Some(object) = user.as_object_mut() {
            object.remove("nodeQuotaUsedBytes");
        }
        let Ok(Some(rule)) = rule_for(user, node_id) else {
            continue;
        };
        let Some(id) = user.get("id").and_then(Value::as_i64) else {
            continue;
        };
        let found = totals.get(&id).copied().unwrap_or_default();
        let consumed = if rule.period == "monthly" {
            found.monthly
        } else {
            found.lifetime
        };
        if let Some(object) = user.as_object_mut() {
            object.insert("nodeQuotaUsedBytes".into(), json!(consumed));
        }
    }
    Ok(())
}

pub fn exhausted(user: &Value, node_id: i64) -> bool {
    let rule = match rule_for(user, node_id) {
        Ok(None) => return false,
        Ok(Some(rule)) => rule,
        Err(()) => return true,
    };
    user.get("nodeQuotaUsedBytes")
        .and_then(Value::as_i64)
        .is_none_or(|used| used < 0 || used >= rule.limit_bytes)
}

pub fn offline_remaining(user: &Value, node_id: i64) -> Option<i64> {
    match rule_for(user, node_id) {
        Ok(None) => None,
        Err(()) => Some(0),
        Ok(Some(rule)) => Some(
            user.get("nodeQuotaUsedBytes")
                .and_then(Value::as_i64)
                .map_or(0, |used| {
                    rule.limit_bytes.saturating_sub(used.max(0)).max(0)
                }),
        ),
    }
}

pub fn remaining_for(
    user: &Value,
    node_id: Option<i64>,
    candidates: &[i64],
    usage: Option<&HashMap<i64, NodeUsage>>,
) -> Remaining {
    // A multi-node Host with any per-node quota is inherently ambiguous;
    // never claim one node's balance as the balance of the whole Host.
    let configured = candidates
        .iter()
        .filter(|id| !matches!(rule_for(user, **id), Ok(None)))
        .count();
    if configured == 0 {
        return if candidates.is_empty() {
            Remaining::Unavailable
        } else {
            Remaining::Unlimited
        };
    }
    if candidates.len() != 1 || Some(candidates[0]) != node_id {
        return Remaining::Unavailable;
    }
    let Some(id) = node_id else {
        return Remaining::Unavailable;
    };
    let Ok(Some(rule)) = rule_for(user, id) else {
        return Remaining::Unavailable;
    };
    let Some(meters) = usage else {
        return Remaining::Unavailable;
    };
    let found = meters.get(&id).copied().unwrap_or_default();
    let spent = if rule.period == "monthly" {
        found.monthly
    } else {
        found.lifetime
    };
    Remaining::Bytes(rule.limit_bytes.saturating_sub(spent.max(0)).max(0))
}

/// Authenticated read-only reporting. Server totals are never writable through
/// /records/users, and orphaned policies remain visible for explicit removal.
pub async fn get_for_user(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(user_id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    crate::enforce_collection(&actor, "users", false)?;
    if user_id <= 0 {
        return Err(bad("Некорректный ID пользователя."));
    }
    let user = sqlx::query_scalar::<_, Value>(
        "SELECT data FROM panel_records WHERE collection='users' AND id=$1",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Пользователь не найден."))?;
    let usage = usage_for_user(&state.pool, user_id).await?;
    let nodes =
        sqlx::query("SELECT id,data FROM panel_records WHERE collection='nodes' ORDER BY id")
            .fetch_all(&state.pool)
            .await?;
    let mut items = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for row in nodes {
        let id: i64 = row.try_get("id")?;
        let node: Value = row.try_get("data")?;
        seen.insert(id);
        items.push(display_row(&user, id, &node, &usage, false));
    }
    if let Some(policies) = policy_map(&user) {
        for key in policies.keys() {
            if let Some(id) = valid_id(key)
                && !seen.contains(&id)
            {
                items.push(display_row(&user, id, &Value::Null, &usage, true));
            }
        }
    }
    Ok(Json(
        json!({"userId":user_id,"items":items,"units":"decimal-gb",
        "resetTimezone":"UTC","source":"signed_user_node_telemetry"}),
    ))
}

fn display_row(
    user: &Value,
    node_id: i64,
    node: &Value,
    usage: &HashMap<i64, NodeUsage>,
    missing: bool,
) -> Value {
    let rule = rule_for(user, node_id).ok().flatten();
    let sampled = usage.get(&node_id).copied().unwrap_or_default();
    let period = rule.map_or("monthly", |r| r.period);
    let used = if period == "monthly" {
        sampled.monthly
    } else {
        sampled.lifetime
    };
    let remaining = rule.map(|r| r.limit_bytes.saturating_sub(used).max(0));
    json!({
        "nodeId":node_id,
        "name":node.get("name").and_then(Value::as_str).unwrap_or(""),
        "countryCode":node.get("countryCode").and_then(Value::as_str).unwrap_or(""),
        "disabled":node.get("disabled").and_then(Value::as_bool)==Some(true),
        "missing":missing,
        "limitGb":rule.map(|r| r.limit_gb),
        "period":period,
        "monthlyBytes":sampled.monthly,
        "lifetimeBytes":sampled.lifetime,
        "usedBytes":used,
        "remainingBytes":remaining,
        "exhausted":remaining.is_some_and(|value| value==0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn strict_node_policy_validation() {
        assert!(
            validate_user(&json!({"nodeTrafficLimits":{
                "1":{"limitGb":1000,"period":"monthly"},
                "2":{"limitGb":847,"period":"lifetime"},
                "3":{"limitGb":5,"period":"monthly"}
            }}))
            .is_ok()
        );
        for invalid in [
            json!({"nodeTrafficLimits":[]}),
            json!({"nodeTrafficLimits":{"01":{"limitGb":5,"period":"monthly"}}}),
            json!({"nodeTrafficLimits":{"-1":{"limitGb":5,"period":"monthly"}}}),
            json!({"nodeTrafficLimits":{"2":{"limitGb":0,"period":"monthly"}}}),
            json!({"nodeTrafficLimits":{"2":{"limitGb":-2,"period":"monthly"}}}),
            json!({"nodeTrafficLimits":{"2":{"limitGb":5,"period":"weekly"}}}),
            json!({"nodeTrafficLimits":{"2":{"limitGb":5}}}),
            json!({"nodeTrafficLimits":{"2":{"limitGb":5,"period":"monthly","used":0}}}),
            json!({"nodeQuotaUsedBytes":0}),
            json!({"nodeQuotaRemainingBytes":0}),
        ] {
            assert!(validate_user(&invalid).is_err(), "{invalid}");
        }
        assert!(
            validate_user(&json!({"nodeTrafficLimits":{
                "3":{"limitGb":0.000_000_03,"period":"monthly"}
            }}))
            .is_ok()
        );
        assert!(
            validate_user(&json!({"nodeTrafficLimits":{
                "3":{"limitGb":0.000_000_000_01,"period":"monthly"}
            }}))
            .is_err()
        );
    }

    #[test]
    fn exhaustion_applies_to_only_selected_node() {
        let mut user = json!({"nodeTrafficLimits":{
            "10":{"limitGb":5,"period":"monthly"},
            "20":{"limitGb":847,"period":"lifetime"}
        }});
        assert!(!exhausted(&user, 30));
        assert!(exhausted(&user, 10)); // missing trusted meter -> deny
        user["nodeQuotaUsedBytes"] = json!(4_999_999_999_i64);
        assert!(!exhausted(&user, 10));
        user["nodeQuotaUsedBytes"] = json!(5_000_000_000_i64);
        assert!(exhausted(&user, 10));
        assert!(!exhausted(&user, 20)); // different limit
        assert_eq!(offline_remaining(&user, 10), Some(0));
    }

    #[test]
    fn multi_node_label_is_not_a_fake_per_node_balance() {
        let user = json!({"nodeTrafficLimits":{
            "10":{"limitGb":5,"period":"monthly"},
            "20":{"limitGb":1000,"period":"lifetime"}
        }});
        let usage = HashMap::from([
            (
                10,
                NodeUsage {
                    monthly: 1_750_000_000,
                    lifetime: 12_000_000_000,
                },
            ),
            (
                20,
                NodeUsage {
                    monthly: 0,
                    lifetime: 1_000_000_000,
                },
            ),
        ]);
        assert_eq!(
            remaining_for(&user, Some(10), &[10], Some(&usage)),
            Remaining::Bytes(3_250_000_000)
        );
        assert_eq!(
            remaining_for(&user, Some(20), &[20], Some(&usage)),
            Remaining::Bytes(999_000_000_000)
        );
        assert_eq!(
            remaining_for(&user, None, &[10, 20], Some(&usage)),
            Remaining::Unavailable
        );
        assert_eq!(
            remaining_for(&user, Some(10), &[10], None),
            Remaining::Unavailable
        );
        assert_eq!(
            remaining_for(&user, Some(30), &[30], Some(&usage)),
            Remaining::Unlimited
        );
    }
}
