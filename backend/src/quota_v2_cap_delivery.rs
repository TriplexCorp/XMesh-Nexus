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

async fn first_cap(state: &AppState, req: &Request, activation: &str) -> Result<String, ApiError> {
    let scope =
        crate::node_runtime::original_first_genesis_cap_scope(state, req.node_id, req.user_id)
            .await?;
    let key = state.node_policy_signer.public_key();
    let mut tx = state.pool.begin().await?;
    sqlx::query("SET LOCAL synchronous_commit TO on")
        .execute(&mut *tx)
        .await?;
    // Match ensure_account: the per-user advisory lock precedes the
    // user record and accounting rows. A changed plan cannot be serviced
    // from a stale outbox just because the Xray config hash is unchanged.
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(req.user_id ^ 0x51_4D_45_53_48_i64)
        .execute(&mut *tx)
        .await?;
    let current_user: Value = sqlx::query_scalar(
        "SELECT data FROM panel_records WHERE collection='users' AND id=$1 FOR SHARE",
    )
    .bind(req.user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(deny)?;
    let has_cdn = scope.aliases.iter().any(|alias| alias.class == "cdn");
    let inbound_class = if scope.aliases.iter().all(|a| a.class == "cdn") {
        "cdn"
    } else if scope.aliases.iter().all(|a| a.class == "main") {
        "main"
    } else {
        "mixed"
    };
    if !crate::node_runtime::first_genesis_rehearsal_limits_supported(
        &current_user, req.node_id, has_cdn,
    ) || !crate::quota_v2_cdn_lifetime::supported(&current_user, inbound_class) {
        return Err(deny());
    }
    // Account first, as in every reserve/settle/revoke writer.
    let account: Option<(String, i64, i64)> = sqlx::query_as(
        "SELECT epoch::text,limit_bytes,GREATEST(settled_bytes,observed_floor_bytes)
         FROM quota_v2_accounts WHERE user_id=$1 AND NOT closed FOR UPDATE",
    )
    .bind(req.user_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (epoch, limit, floor) = account.ok_or_else(deny)?;
    let now: i64 =
        sqlx::query_scalar("SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint")
            .fetch_one(&mut *tx)
            .await?;
    if !crate::node_runtime::first_genesis_active_until(&current_user, now, now.saturating_add(1))
        || current_user["limit"].as_f64().map(crate::gb_to_bytes_i64) != Some(limit)
    {
        return Err(deny());
    }
    check_conservation(&mut tx, req.user_id, &epoch, limit, floor).await?;
    if !crate::quota_v2_node_lifetime::issued_within_limit(
        &mut tx, req.user_id, req.node_id, &current_user,
    ).await? || !crate::quota_v2_cdn_lifetime::issued_within_limit(
        &mut tx, req.user_id, &current_user, inbound_class,
    ).await? {
        return Err(deny());
    }
    let mut row = load_outbox(&mut tx, req, &scope, &epoch, &key, activation).await?;
    if row.is_none() {
        let measurement = req.measurement.as_ref().ok_or_else(deny)?;
        issue_original(&mut tx, state, req, &scope, &epoch, activation, measurement).await?;
        row = load_outbox(&mut tx, req, &scope, &epoch, &key, activation).await?;
    }
    let row = row.ok_or_else(deny)?;
    let install: i64 = row.try_get("install_before_ms")?;
    let expires: i64 = row.try_get("valid_until_ms")?;
    // The outbox/lease reads can wait behind a writer. The signed
    // installation window must still be open after those locks are taken.
    let delivery_now: i64 =
        sqlx::query_scalar("SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint")
            .fetch_one(&mut *tx)
            .await?;
    if delivery_now < now
        || delivery_now >= install
        || !crate::node_runtime::first_genesis_active_until(&current_user, delivery_now, expires)
    {
        return Err(deny());
    }
    let exact = verified_outbox(state, req, &scope, &epoch, activation, &row)?;
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

fn verified_outbox(
    state: &AppState,
    req: &Request,
    scope: &FirstGenesisCapPolicyScope,
    epoch: &str,
    activation: &str,
    row: &PgRow,
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
    let has_cdn = scope.aliases.iter().any(|alias| alias.class == "cdn");
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
        || p["cdnCeilingBytes"] != if has_cdn { ceiling } else { 0 }
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
    measurement: &Measurement,
) -> Result<(), ApiError> {
    let lease = lock_first_lease(conn, req, epoch, activation, measurement).await?;
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
    let now: i64 =
        sqlx::query_scalar("SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint")
            .fetch_one(&mut *conn)
            .await?;
    let aliases = scope
        .aliases
        .iter()
        .map(|a| Alias {
            email: a.email.clone(),
            class: a.class.clone(),
        })
        .collect::<Vec<_>>();
    let cdn_ceiling = if aliases.iter().any(|alias| alias.class == "cdn") {
        lease.ceiling
    } else {
        0
    };
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
                .min(lease.prepared_ms.saturating_add(120_000)),
            valid_until_ms: now.saturating_add(3_600_000).min(lease.lease_expires),
            aliases,
        },
        now,
    )
    .map_err(|_| deny())?;
    let exact: Vec<u8> = sqlx::query_scalar(
        "SELECT signed_envelope FROM quota_v2_store_signed_first_cap($1,$2,$3,$4)",
    )
    .bind(req.node_id)
    .bind(&req.challenge)
    .bind(state.node_policy_signer.public_key())
    .bind(&signed)
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
    // Share WAL storage's per-Node transaction lock. An external WAL
    // anchor and the first grant cannot both observe an empty prior history.
    sqlx::query("SELECT pg_advisory_xact_lock(1794501,hashtext($1::text))")
        .bind(req.node_id.to_string())
        .execute(&mut *conn)
        .await?;
    let already_used: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM quota_v2_signed_first_cap_outbox WHERE node_id=$1)
          OR EXISTS(SELECT 1 FROM quota_v2_external_wal_birth_anchors WHERE node_id=$1)",
    )
    .bind(req.node_id)
    .fetch_one(&mut *conn)
    .await?;
    if already_used {
        return Err(deny());
    }

    Ok(lease)
}
