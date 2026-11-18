//! Staged quota-v2 issuer. Deliberately disabled unless the operator enables
//! `XMESH_QUOTA_V2_ENABLED=1` after rolling out v2-capable node agents.
//! The account row serializes allocation across independent nodes; a node's
//! authenticated durable total is acknowledged only against its own lease.
use crate::{ApiError, AppState, auth::AuthUser};
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
};
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

/// Record an authenticated node/gateway protocol claim. The caller must have
/// completed either registered Node Ed25519 authentication or strict-PQ
/// product-gateway authorization first.
/// This is never a proof that the Agent applied the policy or stopped traffic.
pub async fn record_authenticated_protocol_claim(
    pool: &PgPool,
    node_id: i64,
    protocol_version: Option<u8>,
) -> Result<(), ApiError> {
    let version = i16::from(protocol_version.unwrap_or_default());
    sqlx::query(
        "INSERT INTO quota_v2_authenticated_protocol_observations
             (node_id,protocol_version,authenticated_request_at,
              last_v2_claim_at,last_legacy_claim_at)
         VALUES($1,$2,NOW(),
                CASE WHEN $2=2 THEN NOW() ELSE NULL END,
                CASE WHEN $2<>2 THEN NOW() ELSE NULL END)
         ON CONFLICT(node_id) DO UPDATE SET
             protocol_version=EXCLUDED.protocol_version,
             authenticated_request_at=NOW(),
             last_v2_claim_at=CASE WHEN EXCLUDED.protocol_version=2
                 THEN NOW() ELSE quota_v2_authenticated_protocol_observations.last_v2_claim_at END,
             last_legacy_claim_at=CASE WHEN EXCLUDED.protocol_version<>2
                 THEN NOW() ELSE quota_v2_authenticated_protocol_observations.last_legacy_claim_at END",
    )
    .bind(node_id)
    .bind(version)
    .execute(pool)
    .await?;
    Ok(())
}

/// Track only a successfully authenticated control-Agent heartbeat. A newer
/// release claim must not erase a recently observed old worker, including
/// when the release target changes between Nexus deployments. This is a
/// self-reported version, NOT a verified installed executable identity.
pub async fn record_authenticated_agent_heartbeat(
    pool: &PgPool,
    node_id: i64,
    version: &str,
) -> Result<(), ApiError> {
    let target = crate::node_runtime::CONTROL_AGENT_VERSION;
    sqlx::query(
        "INSERT INTO quota_v2_authenticated_agent_release_observations
           (node_id,reported_version,last_authenticated_at,last_non_target_at)
         VALUES($1,$2,NOW(),CASE WHEN $2<>$3 THEN NOW() ELSE NULL END)
         ON CONFLICT(node_id) DO UPDATE SET
           last_non_target_at=CASE
               WHEN EXCLUDED.reported_version<>$3 THEN NOW()
               WHEN quota_v2_authenticated_agent_release_observations.reported_version<>$3
                   THEN GREATEST(
                       COALESCE(quota_v2_authenticated_agent_release_observations.last_non_target_at,
                                quota_v2_authenticated_agent_release_observations.last_authenticated_at),
                       quota_v2_authenticated_agent_release_observations.last_authenticated_at)
               ELSE quota_v2_authenticated_agent_release_observations.last_non_target_at END,
           reported_version=EXCLUDED.reported_version,
           last_authenticated_at=NOW()",
    )
    .bind(node_id)
    .bind(version)
    .bind(target)
    .execute(pool)
    .await?;
    Ok(())
}

// Keep per-node rollout classification independent from the database query.
// A heartbeat is a reported release, never verified executable attestation.
#[derive(Clone, Copy)]
enum FleetReadinessClass {
    Disabled,
    Neither,
    ProtocolOnly,
    AgentOnly,
    Ready,
}
struct FleetReadinessNode {
    payload: Value,
    class: FleetReadinessClass,
}

fn classify_fleet_node(entry: &sqlx::postgres::PgRow) -> Result<FleetReadinessNode, ApiError> {
    let node_id: i64 = entry.try_get("id")?;
    let data: Value = entry.try_get("data")?;
    let disabled = data.get("disabled").and_then(Value::as_bool) == Some(true);
    let protocol: Option<i16> = entry.try_get("protocol_version")?;
    let seen_at_ms: Option<i64> = entry.try_get("authenticated_request_at_ms")?;
    let recent: Option<bool> = entry.try_get("recent")?;
    let served: bool = entry.try_get("signed_policy_after_claim")?;
    let legacy_quiet: bool = entry.try_get("legacy_quiet")?;
    let last_legacy_ms: Option<i64> = entry.try_get("last_legacy_request_at_ms")?;
    let recent = recent.unwrap_or(false);
    let reported_agent: Option<String> = entry.try_get("reported_agent_version")?;
    let last_agent_ms: Option<i64> = entry.try_get("agent_seen_at_ms")?;
    let agent_fresh: Option<bool> = entry.try_get("agent_fresh")?;
    let agent_quiet: bool = entry.try_get("agent_quiet")?;
    let last_old_agent_ms: Option<i64> = entry.try_get("last_old_agent_at_ms")?;
    let agent_fresh = agent_fresh.unwrap_or(false);
    let agent_current =
        reported_agent.as_deref() == Some(crate::node_runtime::CONTROL_AGENT_VERSION);
    let agent_passed = !disabled && agent_current && agent_fresh && agent_quiet;
    let claims_v2 = protocol == Some(2);
    let passed = !disabled && claims_v2 && recent && legacy_quiet && served;
    let rollout_passed = passed && agent_passed;
    let class = match (disabled, passed, agent_passed) {
        (true, _, _) => FleetReadinessClass::Disabled,
        (false, true, true) => FleetReadinessClass::Ready,
        (false, true, false) => FleetReadinessClass::ProtocolOnly,
        (false, false, true) => FleetReadinessClass::AgentOnly,
        (false, false, false) => FleetReadinessClass::Neither,
    };
    let blocker = if disabled {
        "excluded_disabled"
    } else if !recent {
        "missing_or_stale_authenticated_request"
    } else if !claims_v2 {
        "legacy_or_missing_protocol_v2"
    } else if !legacy_quiet {
        "legacy_protocol_seen_recently"
    } else if !served {
        "no_signed_policy_served_after_claim"
    } else {
        "none"
    };
    let agent_blocker = if disabled {
        "excluded_disabled"
    } else if !agent_fresh {
        "missing_or_stale_authenticated_agent_heartbeat"
    } else if !agent_current {
        "agent_release_version_mismatch"
    } else if !agent_quiet {
        "outdated_agent_seen_recently"
    } else {
        "none"
    };
    Ok(FleetReadinessNode {
        payload: json!({
            "nodeId":node_id,
            "name":data.get("name").and_then(Value::as_str).unwrap_or(""),
            "disabled":disabled,
            "reportedProtocolVersion":protocol,
            "lastAuthenticatedRequestAtMs":seen_at_ms,
            "recentAuthenticatedRequest":recent,
            "legacyQuietPeriodPassed":legacy_quiet,
            "lastLegacyAuthenticatedRequestAtMs":last_legacy_ms,
            "signedPolicyServedAfterClaim":served,
            "protocolPreflightPassed":passed,
            "blocker":blocker,
            "reportedAgentVersion":reported_agent,
            "lastAuthenticatedAgentHeartbeatAtMs":last_agent_ms,
            "agentHeartbeatFresh":agent_fresh,
            "legacyAgentQuietPeriodPassed":agent_quiet,
            "lastOutdatedAgentHeartbeatAtMs":last_old_agent_ms,
            "agentReleasePreflightPassed":agent_passed,
            "agentBlocker":agent_blocker,
            "rolloutPreflightPassed":rollout_passed,
        }),
        class,
    })
}

/// An operator-only, read-only readiness inventory. A fresh authenticated v2
/// request followed by a server-signed policy response is only a compatibility
/// preflight, NOT an attestation of the installed binary, actual Xray
/// admission state, last accounted bytes, or eligibility for refunds.
pub async fn fleet_protocol_readiness(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Value>, ApiError> {
    crate::enforce_collection(&actor, "nodes", true)?;
    let entries = sqlx::query(
        "SELECT n.id,n.data,obs.protocol_version,
                (EXTRACT(EPOCH FROM obs.authenticated_request_at)*1000)::BIGINT
                    AS authenticated_request_at_ms,
                obs.authenticated_request_at>=NOW()-INTERVAL '15 minutes' AS recent,
                (obs.last_legacy_claim_at IS NULL OR
                 obs.last_legacy_claim_at < NOW()-INTERVAL '15 minutes') AS legacy_quiet,
                (EXTRACT(EPOCH FROM obs.last_legacy_claim_at)*1000)::BIGINT
                    AS last_legacy_request_at_ms,
                COALESCE((desired.served_at IS NOT NULL
                   AND desired.served_at>=obs.authenticated_request_at
                   AND desired.served_at>=NOW()-INTERVAL '15 minutes'),FALSE)
                    AS signed_policy_after_claim,
                agent_report.reported_version AS reported_agent_version,
                (EXTRACT(EPOCH FROM agent_report.last_authenticated_at)*1000)::BIGINT
                    AS agent_seen_at_ms,
                agent_report.last_authenticated_at>=NOW()-INTERVAL '65 seconds'
                    AS agent_fresh,
                (agent_report.node_id IS NOT NULL AND
                 (agent_report.last_non_target_at IS NULL OR
                  agent_report.last_non_target_at<NOW()-INTERVAL '15 minutes'))
                    AS agent_quiet,
                (EXTRACT(EPOCH FROM agent_report.last_non_target_at)*1000)::BIGINT
                    AS last_old_agent_at_ms
         FROM panel_records AS n
         LEFT JOIN quota_v2_authenticated_protocol_observations AS obs
           ON obs.node_id=n.id
         LEFT JOIN quota_v2_authenticated_agent_release_observations AS agent_report
           ON agent_report.node_id=n.id
         LEFT JOIN node_desired_revisions AS desired ON desired.node_id=n.id
         WHERE n.collection='nodes'
         ORDER BY n.id",
    )
    .fetch_all(&state.pool)
    .await?;
    let mut nodes = Vec::with_capacity(entries.len());
    let mut serving = 0_usize;
    let mut compatible = 0_usize;
    let mut release_compatible = 0_usize;
    let mut rollout_compatible = 0_usize;
    for entry in &entries {
        let node = classify_fleet_node(entry)?;
        if !matches!(node.class, FleetReadinessClass::Disabled) {
            serving += 1;
        }
        if matches!(
            node.class,
            FleetReadinessClass::ProtocolOnly | FleetReadinessClass::Ready
        ) {
            compatible += 1;
        }
        if matches!(
            node.class,
            FleetReadinessClass::AgentOnly | FleetReadinessClass::Ready
        ) {
            release_compatible += 1;
        }
        if matches!(node.class, FleetReadinessClass::Ready) {
            rollout_compatible += 1;
        }
        nodes.push(node.payload);
    }
    let all_claim_v2 = serving > 0 && serving == compatible;
    Ok(Json(json!({
        "protocol":"v2",
        "featureEnabled":enabled(),
        "servingNodes":serving,
        "protocolCompatibleNodes":compatible,
        "protocolPreflightPassed":all_claim_v2,
        "targetAgentVersion":crate::node_runtime::CONTROL_AGENT_VERSION,
        "agentReleaseCompatibleNodes":release_compatible,
        "rolloutCompatibleNodes":rollout_compatible,
        "rolloutPreflightPassed":serving>0 && rollout_compatible==serving,
        "agentHeartbeatFreshnessSeconds":65,
        "legacyAgentQuietPeriodMinutes":15,
        "observationFreshnessMinutes":15,
        "legacyQuietPeriodMinutes":15,
        "nodes":nodes,
        // Authenticated polling is not a signed *application acknowledgment*.
        "installedAgentVersionAttested":false,
        "physicalStopAndFinalMeterVerified":false,
        "canRefundFromThisPreflight":false,
        "requiresNodeRolloutVerification":true
    })))
}

/// Read-only operator preflight for coordinated revocation/reset.
/// Expiration never refunds an offline grant: the outstanding amount remains
/// held until authenticated node-side spending or a future revocation proof.
pub async fn revocation_status(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(user_id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    crate::enforce_collection(&actor, "users", true)?;
    if user_id <= 0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid user ID."));
    }
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM panel_records WHERE collection='users' AND id=$1)",
    )
    .bind(user_id)
    .fetch_one(&state.pool)
    .await?;
    if !exists {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "User not found."));
    }
    let active = sqlx::query(
        "SELECT epoch::text AS epoch,limit_bytes,settled_bytes
         FROM quota_v2_accounts WHERE user_id=$1 AND NOT closed",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some(active) = active else {
        return Ok(Json(json!({
            "userId":user_id,"protocol":"v2","state":"inactive",
            "canResetNow":false,"heldBytes":0,"nodes":[],
            "canRefundNow":false,"finalMeterVerified":false,
            "expirationRefundsBudget":false
        })));
    };
    let epoch: String = active.try_get("epoch")?;
    let limit: i64 = active.try_get("limit_bytes")?;
    let settled: i64 = active.try_get("settled_bytes")?;
    let leases = sqlx::query(
        "SELECT lease.node_id,lease.acknowledged_bytes,lease.ceiling_bytes,
                lease.revision,lease.node_confirmed,lease.valid_until<NOW() AS expired,
                revoke.request_id::text AS revocation_request_id,
                revoke.applied_at IS NOT NULL AS revocation_applied,
                revoke.observed_used_bytes,
                lease.conservative_burn_floor_bytes,lease.conservative_burned_bytes,
                lease.conservative_burned_at IS NOT NULL AS conservatively_burned
         FROM quota_v2_reservations AS lease
         LEFT JOIN quota_v2_revocation_requests AS revoke
           ON revoke.user_id=lease.user_id AND revoke.epoch=lease.epoch
          AND revoke.node_id=lease.node_id AND revoke.meter_epoch=lease.meter_epoch
         WHERE lease.user_id=$1 AND lease.epoch=$2::uuid
         ORDER BY lease.node_id",
    )
    .bind(user_id)
    .bind(&epoch)
    .fetch_all(&state.pool)
    .await?;
    let mut held: i64 = 0;
    let mut nodes = Vec::with_capacity(leases.len());
    for lease in leases {
        let ceiling: i64 = lease.try_get("ceiling_bytes")?;
        let acknowledged: i64 = lease.try_get("acknowledged_bytes")?;
        let charged_floor: i64 = lease.try_get("conservative_burn_floor_bytes")?;
        let burned: i64 = lease.try_get("conservative_burned_bytes")?;
        let burn_completed: bool = lease.try_get("conservatively_burned")?;
        let outstanding = ceiling
            .checked_sub(acknowledged.max(charged_floor))
            .ok_or_else(conflict)?;
        held = held.checked_add(outstanding).ok_or_else(conflict)?;
        let stop_applied: bool = lease.try_get("revocation_applied")?;
        let observed_stop: Option<i64> = lease.try_get("observed_used_bytes")?;
        // An applied signed deny is not a terminal Xray meter. Even when its
        // observed usage matches the current receipt, no hold is refundable.
        let stop_proof_below_settled =
            stop_applied && observed_stop.is_none_or(|used| used < acknowledged);
        nodes.push(json!({
            "nodeId":lease.try_get::<i64,_>("node_id")?,
            "acknowledgedBytes":acknowledged,
            "ceilingBytes":ceiling,
            "heldBytes":outstanding,
            "conservativeBurnedBytes":burned,
            "conservativeBurned":burn_completed,
            "conservativeBurnFloorBytes":charged_floor,
            "revision":lease.try_get::<i64,_>("revision")?,
            "nodeConfirmed":lease.try_get::<bool,_>("node_confirmed")?,
            "expired":lease.try_get::<bool,_>("expired")?,
            "revocationRequestId":lease.try_get::<Option<String>,_>("revocation_request_id")?,
            "stopApplied":stop_applied,
            "observedUsedBytes":observed_stop,
            "stopProofBelowSettledUsage":stop_proof_below_settled,
            "awaitingFinalMeter":stop_applied && outstanding > 0,
            "finalMeterVerified":false,
            "canRefundNow":false,
            "refundedBytes":0,
        }));
    }
    Ok(Json(json!({
        "userId":user_id,"protocol":"v2","state":if held == 0 {"drained"} else {"awaiting_nodes"},
        "epoch":epoch,"limitBytes":limit,"settledBytes":settled,
        "heldBytes":held,"canResetNow":held == 0,
        "canRefundNow":false,"finalMeterVerified":false,
        "nodes":nodes,"expirationRefundsBudget":false
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeNodeRequest {
    node_id: i64,
}

/// Stage an irreversible signed-deny request for exactly one active Node
/// reservation. The outstanding offline budget is deliberately NOT refunded.
pub async fn request_node_revocation(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(user_id): Path<i64>,
    Json(body): Json<RevokeNodeRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    crate::enforce_collection(&actor, "users", true)?;
    if !enabled() {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Quota-v2 is disabled; revocation cannot be started.",
        ));
    }
    if user_id <= 0 || body.node_id <= 0 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid quota identity.",
        ));
    }
    let mut tx = state.pool.begin().await?;
    // Same order as issuance and user reset: user row, then active account.
    let user_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM panel_records WHERE collection='users' AND id=$1)",
    )
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;
    if !user_exists {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "User not found."));
    }
    sqlx::query("SELECT id FROM panel_records WHERE collection='users' AND id=$1 FOR SHARE")
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await?;
    let account = sqlx::query(
        "SELECT epoch::text AS epoch FROM quota_v2_accounts
         WHERE user_id=$1 AND NOT closed FOR UPDATE",
    )
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(conflict)?;
    let epoch: String = account.try_get("epoch")?;
    let lease = sqlx::query(
        "SELECT meter_epoch::text AS meter_epoch,
                reservation_id::text AS reservation_id,
                ceiling_bytes,acknowledged_bytes
         FROM quota_v2_reservations
         WHERE user_id=$1 AND epoch=$2::uuid AND node_id=$3
         FOR UPDATE",
    )
    .bind(user_id)
    .bind(&epoch)
    .bind(body.node_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(conflict)?;
    let meter: String = lease.try_get("meter_epoch")?;
    let reservation: String = lease.try_get("reservation_id")?;
    let ceiling: i64 = lease.try_get("ceiling_bytes")?;
    let acknowledged: i64 = lease.try_get("acknowledged_bytes")?;
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT request_id::text FROM quota_v2_revocation_requests
         WHERE user_id=$1 AND epoch=$2::uuid AND node_id=$3
           AND meter_epoch=$4::uuid",
    )
    .bind(user_id)
    .bind(&epoch)
    .bind(body.node_id)
    .bind(&meter)
    .fetch_optional(&mut *tx)
    .await?;
    let request_id = existing.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    sqlx::query(
        "INSERT INTO quota_v2_revocation_requests
         (user_id,epoch,node_id,meter_epoch,reservation_id,request_id)
         VALUES ($1,$2::uuid,$3,$4::uuid,$5::uuid,$6::uuid)
         ON CONFLICT (user_id,epoch,node_id,meter_epoch) DO NOTHING",
    )
    .bind(user_id)
    .bind(&epoch)
    .bind(body.node_id)
    .bind(&meter)
    .bind(&reservation)
    .bind(&request_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({
            "state":"pending_node_stop",
            "userId":user_id,
            "nodeId":body.node_id,
            "requestId":request_id,
            "epoch":epoch,
            "reservationId":reservation,
            "heldBytes":ceiling.saturating_sub(acknowledged),
            "refundedBytes":0,
            "note":"Await signed Node stop proof; no bytes are released."
        })),
    ))
}

/// Owner-directed conservative FULL charge: no unmeasured byte is returned.
/// This action never represents a signed final meter or physical stop proof.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConservativeBurnRequest {
    node_id: i64,
    request_id: String,
    confirmation: String,
}

struct BurnResult {
    epoch: String,
    reservation: String,
    charged: i64,
    actual: i64,
    ceiling: i64,
    already: bool,
}

fn burn_reply(
    user_id: i64,
    node_id: i64,
    request_id: &str,
    result: &BurnResult,
) -> (StatusCode, Json<Value>) {
    (
        StatusCode::OK,
        Json(json!({
            "state":"conservatively_charged","userId":user_id,
            "nodeId":node_id,"requestId":request_id,
            "accountEpoch":result.epoch,"reservationId":result.reservation,
            "chargedBytes":result.charged,"acknowledgedBytes":result.actual,
            "ceilingBytes":result.ceiling,"alreadyCharged":result.already,
            "refundedBytes":0,"finalMeterVerified":false,
            "note":"All remaining bytes are permanently charged, not refunded; no final Node meter was claimed."
        })),
    )
}

async fn historical_burn(
    conn: &mut sqlx::PgConnection,
    user_id: i64,
    node_id: i64,
    request_id: &str,
) -> Result<Option<BurnResult>, ApiError> {
    let history = sqlx::query(
        "SELECT r.epoch::text AS epoch,r.reservation_id::text AS reservation_id,
                r.conservative_burned_bytes,r.acknowledged_bytes,r.ceiling_bytes
         FROM quota_v2_revocation_requests req
         JOIN quota_v2_reservations r
           ON r.user_id=req.user_id AND r.epoch=req.epoch
          AND r.node_id=req.node_id AND r.meter_epoch=req.meter_epoch
          AND r.reservation_id=req.reservation_id
         WHERE req.user_id=$1 AND req.node_id=$2 AND req.request_id=$3::uuid
           AND r.conservative_burned_at IS NOT NULL",
    )
    .bind(user_id)
    .bind(node_id)
    .bind(request_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(row) = history else {
        return Ok(None);
    };
    Ok(Some(BurnResult {
        epoch: row.try_get("epoch")?,
        reservation: row.try_get("reservation_id")?,
        charged: row.try_get("conservative_burned_bytes")?,
        actual: row.try_get("acknowledged_bytes")?,
        ceiling: row.try_get("ceiling_bytes")?,
        already: true,
    }))
}

async fn charge_burn(
    conn: &mut sqlx::PgConnection,
    user_id: i64,
    node_id: i64,
    request_id: &str,
) -> Result<BurnResult, ApiError> {
    let account = sqlx::query(
        "SELECT epoch::text AS epoch FROM quota_v2_accounts
         WHERE user_id=$1 AND NOT closed FOR UPDATE",
    )
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(conflict)?;
    let epoch: String = account.try_get("epoch")?;
    let lease = sqlx::query(
        "SELECT meter_epoch::text AS meter_epoch,
                reservation_id::text AS reservation_id,
                conservative_burned_at IS NOT NULL AS was_burned
         FROM quota_v2_reservations
         WHERE user_id=$1 AND epoch=$2::uuid AND node_id=$3 FOR UPDATE",
    )
    .bind(user_id)
    .bind(&epoch)
    .bind(node_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(conflict)?;
    let meter: String = lease.try_get("meter_epoch")?;
    let reservation: String = lease.try_get("reservation_id")?;
    let already: bool = lease.try_get("was_burned")?;
    let row = sqlx::query(
        "SELECT acknowledged_bytes,ceiling_bytes,conservative_burned_bytes
         FROM quota_v2_burn_revoked($1,$2::uuid,$3,$4::uuid,$5::uuid,$6::uuid)",
    )
    .bind(user_id)
    .bind(&epoch)
    .bind(node_id)
    .bind(&meter)
    .bind(&reservation)
    .bind(request_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|_| conflict())?;
    Ok(BurnResult {
        epoch,
        reservation,
        charged: row.try_get("conservative_burned_bytes")?,
        actual: row.try_get("acknowledged_bytes")?,
        ceiling: row.try_get("ceiling_bytes")?,
        already,
    })
}

pub async fn burn_revoked_reservation(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(user_id): Path<i64>,
    Json(body): Json<ConservativeBurnRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if actor.role != "owner" {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Owner approval required.",
        ));
    }
    if !enabled() {
        return Err(ApiError::new(StatusCode::CONFLICT, "Quota-v2 is disabled."));
    }
    if user_id <= 0
        || body.node_id <= 0
        || body.confirmation != "CHARGE_ALL_REMAINING_BYTES_NO_REFUND"
        || uuid::Uuid::parse_str(&body.request_id).is_err()
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Explicit full-reservation charge confirmation and valid request ID required.",
        ));
    }
    let mut tx = state.pool.begin().await?;
    let user: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM panel_records WHERE collection='users' AND id=$1 FOR SHARE",
    )
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;
    if user.is_none() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "User not found."));
    }
    if let Some(history) = historical_burn(&mut tx, user_id, body.node_id, &body.request_id).await?
    {
        tx.commit().await?;
        return Ok(burn_reply(
            user_id,
            body.node_id,
            &body.request_id,
            &history,
        ));
    }
    let result = charge_burn(&mut tx, user_id, body.node_id, &body.request_id).await?;
    if !result.already {
        // The irreversible charge and its audit event are ONE transaction.
        sqlx::query(
            "INSERT INTO panel_audit_log(actor,action,collection,record_id,detail)
             VALUES ($1,'quota-v2-conservative-burn','users',$2,$3)",
        )
        .bind(&actor.username)
        .bind(user_id)
        .bind(json!({"nodeId":body.node_id,"requestId":body.request_id,
                     "chargedBytes":result.charged,"refundedBytes":0}))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(burn_reply(user_id, body.node_id, &body.request_id, &result))
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
        "SELECT COALESCE(SUM(ceiling_bytes::NUMERIC-GREATEST(acknowledged_bytes,conservative_burn_floor_bytes)),0)::BIGINT
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
            "SELECT COALESCE(SUM(ceiling_bytes::NUMERIC-GREATEST(acknowledged_bytes,conservative_burn_floor_bytes)),0)::BIGINT
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
               WHERE user_id=$1 AND ceiling_bytes>GREATEST(acknowledged_bytes,conservative_burn_floor_bytes)
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
            "INSERT INTO quota_v2_accounts(
                    user_id,epoch,limit_bytes,settled_bytes,observed_floor_bytes)
                 VALUES($1,$2::uuid,$3,$4,$4)",
        )
        .bind(user_id)
        .bind(&new_epoch)
        .bind(limit)
        .bind(panel_used)
        .execute(&mut *conn)
        .await?;
        new_epoch
    };
    // Aggregate panel usage is a monotonic reservation FLOOR, not an extra
    // signed receipt charge. Both may describe the same bytes; adding them
    // would double-charge an honest subscriber on reconnect.
    sqlx::query(
        "UPDATE quota_v2_accounts SET limit_bytes=$3,
                observed_floor_bytes=GREATEST(observed_floor_bytes,$4)
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
        "SELECT r.acknowledged_bytes,r.ceiling_bytes,r.conservative_burn_floor_bytes,a.closed
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
    let burn_floor: i64 = historical.try_get("conservative_burn_floor_bytes")?;
    // A conservative burn is prepaid liability, NOT a fabricated Node meter.
    // Keep the actual monotonic cursor; new signed capacity cannot be issued
    // if a late actual overrun outruns the old prepaid ceiling.
    if !closed
        || ceiling != ack.max(burn_floor)
        || local_total < ack
        || local_total > ack.max(burn_floor)
        || (burn_floor == 0 && local_total != ack)
    {
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
    let revoke_id: Option<String> = sqlx::query_scalar(
        "SELECT request_id::text FROM quota_v2_revocation_requests
         WHERE user_id=$1 AND epoch=$2::uuid AND node_id=$3
           AND meter_epoch=$4::uuid AND reservation_id=$5::uuid",
    )
    .bind(user_id)
    .bind(&epoch)
    .bind(node_id)
    .bind(&meter)
    .bind(&reservation)
    .fetch_optional(&mut *conn)
    .await?;
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
    .bind(if confirmed && revoke_id.is_none() {
        target
    } else {
        0
    })
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
    if let Some(request_id) = revoke_id {
        // Explicit policy denial is Ed25519 signed with the actual lease.
        // Holding the reserve is mandatory until a separate proven stop.
        user["quotaRevocation"] = json!({
            "requestId":request_id,
            "epoch":epoch,
            "meterEpoch":meter,
            "reservationId":reservation,
        });
    }
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
