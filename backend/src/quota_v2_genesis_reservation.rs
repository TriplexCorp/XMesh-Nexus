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
use sqlx::Row;
use sha2::{Digest, Sha256};

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
    // Clone the exact signed per-user policy for the EXISTING serial SQL
    // allocator. Never mutate the immutable Genesis policy or issue any
    // offline grant through ordinary desired-config.
    let mut staged = json!({"version":1,"nodeId":req.node_id,"users":selected});
    let local = match req.echo.as_ref() {
        None => vec![],
        Some(e) => vec![crate::quota_v2::LocalQuotaCounter {
            user_id:req.user_id, used_bytes:0,
            epoch:Some(e.epoch.clone()), meter_epoch:Some(e.meter_epoch.clone()),
            reservation_id:Some(e.reservation_id.clone()),
        }],
    };
    crate::quota_v2::issue(&state.pool, req.node_id, &mut staged, &local, now_ms).await?;
    let reservation = staged["users"][0]["quotaReservation"].clone();
    if !reservation.is_object() {
        return Err(deny());
    }
    if req.operation == "prepare" && reservation["ceilingBytes"] != 0 {
        return Err(deny());
    }
    if req.operation == "confirm" {
        let expected = req.echo.as_ref().ok_or_else(deny)?;
        if reservation["epoch"] != expected.epoch
            || reservation["meterEpoch"] != expected.meter_epoch
            || reservation["reservationId"] != expected.reservation_id
        {
            return Err(deny());
        }
    }
    // The response is NOT permission to spend reservation bytes. Only a
    // FUTURE one-time positive cap signed after independently verified
    // runtime, WAL, SQL preflight and issuer may reach the measured Xray.
    let proof = zero_reply(&req, activation, &verified.policy_sha256,
                           &reservation, now_ms);
    let signature = state.node_policy_signer.sign(&proof)
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Lease proof signing failed."))?;
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(json!({
        "payload":proof,
        "signature":signature,
        "algorithm":"Ed25519",
    }))))
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
