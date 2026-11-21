//! Strict-PQ product-tunneled, ZERO-SPEND preparation/confirmation of a
//! first-Genesis v2 SQL lease. No signed Xray cap, public ingress or refund.
//! The holder cannot obtain this route via legacy node signatures/HTTP.
use crate::{ApiError, AppState, node_auth};
use axum::{
    Json, body::Bytes, extract::State,
    http::{HeaderMap, StatusCode, header},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Row};

const PATH: &str = "/api/v1/node/quota-v2/genesis-reservation";
const MAX_BODY: usize = 3072;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    node_id: i64,
    user_id: i64,
    operation: String,
    policy_sha256: String,
    runtime_id: String,
    genesis_challenge: String,
    #[serde(default)]
    echo: Option<Echo>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Echo {
    epoch: String,
    meter_epoch: String,
    reservation_id: String,
}

fn deny() -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        "First-genesis v2 lease unavailable or already consumed.",
    )
}

fn hex64(v: &str) -> bool {
    v.len() == 64
        && v.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn valid(req: &Request) -> bool {
    req.node_id > 0 && req.user_id > 0
        && hex64(&req.policy_sha256)
        && hex64(&req.runtime_id)
        && hex64(&req.genesis_challenge)
        && req.runtime_id != req.genesis_challenge
        && match req.operation.as_str() {
            "prepare" => req.echo.is_none(),
            "confirm" => req.echo.as_ref().is_some_and(|e| {
                [&e.epoch, &e.meter_epoch, &e.reservation_id]
                    .iter().all(|v| uuid::Uuid::parse_str(v).is_ok())
            }),
            _ => false,
        }
}

fn zero_reply(
    req: &Request,
    activation: &str,
    policy_sha256: &str,
    reservation: &Value,
    now_ms: i64,
) -> Value {
    json!({
        "schemaVersion": 1,
        "kind":"xmesh.quota-v2.genesis-lease-identity",
        "status": if req.operation == "prepare" {"prepared"} else {"confirmed"},
        "nodeId":req.node_id,
        "userId":req.user_id,
        "activationReceiptSha256":activation,
        "runtimeId":req.runtime_id,
        "genesisChallenge":req.genesis_challenge,
        "policySha256":policy_sha256,
        "reservation":reservation,
        "issuedAtMs":now_ms,
        "authorizedBytes":0,
        "canSpend":false,
        "canStart":false,
        "canResume":false,
        "finalMeterVerified":false,
        "refundableBytes":0,
    })
}

fn echo_matches(req: &Request, reservation: &Value) -> bool {
    req.echo.as_ref().is_some_and(|echo| {
        reservation["epoch"].as_str() == Some(echo.epoch.as_str())
            && reservation["meterEpoch"].as_str() == Some(echo.meter_epoch.as_str())
            && reservation["reservationId"].as_str() == Some(echo.reservation_id.as_str())
    })
}

async fn saved_reply(
    conn: &mut PgConnection,
    state: &AppState,
    req: &Request,
    stage: &str,
) -> Result<Option<Value>, ApiError> {
    let saved: Option<(Vec<u8>, String, String)> = sqlx::query_as(
        "SELECT signed_reply,policy_sha256,signer_public_key
         FROM quota_v2_genesis_lease_replies
         WHERE node_id=$1 AND user_id=$2 AND stage=$3",
    )
    .bind(req.node_id)
    .bind(req.user_id)
    .bind(stage)
    .fetch_optional(conn)
    .await?;
    let Some((bytes, sha, key)) = saved else {
        return Ok(None);
    };
    let doc: Value = serde_json::from_slice(&bytes).map_err(|_| deny())?;
    let payload = &doc["payload"];
    if sha != req.policy_sha256
        || key != state.node_policy_signer.public_key()
        || serde_json::to_vec(&doc).map_err(|_| deny())? != bytes
        || doc["algorithm"] != "Ed25519"
        || doc["signature"].as_str()
            != Some(state.node_policy_signer.sign(payload).map_err(|_| deny())?.as_str())
        || payload["nodeId"] != req.node_id
        || payload["userId"] != req.user_id
        || payload["policySha256"] != req.policy_sha256.as_str()
        || payload["runtimeId"] != req.runtime_id.as_str()
        || payload["genesisChallenge"] != req.genesis_challenge.as_str()
        || payload["authorizedBytes"] != 0
        || payload["canSpend"] != false
        || payload["canStart"] != false
        || payload["canResume"] != false
        || payload["refundableBytes"] != 0
        || payload["status"] != if stage == "prepare" { "prepared" } else { "confirmed" }
    {
        return Err(deny());
    }
    Ok(Some(doc))
}

/// Recheck the authoritative product activation and original Genesis in
/// the SAME transaction, after account/lease locks. Expired or replaced
/// identities never get new reservations or replayed signed receipts.
async fn recheck_genesis(
    conn: &mut PgConnection,
    req: &Request,
    activation: &str,
    key: &str,
) -> Result<(), ApiError> {
    let live: Option<i64> = sqlx::query_scalar(
        "SELECT g.node_id FROM quota_v2_xray_genesis g
         JOIN quota_v2_genesis_quarantine_policies q USING(node_id)
         JOIN node_xsp_product_nodes p USING(node_id)
         JOIN panel_records n ON n.id=g.node_id AND n.collection='nodes'
         WHERE g.node_id=$1 AND NOT g.policy_path_used
           AND p.state='active' AND encode(p.receipt_sha256,'hex')=$2
           AND g.first_activation_sha256=$2 AND q.first_activation_sha256=$2
           AND g.runtime_id=$3 AND q.runtime_id=$3
           AND g.challenge=$4 AND q.challenge=$4
           AND q.policy_sha256=$5 AND q.signer_public_key=$6
           AND (n.data->'disabled') IS DISTINCT FROM 'true'::jsonb
           AND g.prepared_ms <= (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint
           AND g.prepared_ms+120000 > (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint
         FOR SHARE OF g,q,p,n",
    )
    .bind(req.node_id)
    .bind(activation)
    .bind(&req.runtime_id)
    .bind(&req.genesis_challenge)
    .bind(&req.policy_sha256)
    .bind(key)
    .fetch_optional(conn)
    .await?;
    if live.is_none() {
        return Err(deny());
    }
    Ok(())
}

async fn recheck_lease(
    conn: &mut PgConnection,
    req: &Request,
    reservation: &Value,
) -> Result<(), ApiError> {
    let epoch = reservation["epoch"].as_str().ok_or_else(deny)?;
    let meter = reservation["meterEpoch"].as_str().ok_or_else(deny)?;
    let id = reservation["reservationId"].as_str().ok_or_else(deny)?;
    let revision = reservation["revision"].as_i64().ok_or_else(deny)?;
    let ceiling = reservation["ceilingBytes"].as_i64().ok_or_else(deny)?;
    // Account lock first, lease lock second, matching all quota writers.
    let account: Option<i64> = sqlx::query_scalar(
        "SELECT user_id FROM quota_v2_accounts WHERE user_id=$1 AND epoch=$2::uuid
         AND NOT closed FOR UPDATE",
    )
    .bind(req.user_id)
    .bind(epoch)
    .fetch_optional(&mut *conn)
    .await?;
    if account.is_none() {
        return Err(deny());
    }
    let live: Option<i64> = sqlx::query_scalar(
        "SELECT r.node_id FROM quota_v2_reservations r
         WHERE r.user_id=$1 AND r.epoch=$2::uuid AND r.node_id=$3
           AND r.meter_epoch=$4::uuid AND r.reservation_id=$5::uuid
           AND r.revision=$6 AND r.ceiling_bytes=$7
           AND r.node_confirmed=$8 AND r.acknowledged_bytes=0
           AND r.conservative_burn_floor_bytes=0 AND r.conservative_burned_at IS NULL
           AND r.valid_until>clock_timestamp()
           AND NOT EXISTS(SELECT 1 FROM quota_v2_revocation_requests v
             WHERE v.user_id=r.user_id AND v.epoch=r.epoch AND v.node_id=r.node_id
               AND v.meter_epoch=r.meter_epoch AND v.reservation_id=r.reservation_id)
         FOR UPDATE OF r",
    )
    .bind(req.user_id)
    .bind(epoch)
    .bind(req.node_id)
    .bind(meter)
    .bind(id)
    .bind(revision)
    .bind(ceiling)
    .bind(req.operation == "confirm")
    .fetch_optional(conn)
    .await?;
    if live.is_none() {
        return Err(deny());
    }
    Ok(())
}

pub async fn handle(
    State(state): State<AppState>,
    headers: HeaderMap,
    raw: Bytes,
) -> Result<([(header::HeaderName, &'static str); 1], Json<Value>), ApiError> {
    if !crate::quota_v2::enabled()
        || !crate::quota_xray_genesis::quarantine_enabled()
        || std::env::var("XMESH_QUOTA_V2_GENESIS_RESERVATION_STAGING")
            .as_deref() != Ok("1")
    {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Experimental lease staging disabled."));
    }
    if raw.is_empty() || raw.len() > MAX_BODY {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid lease stage request size."));
    }
    let req: Request = serde_json::from_slice(&raw).map_err(|_| deny())?;
    if !valid(&req) {
        return Err(deny());
    }
    let activation = node_auth::authenticate_product_activation(
        &state, &headers, req.node_id, PATH
    ).await?;
    let genesis = sqlx::query(
        "SELECT first_activation_sha256,runtime_id,challenge,
                policy_path_used,prepared_ms
           FROM quota_v2_xray_genesis WHERE node_id=$1",
    )
    .bind(req.node_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(deny)?;
    let original_activation: Option<String> = genesis.try_get("first_activation_sha256")?;
    let runtime: Option<String> = genesis.try_get("runtime_id")?;
    let challenge: Option<String> = genesis.try_get("challenge")?;
    let old_policy: bool = genesis.try_get("policy_path_used")?;
    let prepared_ms: Option<i64> = genesis.try_get("prepared_ms")?;
    let now_ms: i64 = sqlx::query_scalar(
        "SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint"
    )
    .fetch_one(&state.pool)
    .await?;
    if original_activation.as_deref() != Some(activation)
        || runtime.as_deref() != Some(req.runtime_id.as_str())
        || challenge.as_deref() != Some(req.genesis_challenge.as_str())
        || old_policy
        || prepared_ms.is_none_or(|t| t > now_ms || now_ms >= t.saturating_add(120_000))
    {
        return Err(deny());
    }
    // Recompile authoritative profile and verify the ORIGINAL immutable,
    // still-current Nexus-signed quarantined user roster and every alias.
    let verified = crate::node_runtime::original_first_genesis_cap_scope(
        &state, req.node_id, req.user_id
    ).await?;
    if verified.policy_sha256 != req.policy_sha256
        || verified.aliases.is_empty()
        || verified.aliases.iter().any(|a| !matches!(a.class.as_str(), "main" | "cdn"))
    {
        return Err(deny());
    }
    let signed_raw: Vec<u8> = sqlx::query_scalar(
        "SELECT signed_policy_bytes FROM quota_v2_genesis_quarantine_policies
         WHERE node_id=$1 AND runtime_id=$2 AND policy_sha256=$3",
    )
    .bind(req.node_id)
    .bind(&req.runtime_id)
    .bind(&req.policy_sha256)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(deny)?;
    let policy: Value = serde_json::from_slice(&signed_raw).map_err(|_| deny())?;
    let list = policy["users"].as_array().ok_or_else(deny)?;
    let selected: Vec<Value> = list.iter()
        .filter(|u| u.get("userId").and_then(Value::as_i64) == Some(req.user_id))
        .cloned().collect();
    if selected.len() != 1 || policy["configSha256"] != verified.profile_revision
        || hex::encode(Sha256::digest(&signed_raw)) != verified.policy_sha256
    {
        return Err(deny());
    }
    // A new stage and its exact signed response must commit atomically.
    // Sharing the ordinary allocator's per-user advisory lock prevents two
    // simultaneous prepare/confirm requests from renewing a lease revision.
    let mut tx = state.pool.begin().await?;
    sqlx::query("SET LOCAL synchronous_commit TO on")
        .execute(&mut *tx)
        .await?;
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
    if !crate::node_runtime::first_genesis_rehearsal_limits_supported(
        &current_user, req.node_id, verified.aliases.iter().any(|alias| alias.class == "cdn"),
    ) || !crate::user_can_connect(&current_user, now_ms)
        || current_user["limit"].as_f64().map(crate::gb_to_bytes_i64)
            != selected[0]["limitBytes"].as_i64()
    {
        return Err(deny());
    }
    let public = state.node_policy_signer.public_key();
    let prepared = saved_reply(&mut tx, &state, &req, "prepare").await?;
    if req.operation == "confirm" {
        let previous = prepared.as_ref().ok_or_else(deny)?;
        if !echo_matches(&req, &previous["payload"]["reservation"]) {
            return Err(deny());
        }
    }
    if let Some(saved) = saved_reply(&mut tx, &state, &req, &req.operation).await? {
        recheck_lease(&mut tx, &req, &saved["payload"]["reservation"]).await?;
        recheck_genesis(&mut tx, &req, activation, &public).await?;
        tx.commit().await?;
        return Ok(([(header::CACHE_CONTROL, "no-store")], Json(saved)));
    }
    if req.operation == "prepare" {
        let prior: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM quota_v2_reservations
             WHERE node_id=$1 AND user_id=$2)",
        )
        .bind(req.node_id)
        .bind(req.user_id)
        .fetch_one(&mut *tx)
        .await?;
        if prior {
            return Err(deny());
        }
    }

    // Clone the exact original user policy. No other desired-config route
    // is invoked, and the immutable signed quarantine stays zero-spend.
    let mut user = selected.into_iter().next().ok_or_else(deny)?;
    let local = req.echo.as_ref().map(|e| crate::quota_v2::LocalQuotaCounter {
        user_id: req.user_id,
        used_bytes: 0,
        epoch: Some(e.epoch.clone()),
        meter_epoch: Some(e.meter_epoch.clone()),
        reservation_id: Some(e.reservation_id.clone()),
    });
    crate::quota_v2::issue_user(
        &mut tx, &mut user, req.user_id, req.node_id, local.as_ref(), now_ms,
    )
    .await?;
    let reservation = &user["quotaReservation"];
    let ceiling = reservation["ceilingBytes"].as_i64().ok_or_else(deny)?;
    if !user["quotaRevocation"].is_null()
        || reservation["acknowledgedBytes"] != 0
        || (req.operation == "prepare" && ceiling != 0)
        || (req.operation == "confirm" && (ceiling <= 0 || !echo_matches(&req, reservation)))
    {
        return Err(deny());
    }
    recheck_lease(&mut tx, &req, reservation).await?;
    recheck_genesis(&mut tx, &req, activation, &public).await?;
    let proof = zero_reply(&req, activation, &verified.policy_sha256, reservation, now_ms);
    let signature = state.node_policy_signer.sign(&proof)
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Lease proof signing failed."))?;
    let reply = json!({
        "payload":proof,
        "signature":signature,
        "algorithm":"Ed25519",
    });
    let bytes = serde_json::to_vec(&reply).map_err(|_| deny())?;
    sqlx::query(
        "INSERT INTO quota_v2_genesis_lease_replies
         (node_id,user_id,stage,policy_sha256,signer_public_key,signed_reply)
         VALUES($1,$2,$3,$4,$5,$6)",
    )
    .bind(req.node_id)
    .bind(req.user_id)
    .bind(&req.operation)
    .bind(&req.policy_sha256)
    .bind(public)
    .bind(bytes)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(reply)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(op: &str, echo: Option<Echo>) -> Request {
        Request {
            node_id:47, user_id:101, operation:op.to_owned(),
            policy_sha256:"a".repeat(64), runtime_id:"b".repeat(64),
            genesis_challenge:"c".repeat(64), echo,
        }
    }

    #[test]
    fn strict_staging_rejects_missing_identity_or_legacy_shortcuts() {
        assert!(valid(&sample("prepare", None)));
        assert!(!valid(&sample("confirm", None)));
        assert!(!valid(&sample("prepare", Some(Echo {
            epoch:"11111111-1111-4111-8111-111111111111".into(),
            meter_epoch:"22222222-2222-4222-8222-222222222222".into(),
            reservation_id:"33333333-3333-4333-8333-333333333333".into(),
        }))));
        assert!(!valid(&sample("grant", None)));
        let mut unknown = sample("prepare", None);
        unknown.runtime_id = unknown.genesis_challenge.clone();
        assert!(!valid(&unknown));
        let mut malformed = sample("prepare", None);
        malformed.policy_sha256 = "ZZ".to_owned();
        assert!(!valid(&malformed));
        let bad = br#"{"nodeId":47,"userId":101,"operation":"prepare",
            "policySha256":"a","runtimeId":"b","genesisChallenge":"c",
            "canStart":true}"#;
        assert!(serde_json::from_slice::<Request>(bad).is_err());
    }

    #[test]
    fn signed_reply_cannot_grant_traffic_even_on_confirm() {
        let reply = zero_reply(&sample("confirm",None), &"a".repeat(64),
            &"d".repeat(64), &json!({"ceilingBytes":1048576}), 1000);
        assert_eq!(reply["authorizedBytes"], 0);
        assert_eq!(reply["canSpend"], false);
        assert_eq!(reply["canStart"], false);
        assert_eq!(reply["canResume"], false);
        assert_eq!(reply["refundableBytes"], 0);
    }
}
