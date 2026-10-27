//! Isolated XSP-v2 rotation PREPARATION only. No cutover, revocation,
//! suite change or trusted HTTP approval response exists in this module.
//! Running Node software must NEVER treat proof_verified as activation.
use crate::{
    ApiError, AppState, auth::AuthUser,
    xsp_v2_enrollment::{
        PURPOSE, Approval, ascii, denied, digest_id, staging, strict_base64, verify_proof,
    },
};
use axum::{Json, extract::{Extension, Path, State}, http::StatusCode};
#[cfg(test)]
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

fn rotation_allowed(floor: i16, phase: &str, from: i64, to: i64) -> bool {
    floor == 1 && from > 0 && from.checked_add(1) == Some(to)
        && matches!(phase, "dual_enrolled" | "shadow")
}

/// Distinct domain from initial enrollment, with both from/to epochs pinned.
/// Purpose/key IDs/public bytes have exactly the same bounded encoding as v1
/// enrollment PoP; no signature can be replayed across those endpoints.
fn rotation_input(
    node: i64, epochs: (i64, i64), challenge: &[u8; 32],
    ed: &[u8], pq: &[u8], ed_id: &str, pq_id: &str,
) -> Result<Vec<u8>, ApiError> {
    let (from, to) = epochs;
    if node <= 0 || from <= 0 || from.checked_add(1) != Some(to)
        || ed.len() != 32 || pq.len() != 1952
    {
        return Err(denied());
    }
    let mut signed = b"XSP2-KEY-ROTATE-PREPARE-V1\0".to_vec();
    signed.extend_from_slice(&node.to_be_bytes());
    signed.extend_from_slice(&from.to_be_bytes());
    signed.extend_from_slice(&to.to_be_bytes());
    ascii(&mut signed, PURPOSE, 32)?;
    signed.extend_from_slice(challenge);
    signed.extend_from_slice(ed);
    signed.extend_from_slice(pq);
    ascii(&mut signed, ed_id, 64)?;
    ascii(&mut signed, pq_id, 64)?;
    Ok(signed)
}

async fn checked_current(
    tx: &mut Transaction<'_, Postgres>, node_id: i64, to: i64,
) -> Result<i64, ApiError> {
    let node = sqlx::query("SELECT id FROM panel_records WHERE collection='nodes' AND id=$1 FOR UPDATE")
        .bind(node_id).fetch_optional(&mut **tx).await?;
    if node.is_none() { return Err(ApiError::new(StatusCode::NOT_FOUND, "Node not found")); }
    let state = sqlx::query(
        "SELECT minimum_suite,activation_phase,key_epoch
         FROM node_xsp_suite_state WHERE node_id=$1 FOR UPDATE",
    ).bind(node_id).fetch_optional(&mut **tx).await?
        .ok_or_else(denied)?;
    let floor: i16 = state.try_get("minimum_suite")?;
    let phase: String = state.try_get("activation_phase")?;
    let from: i64 = state.try_get("key_epoch")?;
    if !rotation_allowed(floor, &phase, from, to) {
        return Err(ApiError::new(StatusCode::CONFLICT, "Node not eligible for staged key rotation"));
    }
    let old_key = sqlx::query(
        "SELECT ed25519_key_id,mldsa65_key_id FROM node_xsp_public_keysets
         WHERE node_id=$1 AND purpose='node_request' AND key_epoch=$2
           AND revoked_at IS NULL FOR UPDATE",
    ).bind(node_id).bind(from).fetch_optional(&mut **tx).await?;
    if old_key.is_none() {
        return Err(ApiError::new(StatusCode::CONFLICT, "No active XSP-v2 public keyset"));
    }
    Ok(from)
}

/// Owner first approves a new public pair, but this cannot activate it.
/// A single outstanding proposal per Node is deliberate: a proved proposal
/// stays frozen until a separately specified signed ACK/retirement protocol.
pub async fn prepare(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(node_id): Path<i64>,
    Json(input): Json<Approval>,
) -> Result<Json<Value>, ApiError> {
    staging()?;
    crate::require_owner(&actor)?;
    if node_id <= 0 || input.key_epoch <= 1 { return Err(denied()); }
    let ed = strict_base64(&input.ed25519_public_b64, 32)?;
    let pq = strict_base64(&input.mldsa65_public_b64, 1952)?;
    if input.ed25519_key_id != digest_id("ed-", &ed)
        || input.mldsa65_key_id != digest_id("pq-", &pq) { return Err(denied()); }
    let mut tx = state.pool.begin().await?;
    let from = checked_current(&mut tx, node_id, input.key_epoch).await?;
    sqlx::query(
        "DELETE FROM node_xsp_rotation_preparations
         WHERE node_id=$1 AND purpose='node_request' AND expires_at<=NOW()
           AND proved_at IS NULL",
    ).bind(node_id).execute(&mut *tx).await?;
    let outstanding: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM node_xsp_rotation_preparations
          WHERE node_id=$1 AND purpose='node_request')",
    ).bind(node_id).fetch_one(&mut *tx).await?;
    if outstanding {
        return Err(ApiError::new(StatusCode::CONFLICT, "Resolve existing rotation proposal first"));
    }
    let reused: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM node_xsp_public_keysets
          WHERE node_id=$1 AND purpose='node_request'
            AND (ed25519_key_id=$2 OR mldsa65_key_id=$3))",
    ).bind(node_id).bind(&input.ed25519_key_id)
        .bind(&input.mldsa65_key_id).fetch_one(&mut *tx).await?;
    if reused { return Err(ApiError::new(StatusCode::CONFLICT, "Rotation must use fresh keys")); }
    let mut challenge = [0u8; 32];
    challenge[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    challenge[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    sqlx::query(
        "INSERT INTO node_xsp_rotation_preparations
         (node_id,from_epoch,to_epoch,ed25519_key_id,mldsa65_key_id,
          ed25519_public,mldsa65_public,challenge_sha256,approved_by,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()+INTERVAL '10 minutes')",
    ).bind(node_id).bind(from).bind(input.key_epoch)
        .bind(&input.ed25519_key_id).bind(&input.mldsa65_key_id)
        .bind(ed).bind(pq).bind(Sha256::digest(challenge).to_vec())
        .bind(&actor.username).execute(&mut *tx).await?;
    tx.commit().await?;
    crate::audit(
        &state.pool, &actor.username, "node.xsp2_rotation_prepared",
        Some("nodes"), Some(node_id),
        json!({"fromEpoch":from,"toEpoch":input.key_epoch,"purpose":PURPOSE}),
    ).await;
    Ok(Json(json!({
        "nodeId":node_id,"purpose":PURPOSE,"fromEpoch":from,
        "keyEpoch":input.key_epoch,"challengeHex":hex::encode(challenge),
        "expiresInSeconds":600,"cutoverAuthorized":false
    })))
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct RotationProof {
    node_id: i64,
    purpose: String,
    from_epoch: i64,
    key_epoch: i64,
    challenge_hex: String,
    ed25519_signature_b64: String,
    mldsa65_signature_b64: String,
}

struct DecodedRotation {
    challenge: [u8; 32],
    ed_sig: Vec<u8>,
    pq_sig: Vec<u8>,
}

fn decode(input: &RotationProof) -> Result<DecodedRotation, ApiError> {
    if input.node_id <= 0 || input.purpose != PURPOSE
        || input.from_epoch <= 0 || input.from_epoch.checked_add(1) != Some(input.key_epoch)
        || input.challenge_hex.len() != 64 { return Err(denied()); }
    let raw = hex::decode(&input.challenge_hex).map_err(|_| denied())?;
    let challenge: [u8; 32] = raw.try_into().map_err(|_| denied())?;
    if hex::encode(challenge) != input.challenge_hex { return Err(denied()); }
    Ok(DecodedRotation {
        challenge,
        ed_sig: strict_base64(&input.ed25519_signature_b64, 64)?,
        pq_sig: strict_base64(&input.mldsa65_signature_b64, 3309)?,
    })
}

/// Checks both prepared private-key signatures, marking the public proposal
/// proved only. No keyset insertion, old-key revocation or suite-state UPDATE.
pub async fn prove(
    State(state): State<AppState>,
    Json(input): Json<RotationProof>,
) -> Result<Json<Value>, ApiError> {
    staging()?;
    let proof = decode(&input)?;
    let mut tx = state.pool.begin().await?;
    let from = checked_current(&mut tx, input.node_id, input.key_epoch).await?;
    if from != input.from_epoch { return Err(denied()); }
    let row = sqlx::query(
        "SELECT ed25519_public,mldsa65_public,ed25519_key_id,mldsa65_key_id,
                challenge_sha256
         FROM node_xsp_rotation_preparations
         WHERE node_id=$1 AND purpose='node_request' AND from_epoch=$2 AND to_epoch=$3
           AND proved_at IS NULL AND expires_at>NOW() FOR UPDATE",
    ).bind(input.node_id).bind(from).bind(input.key_epoch)
        .fetch_optional(&mut *tx).await?.ok_or_else(denied)?;
    let expected_hash: Vec<u8> = row.try_get("challenge_sha256")?;
    if expected_hash != Sha256::digest(proof.challenge).as_slice() { return Err(denied()); }
    let ed: Vec<u8> = row.try_get("ed25519_public")?;
    let pq: Vec<u8> = row.try_get("mldsa65_public")?;
    let ed_id: String = row.try_get("ed25519_key_id")?;
    let pq_id: String = row.try_get("mldsa65_key_id")?;
    let signed = rotation_input(input.node_id, (from, input.key_epoch),
        &proof.challenge, &ed, &pq, &ed_id, &pq_id)?;
    verify_proof(&signed, &ed, &pq, &proof.ed_sig, &proof.pq_sig)?;
    sqlx::query(
        "UPDATE node_xsp_rotation_preparations SET proved_at=NOW()
         WHERE node_id=$1 AND purpose='node_request' AND from_epoch=$2",
    ).bind(input.node_id).bind(from).execute(&mut *tx).await?;
    tx.commit().await?;
    crate::audit(
        &state.pool, "xsp2-staging-proved-node", "node.xsp2_rotation_proof_verified",
        Some("nodes"), Some(input.node_id),
        json!({"fromEpoch":from,"toEpoch":input.key_epoch,"cutoverAuthorized":false}),
    ).await;
    Ok(Json(json!({
        "nodeId":input.node_id,"fromEpoch":from,"keyEpoch":input.key_epoch,
        "preparedProofVerified":true,"cutoverAuthorized":false,"strictActivated":false
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stage_guard_rejects_strict_legacy_skips_and_rollbacks() {
        assert!(rotation_allowed(1,"dual_enrolled",1,2));
        assert!(rotation_allowed(1,"shadow",8,9));
        for (floor,phase,from,to) in [
            (2,"strict",1,2),(1,"legacy",1,2),
            (1,"dual_enrolled",0,1),(1,"shadow",2,4),
            (1,"shadow",2,2),(1,"shadow",2,1),
            (1,"shadow",i64::MAX,i64::MIN)
        ] { assert!(!rotation_allowed(floor,phase,from,to)); }
    }
    #[test]
    fn rotation_proof_has_distinct_domain_and_binds_epochs() {
        let challenge=[9u8;32];
        let ed=[1u8;32];
        let pq=[2u8;1952];
        let ed_id=digest_id("ed-",&ed);
        let pq_id=digest_id("pq-",&pq);
        let a=rotation_input(42,(1,2),&challenge,&ed,&pq,&ed_id,&pq_id).unwrap();
        assert!(a.starts_with(b"XSP2-KEY-ROTATE-PREPARE-V1\0"));
        assert!(!a.starts_with(b"XSP2-KEY-ENROLL-V1\0"));
        assert_ne!(a,rotation_input(42,(2,3),&challenge,&ed,&pq,&ed_id,&pq_id).unwrap());
        assert_ne!(a,rotation_input(43,(1,2),&challenge,&ed,&pq,&ed_id,&pq_id).unwrap());
        assert!(rotation_input(42,(2,2),&challenge,&ed,&pq,&ed_id,&pq_id).is_err());
    }
    #[test]
    fn rotation_decoder_requires_canonical_bounded_proof() {
        let valid=RotationProof{
            node_id:42,purpose:PURPOSE.to_owned(),from_epoch:1,key_epoch:2,
            challenge_hex:"09".repeat(32),
            ed25519_signature_b64:STANDARD.encode([1u8;64]),
            mldsa65_signature_b64:STANDARD.encode([2u8;3309]),
        };
        assert!(decode(&valid).is_ok());
        let upper=RotationProof{challenge_hex:"AA".repeat(32),..valid};
        assert!(decode(&upper).is_err());
    }
}
