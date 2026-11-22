//! Increase an existing process-bound cap using committed WAL charge floors.
use super::{Alias, DOMAIN, FirstGenesisCapPolicyScope, Request, available, deny};
use crate::{ApiError, AppState, node_runtime, quota_wal_transport};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;

const KIND: &str = "xmesh.quota-v2.xray-cap-renewal";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RequestFields {
    reservation_id: String,
    previous_revision: i64,
}

#[derive(sqlx::FromRow)]
struct Lease {
    epoch: String,
    revision: i64,
    ceiling: i64,
    wal_floor: i64,
    first_nonce: String,
    first_ceiling: i64,
    first_envelope: Vec<u8>,
}

#[derive(sqlx::FromRow)]
struct Permit {
    revision: i64,
    nonce: String,
    signed_envelope: Vec<u8>,
}

async fn lock_lease(
    conn: &mut PgConnection,
    req: &Request,
    fields: &RequestFields,
    activation: &str,
    policy: &str,
) -> Result<Lease, ApiError> {
    let Some(ref measurement) = req.measurement else {
        return Err(deny());
    };
    sqlx::query_as(
        "SELECT r.epoch::text, r.revision, r.ceiling_bytes AS ceiling,
                r.conservative_burn_floor_bytes AS wal_floor,
                f.request_challenge AS first_nonce, f.grant_bytes AS first_ceiling,
                f.signed_envelope AS first_envelope
         FROM quota_v2_reservations r
         JOIN quota_v2_signed_first_cap_outbox f
            ON f.reservation_id=r.reservation_id AND f.epoch=r.epoch AND f.meter_epoch=r.meter_epoch
            AND f.node_id=r.node_id AND f.user_id=r.user_id
         JOIN quota_v2_runtime_admission_preflights pf
            ON pf.node_id=f.node_id AND pf.request_challenge=f.request_challenge
         JOIN node_xsp_product_nodes p ON p.node_id=r.node_id
         JOIN node_xsp_public_keysets k ON k.node_id=p.node_id
              AND k.purpose='node_request' AND k.key_epoch=p.key_epoch
              AND k.ed25519_key_id=p.ed25519_key_id AND k.mldsa65_key_id=p.mldsa65_key_id
              AND k.revoked_at IS NULL
         JOIN panel_records n ON n.id=r.node_id AND n.collection='nodes'
         WHERE r.reservation_id=$1::uuid AND r.node_id=$2 AND r.user_id=$3
           AND f.runtime_id=$4 AND f.policy_sha256=$5
           AND pf.reported_container_id=$6 AND pf.reported_pid=$7
           AND p.state='active' AND encode(p.receipt_sha256,'hex')=$8
           AND (n.data->'disabled') IS DISTINCT FROM 'true'::jsonb
           AND r.node_confirmed AND r.acknowledged_bytes=0 AND r.conservative_burned_at IS NULL
           AND r.valid_until>clock_timestamp()
           AND NOT EXISTS (SELECT 1 FROM quota_v2_revocation_requests v
                 WHERE v.reservation_id=r.reservation_id)
           AND NOT EXISTS (SELECT 1 FROM quota_v2_terminal_settlements t
                 WHERE t.reservation_id=r.reservation_id)
         FOR UPDATE OF r FOR SHARE OF p,k,n",
    )
    .bind(&fields.reservation_id)
    .bind(req.node_id)
    .bind(req.user_id)
    .bind(&measurement.runtime_id)
    .bind(policy)
    .bind(&measurement.container_id)
    .bind(measurement.host_pid)
    .bind(activation)
    .fetch_optional(conn)
    .await?
    .ok_or_else(deny)
}

fn verified_payload(
    state: &AppState,
    permit: &Permit,
    lease: &Lease,
    activation: &str,
    scope: FirstGenesisCapPolicyScope,
) -> Result<Value, ApiError> {
    let doc: Value = serde_json::from_slice(&permit.signed_envelope).map_err(|_| deny())?;
    let payload = &doc["payload"];
    let signature = state
        .node_policy_signer
        .sign_domain(DOMAIN, payload)
        .map_err(|_| deny())?;
    if doc["algorithm"] != "Ed25519"
        || doc["signature"] != signature
        || payload["activationReceiptSha256"] != activation
        || payload["reservationRevision"] != lease.revision
        || payload["sharedCeilingBytes"] != lease.ceiling
        || payload["nonce"] != permit.nonce
    {
        return Err(deny());
    }
    let aliases: Vec<Alias> = scope
        .aliases
        .into_iter()
        .map(|a| Alias {
            email: a.email,
            class: a.class,
        })
        .collect();
    if payload["aliasScopes"] != json!(aliases) || permit.revision != lease.revision {
        return Err(deny());
    }
    Ok(payload.clone())
}

async fn usage_floor(conn: &mut PgConnection, user_id: i64, user: &Value) -> Result<i64, ApiError> {
    let measured: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(uplink_bytes+downlink_bytes),0)::bigint
         FROM user_node_traffic_totals WHERE user_id=$1",
    )
    .bind(user_id)
    .fetch_one(conn)
    .await?;
    let baseline = crate::gb_to_bytes_i64(user["used"].as_f64().unwrap_or_default());
    Ok(baseline.saturating_add(measured.max(0)))
}

async fn latest_permit(
    conn: &mut PgConnection,
    fields: &RequestFields,
    lease: &Lease,
) -> Result<(Permit, bool), ApiError> {
    let latest = sqlx::query_as::<_, Permit>(
        "SELECT revision,nonce,signed_envelope FROM quota_v2_cap_renewals
         WHERE reservation_id=$1::uuid ORDER BY revision DESC LIMIT 1",
    )
    .bind(&fields.reservation_id)
    .fetch_optional(conn)
    .await?;
    let is_renewal = latest.is_some();
    let permit = latest.unwrap_or_else(|| Permit {
        revision: lease.revision,
        nonce: lease.first_nonce.clone(),
        signed_envelope: lease.first_envelope.clone(),
    });
    Ok((permit, is_renewal))
}

pub(super) async fn issue(
    state: &AppState,
    req: &Request,
    fields: &RequestFields,
    activation: &str,
) -> Result<String, ApiError> {
    let next_revision = fields.previous_revision.checked_add(1).ok_or_else(deny)?;
    if fields.previous_revision <= 0
        || !uuid::Uuid::parse_str(&fields.reservation_id)
            .is_ok_and(|parsed| parsed.to_string() == fields.reservation_id)
    {
        return Err(deny());
    }
    let scope =
        node_runtime::signed_first_genesis_scope(state, req.node_id, req.user_id, false).await?;
    let mut tx = state.pool.begin().await?;
    let user = super::lock_signed_user(&mut tx, req.user_id)
        .await?
        .ok_or_else(deny)?;
    let has_cdn = scope.aliases.iter().any(|a| a.class == "cdn");
    let inbound_class = scope.inbound_class();
    if !node_runtime::first_genesis_rehearsal_limits_supported(&user, req.node_id, has_cdn)
        || !crate::quota_v2_cdn_lifetime::supported(&user, inbound_class)
    {
        return Err(deny());
    }
    let (epoch, original_limit, floor) = super::lock_open_account(&mut tx, req.user_id).await?;
    let lease = lock_lease(&mut tx, req, fields, activation, &scope.policy_sha256).await?;
    if lease.epoch != epoch {
        return Err(deny());
    }
    crate::quota_v2_cdn_lifetime::verify_class(
        &mut tx,
        req.user_id,
        req.node_id,
        &fields.reservation_id,
        inbound_class,
    )
    .await?;
    let (permit, is_renewal) = latest_permit(&mut tx, fields, &lease).await?;
    let payload = verified_payload(state, &permit, &lease, activation, scope)?;
    let now = super::database_now_ms(&mut tx).await?;
    let expires = payload["validUntilMs"].as_i64().ok_or_else(deny)?;
    let limit = crate::quota_v2::authoritative_shared_limit(&user).map_err(|_| deny())?;
    if !node_runtime::first_genesis_active_until(&user, now, expires) || limit < original_limit {
        return Err(deny());
    }
    let free =
        verify_issued_limits(&mut tx, req, &epoch, &user, inbound_class, limit, floor).await?;
    let fixed_mixed_cdn = verify_prior_cdn(
        &mut tx,
        req,
        &fields.reservation_id,
        &user,
        inbound_class,
        lease.ceiling,
        &payload,
    )
    .await?;
    let node_free =
        crate::quota_v2_node_lifetime::headroom(&mut tx, req.user_id, req.node_id, &user).await?;
    let cdn_free = if inbound_class == "cdn" {
        crate::quota_v2_cdn_lifetime::headroom(&mut tx, req.user_id, &user).await?
    } else {
        None
    };
    let free = node_free.map_or(free, |remaining| free.min(remaining));
    let free = cdn_free.map_or(free, |remaining| free.min(remaining));
    if is_renewal
        && permit.nonce == req.challenge
        && next_revision == lease.revision
        && payload["installBeforeMs"]
            .as_i64()
            .is_some_and(|deadline| now < deadline)
    {
        return String::from_utf8(permit.signed_envelope).map_err(|_| deny());
    }
    if lease.revision != fields.previous_revision
        || req.challenge == lease.first_nonce
        || now < payload["issuedAtMs"].as_i64().ok_or_else(deny)?
    {
        return Err(deny());
    }
    let signed = extend(
        &mut tx,
        state,
        req,
        fields,
        &lease,
        payload,
        free,
        now,
        expires,
        limit,
        &user,
        inbound_class,
        fixed_mixed_cdn,
    )
    .await?;
    tx.commit().await?;
    Ok(signed)
}

async fn verify_prior_cdn(
    conn: &mut PgConnection,
    req: &Request,
    reservation: &str,
    user: &Value,
    inbound_class: &str,
    ceiling: i64,
    payload: &Value,
) -> Result<bool, ApiError> {
    // Independently prove the exact CDN sub-ceiling already signed for
    // this immutable reservation. For mixed capped Nodes this is the
    // original prefunded hold, NOT the growing shared MAIN ceiling.
    let issued_cdn = crate::quota_v2_cdn_lifetime::signed_cdn_ceiling(
        conn,
        reservation,
        req.user_id,
        req.node_id,
        user,
        inbound_class,
        ceiling,
    )
    .await?;
    if payload["cdnCeilingBytes"].as_i64() != Some(issued_cdn) {
        return Err(deny());
    }
    Ok(inbound_class == "mixed" && crate::quota_v2_cdn_lifetime::limit(user)?.is_some())
}

async fn verify_issued_limits(
    conn: &mut PgConnection,
    req: &Request,
    epoch: &str,
    user: &Value,
    inbound_class: &str,
    limit: i64,
    floor: i64,
) -> Result<i64, ApiError> {
    let usage = usage_floor(&mut *conn, req.user_id, user).await?;
    let free = available(&mut *conn, req.user_id, epoch, limit, floor.max(usage)).await?;
    if free < 0
        || !crate::quota_v2_node_lifetime::issued_within_limit(
            &mut *conn,
            req.user_id,
            req.node_id,
            user,
        )
        .await?
        || !crate::quota_v2_cdn_lifetime::issued_within_limit(
            &mut *conn,
            req.user_id,
            user,
            inbound_class,
        )
        .await?
    {
        return Err(deny());
    }
    Ok(free)
}

/// Both signed ceilings are cumulative. Only independently funded
/// CDN-only reservations may grow their CDN cap with shared top-ups.
/// A mixed reservation whose CDN pool is limited keeps its immutable hold
/// even as the MAIN component grows across multiple revisions.
fn next_cdn_ceiling(
    inbound_class: &str,
    fixed_mixed_cdn: bool,
    previous: i64,
    next_shared: i64,
) -> Option<i64> {
    if previous < 0 || next_shared <= 0 || previous > next_shared {
        return None;
    }
    match inbound_class {
        "main" if previous == 0 => Some(0),
        "mixed" if fixed_mixed_cdn => Some(previous),
        "cdn" | "mixed" => Some(next_shared),
        _ => None,
    }
}

/// A revision is a genuine new entitlement only if it increases the
/// cumulative shared/MAIN ceiling, OR independently increases a strictly
/// funded mixed CDN class allowance. No-op revisions cannot consume nonces.
const fn has_authorized_revision_delta(
    shared_add: i64,
    previous_cdn: i64,
    next_cdn: i64,
    funded_mixed: bool,
) -> bool {
    shared_add >= 0
        && next_cdn >= previous_cdn
        && (shared_add > 0 || (funded_mixed && next_cdn > previous_cdn))
}

#[expect(
    clippy::too_many_arguments,
    reason = "transaction inputs and locked snapshot"
)]
async fn extend(
    conn: &mut PgConnection,
    state: &AppState,
    req: &Request,
    fields: &RequestFields,
    lease: &Lease,
    mut payload: Value,
    free: i64,
    now: i64,
    expires: i64,
    limit: i64,
    user: &Value,
    inbound_class: &str,
    fixed_mixed_cdn: bool,
) -> Result<String, ApiError> {
    let (all, cdn) =
        quota_wal_transport::committed_charge_totals(conn, &fields.reservation_id).await?;
    let held = lease.ceiling.checked_sub(all).ok_or_else(deny)?;
    // A separate CDN class window may need refilling while the shared/MAIN
    // reserve still has room. Never force MAIN consumption simply to unlock
    // independently funded CDN bytes. Shared renewals remain half-window
    // gated; a CDN-only revision keeps the shared ceiling EXACTLY unchanged.
    let add = if held <= lease.first_ceiling / 2 {
        free.min(lease.first_ceiling.saturating_sub(held)).max(0)
    } else {
        0
    };
    let install = now.saturating_add(30_000).min(expires.saturating_sub(1));
    if all != lease.wal_floor || all == 0 || install <= now {
        return Err(deny());
    }
    let digest: String = sqlx::query_scalar(
        "SELECT inventory_tail_digest FROM quota_v2_external_wal_birth_anchors
         WHERE node_id=$1 ORDER BY inventory_sequence DESC LIMIT 1",
    )
    .bind(req.node_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(deny)?;
    let ceiling = lease.ceiling.checked_add(add).ok_or_else(deny)?;
    let revision = fields.previous_revision.checked_add(1).ok_or_else(deny)?;
    payload["kind"] = json!(KIND);
    payload["nonce"] = json!(req.challenge);
    payload["reservationRevision"] = json!(revision);
    payload["inventoryTailDigest"] = json!(digest);
    payload["witnessedWalBytes"] = json!(all);
    payload["witnessedCdnBytes"] = json!(cdn);
    payload["sharedCeilingBytes"] = json!(ceiling);
    payload["nodeCeilingBytes"] = json!(ceiling);
    let old_cdn = payload["cdnCeilingBytes"].as_i64().ok_or_else(deny)?;
    let next_cdn = if fixed_mixed_cdn {
        // Exact signed cap, WAL and current pooled balance are checked under
        // one per-user/account transaction. This append-only top-up must
        // commit together with this exact Ed25519-signed revision response.
        crate::quota_v2_cdn_lifetime::renew_mixed_cdn(
            conn,
            user,
            crate::quota_v2_cdn_lifetime::MixedCdnRenewal {
                user_id: req.user_id,
                node_id: req.node_id,
                reservation: &fields.reservation_id,
                revision,
                nonce: &req.challenge,
                previous_cdn: old_cdn,
                committed_cdn_wal: cdn,
                next_shared: ceiling,
                first_window: lease.first_ceiling,
            },
        )
        .await?
    } else {
        next_cdn_ceiling(inbound_class, false, old_cdn, ceiling).ok_or_else(deny)?
    };
    // Both grants may remain fixed only for a pure replay (handled before
    // extend), never for a newly committed nonce/revision. CDN-only renewals
    // are permitted ONLY through independently committed mixed-class SQL.
    if !has_authorized_revision_delta(add, old_cdn, next_cdn, fixed_mixed_cdn) {
        return Err(deny());
    }
    payload["cdnCeilingBytes"] = json!(next_cdn);
    payload["issuedAtMs"] = json!(now);
    payload["installBeforeMs"] = json!(install);
    let signature = state
        .node_policy_signer
        .sign_domain(DOMAIN, &payload)
        .map_err(|_| deny())?;
    let signed = serde_json::to_string(
        &json!({"algorithm":"Ed25519","payload":payload,"signature":signature}),
    )
    .map_err(|_| deny())?
        + "\n";
    sqlx::query("UPDATE quota_v2_accounts SET limit_bytes=$3 WHERE user_id=$1 AND epoch=$2::uuid")
        .bind(req.user_id)
        .bind(&lease.epoch)
        .bind(limit)
        .execute(&mut *conn)
        .await?;
    sqlx::query("UPDATE quota_v2_reservations SET revision=$2,ceiling_bytes=$3 WHERE reservation_id=$1::uuid")
        .bind(&fields.reservation_id).bind(revision).bind(ceiling).execute(&mut *conn).await?;
    sqlx::query("INSERT INTO quota_v2_cap_renewals(reservation_id,revision,nonce,grant_bytes,signed_envelope)
                 VALUES($1::uuid,$2,$3,$4,$5)")
        .bind(&fields.reservation_id).bind(revision).bind(&req.challenge).bind(ceiling)
        .bind(signed.as_bytes()).execute(conn).await?;
    Ok(signed)
}

#[cfg(test)]
mod mixed_cdn_renewal_tests {
    use super::{has_authorized_revision_delta, next_cdn_ceiling};

    #[test]
    fn cdn_only_revision_does_not_require_artificial_main_consumption() {
        assert!(has_authorized_revision_delta(0, 512, 768, true));
        assert!(has_authorized_revision_delta(100, 512, 512, true));
        assert!(has_authorized_revision_delta(100, 512, 512, false));
        assert!(!has_authorized_revision_delta(0, 512, 512, true));
        assert!(!has_authorized_revision_delta(0, 512, 768, false));
        assert!(!has_authorized_revision_delta(0, 768, 512, true));
        assert!(!has_authorized_revision_delta(-1, 512, 768, true));
    }

    #[test]
    fn main_topup_never_mints_cdn_bytes_in_fixed_mixed_pool() {
        assert_eq!(next_cdn_ceiling("mixed", true, 250, 1_000), Some(250));
        assert_eq!(next_cdn_ceiling("mixed", true, 250, 4_000), Some(250));
        assert_eq!(next_cdn_ceiling("mixed", true, 0, 4_000), Some(0));
        assert_eq!(next_cdn_ceiling("cdn", false, 250, 1_000), Some(1_000));
        assert_eq!(next_cdn_ceiling("mixed", false, 250, 1_000), Some(1_000));
        assert_eq!(next_cdn_ceiling("main", false, 0, 4_000), Some(0));
    }

    #[test]
    fn invalid_or_downgraded_class_never_signs_replenishment() {
        assert_eq!(next_cdn_ceiling("other", false, 0, 1_000), None);
        assert_eq!(next_cdn_ceiling("main", false, 1, 1_000), None);
        assert_eq!(next_cdn_ceiling("mixed", true, 1_001, 1_000), None);
        assert_eq!(next_cdn_ceiling("mixed", true, -1, 1_000), None);
        assert_eq!(next_cdn_ceiling("cdn", false, 0, 0), None);
    }
}
