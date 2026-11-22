//! Conservative, independently bounded per-user/per-Node lifetime quota.
//!
//! This is intentionally limited to the "lifetime" period: allowing the
//! daily/weekly/monthly variants without an independently settled UTC-window
//! reserve ledger would silently refill quotas across a period boundary.
//!
//! Node capacity is never refunded on expiry, stop, ACK or period turnover.
//! An immutable baseline anchors *existing* legacy bytes before the first
//! V2 claim. Every historical V2 issued ceiling then counts against that
//! Node's lifetime budget, including closed epochs and lost remote WAL.
//! This is intentionally stricter than "spent" to avoid recycling
//! unverifiable offline allocations.
use crate::{ApiError, node_user_quotas};
use axum::http::StatusCode;
use serde_json::Value;
use sqlx::PgConnection;

fn deny() -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        "Node lifetime Quota V2 cannot safely allocate another byte.",
    )
}

pub fn lifetime_rule(user: &Value, node_id: i64) -> Result<Option<i64>, ApiError> {
    match node_user_quotas::rule_for(user, node_id) {
        Ok(None) => Ok(None),
        Ok(Some(rule)) if rule.period == "lifetime" && rule.limit_bytes > 0 => {
            Ok(Some(rule.limit_bytes))
        }
        _ => Err(deny()),
    }
}

/// The caller holds the standard per-user advisory lock, THEN the user record
/// share lock and the account row. All other V2 grant writers share this order.
pub async fn headroom(
    conn: &mut PgConnection,
    user_id: i64,
    node_id: i64,
    user: &Value,
) -> Result<Option<i64>, ApiError> {
    let Some(limit) = lifetime_rule(user, node_id)? else {
        return Ok(None);
    };
    if user_id <= 0 || node_id <= 0 {
        return Err(deny());
    }
    // This INSERT is itself transactional and immutable. A later updated
    // V1 meter cannot rewrite the baseline to erase historic consumption.
    sqlx::query(
        "INSERT INTO quota_v2_node_lifetime_baselines(user_id,node_id,baseline_bytes)
         SELECT $1,$2,COALESCE((
             SELECT uplink_bytes+downlink_bytes
               FROM user_node_quota_lifetime
              WHERE user_id=$1 AND node_id=$2
         ),0)
         ON CONFLICT(user_id,node_id) DO NOTHING",
    )
    .bind(user_id)
    .bind(node_id)
    .execute(&mut *conn)
    .await?;

    let baseline: i64 = sqlx::query_scalar(
        "SELECT baseline_bytes FROM quota_v2_node_lifetime_baselines
         WHERE user_id=$1 AND node_id=$2 FOR SHARE",
    )
    .bind(user_id)
    .bind(node_id)
    .fetch_one(&mut *conn)
    .await?;

    // The immutable first baseline cannot erase later V1 counters from
    // another concurrently active meter. Take the larger of the anchored
    // and current lifetime usage as a conservative floor; overlap with V2
    // grants can only deny excess allocation, never create free capacity.
    let observed: Option<i64> = sqlx::query_scalar(
        "SELECT uplink_bytes+downlink_bytes FROM user_node_quota_lifetime
         WHERE user_id=$1 AND node_id=$2",
    )
    .bind(user_id)
    .bind(node_id)
    .fetch_optional(&mut *conn)
    .await?;
    let baseline = baseline.max(observed.unwrap_or(0));
    // Sum ALL issued ceilings, including historical accounting epochs.
    // Never infer that an unreported/offline byte is unspent, and do not
    // confuse ACKs or conservative burns with refundable capacity.
    let issued: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(ceiling_bytes::numeric),0)::bigint
           FROM quota_v2_reservations WHERE user_id=$1 AND node_id=$2",
    )
    .bind(user_id)
    .bind(node_id)
    .fetch_one(&mut *conn)
    .await?;

    Ok(Some(remaining(limit, baseline, issued)))
}

/// A previously signed positive grant must not be delivered after the
/// operator lowers a lifetime Node quota below the already held commitments.
/// No new bytes are minted here, but stale outbox redelivery is also denied.
pub async fn issued_within_limit(
    conn: &mut PgConnection,
    user_id: i64,
    node_id: i64,
    user: &Value,
) -> Result<bool, ApiError> {
    let Some(limit) = lifetime_rule(user, node_id)? else {
        return Ok(true);
    };
    // Anchor any newly introduced lifetime quota conservatively, even if
    // there were V2 grants before the owner configured it.
    let _ = headroom(conn, user_id, node_id, user).await?;
    // A newer signed V1 lifetime meter can exceed the frozen baseline.
    // Delivery and renewal MUST use the same effective high-water floor as
    // headroom(), otherwise an already-signed cap can be re-delivered even
    // when the later V1 usage plus held V2 grants exceeds the lowered plan.
    let committed: bool = sqlx::query_scalar(
        "SELECT GREATEST(b.baseline_bytes::numeric, COALESCE((
              SELECT (v.uplink_bytes+v.downlink_bytes)::numeric
                FROM user_node_quota_lifetime v
               WHERE v.user_id=$1 AND v.node_id=$2
          ),0)) + COALESCE((
              SELECT SUM(r.ceiling_bytes::numeric) FROM quota_v2_reservations r
               WHERE r.user_id=$1 AND r.node_id=$2
          ),0) <= $3::numeric
          FROM quota_v2_node_lifetime_baselines b
          WHERE b.user_id=$1 AND b.node_id=$2",
    )
    .bind(user_id)
    .bind(node_id)
    .bind(limit)
    .fetch_one(conn)
    .await?;
    Ok(committed)
}

fn remaining(limit: i64, baseline: i64, issued: i64) -> i64 {
    limit.saturating_sub(baseline).saturating_sub(issued).max(0)
}

/// Target is the desired OUTSTANDING reserve, not newly issued bytes.
/// Existing outstanding capacity is already charged in historical ceilings.
pub async fn bounded_target(
    conn: &mut PgConnection,
    user_id: i64,
    node_id: i64,
    user: &Value,
    reservation: &str,
    target: i64,
) -> Result<i64, ApiError> {
    let Some(free) = headroom(conn, user_id, node_id, user).await? else {
        return Ok(target);
    };
    let existing: Option<(i64, i64)> = sqlx::query_as(
        "SELECT ceiling_bytes,acknowledged_bytes
         FROM quota_v2_reservations
         WHERE user_id=$1 AND node_id=$2 AND reservation_id=$3::uuid",
    )
    .bind(user_id)
    .bind(node_id)
    .bind(reservation)
    .fetch_optional(&mut *conn)
    .await?;
    let outstanding = existing.map_or(0, |(ceiling, acknowledged)| {
        ceiling.saturating_sub(acknowledged).max(0)
    });
    Ok(target.min(outstanding.saturating_add(free)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lifetime_only_node_scope_never_becomes_an_unbounded_grant() {
        let user = json!({"nodeTrafficLimits":{
            "47":{"limitGb":5,"period":"lifetime"},
            "48":{"limitGb":1,"period":"daily"}
        }});
        assert_eq!(lifetime_rule(&user, 47).unwrap(), Some(5_000_000_000));
        assert_eq!(lifetime_rule(&user, 49).unwrap(), None);
        assert!(lifetime_rule(&user, 48).is_err());
        for bad in [
            json!({"nodeTrafficLimits":{"47":{"period":"lifetime","limitGb":0}}}),
            json!({"nodeTrafficLimits":{"47":{"period":"weekly","limitGb":1}}}),
            json!({"nodeTrafficLimits":[]}),
        ] {
            assert!(lifetime_rule(&bad, 47).is_err());
        }
    }

    #[test]
    fn historic_issuance_never_refills_on_remote_loss_or_period_boundary() {
        assert_eq!(remaining(5_000, 0, 0), 5_000);
        assert_eq!(remaining(5_000, 1_000, 3_000), 1_000);
        assert_eq!(remaining(5_000, 1_000, 4_000), 0);
        assert_eq!(remaining(5_000, 1_000, 7_000), 0);
        assert_eq!(remaining(5_000, 0, 5_000), 0);
        assert_eq!(remaining(5_000, 4_999, 0), 1);
        // Any newly reported V1 usage only raises the baseline.
        assert_eq!(remaining(5_000, 3_000, 2_000), 0);
    }
}
