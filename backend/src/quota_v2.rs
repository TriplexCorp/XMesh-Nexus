//! Staged quota-v2 issuer. Deliberately disabled unless the operator enables
//! `XMESH_QUOTA_V2_ENABLED=1` after rolling out v2-capable node agents.
//! The account row serializes allocation across independent nodes; a node's
//! authenticated durable total is acknowledged only against its own lease.
use crate::ApiError;
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::{Value, json};
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
    ApiError::new(
        StatusCode::CONFLICT,
        "Quota-v2 state changed; retry signed reconciliation.",
    )
}

pub fn enabled() -> bool {
    std::env::var("XMESH_QUOTA_V2_ENABLED").is_ok_and(|value| value == "1")
}

pub async fn validate_limit_change(
    conn: &mut sqlx::PgConnection,
    user_id: i64,
    prior_gb: f64,
    next_gb: f64,
    base_used_gb: f64,
) -> Result<(), ApiError> {
    let old_limit = crate::gb_to_bytes_i64(prior_gb);
    let new_limit = crate::gb_to_bytes_i64(next_gb);
    if old_limit == new_limit {
        return Ok(());
    }
    // Even without an existing quota account, nodes may have cached a
    // version-2 unlimited policy. A new limited tariff needs fleet ACKs.
    if enabled() && ((old_limit == 0) != (new_limit == 0)) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Смена безлимитного тарифа при квотах v2 требует подтверждения всех нод.",
        ));
    }
    let active = sqlx::query(
        "SELECT limit_bytes,settled_bytes,epoch::text AS epoch
         FROM quota_v2_accounts WHERE user_id=$1 AND NOT closed FOR UPDATE",
    )
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(active) = active else {
        return Ok(());
    };
    if old_limit == 0 || new_limit == 0 {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Переключение безлимита при квотах v2 требует обновления всех нод.",
        ));
    }
    let epoch: String = active.try_get("epoch")?;
    let spent: i64 = active.try_get("settled_bytes")?;
    let held: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(ceiling_bytes::NUMERIC-acknowledged_bytes),0)::BIGINT
         FROM quota_v2_reservations WHERE user_id=$1 AND epoch=$2::uuid",
    )
    .bind(user_id)
    .bind(&epoch)
    .fetch_one(&mut *conn)
    .await?;
    // Signed telemetry can be accepted BEFORE the quota receipt arrives.
    // Count that verified but not yet settled traffic plus outstanding holds.
    let measured: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(uplink_bytes+downlink_bytes),0)::BIGINT
         FROM user_node_traffic_totals WHERE user_id=$1",
    )
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await?;
    let baseline = crate::gb_to_bytes_i64(base_used_gb);
    let charged = spent.max(baseline.saturating_add(measured.max(0)));
    if new_limit < charged.saturating_add(held) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Новый лимит меньше уже потраченного и зарезервированного трафика на нодах.",
        ));
    }
    Ok(())
}

pub async fn close_drained_epoch(
    conn: &mut sqlx::PgConnection,
    user_id: i64,
) -> Result<(), ApiError> {
    let active = sqlx::query(
        "SELECT epoch::text AS epoch FROM quota_v2_accounts
         WHERE user_id=$1 AND NOT closed FOR UPDATE",
    )
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(active) = active {
        let epoch: String = active.try_get("epoch")?;
        let outstanding: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(ceiling_bytes::NUMERIC-acknowledged_bytes),0)::BIGINT
             FROM quota_v2_reservations WHERE user_id=$1 AND epoch=$2::uuid",
        )
        .bind(user_id)
        .bind(&epoch)
        .fetch_one(&mut *conn)
        .await?;
        if outstanding > 0 {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "Сброс квоты v2 невозможен: на нодах остался неподтверждённый резерв трафика.",
            ));
        }
        // Close in the same transaction as resetting the UI/telemetry
        // baseline. A late signed old-epoch receipt remains chargeable, but
        // cannot reissue an expired or closed budget.
        sqlx::query(
            "UPDATE quota_v2_accounts SET closed=TRUE
             WHERE user_id=$1 AND epoch=$2::uuid",
        )
        .bind(user_id)
        .bind(&epoch)
        .execute(&mut *conn)
        .await?;
    } else {
        let old_unsettled: bool = sqlx::query_scalar(
            "SELECT EXISTS(
               SELECT 1 FROM quota_v2_reservations
               WHERE user_id=$1 AND ceiling_bytes>acknowledged_bytes
            )",
        )
        .bind(user_id)
        .fetch_one(&mut *conn)
        .await?;
        if old_unsettled {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "Сброс квоты v2 невозможен: на нодах остался неподтверждённый резерв трафика.",
            ));
        }
    }
    Ok(())
}

fn validate_local(
    local: &[LocalQuotaCounter],
) -> Result<HashMap<i64, &LocalQuotaCounter>, ApiError> {
    if local.len() > 2048 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Too many local quota counters.",
        ));
    }
    let mut reported = HashMap::new();
    let mut seen = HashSet::new();
    for counter in local {
        if counter.user_id <= 0 || counter.used_bytes < 0 || !seen.insert(counter.user_id) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Invalid local quota counter.",
            ));
        }
        let ids = [
            &counter.epoch,
            &counter.meter_epoch,
            &counter.reservation_id,
        ];
        if ids.iter().filter(|id| id.is_some()).count() != 0
            && ids.iter().filter(|id| id.is_some()).count() != 3
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Incomplete quota lease identity.",
            ));
        }
        if ids
            .into_iter()
            .flatten()
            .any(|id| uuid::Uuid::parse_str(id).is_err())
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Invalid quota lease identity.",
            ));
        }
        reported.insert(counter.user_id, counter);
    }
    Ok(reported)
}

async fn ensure_account(
    conn: &mut sqlx::PgConnection,
    user_id: i64,
    limit: i64,
    panel_used: i64,
) -> Result<String, ApiError> {
    // Serialize first account creation as well as subsequent updates.
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(user_id ^ 0x51_4D_45_53_48_i64)
        .execute(&mut *conn)
        .await?;
    // Prevent issuing a stale allowance concurrently with an admin's
    // plan change or a different node's accepted telemetry delta.
    let current_user: Value = sqlx::query_scalar(
        "SELECT data FROM panel_records WHERE collection='users' AND id=$1 FOR SHARE",
    )
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(conflict)?;
    let current_limit = current_user
        .get("limit")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let base_used_gb = current_user
        .get("used")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    // load_records() overlays authenticated cumulative traffic on the
    // stored manually edited baseline before compiling signed policies.
    // Comparing only the stored base makes every later receipt look like
    // an unauthorized concurrent edit and rejects the next policy poll.
    let measured_bytes: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(uplink_bytes+downlink_bytes),0)::BIGINT
             FROM user_node_traffic_totals WHERE user_id=$1",
    )
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await?;
    let expected_used = crate::gb_to_bytes_i64(base_used_gb).saturating_add(measured_bytes.max(0));
    if crate::gb_to_bytes_i64(current_limit) != limit || panel_used.abs_diff(expected_used) > 1 {
        return Err(conflict());
    }

    let account = sqlx::query(
        "SELECT epoch::text AS epoch FROM quota_v2_accounts
             WHERE user_id=$1 AND NOT closed FOR UPDATE",
    )
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?;
    let epoch: String = if let Some(row) = account {
        row.try_get("epoch")?
    } else {
        let new_epoch = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO quota_v2_accounts(user_id,epoch,limit_bytes,settled_bytes)
                 VALUES($1,$2::uuid,$3,$4)",
        )
        .bind(user_id)
        .bind(&new_epoch)
        .bind(limit)
        .bind(panel_used)
        .execute(&mut *conn)
        .await?;
        new_epoch
    };
    // The aggregate panel-used counter may advance from already accepted
    // activity; it is a floor, never proof that a *particular* node's
    // local bytes were acknowledged. It must never decrease implicitly.
    sqlx::query(
        "UPDATE quota_v2_accounts SET limit_bytes=$3,
                settled_bytes=GREATEST(settled_bytes,$4)
             WHERE user_id=$1 AND epoch=$2::uuid",
    )
    .bind(user_id)
    .bind(&epoch)
    .bind(limit)
    .bind(panel_used)
    .execute(&mut *conn)
    .await?;

    Ok(epoch)
}

async fn confirm_existing_lease(
    conn: &mut sqlx::PgConnection,
    user_id: i64,
    node_id: i64,
    epoch: &str,
    local_record: Option<&LocalQuotaCounter>,
    local_total: i64,
    row: sqlx::postgres::PgRow,
) -> Result<(String, String, bool), ApiError> {
    let meter: String = row.try_get("meter_epoch")?;
    let reservation: String = row.try_get("reservation_id")?;
    let confirmed: bool = row.try_get("node_confirmed")?;
    let presented = local_record.is_some_and(|received| {
        received.epoch.as_deref() == Some(epoch)
            && received.meter_epoch.as_deref() == Some(meter.as_str())
            && received.reservation_id.as_deref() == Some(reservation.as_str())
    });
    if presented {
        if !confirmed {
            // Only a subsequent authenticated echo of the durable prepared
            // identity may unlock the reserved offline spending allowance.
            sqlx::query(
                "UPDATE quota_v2_reservations SET node_confirmed=TRUE
                 WHERE user_id=$1 AND epoch=$2::uuid AND node_id=$3
                   AND meter_epoch=$4::uuid AND reservation_id=$5::uuid",
            )
            .bind(user_id)
            .bind(epoch)
            .bind(node_id)
            .bind(&meter)
            .bind(&reservation)
            .execute(&mut *conn)
            .await?;
        }
        return Ok((meter, reservation, true));
    }
    let lacks_identity = local_record.is_none_or(|record| {
        record.epoch.is_none() && record.meter_epoch.is_none() && record.reservation_id.is_none()
    });
    let ack: i64 = row.try_get("acknowledged_bytes")?;
    let ceiling: i64 = row.try_get("ceiling_bytes")?;
    // A lost first HTTP response can recover an unfunded lease; losing an
    // already funded journal must never mint an additional grant.
    if confirmed || !lacks_identity || ceiling != ack || local_total != ack {
        return Err(conflict());
    }
    Ok((meter, reservation, false))
}

async fn confirm_closed_epoch(
    conn: &mut sqlx::PgConnection,
    user_id: i64,
    node_id: i64,
    previous: &LocalQuotaCounter,
    local_total: i64,
) -> Result<String, ApiError> {
    let old_epoch = previous.epoch.as_deref().ok_or_else(conflict)?;
    let old_meter = previous.meter_epoch.as_deref().ok_or_else(conflict)?;
    let old_reservation = previous.reservation_id.as_deref().ok_or_else(conflict)?;
    let historical = sqlx::query(
        "SELECT r.acknowledged_bytes,r.ceiling_bytes,a.closed
         FROM quota_v2_reservations r
         JOIN quota_v2_accounts a ON a.user_id=r.user_id AND a.epoch=r.epoch
         WHERE r.user_id=$1 AND r.node_id=$2 AND r.epoch=$3::uuid
           AND r.meter_epoch=$4::uuid AND r.reservation_id=$5::uuid
         FOR SHARE OF r,a",
    )
    .bind(user_id)
    .bind(node_id)
    .bind(old_epoch)
    .bind(old_meter)
    .bind(old_reservation)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(conflict)?;
    let closed: bool = historical.try_get("closed")?;
    let ack: i64 = historical.try_get("acknowledged_bytes")?;
    let ceiling: i64 = historical.try_get("ceiling_bytes")?;
    if !closed || ceiling != ack || local_total != ack {
        return Err(conflict());
    }
    // Keep the durable absolute meter incarnation across the reset. The
    // cumulative Node journal is not comparable to raw post-restart Xray
    // counters; the authenticated old receipt is the trusted baseline.
    Ok(old_meter.to_owned())
}

async fn verify_initial_meter(
    conn: &mut sqlx::PgConnection,
    user_id: i64,
    node_id: i64,
    local_total: i64,
) -> Result<String, ApiError> {
    // Initial enrollment cannot treat unreported old usage as free budget.
    let observed = sqlx::query(
        "SELECT last_uplink_bytes,last_downlink_bytes
         FROM user_node_traffic_totals
         WHERE node_id=$1 AND user_id=$2 FOR SHARE",
    )
    .bind(node_id)
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?;
    let observed_total = if let Some(row) = observed {
        let up: i64 = row.try_get("last_uplink_bytes")?;
        let down: i64 = row.try_get("last_downlink_bytes")?;
        up.checked_add(down).ok_or_else(conflict)?
    } else {
        0
    };
    if local_total != observed_total {
        return Err(conflict());
    }
    Ok(uuid::Uuid::new_v4().to_string())
}

async fn lease_identity(
    conn: &mut sqlx::PgConnection,
    user_id: i64,
    node_id: i64,
    epoch: &str,
    local_record: Option<&LocalQuotaCounter>,
    local_total: i64,
) -> Result<(String, String, bool), ApiError> {
    let existing = sqlx::query(
        "SELECT meter_epoch::text AS meter_epoch,reservation_id::text AS reservation_id,
                node_confirmed,acknowledged_bytes,ceiling_bytes
         FROM quota_v2_reservations
         WHERE user_id=$1 AND epoch=$2::uuid AND node_id=$3
         ORDER BY valid_until DESC LIMIT 1 FOR UPDATE",
    )
    .bind(user_id)
    .bind(epoch)
    .bind(node_id)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(row) = existing {
        return confirm_existing_lease(
            conn,
            user_id,
            node_id,
            epoch,
            local_record,
            local_total,
            row,
        )
        .await;
    }
    // Every fresh epoch starts unfunded and must be re-acknowledged by Node.
    let meter = if let Some(previous) = local_record.filter(|row| row.epoch.is_some()) {
        confirm_closed_epoch(conn, user_id, node_id, previous, local_total).await?
    } else {
        verify_initial_meter(conn, user_id, node_id, local_total).await?
    };
    Ok((meter, uuid::Uuid::new_v4().to_string(), false))
}

async fn issue_user(
    conn: &mut sqlx::PgConnection,
    user: &mut Value,
    user_id: i64,
    node_id: i64,
    local_record: Option<&LocalQuotaCounter>,
    now_ms: i64,
) -> Result<(), ApiError> {
    let limit = user
        .get("limitBytes")
        .and_then(Value::as_i64)
        .ok_or_else(conflict)?;
    if limit <= 0 {
        // Node-only and CDN quotas stay on their independent rule path.
        // A global shared reservation is meaningful only for global limits.
        return Ok(());
    }
    let panel_used = user
        .get("panelUsedBytes")
        .and_then(Value::as_i64)
        .ok_or_else(conflict)?;
    let target = if user.get("onHold").and_then(Value::as_bool) == Some(true) {
        // Waiting subscriptions must be able to make the first verified
        // online connection. Allocate a small shared bootstrap allowance,
        // never an unreserved offline grant across multiple nodes.
        1024 * 1024
    } else {
        user.get("offlineBudgetBytes")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .clamp(0, 64 * 1024 * 1024)
    };
    let local_total = local_record.map_or(0, |item| item.used_bytes);
    let epoch = ensure_account(conn, user_id, limit, panel_used).await?;
    let (meter, reservation, confirmed) =
        lease_identity(conn, user_id, node_id, &epoch, local_record, local_total).await?;
    let until = now_ms.saturating_add(24 * 60 * 60 * 1000);
    let lease = sqlx::query(
        "SELECT acknowledged_bytes,ceiling_bytes,revision,
                    (EXTRACT(EPOCH FROM valid_until)*1000)::BIGINT AS valid_until_ms
             FROM quota_v2_reserve($1,$2::uuid,$3,$4::uuid,$5::uuid,$6,$7,
                   to_timestamp(($8::bigint)::double precision/1000.0))",
    )
    .bind(user_id)
    .bind(&epoch)
    .bind(node_id)
    .bind(&meter)
    .bind(&reservation)
    // Prepare a zero-spend signed policy first. A retry after a lost first
    // HTTP response gets exactly this existing unfunded lease back. Only an
    // authenticated echo of its durable identity unlocks the real budget.
    .bind(if confirmed { target } else { 0 })
    .bind(local_total)
    .bind(until)
    .fetch_one(&mut *conn)
    .await
    .map_err(|_| conflict())?;

    user["quotaReservation"] = json!({
        "epoch": epoch,
        "meterEpoch": meter,
        "reservationId": reservation,
        "revision": lease.try_get::<i64,_>("revision")?,
        "acknowledgedBytes": lease.try_get::<i64,_>("acknowledged_bytes")?,
        "ceilingBytes": lease.try_get::<i64,_>("ceiling_bytes")?,
        "validUntilMs": lease.try_get::<i64,_>("valid_until_ms")?
    });
    Ok(())
}

pub async fn issue(
    pool: &PgPool,
    node_id: i64,
    policy: &mut Value,
    local: &[LocalQuotaCounter],
    now_ms: i64,
) -> Result<(), ApiError> {
    let reported = validate_local(local)?;
    let users = policy
        .get_mut("users")
        .and_then(Value::as_array_mut)
        .ok_or_else(conflict)?;
    let mut tx = pool.begin().await?;
    for user in users.iter_mut() {
        let id = user
            .get("userId")
            .and_then(Value::as_i64)
            .ok_or_else(conflict)?;
        issue_user(
            &mut tx,
            user,
            id,
            node_id,
            reported.get(&id).copied(),
            now_ms,
        )
        .await?;
    }
    policy["version"] = json!(2);
    tx.commit().await?;
    Ok(())
}
