//! Staged quota-v2 issuer. Deliberately disabled unless the operator enables
//! XMESH_QUOTA_V2_ENABLED=1 after rolling out v2-capable node agents.
//! The account row serializes allocation across independent nodes; a node's
//! authenticated durable total is acknowledged only against its own lease.
use crate::ApiError;
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalQuotaCounter {
    pub user_id: i64,
    pub used_bytes: i64,
    #[serde(default)]
    pub epoch: Option<String>,
    #[serde(default)]
    pub meter_epoch: Option<String>,
    #[serde(default)]
    pub reservation_id: Option<String>,
}

fn conflict() -> ApiError {
    ApiError::new(StatusCode::CONFLICT, "Quota-v2 state changed; retry signed reconciliation.")
}

pub fn enabled() -> bool {
    std::env::var("XMESH_QUOTA_V2_ENABLED").is_ok_and(|value| value == "1")
}

pub async fn issue(
    pool: &PgPool,
    node_id: i64,
    policy: &mut Value,
    local: &[LocalQuotaCounter],
    now_ms: i64,
) -> Result<(), ApiError> {
    if local.len() > 2048 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Too many local quota counters."));
    }
    let mut reported = HashMap::new();
    let mut seen = HashSet::new();
    for counter in local {
        if counter.user_id <= 0 || counter.used_bytes < 0 || !seen.insert(counter.user_id) {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid local quota counter."));
        }
        let ids = [&counter.epoch, &counter.meter_epoch, &counter.reservation_id];
        if ids.iter().filter(|id| id.is_some()).count() != 0
            && ids.iter().filter(|id| id.is_some()).count() != 3
        {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "Incomplete quota lease identity."));
        }
        if ids.into_iter().flatten().any(|id| uuid::Uuid::parse_str(id).is_err()) {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid quota lease identity."));
        }
        reported.insert(counter.user_id, counter);
    }
    let users = policy.get_mut("users").and_then(Value::as_array_mut).ok_or_else(conflict)?;
    let mut tx = pool.begin().await?;
    for user in users.iter_mut() {
        let user_id = user.get("userId").and_then(Value::as_i64).ok_or_else(conflict)?;
        let limit = user.get("limitBytes").and_then(Value::as_i64).ok_or_else(conflict)?;
        if limit <= 0 {
            // Node-only and CDN quotas stay on their independent rule path.
            // A global shared reservation is meaningful only for global limits.
            continue;
        }
        let panel_used = user.get("panelUsedBytes").and_then(Value::as_i64).ok_or_else(conflict)?;
        let target = user.get("offlineBudgetBytes").and_then(Value::as_i64)
            .unwrap_or(0).clamp(0, 64 * 1024 * 1024);
        let local_record = reported.get(&user_id).copied();
        let local_total = local_record.map_or(0, |item| item.used_bytes);

        // Serialize first account creation as well as subsequent updates.
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(user_id ^ 0x51_4D_45_53_48_i64)
            .execute(&mut *tx).await?;
        // Prevent issuing a stale allowance concurrently with an admin's
        // plan change or a different node's accepted telemetry delta.
        let current_user: Value = sqlx::query_scalar(
            "SELECT data FROM panel_records WHERE collection='users' AND id=$1 FOR SHARE"
        ).bind(user_id).fetch_optional(&mut *tx).await?.ok_or_else(conflict)?;
        let current_limit = current_user.get("limit").and_then(Value::as_f64).unwrap_or(0.0);
        let current_used = current_user.get("used").and_then(Value::as_f64).unwrap_or(0.0);
        if crate::gb_to_bytes_i64(current_limit) != limit
            || crate::gb_to_bytes_i64(current_used) != panel_used
        {
            return Err(conflict());
        }

        let account = sqlx::query(
            "SELECT epoch::text AS epoch FROM quota_v2_accounts
             WHERE user_id=$1 AND NOT closed FOR UPDATE"
        ).bind(user_id).fetch_optional(&mut *tx).await?;
        let epoch: String = if let Some(row) = account {
            row.try_get("epoch")?
        } else {
            let new_epoch = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes,settled_bytes)
                 VALUES($1,$2::uuid,$3,$4)"
            ).bind(user_id).bind(&new_epoch).bind(limit).bind(panel_used)
             .execute(&mut *tx).await?;
            new_epoch
        };
        // The aggregate panel-used counter may advance from already accepted
        // activity; it is a floor, never proof that a *particular* node's
        // local bytes were acknowledged. It must never decrease implicitly.
        sqlx::query(
            "UPDATE quota_v2_accounts SET limit_bytes=$3,
                settled_bytes=GREATEST(settled_bytes,$4)
             WHERE user_id=$1 AND epoch=$2::uuid"
        ).bind(user_id).bind(&epoch).bind(limit).bind(panel_used)
         .execute(&mut *tx).await?;

        let existing = sqlx::query(
            "SELECT meter_epoch::text AS meter_epoch,reservation_id::text AS reservation_id
             FROM quota_v2_reservations
             WHERE user_id=$1 AND epoch=$2::uuid AND node_id=$3
             ORDER BY valid_until DESC LIMIT 1 FOR UPDATE"
        ).bind(user_id).bind(&epoch).bind(node_id)
         .fetch_optional(&mut *tx).await?;
        if existing.is_some() && local_record.is_none() {
            // A lost/corrupted node ledger must not permit another allowance.
            return Err(conflict());
        }
        let (meter, reservation) = if let Some(row) = existing {
            let meter: String = row.try_get("meter_epoch")?;
            let reservation: String = row.try_get("reservation_id")?;
            let received = local_record.ok_or_else(conflict)?;
            if received.epoch.as_deref() != Some(epoch.as_str())
                || received.meter_epoch.as_deref() != Some(meter.as_str())
                || received.reservation_id.as_deref() != Some(reservation.as_str())
            {
                return Err(conflict());
            }
            (meter, reservation)
        } else {
            // Refuse migration while durable Node bytes have not reached the
            // authenticated telemetry baseline. Otherwise old unreported
            // spending could be reclassified as a free initial quota offset.
            let observed = sqlx::query(
                "SELECT last_uplink_bytes,last_downlink_bytes
                 FROM user_node_traffic_totals
                 WHERE node_id=$1 AND user_id=$2 FOR SHARE"
            ).bind(node_id).bind(user_id).fetch_optional(&mut *tx).await?;
            let observed_total = if let Some(row) = observed {
                let up: i64 = row.try_get("last_uplink_bytes")?;
                let down: i64 = row.try_get("last_downlink_bytes")?;
                up.checked_add(down).ok_or_else(conflict)?
            } else {
                0
            };
            if local_total != observed_total
                || local_record.is_some_and(|counter| counter.epoch.is_some())
            {
                return Err(conflict());
            }
            (uuid::Uuid::new_v4().to_string(), uuid::Uuid::new_v4().to_string())
        };
        let until = now_ms.saturating_add(24 * 60 * 60 * 1000);
        let lease = sqlx::query(
            "SELECT acknowledged_bytes,ceiling_bytes,revision,
                    (EXTRACT(EPOCH FROM valid_until)*1000)::BIGINT AS valid_until_ms
             FROM quota_v2_reserve($1,$2::uuid,$3,$4::uuid,$5::uuid,$6,$7,
                   to_timestamp(($8::bigint)::double precision/1000.0))"
        ).bind(user_id).bind(&epoch).bind(node_id).bind(&meter).bind(&reservation)
         .bind(target).bind(local_total).bind(until)
         .fetch_one(&mut *tx).await.map_err(|_| conflict())?;

        user["quotaReservation"] = json!({
            "epoch": epoch,
            "meterEpoch": meter,
            "reservationId": reservation,
            "revision": lease.try_get::<i64,_>("revision")?,
            "acknowledgedBytes": lease.try_get::<i64,_>("acknowledged_bytes")?,
            "ceilingBytes": lease.try_get::<i64,_>("ceiling_bytes")?,
            "validUntilMs": lease.try_get::<i64,_>("valid_until_ms")?
        });
    }
    policy["version"] = json!(2);
    tx.commit().await?;
    Ok(())
}
