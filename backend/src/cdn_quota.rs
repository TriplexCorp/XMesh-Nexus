//! Dedicated CDN/allow-list traffic pool. This is separate from the global
//! user quota: signed, monotonic per-user/per-inbound counters are authoritative.
//!
//! The first stage enforces the pool through desired-config reconciliation.
//! This is NOT an instantaneous on-node cutoff; offline/hard-cutoff controls
//! require an agent policy extension before production guarantees can be made.
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use std::collections::{HashMap, HashSet};

use crate::ApiError;

const MAX_TAGS: usize = 128;
const MAX_GIB: f64 = 1_000_000.0;
const GIB: f64 = 1_073_741_824.0;

fn bad_request(message: &str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, message)
}

pub fn validate_settings(value: &Value) -> Result<(), ApiError> {
    if let Some(tags) = value.get("cdnInboundTags") {
        let tags = tags
            .as_array()
            .ok_or_else(|| bad_request("CDN: список inbound должен быть массивом тегов."))?;
        if tags.len() > MAX_TAGS {
            return Err(bad_request("CDN: не более 128 inbound в одной группе."));
        }
        let mut seen = HashSet::new();
        for item in tags {
            let tag = item
                .as_str()
                .ok_or_else(|| bad_request("CDN: теги должны быть строками."))?;
            if tag.is_empty()
                || tag.len() > 128
                || tag.trim() != tag
                || tag.chars().any(char::is_control)
                || tag == "xmesh_stats_in"
                || !seen.insert(tag)
            {
                return Err(bad_request(
                    "CDN: некорректный или повторяющийся inbound tag.",
                ));
            }
        }
    }
    if let Some(period) = value.get("cdnResetPeriod") {
        if !matches!(period.as_str(), Some("lifetime" | "monthly")) {
            return Err(bad_request(
                "CDN: режим сброса должен быть lifetime или monthly.",
            ));
        }
    }
    Ok(())
}

pub fn tags(settings: &Value) -> Result<HashSet<String>, ApiError> {
    validate_settings(settings)?;
    Ok(settings
        .get("cdnInboundTags")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default())
}

/// Node-scoped quota policy. Legacy global tags remain supported.
/// A marked LTE node can include all inbounds or an explicit subset, so
/// ordinary inbounds on another node with the same tag never become LTE.
pub fn validate_node(node: &Value) -> Result<(), ApiError> {
    if node.get("cdnMode").is_some_and(|mode| !mode.is_string()) {
        return Err(bad_request("CDN: неизвестный режим трафика узла."));
    }
    let mode = node
        .get("cdnMode")
        .and_then(Value::as_str)
        .unwrap_or("standard");
    if !matches!(mode, "standard" | "all" | "selected") {
        return Err(bad_request("CDN: неизвестный режим трафика узла."));
    }
    if let Some(value) = node.get("cdnInboundTags") {
        validate_settings(&json!({"cdnInboundTags":value}))?;
    }
    if mode == "selected"
        && node
            .get("cdnInboundTags")
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty)
    {
        return Err(bad_request(
            "CDN: выберите хотя бы один inbound этого узла.",
        ));
    }
    Ok(())
}

pub fn tags_for_node(
    settings: &Value,
    node: &Value,
    candidate_tags: &[String],
) -> Result<HashSet<String>, ApiError> {
    validate_node(node)?;
    let mut selected = tags(settings)?;
    match node
        .get("cdnMode")
        .and_then(Value::as_str)
        .unwrap_or("standard")
    {
        "all" => selected.extend(
            candidate_tags
                .iter()
                .cloned()
                .filter(|tag| tag != "xmesh_stats_in"),
        ),
        "selected" => selected.extend(
            node.get("cdnInboundTags")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned),
        ),
        _ => {}
    }
    Ok(selected)
}

pub fn reset_period(settings: &Value) -> Result<&'static str, ApiError> {
    validate_settings(settings)?;
    Ok(
        if settings.get("cdnResetPeriod").and_then(Value::as_str) == Some("monthly") {
            "monthly"
        } else {
            "lifetime"
        },
    )
}

pub fn validate_user(user: &Value) -> Result<(), ApiError> {
    if user.get("cdnUsedBytes").is_some() {
        return Err(bad_request(
            "CDN: расход вычисляется сервером и не может быть изменён вручную.",
        ));
    }
    if let Some(limit) = user.get("cdnLimitGb") {
        let limit = limit
            .as_f64()
            .ok_or_else(|| bad_request("CDN: лимит должен быть числом."))?;
        if !limit.is_finite() || !(0.0..=MAX_GIB).contains(&limit) {
            return Err(bad_request("CDN: лимит должен быть от 0 до 1000000 ГиБ."));
        }
    }
    Ok(())
}

/// Attach a server-calculated value, never trusting user-submitted or
/// node-aggregated traffic. The same inbound tag on multiple nodes is summed.
pub async fn attach_usage(pool: &PgPool, users: &mut [Value]) -> Result<(), ApiError> {
    if users.is_empty() {
        return Ok(());
    }
    let settings = crate::read_settings(pool).await?;
    let mut usage = HashMap::<i64, i64>::new();
    // Monthly deltas are recorded when signed telemetry is accepted, in UTC.
    // This durable ledger survives node deletion and policy edits. Existing
    // cumulative meters cannot accurately reconstruct historic months.
    let rows = if reset_period(&settings)? == "monthly" {
        sqlx::query(
            "SELECT user_id, COALESCE(SUM(quota_uplink_bytes + quota_downlink_bytes),0)::BIGINT AS bytes
             FROM user_inbound_traffic_monthly
             WHERE month_start = date_trunc('month', NOW() AT TIME ZONE 'UTC')::date
             GROUP BY user_id",
        )
        .fetch_all(pool)
        .await?
    } else {
        let mut names = tags(&settings)?.into_iter().collect::<Vec<_>>();
        names.sort_unstable();
        sqlx::query(
            "SELECT totals.user_id, COALESCE(SUM(totals.uplink_bytes + totals.downlink_bytes),0)::BIGINT AS bytes
             FROM user_inbound_traffic_totals AS totals
             LEFT JOIN panel_records AS node ON node.collection='nodes' AND node.id=totals.node_id
             WHERE totals.inbound_tag = ANY($1::TEXT[])
                OR node.data->>'cdnMode'='all'
                OR (node.data->>'cdnMode'='selected' AND
                    node.data->'cdnInboundTags' ? totals.inbound_tag)
             GROUP BY totals.user_id",
        )
        .bind(names)
        .fetch_all(pool)
        .await?
    };
    for row in rows {
        usage.insert(row.try_get("user_id")?, row.try_get("bytes")?);
    }
    for user in users {
        let id = user.get("id").and_then(Value::as_i64).unwrap_or(0);
        if let Some(data) = user.as_object_mut() {
            data.insert(
                "cdnUsedBytes".into(),
                json!(usage.get(&id).copied().unwrap_or(0).max(0)),
            );
        }
    }
    Ok(())
}

/// A missing server-derived meter fails closed for a quota-enabled user.
/// Zero means unlimited CDN access; unrelated inbound tags stay unaffected.
pub fn exhausted(user: &Value, inbound_tag: &str, cdn_tags: &HashSet<String>) -> bool {
    if !cdn_tags.contains(inbound_tag) {
        return false;
    }
    let limit = user
        .get("cdnLimitGb")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    if limit <= 0.0 {
        return false;
    }
    let Some(consumed_bytes) = user.get("cdnUsedBytes").and_then(Value::as_i64) else {
        return true;
    };
    // The panel validates saved quota values. Any invalid legacy quota must
    // never become an overflow-based authorization bypass.
    if !limit.is_finite() || limit > MAX_GIB {
        return true;
    }
    crate::numeric_i64_to_f64(consumed_bytes.max(0)) >= (limit * GIB).floor()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_nonoverlapping_configured_tags() {
        assert!(validate_settings(&json!({"cdnInboundTags":["CDN_DE","CDN_UK"]})).is_ok());
        assert!(validate_settings(&json!({"cdnInboundTags":["CDN_DE","CDN_DE"]})).is_err());
        assert!(validate_settings(&json!({"cdnInboundTags":["xmesh_stats_in"]})).is_err());
        assert!(validate_settings(&json!({"cdnInboundTags":[42]})).is_err());
        assert!(validate_settings(&json!({"cdnInboundTags":"CDN_DE"})).is_err());
    }

    #[test]
    fn unlimited_main_and_bounded_cdn_are_independent() {
        let tags = HashSet::from(["CDN_DE".to_owned(), "CDN_UK".to_owned()]);
        let user = json!({"cdnLimitGb":1.0,"cdnUsedBytes":1_073_741_824_i64});
        assert!(exhausted(&user, "CDN_DE", &tags));
        assert!(exhausted(&user, "CDN_UK", &tags));
        assert!(!exhausted(&user, "MAIN_DE", &tags));
        assert!(!exhausted(
            &json!({"cdnLimitGb":0,"cdnUsedBytes":999_999_i64}),
            "CDN_DE",
            &tags
        ));
        assert!(exhausted(&json!({"cdnLimitGb":1.0}), "CDN_DE", &tags));
    }

    #[test]
    fn node_scoped_lte_inbounds_preserve_standard_nodes() {
        let settings = json!({"cdnInboundTags":[],"cdnResetPeriod":"monthly"});
        let standard = json!({"cdnMode":"standard"});
        let lte = json!({"cdnMode":"all"});
        let mixed = json!({"cdnMode":"selected","cdnInboundTags":["PL_LTE"]});
        let candidates = vec!["PL_LTE".to_owned(), "MAIN_DE".to_owned()];
        assert_eq!(reset_period(&settings).unwrap(), "monthly");
        assert!(
            tags_for_node(&settings, &standard, &candidates)
                .unwrap()
                .is_empty()
        );
        assert!(
            tags_for_node(&settings, &lte, &candidates)
                .unwrap()
                .contains("PL_LTE")
        );
        assert!(
            !tags_for_node(&settings, &mixed, &candidates)
                .unwrap()
                .contains("MAIN_DE")
        );
        assert!(validate_node(&json!({"cdnMode":"selected","cdnInboundTags":[]})).is_err());
        assert!(validate_settings(&json!({"cdnResetPeriod":"weekly"})).is_err());
    }

    #[test]
    fn quota_is_independent_of_total_account_meter() {
        let tags = HashSet::from(["CDN_DE".to_owned()]);
        let user =
            json!({"limit":0,"used":10_000.0,"cdnLimitGb":3.0,"cdnUsedBytes":1_073_741_824_i64});
        assert!(!exhausted(&user, "CDN_DE", &tags));
        assert!(!exhausted(&user, "MAIN_DE", &tags));
        assert!(validate_user(&json!({"cdnLimitGb":3.0})).is_ok());
        assert!(validate_user(&json!({"cdnLimitGb":-1})).is_err());
        assert!(validate_user(&json!({"cdnUsedBytes":1})).is_err());
    }
}
