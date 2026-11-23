//! Dedicated XSP/2 calendar successor positive-cap issuer.
//!
//! All old WAL liabilities remain in their ORIGINAL reservations. The fresh
//! process/empty-WAL measurement is an authenticated Agent claim, NOT remote
//! hardware attestation. SQL signs and holds a new independent reservation
//! atomically; exact signed bytes are immutable after COMMIT/lost reply.
//! Production remains off unless the existing Quota V2/Genesis flags are on.
use super::{
    Alias, Request, SqlSnapshot, available, database_now_ms, deny, lock_open_account,
    lock_signed_user, sign_snapshot,
};
use crate::{ApiError, AppState, node_runtime, quota_v2_cap_signing::MAX_CAP};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Row};

const ZERO_DOMAIN: &[u8] = b"XMESH_QUOTA_V2_CALENDAR_SUCCESSOR_V1\0";
const FRESH_GENESIS_DOMAIN: &[u8] = b"XMESH_XRAY_GENESIS_PREPARED_V1\0";
const EMPTY_SHA: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RequestFields {
    predecessor_id: String,
    fresh_runtime_id: String,
    fresh_container_id: String,
    fresh_started_at: String,
    fresh_host_pid: i64,
    fresh_executable_sha256: String,
    fresh_config_sha256: String,
    fresh_wal_inventory_sha256: String,
    zero_initial_raw_counters: bool,
    isolated_new_wal_root: bool,
    old_wal_charge_heads_sha256: String,
}

fn canonical_id(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}

fn challenge(predecessor: &str, runtime: &str) -> String {
    let prefix = format!("XMESH_QUOTA_V2_CALENDAR_POSITIVE_REQUEST_V1\0{predecessor}\0{runtime}");
    format!("{:x}", Sha256::digest(prefix.as_bytes()))
}

fn confirmed_old_heads_hash(heads: &[(String, i64, String, i64)]) -> Result<String, ApiError> {
    // Cross-language canonical bytes MUST match Agent
    // calendar_fence._verified_old_wal_charge_heads. PostgreSQL's
    // DISTINCT ON filename result is sorted ASC by filename.
    let mut last_name = "";
    let mut json_heads = Vec::with_capacity(heads.len());
    for (name, sequence, digest, bytes) in heads {
        if name.as_str() <= last_name
            || *sequence <= 0
            || *bytes <= 0
            || !super::hex64(digest)
            || !name.starts_with("meter-")
            || !name.rsplit_once('.').is_some_and(|(_, ext)| ext == "jsonl")
        {
            return Err(deny());
        }
        json_heads.push(json!({
            "filename":name, "lastSequence":sequence,
            "lastDigest":digest, "conservativeBytes":bytes
        }));
        last_name = name;
    }
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&json_heads).map_err(|_| deny())?)
    ))
}

fn request_valid(req: &Request, fields: &RequestFields) -> bool {
    canonical_id(&fields.predecessor_id)
        && req.challenge == challenge(&fields.predecessor_id, &fields.fresh_runtime_id)
        && super::hex64(&fields.fresh_runtime_id)
        && super::hex64(&fields.fresh_container_id)
        && super::hex64(&fields.fresh_executable_sha256)
        && super::hex64(&fields.fresh_config_sha256)
        && super::hex64(&fields.old_wal_charge_heads_sha256)
        && fields.fresh_wal_inventory_sha256 == EMPTY_SHA
        && fields.zero_initial_raw_counters
        && fields.isolated_new_wal_root
        && fields.fresh_host_pid > 0
        && !fields.fresh_started_at.is_empty()
        && fields.fresh_started_at.len() <= 48
        && fields.fresh_started_at.contains('T')
        && req.calendar_successor.is_none()
        && req.renewal.is_none()
        && req.measurement.is_none()
}

/// Verify the archived exact Nexus-signed ZERO byte predecessor preparation.
/// The planning deadline may have elapsed; it is never reused to install
/// an actual spending cap. Only a new fresh-signature installation window
/// can authorize use of the new Xray.
async fn verify_predecessor_wal_heads(
    conn: &mut PgConnection,
    req: &Request,
    fields: &RequestFields,
    runtime: &str,
    old_successor: bool,
) -> Result<(), ApiError> {
    // The Node's original nonfinal fence marker carries the SHA256 of
    // EACH last signed WAL-charge head from the predecessor. Reconstruct
    // those same exact bytes from PostgreSQL's immutable charge receipts
    // BEFORE funding any new cap. A made-up local "all tails ACK" marker
    // can no longer hide a missing or altered remote old-reservation debt.
    // Birth history before the first off-host checkpoint is separately
    // guarded and remains a release gate, not a refund authority.
    let old_heads = sqlx::query(
        "SELECT DISTINCT ON (filename) filename,last_sequence,last_digest,stream_bytes
         FROM quota_v2_wal_charges WHERE reservation_id=$1::uuid
         ORDER BY filename,first_sequence DESC",
    )
    .bind(&fields.predecessor_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut canonical_heads = Vec::with_capacity(old_heads.len());
    for row in &old_heads {
        canonical_heads.push((
            row.try_get::<String, _>("filename")?,
            row.try_get::<i64, _>("last_sequence")?,
            row.try_get::<String, _>("last_digest")?,
            row.try_get::<i64, _>("stream_bytes")?,
        ));
    }
    let expected_heads = confirmed_old_heads_hash(&canonical_heads)?;
    if expected_heads != fields.old_wal_charge_heads_sha256 {
        return Err(deny());
    }
    crate::quota_wal_transport::require_closed_stream_charges(
        conn,
        req.node_id,
        req.user_id,
        runtime,
        old_successor,
        &canonical_heads,
    )
    .await?;
    Ok(())
}

async fn signed_predecessor(
    conn: &mut PgConnection,
    state: &AppState,
    req: &Request,
    fields: &RequestFields,
    activation: &str,
    (account_epoch, policy_sha256): (&str, &str),
    now: i64,
) -> Result<(String, String), ApiError> {
    let row = sqlx::query(
        "SELECT p.candidate_meter_epoch::text AS meter,
                p.candidate_reservation_id::text AS reservation,
                p.signed_envelope AS envelope,
                p.predecessor_runtime_id AS old_runtime,
                p.issued_at_ms,p.valid_until_ms,
                f.valid_until_ms AS old_until,f.successor AS old_successor,
                p.signer_public_key
         FROM quota_v2_calendar_successor_preparations p
         JOIN quota_v2_calendar_closures c ON c.reservation_id=p.predecessor_id
         JOIN quota_v2_wal_admission_caps f
           ON f.reservation_id=p.predecessor_id AND f.node_id=p.node_id
              AND f.user_id=p.user_id AND f.epoch=p.account_epoch
         WHERE p.predecessor_id=$1::uuid AND p.node_id=$2 AND p.user_id=$3
           AND p.account_epoch=$4::uuid AND p.policy_sha256=$5
           AND f.policy_sha256=$5 AND c.observed_at>=c.boundary_at
           AND f.valid_until_ms <= $6
         FOR SHARE OF p,c",
    )
    .bind(&fields.predecessor_id)
    .bind(req.node_id)
    .bind(req.user_id)
    .bind(account_epoch)
    .bind(policy_sha256)
    .bind(now)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(deny)?;
    let signer = state.node_policy_signer.public_key();
    let db_signer: String = row.try_get("signer_public_key")?;
    let raw: Vec<u8> = row.try_get("envelope")?;
    let doc: Value = serde_json::from_slice(&raw).map_err(|_| deny())?;
    let payload = &doc["payload"];
    let expected_sig = state
        .node_policy_signer
        .sign_domain(ZERO_DOMAIN, payload)
        .map_err(|_| deny())?;
    let meter: String = row.try_get("meter")?;
    let reservation: String = row.try_get("reservation")?;
    let runtime: String = row.try_get("old_runtime")?;
    let issued: i64 = row.try_get("issued_at_ms")?;
    let valid_until: i64 = row.try_get("valid_until_ms")?;
    let old_until: i64 = row.try_get("old_until")?;
    let old_challenge = format!(
        "{:x}",
        Sha256::digest(
            format!(
                "XMESH_QUOTA_V2_CALENDAR_SUCCESSOR_REQUEST_V1\0{}",
                fields.predecessor_id
            )
            .as_bytes()
        )
    );
    if db_signer != signer
        || serde_json::to_vec(&doc).map_err(|_| deny())? != raw
        || doc["algorithm"] != "Ed25519"
        || doc["signature"] != expected_sig
        || payload["kind"] != "xmesh.quota-v2.calendar-successor-prepared"
        || payload["schemaVersion"] != 1
        || payload["nodeId"] != req.node_id
        || payload["userId"] != req.user_id
        || payload["nonce"] != old_challenge
        || payload["predecessorId"] != fields.predecessor_id
        || payload["predecessorRuntimeId"] != runtime
        || payload["activationReceiptSha256"] != activation
        || payload["policySha256"] != policy_sha256
        || payload["accountEpoch"] != account_epoch
        || payload["meterEpoch"] != meter
        || payload["reservationId"] != reservation
        || payload["issuedAtMs"] != issued
        || payload["validUntilMs"] != valid_until
        || issued < old_until
        || issued > now
        || valid_until <= issued
        || valid_until > issued.saturating_add(120_000)
        || payload["authorizedBytes"] != 0
        || payload["canSpend"] != false
        || payload["canStart"] != false
        || payload["canResume"] != false
        || payload["finalMeterVerified"] != false
        || payload["refundableBytes"] != 0
        || meter == reservation
        || runtime == fields.fresh_runtime_id
    {
        return Err(deny());
    }
    verify_predecessor_wal_heads(
        conn, req, fields, &runtime, row.try_get("old_successor")?,
    ).await?;
    Ok((meter, reservation))
}

/// Check that a committed signed outbox replay belongs to THIS exact fresh
/// incarnation and Node challenge. Do not create or increase another grant.
async fn existing_signed(
    conn: &mut PgConnection,
    state: &AppState,
    req: &Request,
    fields: &RequestFields,
    account_epoch: &str,
    (meter, reservation): (&str, &str),
    policy: &str,
) -> Result<Option<(String, String)>, ApiError> {
    let row = sqlx::query(
        "SELECT o.node_id,o.user_id,o.account_epoch::text AS epoch,
                o.meter_epoch::text AS meter,o.reservation_id::text AS reservation,
                o.fresh_runtime_id,o.policy_sha256,o.signer_public_key,
                o.nonce,o.grant_bytes,o.signed_envelope,
                o.fresh_genesis_envelope,
                p.fresh_container_id,p.fresh_host_pid,p.fresh_started_at::text AS started,
                p.fresh_executable_sha256,p.fresh_config_sha256
         FROM quota_v2_calendar_successor_positive_caps o
         JOIN quota_v2_calendar_successor_meter_preflights p
           ON p.predecessor_id=o.predecessor_id
         WHERE o.predecessor_id=$1::uuid FOR SHARE OF o,p",
    )
    .bind(&fields.predecessor_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let signed: Vec<u8> = row.try_get("signed_envelope")?;
    let fresh: Vec<u8> = row.try_get("fresh_genesis_envelope")?;
    let parsed: Value = serde_json::from_slice(&signed).map_err(|_| deny())?;
    let fresh_doc: Value = serde_json::from_slice(&fresh).map_err(|_| deny())?;
    let payload = &parsed["payload"];
    let check = state
        .node_policy_signer
        .sign_domain(super::DOMAIN, payload)
        .map_err(|_| deny())?;
    let fresh_payload = &fresh_doc["payload"];
    let fresh_check = state
        .node_policy_signer
        .sign_domain(FRESH_GENESIS_DOMAIN, fresh_payload)
        .map_err(|_| deny())?;
    let stored_started: String = row.try_get("started")?;
    let requested_started: Option<String> =
        sqlx::query_scalar("SELECT $1::text::timestamptz::text")
            .bind(&fields.fresh_started_at)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|_| deny())?;
    if row.try_get::<i64, _>("node_id")? != req.node_id
        || row.try_get::<i64, _>("user_id")? != req.user_id
        || row.try_get::<String, _>("epoch")? != account_epoch
        || row.try_get::<String, _>("meter")? != meter
        || row.try_get::<String, _>("reservation")? != reservation
        || row.try_get::<String, _>("fresh_runtime_id")? != fields.fresh_runtime_id
        || row.try_get::<String, _>("fresh_container_id")? != fields.fresh_container_id
        || row.try_get::<i64, _>("fresh_host_pid")? != fields.fresh_host_pid
        || Some(stored_started) != requested_started
        || row.try_get::<String, _>("fresh_executable_sha256")? != fields.fresh_executable_sha256
        || row.try_get::<String, _>("fresh_config_sha256")? != fields.fresh_config_sha256
        || row.try_get::<String, _>("policy_sha256")? != policy
        || row.try_get::<String, _>("signer_public_key")? != state.node_policy_signer.public_key()
        || row.try_get::<String, _>("nonce")? != req.challenge
        || row.try_get::<i64, _>("grant_bytes")? <= 0
        || parsed["algorithm"] != "Ed25519"
        || parsed["signature"] != check
        || fresh_doc["algorithm"] != "Ed25519"
        || fresh_doc["signature"] != fresh_check
        || fresh_payload["kind"] != "xmesh.xray.genesis-prepared"
        || fresh_payload["nodeId"] != req.node_id
        || fresh_payload["challenge"] != req.challenge
        || fresh_payload["candidateRuntimeId"] != fields.fresh_runtime_id
        || fresh_payload["activationReceiptSha256"] != payload["activationReceiptSha256"]
        || fresh_payload["authorizedBytes"] != 0
        || fresh_payload["canStart"] != false
        || fresh_payload["canResume"] != false
        || serde_json::to_vec(&fresh_doc).map_err(|_| deny())? != fresh
        || payload["nonce"] != req.challenge
        || payload["runtimeId"] != fields.fresh_runtime_id
        || payload["reservationId"] != reservation
        || payload["meterEpoch"] != meter
        || !matches!(serde_json::to_vec(&parsed),Ok(ref canonical)
                if signed.as_slice()==canonical.as_slice()
                    || signed.as_slice()==[canonical.as_slice(),b"\n"].concat().as_slice())
    {
        return Err(deny());
    }
    let grant = String::from_utf8(signed).map_err(|_| deny())?;
    let genesis = String::from_utf8(fresh).map_err(|_| deny())?;
    Ok(Some((grant, genesis)))
}

async fn persist_fresh_preflight(
    conn: &mut PgConnection,
    req: &Request,
    fields: &RequestFields,
    epoch: &str,
    meter: &str,
    reservation: &str,
    now: i64,
    class: &str,
) -> Result<(), ApiError> {
    let previously: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM quota_v2_calendar_successor_meter_preflights
          WHERE predecessor_id=$1::uuid)",
    )
    .bind(&fields.predecessor_id)
    .fetch_one(&mut *conn)
    .await?;
    if previously {
        return Err(deny());
    }
    // This row is a purported local measurement by an XSP-authenticated
    // Node. Database constraints pin all candidate identities; SQL does
    // NOT turn a root compromise into independent hardware attestation.
    sqlx::query(
        "INSERT INTO quota_v2_calendar_successor_meter_preflights
         (predecessor_id,node_id,user_id,account_epoch,
          candidate_meter_epoch,candidate_reservation_id,
          fresh_runtime_id,fresh_container_id,fresh_started_at,fresh_host_pid,
          fresh_executable_sha256,fresh_config_sha256,fresh_wal_inventory_sha256,
          zero_initial_raw_counters,isolated_new_wal_root)
         VALUES($1::uuid,$2,$3,$4::uuid,$5::uuid,$6::uuid,
                $7,$8,$9::text::timestamptz,$10,$11,$12,$13,$14,$15)",
    )
    .bind(&fields.predecessor_id)
    .bind(req.node_id)
    .bind(req.user_id)
    .bind(epoch)
    .bind(meter)
    .bind(reservation)
    .bind(&fields.fresh_runtime_id)
    .bind(&fields.fresh_container_id)
    .bind(&fields.fresh_started_at)
    .bind(fields.fresh_host_pid)
    .bind(&fields.fresh_executable_sha256)
    .bind(&fields.fresh_config_sha256)
    .bind(&fields.fresh_wal_inventory_sha256)
    .bind(fields.zero_initial_raw_counters)
    .bind(fields.isolated_new_wal_root)
    .execute(&mut *conn)
    .await
    .map_err(|_| deny())?;
    // First create an EMPTY reservation; calendar/class bindings must be
    // immutable before ANY positive byte is ever reserved.
    sqlx::query(
        "INSERT INTO quota_v2_reservations
         (user_id,epoch,node_id,meter_epoch,reservation_id,valid_until)
         VALUES($1,$2::uuid,$3,$4::uuid,$5::uuid,
                to_timestamp($6::double precision/1000.0))",
    )
    .bind(req.user_id)
    .bind(epoch)
    .bind(req.node_id)
    .bind(meter)
    .bind(reservation)
    .bind(now.saturating_add(1))
    .execute(&mut *conn)
    .await
    .map_err(|_| deny())?;
    crate::quota_v2_cdn_lifetime::record_class(
        &mut *conn,
        req.user_id,
        req.node_id,
        reservation,
        class,
    )
    .await?;
    Ok(())
}

struct FundedSuccessor {
    granted: i64,
    revision: i64,
    valid_until: i64,
    cdn_ceiling: i64,
    held: i64,
    signed_now: i64,
    install_before: i64,
}

async fn fund_successor_reservation(
    conn: &mut PgConnection,
    req: &Request,
    user: &Value,
    epoch: &str,
    meter: &str,
    reservation: &str,
    class: &str,
    now: i64,
    limit: i64,
    floor: i64,
) -> Result<FundedSuccessor, ApiError> {
    let node_end = crate::quota_v2_node_lifetime::bind_deadline(
        &mut *conn,
        req.node_id,
        user,
        reservation,
        true,
    )
    .await?;
    let cdn_end =
        crate::quota_v2_cdn_lifetime::bind_deadline(&mut *conn, user, reservation, class).await?;
    if node_end.is_none() && cdn_end.is_none() {
        return Err(deny());
    }
    let mut valid_until = now.saturating_add(3_600_000);
    for deadline in node_end.into_iter().chain(cdn_end) {
        valid_until = valid_until.min(deadline);
    }
    if valid_until <= now.saturating_add(90_000)
        || !node_runtime::first_genesis_active_until(user, now, valid_until)
    {
        return Err(deny());
    }
    let global = available(&mut *conn, req.user_id, epoch, limit, floor).await?;
    let node_free =
        crate::quota_v2_node_lifetime::headroom(&mut *conn, req.user_id, req.node_id, user)
            .await?
            .unwrap_or(MAX_CAP);
    let cdn_free = crate::quota_v2_cdn_lifetime::headroom(&mut *conn, req.user_id, user).await?;
    let mut target = MAX_CAP.min(global).min(node_free);
    if class == "cdn" {
        target = target.min(cdn_free.unwrap_or(MAX_CAP));
    }
    if target <= 0 {
        return Err(deny());
    }
    let (granted, revision): (i64, i64) = sqlx::query_as(
        "SELECT ceiling_bytes,revision
         FROM quota_v2_reserve($1,$2::uuid,$3,$4::uuid,$5::uuid,$6,0,
              to_timestamp($7::double precision/1000.0))",
    )
    .bind(req.user_id)
    .bind(epoch)
    .bind(req.node_id)
    .bind(meter)
    .bind(reservation)
    .bind(target)
    .bind(valid_until)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| deny())?;
    if granted <= 0 || granted > target || revision != 1 {
        return Err(deny());
    }
    sqlx::query(
        "UPDATE quota_v2_reservations SET node_confirmed=TRUE
         WHERE reservation_id=$1::uuid AND node_id=$2 AND user_id=$3
           AND revision=1 AND ceiling_bytes=$4 AND NOT node_confirmed",
    )
    .bind(reservation)
    .bind(req.node_id)
    .bind(req.user_id)
    .bind(granted)
    .execute(&mut *tx)
    .await
    .map_err(|_| deny())?;
    crate::quota_v2_cdn_lifetime::fund_mixed(
        &mut *conn,
        req.user_id,
        req.node_id,
        user,
        reservation,
        class,
        cdn_free,
    )
    .await?;
    let cdn_ceiling = crate::quota_v2_cdn_lifetime::signed_cdn_ceiling(
        &mut *conn,
        reservation,
        req.user_id,
        req.node_id,
        user,
        class,
        granted,
    )
    .await?;
    super::check_reservation_calendars(&mut *conn, req, user, reservation, class, valid_until)
        .await?;
    super::check_conservation(&mut *conn, req.user_id, epoch, limit, floor).await?;
    let held: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(GREATEST(ceiling_bytes::numeric-
            GREATEST(acknowledged_bytes,conservative_burn_floor_bytes),0)),0)::bigint
         FROM quota_v2_reservations WHERE user_id=$1 AND epoch=$2::uuid",
    )
    .bind(req.user_id)
    .bind(epoch)
    .fetch_one(&mut *tx)
    .await?;
    let signed_now = database_now_ms(&mut *conn).await?;
    let install_before = signed_now.saturating_add(60_000).min(valid_until - 1);
    Ok(FundedSuccessor {
        granted, revision, valid_until, cdn_ceiling, held,
        signed_now, install_before,
    })
}

pub(super) async fn issue(
    state: &AppState,
    req: &Request,
    fields: &RequestFields,
    activation: &str,
) -> Result<(String, String), ApiError> {
    if !request_valid(req, fields) {
        return Err(deny());
    }
    // The original Genesis installation deadline has expired in a calendar
    // rollover. Recheck the signed policy and current scope, and use the
    // independently measured new runtime's own short installation window.
    let scope =
        node_runtime::signed_first_genesis_scope(state, req.node_id, req.user_id, false).await?;
    let policy = &scope.policy_sha256;
    let class = scope.inbound_class();
    let has_cdn = scope.aliases.iter().any(|a| a.class == "cdn");
    let mut tx = state.pool.begin().await?;
    let user = lock_signed_user(&mut tx, req.user_id)
        .await?
        .ok_or_else(deny)?;
    if !node_runtime::first_genesis_rehearsal_limits_supported(&user, req.node_id, has_cdn)
        || !crate::quota_v2_cdn_lifetime::supported(&user, class)
    {
        return Err(deny());
    }
    let (epoch, limit, floor) = lock_open_account(&mut tx, req.user_id).await?;
    let now = database_now_ms(&mut tx).await?;
    if !node_runtime::first_genesis_active_until(&user, now, now.saturating_add(120_000))
        || crate::quota_v2::authoritative_shared_limit(&user).ok() != Some(limit)
    {
        return Err(deny());
    }
    let (meter, reservation) = signed_predecessor(
        &mut tx,
        state,
        req,
        fields,
        activation,
        (&epoch, policy),
        now,
    )
    .await?;
    if let Some(saved) = existing_signed(
        &mut tx,
        state,
        req,
        fields,
        &epoch,
        (&meter, &reservation),
        policy,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(saved);
    }
    persist_fresh_preflight(
        &mut tx, req, fields, &epoch, &meter, &reservation, now, class,
    ).await?;
    let funded = fund_successor_reservation(
        &mut tx, req, &user, &epoch, &meter, &reservation, class, now, limit, floor,
    ).await?;
    let aliases = scope
        .aliases
        .into_iter()
        .map(|a| Alias {
            email: a.email,
            class: a.class,
        })
        .collect::<Vec<_>>();
    let fresh_genesis_payload = json!({
        "schemaVersion":1,"kind":"xmesh.xray.genesis-prepared",
        "nodeId":req.node_id,"activationReceiptSha256":activation,
        "candidateRuntimeId":fields.fresh_runtime_id,
        "challenge":req.challenge,
        "preparedAtMs":signed_now,
        "validUntilMs":signed_now.saturating_add(120_000),
        "authorizedBytes":0,"canStart":false,"canResume":false
    });
    let fresh_signature = state
        .node_policy_signer
        .sign_domain(FRESH_GENESIS_DOMAIN, &fresh_genesis_payload)
        .map_err(|_| deny())?;
    let fresh_genesis = serde_json::to_vec(&json!({
        "algorithm":"Ed25519",
        "payload":fresh_genesis_payload,
        "signature":fresh_signature
    }))
    .map_err(|_| deny())?;
    if fresh_genesis.len() > 4096 {
        return Err(deny());
    }
    let signed = sign_snapshot(
        &state.node_policy_signer,
        &SqlSnapshot {
            user_id: req.user_id,
            node_id: req.node_id,
            activation_sha: activation.into(),
            runtime_id: fields.fresh_runtime_id.clone(),
            policy_sha: policy.clone(),
            account_epoch: epoch.clone(),
            meter_epoch: meter.clone(),
            reservation_id: reservation.clone(),
            revision,
            nonce: req.challenge.clone(),
            original_inventory_head: "0".repeat(64),
            acknowledged: 0,
            measured_wal: 0,
            measured_cdn_wal: 0,
            ceiling: granted,
            node_ceiling: granted,
            cdn_ceiling,
            shared_account_limit: limit,
            shared_account_floor: floor,
            all_node_held: held,
            sql_preflight_expires_ms: install_before,
            lease_expires_ms: valid_until,
            issued_at_ms: signed_now,
            install_before_ms: install_before,
            valid_until_ms: valid_until,
            aliases,
        },
        signed_now,
    )
    .map_err(|_| deny())?;
    sqlx::query(
        "INSERT INTO quota_v2_calendar_successor_positive_caps
         (predecessor_id,node_id,user_id,account_epoch,meter_epoch,
          reservation_id,fresh_runtime_id,policy_sha256,signer_public_key,
          nonce,revision,grant_bytes,cdn_ceiling_bytes,issued_at_ms,
          install_before_ms,valid_until_ms,signed_envelope,fresh_genesis_envelope)
         VALUES($1::uuid,$2,$3,$4::uuid,$5::uuid,$6::uuid,
                $7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
    )
    .bind(&fields.predecessor_id)
    .bind(req.node_id)
    .bind(req.user_id)
    .bind(&epoch)
    .bind(&meter)
    .bind(&reservation)
    .bind(&fields.fresh_runtime_id)
    .bind(policy)
    .bind(state.node_policy_signer.public_key())
    .bind(&req.challenge)
    .bind(revision)
    .bind(granted)
    .bind(cdn_ceiling)
    .bind(signed_now)
    .bind(install_before)
    .bind(valid_until)
    .bind(&signed)
    .bind(&fresh_genesis)
    .execute(&mut *tx)
    .await
    .map_err(|_| deny())?;
    // PostgreSQL 0161 deferred constraint verifies that NO committed
    // successor reservation exists without exactly these signed bytes.
    tx.commit().await.map_err(|_| deny())?;
    Ok((
        String::from_utf8(signed).map_err(|_| deny())?,
        String::from_utf8(fresh_genesis).map_err(|_| deny())?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_wal_charge_head_sha256_exactly_matches_agent_canonical_json() {
        let empty: Vec<(String, i64, String, i64)> = vec![];
        assert_eq!(
            confirmed_old_heads_hash(&empty).unwrap(),
            "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        );
        let rows = vec![
            (
                format!("meter-{}.jsonl", "a".repeat(64)),
                2,
                "b".repeat(64),
                123,
            ),
            (
                format!("meter-{}.jsonl", "c".repeat(64)),
                1,
                "d".repeat(64),
                456,
            ),
        ];
        assert_eq!(
            confirmed_old_heads_hash(&rows).unwrap(),
            "d0f329fe6cd8f43ff9677ff16a4b276a3b20c6566ba7d0e6dbe267d24281f64c"
        );
        assert!(confirmed_old_heads_hash(&rows.iter().rev().cloned().collect::<Vec<_>>()).is_err());
        assert!(
            confirmed_old_heads_hash(&[(rows[0].0.clone(), 0, rows[0].2.clone(), 123)]).is_err()
        );
        // WAL names are canonical, case-sensitive protocol identifiers:
        // accepting a differently cased extension could misbind a signed
        // off-host charge head to a local journal with a different name.
        let upper = vec![(
            format!("meter-{}.JSONL", "a".repeat(64)),
            1,
            "b".repeat(64),
            123,
        )];
        assert!(confirmed_old_heads_hash(&upper).is_err());
        let malformed = vec![(
            format!("meter-{}.jsonl.bak", "a".repeat(64)),
            1,
            "b".repeat(64),
            123,
        )];
        assert!(confirmed_old_heads_hash(&malformed).is_err());
    }
    #[test]
    fn successor_challenge_is_process_and_predecessor_bound() {
        let p = "33333333-3333-4333-8333-333333333333";
        let a = "a".repeat(64);
        let b = "b".repeat(64);
        assert!(canonical_id(p));
        assert_ne!(challenge(p, &a), challenge(p, &b));
        assert_ne!(
            challenge(p, &a),
            challenge("44444444-4444-4444-8444-444444444444", &a)
        );
        assert_eq!(challenge(p, &a).len(), 64);
    }
}
