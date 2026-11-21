//! Disposable ONLY: delivery of the original, independently staged and
//! already committed signed positive cap over installed strict XSP/2.
//!
//! This handler NEVER creates a preflight, signs a new cap, renews a lease,
//! accepts a Node runtime assertion as independent evidence, or grants
//! start/resume/refund. Default production builds do not contain this route.
use crate::{ApiError, AppState, node_auth};
use axum::{
    Json, body::Bytes, extract::State,
    http::{HeaderMap, StatusCode, header},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;

const PATH: &str = "/api/v1/node/quota-v2/genesis-cap-delivery";
const DOMAIN: &[u8] = b"XMESH_QUOTA_V2_XRAY_CAP_ADMISSION_V1\0";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    node_id: i64,
    user_id: i64,
    request_challenge: String,
}

fn enabled() -> bool {
    crate::quota_v2::enabled()
        && crate::quota_xray_genesis::quarantine_enabled()
        && std::env::var("XMESH_AUDIT_DISPOSABLE").as_deref() == Ok("1")
        && std::env::var("GITHUB_ACTIONS").as_deref() == Ok("true")
        && std::env::var("RUNNER_ENVIRONMENT").as_deref() == Ok("github-hosted")
        && std::env::var("XMESH_INSTALLED_GENESIS_LEASE").as_deref() == Ok("1")
        && std::env::var("XMESH_QUOTA_V2_INSTALLED_CAP_DELIVERY").as_deref() == Ok("1")
        && std::env::var("DATABASE_URL").ok()
            .and_then(|s| reqwest::Url::parse(&s).ok())
            .is_some_and(|u| {
                u.host_str() == Some("127.0.0.1")
                    && u.path() == "/quota_wal_installed"
                    && u.username() == "quota_test"
            })
}

fn deny() -> ApiError {
    ApiError::new(StatusCode::CONFLICT, "No current independently staged signed first cap.")
}

fn valid(req: &Request) -> bool {
    req.node_id > 0 && req.user_id > 0
        && req.request_challenge.len() == 64
        && req.request_challenge.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Read the exact persisted signed cap only after current identity, signed
/// policy, scope, account and confirmed SQL reservation checks.
/// The request has NO byte ceiling, runtime or other authority fields.
pub async fn handle(
    State(state): State<AppState>,
    headers: HeaderMap,
    raw: Bytes,
) -> Result<([(header::HeaderName, &'static str); 1], Json<Value>), ApiError> {
    if !enabled() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Disposable cap delivery disabled."));
    }
    if raw.is_empty() || raw.len() > 2048 {
        return Err(deny());
    }
    let req: Request = serde_json::from_slice(&raw).map_err(|_| deny())?;
    if !valid(&req) {
        return Err(deny());
    }
    let activation = node_auth::authenticate_product_activation(
        &state, &headers, req.node_id, PATH,
    ).await?;
    let scope = crate::node_runtime::original_first_genesis_cap_scope(
        &state, req.node_id, req.user_id,
    ).await?;
    let key = state.node_policy_signer.public_key();
    let mut tx = state.pool.begin().await?;
    // Account first, as in every reserve/settle/revoke writer.
    let account: Option<(String, i64, i64)> = sqlx::query_as(
        "SELECT epoch::text,limit_bytes,GREATEST(settled_bytes,observed_floor_bytes)
         FROM quota_v2_accounts WHERE user_id=$1 AND NOT closed FOR UPDATE",
    )
    .bind(req.user_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (epoch, limit, floor) = account.ok_or_else(deny)?;
    let held: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(GREATEST(ceiling_bytes::numeric-
                 GREATEST(acknowledged_bytes,conservative_burn_floor_bytes),0)),0)::bigint
         FROM quota_v2_reservations WHERE user_id=$1 AND epoch=$2::uuid",
    )
    .bind(req.user_id).bind(&epoch)
    .fetch_one(&mut *tx).await?;
    if i128::from(held)+i128::from(floor)>i128::from(limit) {
        return Err(deny());
    }
    let row = sqlx::query(
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
         FOR SHARE OF o,pf,r,g,q,p,n,c,prep",
    )
    .bind(req.node_id).bind(req.user_id).bind(&req.request_challenge)
    .bind(&epoch).bind(&scope.policy_sha256).bind(&key).bind(activation)
    .bind(&scope.profile_revision)
    .fetch_optional(&mut *tx).await?.ok_or_else(deny)?;

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
    let aliases: Vec<Value> = scope.aliases.iter()
        .map(|a| json!({"email":a.email,"class":a.class})).collect();
    if raw != canonical || doc["algorithm"] != "Ed25519"
        || doc["signature"].as_str()
           != Some(state.node_policy_signer.sign_domain(DOMAIN,p).map_err(|_|deny())?.as_str())
        || confirm["signature"].as_str()
           != Some(state.node_policy_signer.sign(original).map_err(|_|deny())?.as_str())
        || original["status"] != "confirmed" || original["authorizedBytes"] != 0
        || original["canSpend"] != false
        || original["reservation"]["reservationId"].as_str() != Some(reservation.as_str())
        || original["reservation"]["revision"] != revision
        || original["reservation"]["ceilingBytes"] != ceiling
        || p["kind"] != "xmesh.quota-v2.xray-cap-admission"
        || p["nodeId"] != req.node_id || p["userId"] != req.user_id
        || p["activationReceiptSha256"].as_str() != Some(activation)
        || p["runtimeId"].as_str() != Some(runtime.as_str())
        || p["policySha256"].as_str() != Some(scope.policy_sha256.as_str())
        || p["nonce"].as_str() != Some(req.request_challenge.as_str())
        || p["accountEpoch"].as_str() != Some(epoch.as_str())
        || p["meterEpoch"].as_str() != Some(meter.as_str())
        || p["reservationId"].as_str() != Some(reservation.as_str())
        || p["reservationRevision"] != revision
        || p["sharedCeilingBytes"] != ceiling
        || p["nodeCeilingBytes"] != ceiling
        || p["installBeforeMs"] != install || p["validUntilMs"] != expires
        || p["aliasScopes"] != json!(aliases)
        || p["witnessedWalBytes"] != 0 || p["witnessedCdnBytes"] != 0
        || p["canSpend"] != true || p["canStart"] != false || p["canResume"] != false
        || p["finalMeterVerified"] != false || p["refundableBytes"] != 0
    {
        return Err(deny());
    }
    // Do not mint, refresh, extend or rewrite the immutable cap on retry.
    let exact = String::from_utf8(raw).map_err(|_|deny())?;
    tx.commit().await?;
    Ok(([(header::CACHE_CONTROL,"no-store")],Json(json!({
        "status":"committed_first_cap", "nodeId":req.node_id, "userId":req.user_id,
        "signedEnvelope":exact,
    }))))
}
