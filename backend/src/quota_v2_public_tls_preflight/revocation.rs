//! Strict-PQ control-plane revocation polling for a previously committed
//! TLS authority. This route never issues an ingress permit or attests
//! a remote Linux process, certificate or WAL. The eventual installed Node
//! supervisor must independently check those on every tick.
use super::{Request, deny, hex64, signed_roster, valid};
use crate::{
    ApiError, AppState, node_auth, node_runtime,
    quota_v2_public_tls_authority::{
        GenesisBinding, RevocationBinding, sign_revocation_witness, verify_existing,
    },
};
use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode, header},
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::Duration;

const PATH: &str = "/api/v1/node/quota-v2/public-tls-revocation";
const WITNESS_MS: i64 = 7_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Poll {
    scope: Request,
    authority_sha256: String,
    challenge: String,
}

#[derive(sqlx::FromRow)]
struct Authority {
    signed_envelope: Vec<u8>,
    issued_at_ms: i64,
    valid_until_ms: i64,
}

impl Poll {
    fn valid(&self) -> bool {
        valid(&self.scope)
            && self.scope.required_lifetime_ms == WITNESS_MS
            && hex64(&self.authority_sha256)
            && hex64(&self.challenge)
    }

    fn binding(&self) -> GenesisBinding {
        GenesisBinding {
            node_id: self.scope.node_id,
            activation_receipt_sha256: self.scope.activation_receipt_sha256.clone(),
            genesis_policy_sha256: self.scope.genesis_policy_sha256.clone(),
            runtime_id: self.scope.runtime_id.clone(),
            profile_revision: self.scope.profile_revision.clone(),
        }
    }
}

async fn load_authority(poll: &Poll, state: &AppState) -> Result<Authority, ApiError> {
    let scope = &poll.scope;
    let stored: Authority = sqlx::query_as(
        "SELECT signed_envelope,issued_at_ms,valid_until_ms
         FROM quota_v2_public_tls_authority_outbox
         WHERE node_id=$1 AND authority_sha256=$2 AND activation_sha256=$3
           AND runtime_id=$4 AND profile_revision=$5 AND genesis_policy_sha256=$6
           AND signer_public_key=$7 AND cap_roster_sha256=$8",
    )
    .bind(scope.node_id)
    .bind(&poll.authority_sha256)
    .bind(&scope.activation_receipt_sha256)
    .bind(&scope.runtime_id)
    .bind(&scope.profile_revision)
    .bind(&scope.genesis_policy_sha256)
    .bind(state.node_policy_signer.public_key())
    .bind(&scope.cap_roster_sha256)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(deny)?;

    if hex::encode(Sha256::digest(&stored.signed_envelope)) != poll.authority_sha256
        || verify_existing(
            &state.node_policy_signer,
            &poll.binding(),
            stored.issued_at_ms,
            stored.valid_until_ms,
            &stored.signed_envelope,
        )
        .is_err()
    {
        return Err(deny());
    }
    Ok(stored)
}

async fn profile_matches(state: &AppState, scope: &Request) -> bool {
    // This full authoritative compilation checks squad/profile/host/routing
    // drift, not only the immutable signed roster. It is advisory, checked
    // before and after the serialized SQL proof, and never remote attestation.
    node_runtime::first_genesis_config_preview(state, scope.node_id)
        .await
        .is_ok_and(|preview| preview["configSha256"] == scope.profile_revision)
}

async fn signed_reply(state: &AppState, poll: &Poll, activation: &str) -> Result<Vec<u8>, ApiError> {
    // Immutable, exact-hash lookup before expensive profile compilation.
    let stored = load_authority(poll, state).await?;
    let profile_before = profile_matches(state, &poll.scope).await;
    let mut tx = state.pool.begin().await?;
    signed_roster::configure_transaction(&mut tx).await?;
    let matched = if profile_before {
        signed_roster::locked_digest(&mut tx, state, &poll.scope, activation)
            .await?
            .is_some()
    } else {
        false
    };
    let now: i64 =
        sqlx::query_scalar("SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT")
            .fetch_one(&mut *tx)
            .await?;
    let clear = matched && stored.issued_at_ms <= now && stored.valid_until_ms > now;
    let end = if clear {
        now.saturating_add(WITNESS_MS).min(stored.valid_until_ms)
    } else {
        now.saturating_add(WITNESS_MS)
    };
    // A clear control-plane witness is signed only while the current SQL
    // locks are still held. An expired authority never becomes live again.
    let source = poll.binding();
    let binding = RevocationBinding {
        genesis: &source,
        authority_sha256: &poll.authority_sha256,
        cap_roster_sha256: &poll.scope.cap_roster_sha256,
        challenge: &poll.challenge,
    };
    let bytes = sign_revocation_witness(&state.node_policy_signer, &binding, now, end, !clear)
        .map_err(|_| deny())?;
    // Polls do not persist helper writes or modify the signed outbox.
    tx.rollback().await?;
    if clear && !profile_matches(state, &poll.scope).await {
        return Err(deny());
    }
    Ok(bytes)
}

pub async fn handle(
    State(state): State<AppState>,
    headers: HeaderMap,
    raw: Bytes,
) -> Result<([(header::HeaderName, &'static str); 2], Vec<u8>), ApiError> {
    if !crate::quota_v2::enabled() || !crate::quota_xray_genesis::quarantine_enabled() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "TLS polling is disabled."));
    }
    if raw.is_empty() || raw.len() > 2048 {
        return Err(deny());
    }
    let poll: Poll = serde_json::from_slice(&raw).map_err(|_| deny())?;
    if !poll.valid() {
        return Err(deny());
    }
    let activation =
        node_auth::authenticate_product_activation(&state, &headers, poll.scope.node_id, PATH)
            .await?;
    if activation != poll.scope.activation_receipt_sha256 {
        return Err(deny());
    }
    let bytes = tokio::time::timeout(
        Duration::from_secs(2),
        signed_reply(&state, &poll, activation),
    )
    .await
    .map_err(|_| deny())??;
    Ok((
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::CONTENT_TYPE, "application/json"),
        ],
        bytes,
    ))
}
