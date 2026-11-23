//! Signed Quota V2 CDN budgets backed by conservative classified reservations.
//!
//! MAIN permits stay outside the CDN pool. Homogeneous CDN Nodes reserve
//! their full issued ceiling. Mixed MAIN+CDN Nodes pre-fund a *separate*
//! immutable CDN sub-ceiling; MAIN can renew without expanding that CDN
//! ceiling. Unknown historic/mixed-without-a-hold reservations count FULL
//! shared ceilings, never an optimistic guess at delivered bytes.
use crate::{ApiError, cdn_quota};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgConnection;

fn deny() -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        "Independent CDN quota cannot safely fund this Xray reservation.",
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
            .is_ok_and(|quota| quota.is_none() || matches!(class, "main" | "cdn" | "mixed"))
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
    if user_id <= 0 || node_id <= 0 || !matches!(class, "main" | "cdn" | "mixed" | "unclassified") {
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
           -- The very first prepared policy can preserve an OLD absolute
           -- Xray meter baseline. ceiling=ack is ZERO outstanding authority,
           -- not a positive grant. It is safe to freeze its class only while
           -- the new lease is unconfirmed and has never had a signed cap.
           -- A closed/previously confirmed lease cannot be reclassified,
           -- even if its historical ceiling has now been fully spent.
           AND r.ceiling_bytes=r.acknowledged_bytes
           AND r.conservative_burn_floor_bytes<=r.acknowledged_bytes
           -- Explicit successor-positive staging inserts its own
           -- still-empty candidate BEFORE quota_v2_reserve (revision=0).
           -- Ordinary two-step policy prepare has revision=1. Neither
           -- has been Node-confirmed or signed, so both remain zero-spend.
           AND r.revision IN (0,1) AND NOT r.node_confirmed
           AND NOT EXISTS(
               SELECT 1 FROM quota_v2_signed_first_cap_outbox o
                WHERE o.reservation_id=r.reservation_id
           )
           AND NOT EXISTS(
               SELECT 1 FROM quota_v2_cap_renewals x
                WHERE x.reservation_id=r.reservation_id
           )
           AND NOT EXISTS(
               SELECT 1 FROM quota_v2_calendar_successor_positive_caps y
                WHERE y.reservation_id=r.reservation_id
           )
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

async fn panel_settings(conn: &mut PgConnection) -> Result<Value, ApiError> {
    Ok(
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key='panel' FOR SHARE")
            .fetch_optional(conn)
            .await?
            .unwrap_or_else(|| json!({})),
    )
}

async fn calendar_period(
    conn: &mut PgConnection,
    user: &Value,
) -> Result<Option<&'static str>, ApiError> {
    if limit(user)?.is_none() {
        return Ok(None);
    }
    let period = cdn_quota::reset_period(&panel_settings(conn).await?)?;
    if period == "lifetime" {
        return Ok(None);
    }
    if std::env::var("XMESH_QUOTA_V2_CDN_CALENDAR_STAGING").as_deref() != Ok("1") {
        return Err(deny());
    }
    Ok(Some(period))
}

pub async fn bind_deadline(
    conn: &mut PgConnection,
    user: &Value,
    reservation: &str,
    class: &str,
) -> Result<Option<i64>, ApiError> {
    if matches!(class, "cdn" | "mixed")
        && let Some(period) = calendar_period(conn, user).await?
    {
        // Avoid invoking the insert guard on an already issued reservation.
        sqlx::query(
            "INSERT INTO quota_v2_cdn_calendar_bindings(reservation_id,period,calendar_window)
             SELECT $1::uuid,$2,quota_v2_calendar_window($2,statement_timestamp())
             WHERE NOT EXISTS (SELECT 1 FROM quota_v2_cdn_calendar_bindings WHERE reservation_id=$1::uuid)",
        )
        .bind(reservation)
        .bind(period)
        .execute(&mut *conn)
        .await?;
    }
    permit_deadline(conn, user, reservation, class).await
}

/// Existing bindings cannot be relabeled or extended after a policy change.
pub async fn permit_deadline(
    conn: &mut PgConnection,
    user: &Value,
    reservation: &str,
    class: &str,
) -> Result<Option<i64>, ApiError> {
    let period = if matches!(class, "cdn" | "mixed") {
        calendar_period(conn, user).await?
    } else {
        None
    };
    let existing: Option<(String, i64, bool)> = sqlx::query_as(
        "SELECT period,(extract(epoch FROM upper(calendar_window))*1000)::bigint,
                calendar_window @> statement_timestamp()
         FROM quota_v2_cdn_calendar_bindings WHERE reservation_id=$1::uuid",
    )
    .bind(reservation)
    .fetch_optional(conn)
    .await?;
    match (period, existing) {
        (None, None) => Ok(None),
        (Some(period), Some((bound, end, true))) if period == bound => Ok(Some(end)),
        _ => Err(deny()),
    }
}

async fn calendar_remaining(
    conn: &mut PgConnection,
    user_id: i64,
    period: &str,
    limit: i64,
) -> Result<i64, ApiError> {
    Ok(
        sqlx::query_scalar(
            "SELECT quota_v2_cdn_calendar_remaining($1,$2,$3,statement_timestamp())",
        )
        .bind(user_id)
        .bind(period)
        .bind(limit)
        .fetch_one(conn)
        .await?,
    )
}

/// Runs inside the existing locked per-user account transaction. Legacy
/// aggregate input comes from the authoritative server telemetry ledger.
async fn legacy_cdn_usage(conn: &mut PgConnection, user_id: i64) -> Result<i64, ApiError> {
    let settings = panel_settings(conn).await?;
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
        "SELECT LEAST(9223372036854775807,COALESCE(SUM(bytes),0))::bigint
         FROM quota_v2_cdn_legacy_windows WHERE user_id=$1",
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
    if let Some(period) = calendar_period(conn, user).await? {
        return Ok(Some(
            calendar_remaining(conn, user_id, period, limit)
                .await?
                .max(0),
        ));
    }
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
        "SELECT COALESCE(SUM((CASE
           WHEN s.class='mixed' AND m.held_bytes IS NOT NULL
             THEN m.held_bytes::numeric + COALESCE((
                SELECT SUM(t.added_bytes::numeric)
                  FROM quota_v2_mixed_cdn_topups t
                 WHERE t.reservation_id=r.reservation_id
               ),0)
           ELSE r.ceiling_bytes::numeric END)),0)::bigint
         FROM quota_v2_reservations r
         LEFT JOIN quota_v2_reservation_classes s ON s.reservation_id=r.reservation_id
         LEFT JOIN quota_v2_mixed_cdn_holds m ON m.reservation_id=r.reservation_id
         WHERE r.user_id=$1 AND (s.class IS NULL OR s.class<>'main')",
    )
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(Some(
        limit
            .saturating_sub(anchor.max(observed))
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

/// A historic mixed reservation which already issued positive bytes
/// without an immutable CDN sub-hold must NOT be backfilled later. Doing so
/// would reclassify the old potentially-CDN bytes as independent MAIN and
/// refund previously committed CDN liability. Run BEFORE any shared grant.
pub async fn require_fundable_mixed(
    conn: &mut PgConnection,
    user_id: i64,
    node_id: i64,
    user: &Value,
    reservation: &str,
    class: &str,
) -> Result<(), ApiError> {
    if class != "mixed" || limit(user)?.is_none() {
        return Ok(());
    }
    let legacy_unfunded: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM quota_v2_reservations r
            LEFT JOIN quota_v2_mixed_cdn_holds h
                   ON h.reservation_id=r.reservation_id
            WHERE r.reservation_id=$1::uuid AND r.user_id=$2 AND r.node_id=$3
              AND (r.ceiling_bytes>0 OR r.acknowledged_bytes>0)
              AND h.reservation_id IS NULL
         )",
    )
    .bind(reservation)
    .bind(user_id)
    .bind(node_id)
    .fetch_one(conn)
    .await?;
    if legacy_unfunded {
        return Err(deny());
    }
    Ok(())
}

/// Freeze an independent CDN sub-ceiling for a *newly funded* mixed
/// reservation. The caller must hold the account's per-user advisory lock,
/// must have calculated free CDN capacity BEFORE issuing the positive shared
/// ceiling, and must operate in the SAME transaction as the SQL grant.
/// Exact retries cannot increase the original CDN hold.
pub async fn fund_mixed(
    conn: &mut PgConnection,
    user_id: i64,
    node_id: i64,
    user: &Value,
    reservation: &str,
    class: &str,
    free_before: Option<i64>,
) -> Result<(), ApiError> {
    if class != "mixed" || limit(user)?.is_none() {
        return Ok(());
    }
    let available = free_before.ok_or_else(deny)?.max(0);
    let row: (i64, i64) = sqlx::query_as(
        "SELECT r.ceiling_bytes,r.acknowledged_bytes
         FROM quota_v2_reservations r
         JOIN quota_v2_reservation_classes s ON s.reservation_id=r.reservation_id
         WHERE r.reservation_id=$1::uuid AND r.user_id=$2 AND r.node_id=$3
           AND s.class='mixed' FOR UPDATE OF r",
    )
    .bind(reservation)
    .bind(user_id)
    .bind(node_id)
    .fetch_one(&mut *conn)
    .await?;
    let (ceiling, charged) = row;
    if !(0..=64 * 1024 * 1024).contains(&ceiling) || charged > ceiling {
        return Err(deny());
    }
    // An existing nonzero historic reservation without a held row is not
    // an eligible newly-funded mixed lease. Its FULL shared ceiling remains
    // conservatively charged under headroom(), preventing backfill.
    let previously: Option<i64> = sqlx::query_scalar(
        "SELECT held_bytes FROM quota_v2_mixed_cdn_holds
         WHERE reservation_id=$1::uuid AND user_id=$2 AND node_id=$3",
    )
    .bind(reservation)
    .bind(user_id)
    .bind(node_id)
    .fetch_optional(&mut *conn)
    .await?;
    if previously.is_some() {
        return Ok(());
    }
    if charged != 0 {
        return Err(deny());
    }
    let held = ceiling.min(available);
    sqlx::query(
        "INSERT INTO quota_v2_mixed_cdn_holds(reservation_id,user_id,node_id,held_bytes)
         VALUES($1::uuid,$2,$3,$4) ON CONFLICT DO NOTHING",
    )
    .bind(reservation)
    .bind(user_id)
    .bind(node_id)
    .bind(held)
    .execute(&mut *conn)
    .await?;
    let saved: i64 = sqlx::query_scalar(
        "SELECT held_bytes FROM quota_v2_mixed_cdn_holds
         WHERE reservation_id=$1::uuid AND user_id=$2 AND node_id=$3 FOR SHARE",
    )
    .bind(reservation)
    .bind(user_id)
    .bind(node_id)
    .fetch_one(conn)
    .await?;
    if saved != held {
        return Err(deny());
    }
    Ok(())
}

/// A first mixed signed cap must use the SAME immutable sub-ceiling recorded
/// by `fund_mixed`. A CDN-only cap uses its full independently funded lease.
pub async fn signed_cdn_ceiling(
    conn: &mut PgConnection,
    reservation: &str,
    user_id: i64,
    node_id: i64,
    user: &Value,
    class: &str,
    shared: i64,
) -> Result<i64, ApiError> {
    match class {
        "main" => Ok(0),
        "cdn" => Ok(shared),
        "mixed" if limit(user)?.is_none() => Ok(shared),
        "mixed" => {
            let held: Option<i64> = sqlx::query_scalar(
                "SELECT (m.held_bytes::numeric+COALESCE((
                    SELECT SUM(t.added_bytes::numeric) FROM quota_v2_mixed_cdn_topups t
                    WHERE t.reservation_id=m.reservation_id
                ),0))::bigint FROM quota_v2_mixed_cdn_holds m
                 WHERE m.reservation_id=$1::uuid AND m.user_id=$2 AND m.node_id=$3
                 FOR SHARE",
            )
            .bind(reservation)
            .bind(user_id)
            .bind(node_id)
            .fetch_optional(conn)
            .await?;
            held.filter(|value| *value >= 0 && *value <= shared)
                .ok_or_else(deny)
        }
        _ => Err(deny()),
    }
}

/// Independently signed CDN headroom is a separate ledger dimension.
/// A MAIN-only renewal with no CDN spend must never refill an already full
/// CDN window; verified CDN WAL and owner-funded free capacity are required.
fn next_mixed_cdn_refill(
    free: i64,
    first_window: i64,
    previous_cdn: i64,
    witnessed_cdn: i64,
    next_shared: i64,
) -> Option<i64> {
    if free < 0
        || first_window <= 0
        || previous_cdn < 0
        || witnessed_cdn < 0
        || witnessed_cdn > previous_cdn
        || next_shared < previous_cdn
    {
        return None;
    }
    let remaining = previous_cdn.checked_sub(witnessed_cdn)?;
    // Only grow the class allowance after the independently witnessed CDN
    // WAL has consumed at least half of the ACTIVE class window. Comparing
    // cumulative *all-time spend* with cumulative CDN ceiling is unsafe on
    // later revisions: old spend could repeatedly refill a still-full
    // class window with no NEW CDN transfer. The finite first reserve and
    // the cumulative signed ceiling jointly bound this active window.
    let active_window = first_window.min(previous_cdn);
    if previous_cdn == 0 || remaining > active_window / 2 {
        return Some(0);
    }
    Some(
        free.min(first_window.saturating_sub(remaining))
            .min(next_shared.saturating_sub(previous_cdn))
            .max(0),
    )
}

pub struct MixedCdnRenewal<'a> {
    pub user_id: i64,
    pub node_id: i64,
    pub reservation: &'a str,
    pub revision: i64,
    pub nonce: &'a str,
    pub previous_cdn: i64,
    pub committed_cdn_wal: i64,
    pub next_shared: i64,
    pub first_window: i64,
}

/// Fund another CDN class window only from the independently uncommitted
/// pooled CDN balance. The caller holds the per-user advisory/account locks,
/// has authenticated the EXACT signed prior cap and attested WAL charge, and
/// writes the new immutable top-up in the SAME PostgreSQL transaction as the
/// signed revision/outbox. All signed byte ceilings are CUMULATIVE.
/// An offline, stale or duplicated revision never creates additional bytes.
pub async fn renew_mixed_cdn(
    conn: &mut PgConnection,
    user: &Value,
    renewal: MixedCdnRenewal<'_>,
) -> Result<i64, ApiError> {
    let MixedCdnRenewal {
        user_id,
        node_id,
        reservation,
        revision,
        nonce,
        previous_cdn,
        committed_cdn_wal,
        next_shared,
        first_window,
    } = renewal;
    if revision <= 1
        || nonce.len() != 64
        || !nonce
            .bytes()
            .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase())
        || first_window <= 0
        || first_window > 64 * 1024 * 1024
        || previous_cdn < 0
        || previous_cdn < committed_cdn_wal
        || next_shared < previous_cdn
        || next_shared <= 0
    {
        return Err(deny());
    }
    let Some(free) = headroom(conn, user_id, user).await? else {
        return Err(deny());
    };
    let stored: i64 = sqlx::query_scalar(
        "SELECT (m.held_bytes::numeric+COALESCE((
            SELECT SUM(t.added_bytes::numeric) FROM quota_v2_mixed_cdn_topups t
             WHERE t.reservation_id=m.reservation_id
         ),0))::bigint FROM quota_v2_mixed_cdn_holds m
         WHERE m.reservation_id=$1::uuid AND m.user_id=$2 AND m.node_id=$3 FOR SHARE",
    )
    .bind(reservation)
    .bind(user_id)
    .bind(node_id)
    .fetch_one(&mut *conn)
    .await?;
    if stored != previous_cdn {
        return Err(deny());
    }
    let refill = next_mixed_cdn_refill(
        free,
        first_window,
        previous_cdn,
        committed_cdn_wal,
        next_shared,
    )
    .ok_or_else(deny)?;
    if refill == 0 {
        return Ok(previous_cdn);
    }
    let cumulative = previous_cdn.checked_add(refill).ok_or_else(deny)?;
    sqlx::query(
        "INSERT INTO quota_v2_mixed_cdn_topups(
           reservation_id,revision,user_id,node_id,added_bytes,
           cumulative_cdn_ceiling_bytes,request_nonce
         ) VALUES($1::uuid,$2,$3,$4,$5,$6,$7)",
    )
    .bind(reservation)
    .bind(revision)
    .bind(user_id)
    .bind(node_id)
    .bind(refill)
    .bind(cumulative)
    .bind(nonce)
    .execute(&mut *conn)
    .await?;
    Ok(cumulative)
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
    if class == "main" {
        return Ok(true);
    }
    let Some(limit) = limit(user)? else {
        return Ok(true);
    };
    if let Some(period) = calendar_period(conn, user).await? {
        return Ok(calendar_remaining(conn, user_id, period, limit).await? >= 0);
    }
    let _ = headroom(conn, user_id, user).await?;
    let anchor: i64 = sqlx::query_scalar(
        "SELECT baseline_bytes FROM quota_v2_cdn_lifetime_baselines
         WHERE user_id=$1 FOR SHARE",
    )
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await?;
    let issued: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM((CASE
           WHEN s.class='mixed' AND m.held_bytes IS NOT NULL
             THEN m.held_bytes::numeric + COALESCE((
                SELECT SUM(t.added_bytes::numeric)
                  FROM quota_v2_mixed_cdn_topups t
                 WHERE t.reservation_id=r.reservation_id
               ),0)
           ELSE r.ceiling_bytes::numeric END)),0)::bigint
         FROM quota_v2_reservations r
         LEFT JOIN quota_v2_reservation_classes s ON s.reservation_id=r.reservation_id
         LEFT JOIN quota_v2_mixed_cdn_holds m ON m.reservation_id=r.reservation_id
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
    fn only_verified_cdn_spend_and_independent_pool_funds_a_topup() {
        assert_eq!(next_mixed_cdn_refill(0, 700, 400, 300, 1_000), Some(0));
        assert_eq!(next_mixed_cdn_refill(200, 700, 700, 0, 1_200), Some(0));
        assert_eq!(next_mixed_cdn_refill(200, 700, 700, 300, 1_200), Some(0));
        assert_eq!(next_mixed_cdn_refill(200, 700, 700, 350, 1_200), Some(200));
        assert_eq!(next_mixed_cdn_refill(200, 700, 700, 500, 750), Some(50));
        assert_eq!(next_mixed_cdn_refill(200, 700, 400, 0, 1_200), Some(0));
        assert_eq!(next_mixed_cdn_refill(200, 700, 400, 100, 1_200), Some(0));
        assert_eq!(next_mixed_cdn_refill(200, 700, 400, 200, 1_200), Some(200));
        assert_eq!(next_mixed_cdn_refill(200, 700, 400, 199, 1_200), Some(0));
        // Two historic 700-byte CDN windows do not let a full third
        // window grow merely because 700 bytes were spent long ago.
        assert_eq!(next_mixed_cdn_refill(400, 700, 1_400, 700, 2_000), Some(0));
        assert_eq!(
            next_mixed_cdn_refill(400, 700, 1_400, 1_050, 2_000),
            Some(350)
        );

        assert_eq!(next_mixed_cdn_refill(-1, 700, 400, 100, 1_200), None);
        assert_eq!(next_mixed_cdn_refill(100, 700, 400, 401, 1_200), None);
        assert_eq!(next_mixed_cdn_refill(100, 700, 400, 300, 399), None);
    }

    #[test]
    fn lifetime_cdn_supported_only_in_classified_safe_scope() {
        let user = json!({"cdnLimitGb":0.000_716_8});
        assert_eq!(limit(&user).unwrap(), Some(716_800));
        assert!(supported(&user, "main"));
        assert!(supported(&user, "cdn"));
        assert!(supported(&user, "mixed"));
        assert!(!supported(&user, "unclassified"));
        assert!(supported(&json!({"cdnLimitGb":0}), "mixed"));
        for bad in [json!(null), json!(-1), json!("1"), json!(1_000_001)] {
            assert!(limit(&json!({"cdnLimitGb":bad})).is_err());
        }
    }
}
