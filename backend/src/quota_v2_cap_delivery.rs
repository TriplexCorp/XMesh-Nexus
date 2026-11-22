//! Issue or redeliver a first-genesis spending cap for an enrolled XSP/2 Node.
//!
//! A Node measurement is an authenticated assertion, not remote attestation.
//! The existing allocator ceiling is already held in PostgreSQL. This API
//! retains the same reservation and runtime on renewal.
mod renewal;
use crate::{
    ApiError, AppState, node_auth,
    node_runtime::FirstGenesisCapPolicyScope,
    quota_v2_cap_signing::{Alias, DOMAIN, SqlSnapshot, sign_snapshot},
};
use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode, header},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row, postgres::PgRow};

const PATH: &str = "/api/v1/node/quota-v2/genesis-cap-delivery";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    node_id: i64,
    user_id: i64,
    #[serde(rename = "requestChallenge")]
    challenge: String,
    measurement: Option<Measurement>,
    renewal: Option<renewal::RequestFields>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Measurement {
    runtime_id: String,
    container_id: String,
    host_pid: i64,
}

fn enabled() -> bool {
    crate::quota_v2::enabled() && crate::quota_xray_genesis::quarantine_enabled()
}

fn deny() -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        "No current signed first cap for this Node and reservation.",
    )
}

fn hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn valid(req: &Request) -> bool {
    req.node_id > 0
        && req.user_id > 0
        && hex64(&req.challenge)
        && req.measurement.as_ref().is_none_or(|measurement| {
            measurement.host_pid > 0
                && hex64(&measurement.runtime_id)
                && hex64(&measurement.container_id)
                && req.challenge != measurement.runtime_id
        })
}

pub async fn handle(
    State(state): State<AppState>,
    headers: HeaderMap,
    raw: Bytes,
) -> Result<([(header::HeaderName, &'static str); 1], Json<Value>), ApiError> {
    if !enabled() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "First quota cap issuance is disabled.",
        ));
    }
    if raw.is_empty() || raw.len() > 2048 {
        return Err(deny());
    }
    let req: Request = serde_json::from_slice(&raw).map_err(|_| deny())?;
    if !valid(&req) {
        return Err(deny());
    }
    let activation =
        node_auth::authenticate_product_activation(&state, &headers, req.node_id, PATH).await?;
    let (status, exact) = if let Some(ref fields) = req.renewal {
        (
            "committed_renewal",
            renewal::issue(&state, &req, fields, activation).await?,
        )
    } else {
        (
            "committed_first_cap",
            first_cap(&state, &req, activation).await?,
        )
    };
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(json!({
            "status":status, "nodeId":req.node_id, "userId":req.user_id,
            "signedEnvelope":exact,
        })),
    ))
}

/// Acquire the allocator's per-user lock before reading the current plan.
pub async fn lock_signed_user(
    conn: &mut PgConnection,
    user_id: i64,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query("SET LOCAL synchronous_commit TO on")
        .execute(&mut *conn)
        .await?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(user_id ^ 0x51_4D_45_53_48_i64)
        .execute(&mut *conn)
        .await?;
    sqlx::query_scalar(
        "SELECT data FROM panel_records WHERE collection='users' AND id=$1 FOR SHARE",
    )
    .bind(user_id)
    .fetch_optional(conn)
    .await
}

async fn lock_open_account(
    conn: &mut PgConnection,
    user_id: i64,
) -> Result<(String, i64, i64), ApiError> {
    sqlx::query_as(
        "SELECT epoch::text,limit_bytes,GREATEST(settled_bytes,observed_floor_bytes)
         FROM quota_v2_accounts WHERE user_id=$1 AND NOT closed FOR UPDATE",
    )
    .bind(user_id)
    .fetch_optional(conn)
    .await?
    .ok_or_else(deny)
}

async fn database_now_ms(conn: &mut PgConnection) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint")
        .fetch_one(conn)
        .await
}

pub(crate) async fn observe_closed_calendars(
    conn: &mut PgConnection,
    user: i64,
    node: i64,
    epoch: &str,
) -> Result<bool, sqlx::Error> {
    let created: i64 =
        sqlx::query_scalar("SELECT quota_v2_observe_calendar_closures($1,$2,$3::uuid)")
            .bind(user)
            .bind(node)
            .bind(epoch)
            .fetch_one(conn)
            .await?;
    Ok(created > 0)
}

async fn first_cap(state: &AppState, req: &Request, activation: &str) -> Result<String, ApiError> {
    let scope =
        crate::node_runtime::original_first_genesis_cap_scope(state, req.node_id, req.user_id)
            .await?;
    let key = state.node_policy_signer.public_key();
    let mut tx = state.pool.begin().await?;
    let current_user = lock_signed_user(&mut tx, req.user_id)
        .await?
        .ok_or_else(deny)?;
    let has_cdn = scope.aliases.iter().any(|alias| alias.class == "cdn");
    let inbound_class = scope.inbound_class();
    if !crate::node_runtime::first_genesis_rehearsal_limits_supported(
        &current_user,
        req.node_id,
        has_cdn,
    ) || !crate::quota_v2_cdn_lifetime::supported(&current_user, inbound_class)
    {
        return Err(deny());
    }
    // Account first, as in every reserve/settle/revoke writer.
    let (epoch, limit, floor) = lock_open_account(&mut tx, req.user_id).await?;
    if observe_closed_calendars(&mut tx, req.user_id, req.node_id, &epoch).await? {
        // A refused request must still commit the irreversible boundary.
        tx.commit().await?;
        return Err(deny());
    }
    let now = database_now_ms(&mut tx).await?;
    if !crate::node_runtime::first_genesis_active_until(&current_user, now, now.saturating_add(1))
        || crate::quota_v2::authoritative_shared_limit(&current_user).ok() != Some(limit)
    {
        return Err(deny());
    }
    check_conservation(&mut tx, req.user_id, &epoch, limit, floor).await?;
    if !crate::quota_v2_node_lifetime::issued_within_limit(
        &mut tx,
        req.user_id,
        req.node_id,
        &current_user,
    )
    .await?
        || !crate::quota_v2_cdn_lifetime::issued_within_limit(
            &mut tx,
            req.user_id,
            &current_user,
            inbound_class,
        )
        .await?
    {
        return Err(deny());
    }
    let mut row = load_outbox(&mut tx, req, &scope, &epoch, &key, activation).await?;
    if row.is_none() {
        issue_original(
            &mut tx,
            state,
            req,
            &scope,
            &epoch,
            activation,
            &current_user,
        )
        .await?;
        row = load_outbox(&mut tx, req, &scope, &epoch, &key, activation).await?;
    }
    let row = row.ok_or_else(deny)?;
    let reservation: String = row.try_get("reservation")?;
    crate::quota_v2_cdn_lifetime::verify_class(
        &mut tx,
        req.user_id,
        req.node_id,
        &reservation,
        inbound_class,
    )
    .await?;
    let install: i64 = row.try_get("install_before_ms")?;
    let expires: i64 = row.try_get("valid_until_ms")?;
    check_reservation_calendars(
        &mut tx,
        req,
        &current_user,
        &reservation,
        inbound_class,
        expires,
    )
    .await?;
    // The outbox/lease reads can wait behind a writer. The signed
    // installation window must still be open after those locks are taken.
    let delivery_now = database_now_ms(&mut tx).await?;
    if delivery_now < now
        || delivery_now >= install
        || !crate::node_runtime::first_genesis_active_until(&current_user, delivery_now, expires)
    {
        return Err(deny());
    }
    let expected_cdn = crate::quota_v2_cdn_lifetime::signed_cdn_ceiling(
        &mut tx,
        &reservation,
        req.user_id,
        req.node_id,
        &current_user,
        inbound_class,
        row.try_get("grant_bytes")?,
    )
    .await?;
    let exact = verified_outbox(state, req, &scope, &epoch, activation, &row, expected_cdn)?;
    tx.commit().await?;
    Ok(exact)
}

async fn check_conservation(
    conn: &mut PgConnection,
    user_id: i64,
    epoch: &str,
    limit: i64,
    floor: i64,
) -> Result<(), ApiError> {
    if available(conn, user_id, epoch, limit, floor).await? < 0 {
        return Err(deny());
    }
    Ok(())
}

async fn available(
    conn: &mut PgConnection,
    user_id: i64,
    epoch: &str,
    limit: i64,
    floor: i64,
) -> Result<i64, ApiError> {
    let held: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(GREATEST(ceiling_bytes::numeric-
                 GREATEST(acknowledged_bytes,conservative_burn_floor_bytes),0)),0)::bigint
         FROM quota_v2_reservations WHERE user_id=$1 AND epoch=$2::uuid",
    )
    .bind(user_id)
    .bind(epoch)
    .fetch_one(conn)
    .await?;
    Ok(limit.saturating_sub(floor).saturating_sub(held))
}

async fn load_outbox(
    conn: &mut PgConnection,
    req: &Request,
    scope: &FirstGenesisCapPolicyScope,
    epoch: &str,
    key: &str,
    activation: &str,
) -> Result<Option<PgRow>, ApiError> {
    sqlx::query(
        "SELECT o.signed_envelope,o.runtime_id,o.grant_bytes,o.revision,
                o.reservation_id::text AS reservation,o.meter_epoch::text AS meter,
                o.install_before_ms,o.valid_until_ms,c.signed_reply
         FROM quota_v2_signed_first_cap_outbox o
         JOIN quota_v2_runtime_admission_preflights pf
              ON pf.node_id=o.node_id AND pf.request_challenge=o.request_challenge
         JOIN quota_v2_reservations r ON r.user_id=o.user_id AND r.epoch=o.epoch
              AND r.node_id=o.node_id AND r.meter_epoch=o.meter_epoch
         JOIN quota_v2_xray_genesis g ON g.node_id=o.node_id
         JOIN quota_v2_genesis_quarantine_policies q ON q.node_id=o.node_id
         JOIN node_xsp_product_nodes p ON p.node_id=o.node_id
         JOIN node_xsp_public_keysets k ON k.node_id=p.node_id
              AND k.purpose='node_request' AND k.key_epoch=p.key_epoch
              AND k.ed25519_key_id=p.ed25519_key_id AND k.mldsa65_key_id=p.mldsa65_key_id
              AND k.revoked_at IS NULL
         JOIN panel_records n ON n.id=o.node_id AND n.collection='nodes'
         JOIN quota_v2_genesis_lease_replies c ON c.node_id=o.node_id
              AND c.user_id=o.user_id AND c.stage='confirm'
         JOIN quota_v2_genesis_lease_replies prep ON prep.node_id=o.node_id
              AND prep.user_id=o.user_id AND prep.stage='prepare'
         WHERE o.node_id=$1 AND o.user_id=$2 AND o.request_challenge=$3
           AND o.epoch=$4::uuid AND o.policy_sha256=$5 AND o.signer_public_key=$6
           AND p.state='active' AND encode(p.receipt_sha256,'hex')=$7
           AND g.first_activation_sha256=$7 AND q.first_activation_sha256=$7
           AND pf.first_activation_sha256=$7 AND g.runtime_id=o.runtime_id
           AND ($9::text IS NULL OR (pf.prepared_runtime_id=$9
             AND pf.reported_container_id=$10 AND pf.reported_pid=$11))
           AND q.runtime_id=o.runtime_id AND pf.prepared_runtime_id=o.runtime_id
           AND q.policy_sha256=$5 AND c.policy_sha256=$5 AND prep.policy_sha256=$5
           AND q.signer_public_key=$6 AND c.signer_public_key=$6 AND prep.signer_public_key=$6
           AND NOT g.policy_path_used AND NOT o.can_start AND NOT o.can_resume
           AND o.refundable_bytes=0 AND pf.reported_wal_floor_bytes=0
           AND q.profile_revision=$8
           AND (n.data->'disabled') IS DISTINCT FROM 'true'::jsonb
           AND r.node_confirmed AND r.revision=o.revision AND r.reservation_id=o.reservation_id
           AND r.ceiling_bytes=o.grant_bytes AND r.acknowledged_bytes=0
           AND r.conservative_burn_floor_bytes=0 AND r.conservative_burned_at IS NULL
           AND pf.expires_at>clock_timestamp() AND r.valid_until>clock_timestamp()
           AND o.install_before_ms>(EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint
           AND o.install_before_ms<=g.prepared_ms+120000
           AND o.valid_until_ms<=(EXTRACT(EPOCH FROM r.valid_until)*1000)::bigint
           AND NOT EXISTS(SELECT 1 FROM quota_v2_revocation_requests v
             WHERE v.user_id=r.user_id AND v.epoch=r.epoch AND v.node_id=r.node_id
               AND v.meter_epoch=r.meter_epoch AND v.reservation_id=r.reservation_id)
           AND NOT EXISTS(SELECT 1 FROM quota_v2_reservations old
             JOIN quota_v2_accounts oa USING(user_id,epoch)
             WHERE old.user_id=o.user_id AND oa.closed
               AND old.ceiling_bytes>GREATEST(old.acknowledged_bytes,old.conservative_burn_floor_bytes))
         FOR SHARE OF o,pf,r,g,q,p,n,c,prep,k",
    )
    .bind(req.node_id).bind(req.user_id).bind(&req.challenge)
    .bind(epoch).bind(&scope.policy_sha256).bind(key).bind(activation)
    .bind(&scope.profile_revision)
    .bind(req.measurement.as_ref().map(|m| m.runtime_id.as_str()))
    .bind(req.measurement.as_ref().map(|m| m.container_id.as_str()))
    .bind(req.measurement.as_ref().map(|m| m.host_pid))
    .fetch_optional(conn).await.map_err(ApiError::from)
}

/// Re-delivery must compare the immutable SQL-backed CDN sub-cap, NOT
/// infer that every CDN alias may spend the entire shared MAIN ceiling.
fn signed_cdn_matches_sql(signed: &Value, expected_cdn: i64, shared: i64) -> bool {
    expected_cdn >= 0 && expected_cdn <= shared && signed.as_i64() == Some(expected_cdn)
}

#[cfg(test)]
mod immutable_first_cdn_outbox_tests {
    use super::signed_cdn_matches_sql;
    use serde_json::json;

    #[test]
    fn signed_mixed_cap_replays_exactly_its_small_sql_funded_cdn_hold() {
        assert!(signed_cdn_matches_sql(&json!(512), 512, 4_096));
        assert!(signed_cdn_matches_sql(&json!(0), 0, 4_096));
        assert!(signed_cdn_matches_sql(&json!(4_096), 4_096, 4_096));
        assert!(!signed_cdn_matches_sql(&json!(4_096), 512, 4_096));
        assert!(!signed_cdn_matches_sql(&json!(512), 513, 4_096));
        assert!(!signed_cdn_matches_sql(&json!(513), 512, 4_096));
        assert!(!signed_cdn_matches_sql(&json!(512), -1, 4_096));
        assert!(!signed_cdn_matches_sql(&json!(512), 4_097, 4_096));
        assert!(!signed_cdn_matches_sql(&json!(-1), -1, 4_096));
        assert!(!signed_cdn_matches_sql(&json!(null), 512, 4_096));
    }
}

fn verified_outbox(
    state: &AppState,
    req: &Request,
    scope: &FirstGenesisCapPolicyScope,
    epoch: &str,
    activation: &str,
    row: &PgRow,
    expected_cdn: i64,
) -> Result<String, ApiError> {
    let raw: Vec<u8> = row.try_get("signed_envelope")?;
    let saved: Vec<u8> = row.try_get("signed_reply")?;
    let runtime: String = row.try_get("runtime_id")?;
    let ceiling: i64 = row.try_get("grant_bytes")?;
    let revision: i64 = row.try_get("revision")?;
    let reservation: String = row.try_get("reservation")?;
    let meter: String = row.try_get("meter")?;
    let install: i64 = row.try_get("install_before_ms")?;
    let expires: i64 = row.try_get("valid_until_ms")?;
    let doc: Value = serde_json::from_slice(&raw).map_err(|_| deny())?;
    let p = &doc["payload"];
    let confirm: Value = serde_json::from_slice(&saved).map_err(|_| deny())?;
    let original = &confirm["payload"];
    let mut canonical = serde_json::to_vec(&doc).map_err(|_| deny())?;
    canonical.push(b'\n');
    let aliases: Vec<Value> = scope
        .aliases
        .iter()
        .map(|a| json!({"email":a.email,"class":a.class}))
        .collect();
    if raw != canonical
        || doc["algorithm"] != "Ed25519"
        || doc["signature"].as_str()
            != Some(
                state
                    .node_policy_signer
                    .sign_domain(DOMAIN, p)
                    .map_err(|_| deny())?
                    .as_str(),
            )
        || confirm["signature"].as_str()
            != Some(
                state
                    .node_policy_signer
                    .sign(original)
                    .map_err(|_| deny())?
                    .as_str(),
            )
        || original["status"] != "confirmed"
        || original["authorizedBytes"] != 0
        || original["canSpend"] != false
        || original["reservation"]["reservationId"].as_str() != Some(reservation.as_str())
        || original["reservation"]["revision"] != revision
        || original["reservation"]["ceilingBytes"] != ceiling
        || p["kind"] != "xmesh.quota-v2.xray-cap-admission"
        || p["nodeId"] != req.node_id
        || p["userId"] != req.user_id
        || p["activationReceiptSha256"].as_str() != Some(activation)
        || p["runtimeId"].as_str() != Some(runtime.as_str())
        || p["policySha256"].as_str() != Some(scope.policy_sha256.as_str())
        || p["nonce"].as_str() != Some(req.challenge.as_str())
        || p["accountEpoch"].as_str() != Some(epoch)
        || p["meterEpoch"].as_str() != Some(meter.as_str())
        || p["reservationId"].as_str() != Some(reservation.as_str())
        || p["reservationRevision"] != revision
        || p["sharedCeilingBytes"] != ceiling
        || p["nodeCeilingBytes"] != ceiling
        || !signed_cdn_matches_sql(&p["cdnCeilingBytes"], expected_cdn, ceiling)
        || p["installBeforeMs"] != install
        || p["validUntilMs"] != expires
        || p["aliasScopes"] != json!(aliases)
        || p["witnessedWalBytes"] != 0
        || p["witnessedCdnBytes"] != 0
        || p["canSpend"] != true
        || p["canStart"] != false
        || p["canResume"] != false
        || p["finalMeterVerified"] != false
        || p["refundableBytes"] != 0
    {
        return Err(deny());
    }
    // Do not mint, refresh, extend or rewrite the immutable cap on retry.
    String::from_utf8(raw).map_err(|_| deny())
}

#[derive(sqlx::FromRow)]
struct FirstLease {
    meter: String,
    reservation: String,
    revision: i64,
    ceiling: i64,
    lease_expires: i64,
    prepared_ms: i64,
}

#[derive(sqlx::FromRow)]
struct Preflight {
    account_limit_bytes: i64,
    account_floor_bytes: i64,
    all_node_held_bytes: i64,
    expires_ms: i64,
}

fn reject_conflict(err: sqlx::Error) -> ApiError {
    if err
        .as_database_error()
        .and_then(sqlx::error::DatabaseError::code)
        .is_some_and(|code| matches!(code.as_ref(), "22023" | "23505" | "P0002"))
    {
        deny()
    } else {
        ApiError::from(err)
    }
}

async fn issue_original(
    conn: &mut PgConnection,
    state: &AppState,
    req: &Request,
    scope: &FirstGenesisCapPolicyScope,
    epoch: &str,
    activation: &str,
    current_user: &Value,
) -> Result<(), ApiError> {
    let measurement = req.measurement.as_ref().ok_or_else(deny)?;
    let lease = lock_first_lease(conn, req, epoch, activation, measurement).await?;
    let inbound_class = scope.inbound_class();
    crate::quota_v2_cdn_lifetime::verify_class(
        conn,
        req.user_id,
        req.node_id,
        &lease.reservation,
        inbound_class,
    )
    .await?;
    let preflight = sqlx::query_as::<_, Preflight>(
        "SELECT account_limit_bytes,account_floor_bytes,all_node_held_bytes,
                (EXTRACT(EPOCH FROM expires_at)*1000)::bigint AS expires_ms
         FROM quota_v2_record_quarantined_runtime_preflight(
             $1,$2::uuid,$3,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11,$12,0)",
    )
    .bind(req.user_id)
    .bind(epoch)
    .bind(req.node_id)
    .bind(&lease.meter)
    .bind(&lease.reservation)
    .bind(lease.revision)
    .bind(&req.challenge)
    .bind(&measurement.runtime_id)
    .bind(&measurement.container_id)
    .bind(measurement.host_pid)
    .bind(&scope.policy_sha256)
    .bind(activation)
    .fetch_one(&mut *conn)
    .await
    .map_err(reject_conflict)?;
    let now = database_now_ms(conn).await?;
    let expires = now.saturating_add(3_600_000).min(lease.lease_expires);
    let aliases = scope
        .aliases
        .iter()
        .map(|a| Alias {
            email: a.email.clone(),
            class: a.class.clone(),
        })
        .collect::<Vec<_>>();
    let cdn_ceiling = crate::quota_v2_cdn_lifetime::signed_cdn_ceiling(
        conn,
        &lease.reservation,
        req.user_id,
        req.node_id,
        current_user,
        inbound_class,
        lease.ceiling,
    )
    .await?;
    let signed = sign_snapshot(
        &state.node_policy_signer,
        &SqlSnapshot {
            user_id: req.user_id,
            node_id: req.node_id,
            activation_sha: activation.to_owned(),
            runtime_id: measurement.runtime_id.clone(),
            policy_sha: scope.policy_sha256.clone(),
            account_epoch: epoch.to_owned(),
            meter_epoch: lease.meter,
            reservation_id: lease.reservation,
            revision: lease.revision,
            nonce: req.challenge.clone(),
            original_inventory_head: "0".repeat(64),
            acknowledged: 0,
            measured_wal: 0,
            measured_cdn_wal: 0,
            ceiling: lease.ceiling,
            node_ceiling: lease.ceiling,
            cdn_ceiling,
            shared_account_limit: preflight.account_limit_bytes,
            shared_account_floor: preflight.account_floor_bytes,
            all_node_held: preflight.all_node_held_bytes,
            sql_preflight_expires_ms: preflight.expires_ms,
            lease_expires_ms: lease.lease_expires,
            issued_at_ms: now,
            install_before_ms: now
                .saturating_add(60_000)
                .min(preflight.expires_ms)
                .min(expires.saturating_sub(1))
                .min(lease.prepared_ms.saturating_add(120_000)),
            valid_until_ms: expires,
            aliases,
        },
        now,
    )
    .map_err(|_| deny())?;
    store_signed_first_cap(conn, state, req, &signed).await
}

async fn check_reservation_calendars(
    conn: &mut PgConnection,
    req: &Request,
    user: &Value,
    reservation: &str,
    class: &str,
    expires: i64,
) -> Result<(), ApiError> {
    let closed: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM quota_v2_calendar_closures WHERE reservation_id=$1::uuid)",
    )
    .bind(reservation)
    .fetch_one(&mut *conn)
    .await?;
    if closed {
        return Err(deny());
    }
    let node = crate::quota_v2_node_lifetime::permit_deadline(conn, req.node_id, user, reservation)
        .await?;
    let cdn = crate::quota_v2_cdn_lifetime::permit_deadline(conn, user, reservation, class).await?;
    if node.into_iter().chain(cdn).any(|end| expires > end) {
        return Err(deny());
    }
    Ok(())
}

async fn store_signed_first_cap(
    conn: &mut PgConnection,
    state: &AppState,
    req: &Request,
    signed: &[u8],
) -> Result<(), ApiError> {
    let exact: Vec<u8> = sqlx::query_scalar(
        "SELECT signed_envelope FROM quota_v2_store_signed_first_cap($1,$2,$3,$4)",
    )
    .bind(req.node_id)
    .bind(&req.challenge)
    .bind(state.node_policy_signer.public_key())
    .bind(signed)
    .fetch_one(conn)
    .await
    .map_err(reject_conflict)?;
    if exact != signed {
        return Err(deny());
    }
    Ok(())
}

async fn lock_first_lease(
    conn: &mut PgConnection,
    req: &Request,
    epoch: &str,
    activation: &str,
    measurement: &Measurement,
) -> Result<FirstLease, ApiError> {
    // The caller holds the user advisory lock and open account row. Each
    // reservation revision can have only one positive envelope.
    let lease = sqlx::query_as::<_, FirstLease>(
        "SELECT r.meter_epoch::text AS meter,r.reservation_id::text AS reservation,
                r.revision,r.ceiling_bytes AS ceiling,g.prepared_ms,
                (EXTRACT(EPOCH FROM r.valid_until)*1000)::bigint AS lease_expires
         FROM quota_v2_reservations r
         JOIN quota_v2_xray_genesis g ON g.node_id=r.node_id
         WHERE r.user_id=$1 AND r.node_id=$2 AND r.epoch=$3::uuid
           AND r.node_confirmed AND r.acknowledged_bytes=0 AND g.runtime_id=$4
           AND g.prepared_ms IS NOT NULL AND g.first_activation_sha256=$5
         FOR UPDATE OF r",
    )
    .bind(req.user_id)
    .bind(req.node_id)
    .bind(epoch)
    .bind(&measurement.runtime_id)
    .bind(activation)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(deny)?;

    let active: Option<i64> = sqlx::query_scalar(
        "SELECT n.id FROM panel_records n JOIN node_xsp_product_nodes p ON p.node_id=n.id
         WHERE n.id=$1 AND n.collection='nodes' AND p.state='active'
           AND encode(p.receipt_sha256,'hex')=$2
           AND (n.data->'disabled') IS DISTINCT FROM 'true'::jsonb
         FOR SHARE OF n,p",
    )
    .bind(req.node_id)
    .bind(activation)
    .fetch_optional(&mut *conn)
    .await?;
    if active.is_none() {
        return Err(deny());
    }
    // Serialize first admission against the immutable off-host WAL ledger.
    sqlx::query("SELECT pg_advisory_xact_lock(1794501,hashtext($1::text))")
        .bind(req.node_id.to_string())
        .execute(&mut *conn)
        .await?;
    let (incompatible_grant, peer_grant): (bool, bool) = sqlx::query_as(
        "SELECT COALESCE(bool_or(user_id=$2 OR runtime_id<>$3),false), count(*)<>0
           FROM quota_v2_signed_first_cap_outbox WHERE node_id=$1",
    )
    .bind(req.node_id)
    .bind(req.user_id)
    .bind(&measurement.runtime_id)
    .fetch_one(&mut *conn)
    .await?;
    if incompatible_grant {
        return Err(deny());
    }
    crate::quota_wal_transport::require_unused_first_cap_user(
        conn,
        req.node_id,
        req.user_id,
        &measurement.runtime_id,
        peer_grant,
    )
    .await?;

    Ok(lease)
}
