//! Signed Quota V2 lifetime CDN budget: conservative classified reservations.
//!
//! Only CDN-only Node permits with a separately enforced, globally bounded
//! account are eligible. MAIN permits stay outside the CDN pool. A mixed
//! MAIN/CDN Node cannot be safely admitted into a smaller CDN pool until
//! the issuer supports separate independently held class ceilings.
//! Unknown or mixed historical reservations count against CDN in FULL,
//! never as a guess about how many bytes actually reached a remote peer.
use crate::{ApiError, cdn_quota};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgConnection;

fn deny() -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        "Independent lifetime CDN quota cannot safely fund this Xray reservation.",
    )
}

pub fn limit(user: &Value) -> Result<Option<i64>, ApiError> {
    let Some(value) = user.get("cdnLimitGb") else {
        return Ok(None);
    };
    let Some(gb) = value.as_f64() else {
        return Err(deny());
    };
    if !gb.is_finite() || !(0.0..=1_000_000.0).contains(&gb) {
        return Err(deny());
    }
    if gb == 0.0 {
        return Ok(None);
    }
    let bytes = crate::gb_to_bytes_i64(gb);
    if bytes <= 0 {
        return Err(deny());
    }
    Ok(Some(bytes))
}

/// Source is the compiler-verified MAIN/CDN inbound scope, not the Node's
/// network request or a hard-coded VLESS inbound tag.
pub fn supported(user: &Value, class: &str) -> bool {
    matches!(class, "main" | "cdn" | "mixed" | "unclassified")
        && limit(user)
            .is_ok_and(|quota| quota.is_none() || matches!(class, "main" | "cdn"))
}

/// Record every reservation's original signed classification even if the
/// owner had no CDN cap. Later quota edits cannot claim previous CDN grants
/// were MAIN grants, or use an unmapped/legacy lease as free capacity.
pub async fn record_class(
    conn: &mut PgConnection,
    user_id: i64,
    node_id: i64,
    reservation: &str,
    class: &str,
) -> Result<(), ApiError> {
    if user_id <= 0
        || node_id <= 0
        || !matches!(class, "main" | "cdn" | "mixed" | "unclassified")
    {
        return Err(deny());
    }
    // An old reservation without a class could already have spent or held
    // CDN bytes. Never retroactively relabel it MAIN and release that
    // historical liability. New Genesis always first records its class
    // while the prepared reservation still has a zero issued ceiling.
    sqlx::query(
        "INSERT INTO quota_v2_reservation_classes(reservation_id,user_id,node_id,class)
         SELECT r.reservation_id,r.user_id,r.node_id,$4
         FROM quota_v2_reservations r
         WHERE r.reservation_id=$1::uuid AND r.user_id=$2 AND r.node_id=$3
           AND r.ceiling_bytes=0 AND r.acknowledged_bytes=0
         ON CONFLICT(reservation_id) DO NOTHING",
    )
    .bind(reservation)
    .bind(user_id)
    .bind(node_id)
    .bind(class)
    .execute(&mut *conn)
    .await?;
    let saved: (i64, i64, String) = sqlx::query_as(
        "SELECT user_id,node_id,class FROM quota_v2_reservation_classes
         WHERE reservation_id=$1::uuid FOR SHARE",
    )
    .bind(reservation)
    .fetch_optional(conn)
    .await?
    .ok_or_else(deny)?;
    if (saved.0, saved.1, saved.2.as_str()) != (user_id, node_id, class) {
        return Err(deny());
    }
    Ok(())
}

/// An immutable classification is required on EVERY positive signed
/// delivery, including exact outbox retries and incremental renewals. A
/// historic unclassified reservation is conservatively charged as CDN and
/// cannot later claim to have been MAIN merely because a profile changed.
pub async fn verify_class(
    conn: &mut PgConnection,
    user_id: i64,
    node_id: i64,
    reservation: &str,
    class: &str,
) -> Result<(), ApiError> {
    if !matches!(class, "main" | "cdn" | "mixed") {
        return Err(deny());
    }
    let stored: Option<String> = sqlx::query_scalar(
        "SELECT class FROM quota_v2_reservation_classes
         WHERE reservation_id=$1::uuid AND user_id=$2 AND node_id=$3
         FOR SHARE",
    )
    .bind(reservation)
    .bind(user_id)
    .bind(node_id)
    .fetch_optional(conn)
    .await?;
    if stored.as_deref() != Some(class) {
        return Err(deny());
    }
    Ok(())
}

/// Runs inside the existing locked per-user account transaction. Legacy
/// aggregate input is read only from the existing authoritative server
/// telemetry ledger, NOT from the claimed node counters or client policy.
async fn legacy_cdn_usage(conn: &mut PgConnection, user_id: i64) -> Result<i64, ApiError> {
    let settings: Value = sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key='panel' FOR SHARE",
    )
    .fetch_optional(&mut *conn)
    .await?
    .unwrap_or_else(|| json!({}));
    if cdn_quota::reset_period(&settings)? != "lifetime" {
        return Err(deny());
    }
    let tags = cdn_quota::tags(&settings)?.into_iter().collect::<Vec<_>>();
    let used: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(t.uplink_bytes+t.downlink_bytes),0)::bigint
         FROM user_inbound_traffic_totals t
         LEFT JOIN panel_records n ON n.collection='nodes' AND n.id=t.node_id
         WHERE t.user_id=$1
           AND (t.inbound_tag=ANY($2::text[])
                OR n.id IS NULL
                OR n.data->>'cdnMode'='all'
                OR (n.data->>'cdnMode'='selected'
                    AND n.data->'cdnInboundTags' ? t.inbound_tag))",
    )
    .bind(user_id)
    .bind(&tags)
    .fetch_one(&mut *conn)
    .await?;
    // Monthly quota deltas are recorded at the time of signed telemetry
    // acceptance. Counting *all* historical months protects the lifetime
    // budget when an old CDN Node was deleted or subsequently reclassified
    // as MAIN. This is a floor, never a refund or proof of delivered bytes.
    let durable_history: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(quota_uplink_bytes+quota_downlink_bytes),0)::bigint
         FROM user_inbound_traffic_monthly WHERE user_id=$1",
    )
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(used.max(durable_history).max(0))
}

pub async fn headroom(
    conn: &mut PgConnection,
    user_id: i64,
    user: &Value,
) -> Result<Option<i64>, ApiError> {
    let Some(limit) = limit(user)? else {
        return Ok(None);
    };
    let observed = legacy_cdn_usage(conn, user_id).await?;
    sqlx::query(
        "INSERT INTO quota_v2_cdn_lifetime_baselines(user_id,baseline_bytes)
         VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING",
    )
    .bind(user_id)
    .bind(observed)
    .execute(&mut *conn)
    .await?;
    let anchor: i64 = sqlx::query_scalar(
        "SELECT baseline_bytes FROM quota_v2_cdn_lifetime_baselines
         WHERE user_id=$1 FOR SHARE",
    )
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await?;

    // Unknown historic reservations are treated as CDN, so upgrading
    // metadata cannot retroactively release bytes previously issued.
    let issued: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(r.ceiling_bytes::numeric),0)::bigint
         FROM quota_v2_reservations r
         LEFT JOIN quota_v2_reservation_classes s ON s.reservation_id=r.reservation_id
         WHERE r.user_id=$1 AND (s.class IS NULL OR s.class<>'main')",
    )
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(Some(
        limit.saturating_sub(anchor.max(observed))
            .saturating_sub(issued)
            .max(0),
    ))
}

/// The CDN floor consumes its OWN pool even if the general shared account
/// still has spare bytes. The original existing reservation ceiling is
/// already included in total issued CDN capacity and cannot be replenished.
pub async fn bounded_target(
    conn: &mut PgConnection,
    user_id: i64,
    node_id: i64,
    user: &Value,
    reservation: &str,
    target: i64,
    class: &str,
) -> Result<i64, ApiError> {
    if !supported(user, class) {
        return Err(deny());
    }
    if class != "cdn" {
        return Ok(target);
    }
    let Some(free) = headroom(conn, user_id, user).await? else {
        return Ok(target);
    };
    let existing: Option<(i64, i64)> = sqlx::query_as(
        "SELECT ceiling_bytes,acknowledged_bytes FROM quota_v2_reservations
         WHERE reservation_id=$1::uuid AND user_id=$2 AND node_id=$3",
    )
    .bind(reservation)
    .bind(user_id)
    .bind(node_id)
    .fetch_optional(&mut *conn)
    .await?;
    let outstanding = existing.map_or(0, |(total, ack)| total.saturating_sub(ack).max(0));
    Ok(target.min(outstanding.saturating_add(free)))
}

/// A saved first cap or renewal cannot escape a recently lowered CDN plan.
pub async fn issued_within_limit(
    conn: &mut PgConnection,
    user_id: i64,
    user: &Value,
    class: &str,
) -> Result<bool, ApiError> {
    if !supported(user, class) {
        return Ok(false);
    }
    if class != "cdn" {
        return Ok(true);
    }
    let Some(_limit) = limit(user)? else {
        return Ok(true);
    };
    let _ = headroom(conn, user_id, user).await?;
    let limit = limit(user)?.ok_or_else(deny)?;
    let anchor: i64 = sqlx::query_scalar(
        "SELECT baseline_bytes FROM quota_v2_cdn_lifetime_baselines
         WHERE user_id=$1 FOR SHARE",
    )
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await?;
    let issued: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(r.ceiling_bytes::numeric),0)::bigint
         FROM quota_v2_reservations r
         LEFT JOIN quota_v2_reservation_classes s ON s.reservation_id=r.reservation_id
         WHERE r.user_id=$1 AND (s.class IS NULL OR s.class<>'main')",
    )
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await?;
    // A later legacy CDN meter can only raise the consumption floor; it
    // cannot be counted as proof that any V2 unspent allocation was freed.
    let observed = legacy_cdn_usage(conn, user_id).await?;
    Ok(anchor.max(observed).saturating_add(issued) <= limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lifetime_cdn_supported_only_in_classified_safe_scope() {
        let user = json!({"cdnLimitGb":0.000_716_8});
        assert_eq!(limit(&user).unwrap(),Some(716_800));
        assert!(supported(&user, "main"));
        assert!(supported(&user, "cdn"));
        assert!(!supported(&user, "mixed"));
        assert!(!supported(&user, "unclassified"));
        assert!(supported(&json!({"cdnLimitGb":0}), "mixed"));
        for bad in [json!(null),json!(-1),json!("1"),json!(1_000_001)] {
            assert!(limit(&json!({"cdnLimitGb":bad})).is_err());
        }
    }
}
