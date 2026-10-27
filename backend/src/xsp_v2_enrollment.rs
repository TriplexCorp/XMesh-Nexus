//! Staging-only, owner-approved XSP-v2 Node dual-key enrollment and rotation.
//! Not present in production builds. Never activates strict PQ and never
//! enrolls panel_response keys or transmits private keys.
use crate::{ApiError, AppState, auth::AuthUser};
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, Verifier as _, VerifyingKey};
use openssl::{
    pkey::{KeyType, PKey},
    sign::Verifier as PQVerifier,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

const PURPOSE: &str = "node_request";

fn denied() -> ApiError {
    ApiError::new(StatusCode::UNAUTHORIZED, "Invalid XSP-v2 enrollment proof")
}
fn staging() -> Result<(), ApiError> {
    if std::env::var("XSP_V2_EXPERIMENTAL_HEARTBEAT").as_deref() == Ok("staging-only") {
        Ok(())
    } else {
        Err(ApiError::new(StatusCode::NOT_FOUND, "Not found"))
    }
}
fn ascii(bytes: &mut Vec<u8>, value: &str, max_len: usize) -> Result<(), ApiError> {
    if value.is_empty() || value.len() > max_len || !value.bytes().all(|b| b.is_ascii_graphic()) {
        return Err(denied());
    }
    bytes.extend_from_slice(
        &u32::try_from(value.len())
            .map_err(|_| denied())?
            .to_be_bytes(),
    );
    bytes.extend_from_slice(value.as_bytes());
    Ok(())
}
fn digest_id(prefix: &str, public: &[u8]) -> String {
    let hash = Sha256::digest(public);
    format!("{prefix}{}", hex::encode(&hash[..12]))
}
fn strict_base64(raw: &str, expected: usize) -> Result<Vec<u8>, ApiError> {
    if raw.len() > ((expected + 2) / 3) * 4 {
        return Err(denied());
    }
    let decoded = STANDARD.decode(raw).map_err(|_| denied())?;
    if decoded.len() != expected || STANDARD.encode(&decoded) != raw {
        return Err(denied());
    }
    Ok(decoded)
}

/// Exact binary proof input, signed independently with Ed25519 AND ML-DSA-65.
/// It binds the public keys, purpose, node, epoch, key IDs and owner challenge.
fn proof_input(
    node: i64,
    epoch: i64,
    challenge: &[u8; 32],
    ed: &[u8],
    pq: &[u8],
    ed_id: &str,
    pq_id: &str,
) -> Result<Vec<u8>, ApiError> {
    if node <= 0 || epoch <= 0 || ed.len() != 32 || pq.len() != 1952 {
        return Err(denied());
    }
    let mut input = b"XSP2-KEY-ENROLL-V1\0".to_vec();
    input.extend_from_slice(&node.to_be_bytes());
    input.extend_from_slice(&epoch.to_be_bytes());
    ascii(&mut input, PURPOSE, 32)?;
    input.extend_from_slice(challenge);
    input.extend_from_slice(ed);
    input.extend_from_slice(pq);
    ascii(&mut input, ed_id, 64)?;
    ascii(&mut input, pq_id, 64)?;
    Ok(input)
}
fn verify_proof(
    input: &[u8],
    ed: &[u8],
    pq: &[u8],
    ed_sig: &[u8],
    pq_sig: &[u8],
) -> Result<(), ApiError> {
    let ed_bytes: [u8; 32] = ed.try_into().map_err(|_| denied())?;
    let ed_sig_bytes: [u8; 64] = ed_sig.try_into().map_err(|_| denied())?;
    let verifying_key = VerifyingKey::from_bytes(&ed_bytes).map_err(|_| denied())?;
    verifying_key
        .verify(input, &Signature::from_bytes(&ed_sig_bytes))
        .map_err(|_| denied())?;
    if pq.len() != 1952 || pq_sig.len() != 3309 {
        return Err(denied());
    }
    let pq_public = PKey::public_key_from_raw_bytes_ex(None, KeyType::ML_DSA_65, None, pq)
        .map_err(|_| denied())?;
    let mut verifier = PQVerifier::new_without_digest(&pq_public).map_err(|_| denied())?;
    if !verifier
        .verify_oneshot(pq_sig, input)
        .map_err(|_| denied())?
    {
        return Err(denied());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Approval {
    key_epoch: i64,
    ed25519_key_id: String,
    mldsa65_key_id: String,
    ed25519_public_b64: String,
    mldsa65_public_b64: String,
}

/// Owner approves EXACT public keys + next epoch; challenge is 10-min TTL.
/// No generic bearer token can enroll an unknown public key.
pub async fn approve(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(node_id): Path<i64>,
    Json(input): Json<Approval>,
) -> Result<Json<Value>, ApiError> {
    staging()?;
    crate::require_owner(&actor)?;
    if node_id <= 0 || input.key_epoch <= 0 {
        return Err(denied());
    }
    let ed = strict_base64(&input.ed25519_public_b64, 32)?;
    let pq = strict_base64(&input.mldsa65_public_b64, 1952)?;
    if input.ed25519_key_id != digest_id("ed-", &ed)
        || input.mldsa65_key_id != digest_id("pq-", &pq)
    {
        return Err(denied());
    }
    let mut challenge = [0u8; 32];
    challenge[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    challenge[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    let hash = Sha256::digest(challenge);
    let mut tx = state.pool.begin().await?;
    let node =
        sqlx::query("SELECT id FROM panel_records WHERE collection='nodes' AND id=$1 FOR UPDATE")
            .bind(node_id)
            .fetch_optional(&mut *tx)
            .await?;
    if node.is_none() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Node not found"));
    }
    // Requires an already enrolled v1 identity; never auto-create node trust.
    let created = sqlx::query(
        "INSERT INTO node_xsp_suite_state(node_id) VALUES($1)
         ON CONFLICT (node_id) DO NOTHING",
    )
    .bind(node_id)
    .execute(&mut *tx)
    .await;
    // FK rejection is deliberate if no trusted v1 node key exists.
    created?;
    let row = sqlx::query(
        "SELECT minimum_suite,activation_phase,key_epoch
         FROM node_xsp_suite_state WHERE node_id=$1 FOR UPDATE",
    )
    .bind(node_id)
    .fetch_one(&mut *tx)
    .await?;
    let floor: i16 = row.try_get("minimum_suite")?;
    let phase: String = row.try_get("activation_phase")?;
    let current: i64 = row.try_get("key_epoch")?;
    if floor != 1 || phase == "strict" || current.checked_add(1) != Some(input.key_epoch) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "XSP-v2 epoch or suite floor mismatch",
        ));
    }
    sqlx::query(
        "INSERT INTO node_xsp_key_enrollment_approvals
         (node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,
          mldsa65_public,challenge_sha256,approved_by,expires_at)
         VALUES($1,'node_request',$2,$3,$4,$5,$6,$7,$8,NOW()+INTERVAL '10 minutes')
         ON CONFLICT(node_id,purpose) DO UPDATE SET
          key_epoch=EXCLUDED.key_epoch,ed25519_key_id=EXCLUDED.ed25519_key_id,
          mldsa65_key_id=EXCLUDED.mldsa65_key_id,
          ed25519_public=EXCLUDED.ed25519_public,
          mldsa65_public=EXCLUDED.mldsa65_public,
          challenge_sha256=EXCLUDED.challenge_sha256,
          approved_by=EXCLUDED.approved_by,
          created_at=NOW(),expires_at=NOW()+INTERVAL '10 minutes',consumed_at=NULL",
    )
    .bind(node_id)
    .bind(input.key_epoch)
    .bind(&input.ed25519_key_id)
    .bind(&input.mldsa65_key_id)
    .bind(&ed)
    .bind(&pq)
    .bind(hash.to_vec())
    .bind(&actor.username)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    crate::audit(
        &state.pool,
        &actor.username,
        "node.xsp2_keys_approved",
        Some("nodes"),
        Some(node_id),
        json!({"epoch":input.key_epoch,"purpose":PURPOSE}),
    )
    .await;
    Ok(Json(json!({
        "nodeId": node_id,"purpose": PURPOSE,"keyEpoch":input.key_epoch,
        "challengeHex":hex::encode(challenge),"expiresInSeconds":600
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Claim {
    node_id: i64,
    purpose: String,
    key_epoch: i64,
    challenge_hex: String,
    ed25519_signature_b64: String,
    mldsa65_signature_b64: String,
}

/// Unauthenticated claim is safe only with an owner-issued, one-use challenge
/// AND possession proof of BOTH already-approved private keys.
pub async fn claim(
    State(state): State<AppState>,
    Json(input): Json<Claim>,
) -> Result<Json<Value>, ApiError> {
    staging()?;
    if input.node_id <= 0
        || input.purpose != PURPOSE
        || input.key_epoch <= 0
        || input.challenge_hex.len() != 64
    {
        return Err(denied());
    }
    let challenge: [u8; 32] = hex::decode(&input.challenge_hex)
        .map_err(|_| denied())?
        .try_into()
        .map_err(|_| denied())?;
    if hex::encode(challenge) != input.challenge_hex {
        return Err(denied());
    }
    let ed_sig = strict_base64(&input.ed25519_signature_b64, 64)?;
    let pq_sig = strict_base64(&input.mldsa65_signature_b64, 3309)?;
    let mut tx = state.pool.begin().await?;
    let suite = sqlx::query(
        "SELECT minimum_suite,activation_phase,key_epoch
         FROM node_xsp_suite_state WHERE node_id=$1 FOR UPDATE",
    )
    .bind(input.node_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(denied)?;
    let floor: i16 = suite.try_get("minimum_suite")?;
    let phase: String = suite.try_get("activation_phase")?;
    let epoch: i64 = suite.try_get("key_epoch")?;
    if floor != 1 || phase == "strict" || epoch.checked_add(1) != Some(input.key_epoch) {
        return Err(denied());
    }
    let pending = sqlx::query(
        "SELECT ed25519_public,mldsa65_public,ed25519_key_id,mldsa65_key_id,
                challenge_sha256,approved_by
         FROM node_xsp_key_enrollment_approvals
         WHERE node_id=$1 AND purpose='node_request' AND key_epoch=$2
           AND consumed_at IS NULL AND expires_at>NOW() FOR UPDATE",
    )
    .bind(input.node_id)
    .bind(input.key_epoch)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(denied)?;
    let challenge_hash: Vec<u8> = pending.try_get("challenge_sha256")?;
    if challenge_hash != Sha256::digest(challenge).as_slice() {
        return Err(denied());
    }
    let ed: Vec<u8> = pending.try_get("ed25519_public")?;
    let pq: Vec<u8> = pending.try_get("mldsa65_public")?;
    let ed_id: String = pending.try_get("ed25519_key_id")?;
    let pq_id: String = pending.try_get("mldsa65_key_id")?;
    let approved_by: String = pending.try_get("approved_by")?;
    let signing_input = proof_input(
        input.node_id,
        input.key_epoch,
        &challenge,
        &ed,
        &pq,
        &ed_id,
        &pq_id,
    )?;
    verify_proof(&signing_input, &ed, &pq, &ed_sig, &pq_sig)?;
    // Insert new keys before revoking previous keys, atomically with epoch.
    // On error, old keys and the outstanding approval remain untouched.
    sqlx::query(
        "INSERT INTO node_xsp_public_keysets
         (node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,
          ed25519_public,mldsa65_public)
         VALUES($1,'node_request',$2,$3,$4,$5,$6)",
    )
    .bind(input.node_id)
    .bind(input.key_epoch)
    .bind(&ed_id)
    .bind(&pq_id)
    .bind(&ed)
    .bind(&pq)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE node_xsp_public_keysets SET revoked_at=NOW()
         WHERE node_id=$1 AND purpose='node_request' AND key_epoch<$2
           AND revoked_at IS NULL",
    )
    .bind(input.node_id)
    .bind(input.key_epoch)
    .execute(&mut *tx)
    .await?;
    // A rotation pauses shadow verification; explicit owner reapproval is
    // needed to resume shadow. Never activates strict mode or lowers suite.
    sqlx::query(
        "UPDATE node_xsp_suite_state SET key_epoch=$2,activation_phase='dual_enrolled'
         WHERE node_id=$1",
    )
    .bind(input.node_id)
    .bind(input.key_epoch)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE node_xsp_key_enrollment_approvals SET consumed_at=NOW()
         WHERE node_id=$1 AND purpose='node_request'",
    )
    .bind(input.node_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    crate::audit(
        &state.pool,
        &approved_by,
        "node.xsp2_keys_enrolled",
        Some("nodes"),
        Some(input.node_id),
        json!({"epoch":input.key_epoch,"purpose":PURPOSE}),
    )
    .await;
    Ok(Json(json!({
        "nodeId":input.node_id,"keyEpoch":input.key_epoch,
        "enrolled":true,"activationPhase":"dual_enrolled",
        "strictActivated":false
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    // This proof is produced by the independent Go 1.27.3 encrypted keytool
    // during the isolated OpenSSL 3.5 CI job. Standard backend builds run the
    // format tests without accessing any real or test private keys.
    #[test]
    fn go_encrypted_vault_signatures_are_verified_by_rust() {
        let Ok(file) = std::env::var("XSP_V2_OWNER_PROOF_FIXTURE") else {
            return;
        };
        let blob = std::fs::read(file).expect("Go-generated ephemeral proof fixture");
        let v: serde_json::Value = serde_json::from_slice(&blob).unwrap();
        let public = &v["public"];
        let proof = &v["proof"];
        let node = public["nodeId"].as_i64().unwrap();
        let epoch = public["keyEpoch"].as_i64().unwrap();
        let ed_id = public["ed25519KeyId"].as_str().unwrap();
        let pq_id = public["mldsa65KeyId"].as_str().unwrap();
        let ed = strict_base64(public["ed25519Public"].as_str().unwrap(), 32).unwrap();
        let pq = strict_base64(public["mldsa65Public"].as_str().unwrap(), 1952).unwrap();
        assert_eq!(ed_id, digest_id("ed-", &ed));
        assert_eq!(pq_id, digest_id("pq-", &pq));
        assert_eq!(proof["nodeId"].as_i64().unwrap(), node);
        assert_eq!(proof["keyEpoch"].as_i64().unwrap(), epoch);
        assert_eq!(proof["purpose"], "node_request");
        let challenge: [u8; 32] = hex::decode(proof["challengeHex"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let ed_sig = strict_base64(proof["ed25519SignatureB64"].as_str().unwrap(), 64).unwrap();
        let pq_sig = strict_base64(proof["mldsa65SignatureB64"].as_str().unwrap(), 3309).unwrap();
        let signed = proof_input(node, epoch, &challenge, &ed, &pq, ed_id, pq_id).unwrap();
        assert!(verify_proof(&signed, &ed, &pq, &ed_sig, &pq_sig).is_ok());
        let mut changed = signed.clone();
        changed[0] ^= 1;
        assert!(verify_proof(&changed, &ed, &pq, &ed_sig, &pq_sig).is_err());
        let mut missing = ed_sig.clone();
        missing.clear();
        assert!(verify_proof(&signed, &ed, &pq, &missing, &pq_sig).is_err());
        let mut bad_pq = pq_sig.clone();
        bad_pq[0] ^= 1;
        assert!(verify_proof(&signed, &ed, &pq, &ed_sig, &bad_pq).is_err());
        let wrong_epoch = proof_input(node, epoch + 1, &challenge, &ed, &pq, ed_id, pq_id).unwrap();
        assert!(verify_proof(&wrong_epoch, &ed, &pq, &ed_sig, &pq_sig).is_err());
    }

    #[test]
    fn approval_proof_binds_identity_epoch_nonce_keys_and_purpose() {
        let nonce = [9u8; 32];
        let ed = [1u8; 32];
        let pq = [2u8; 1952];
        let ed_id = digest_id("ed-", &ed);
        let pq_id = digest_id("pq-", &pq);
        let a = proof_input(42, 1, &nonce, &ed, &pq, &ed_id, &pq_id).unwrap();
        assert_eq!(
            hex::encode(Sha256::digest(&a)),
            "902160cf06cde566b7150667d0cbbdd2971e7507d5f640925602b6fc703035a0"
        );
        assert!(a.starts_with(b"XSP2-KEY-ENROLL-V1\0"));
        assert_ne!(
            a,
            proof_input(42, 2, &nonce, &ed, &pq, &ed_id, &pq_id).unwrap()
        );
        assert_ne!(
            a,
            proof_input(43, 1, &nonce, &ed, &pq, &ed_id, &pq_id).unwrap()
        );
        let mut other_nonce = nonce;
        other_nonce[0] ^= 1;
        assert_ne!(
            a,
            proof_input(42, 1, &other_nonce, &ed, &pq, &ed_id, &pq_id).unwrap()
        );
        let mut other_pq = pq;
        other_pq[0] ^= 1;
        assert_ne!(
            a,
            proof_input(42, 1, &nonce, &ed, &other_pq, &ed_id, &pq_id).unwrap()
        );
        assert_ne!(
            a,
            proof_input(42, 1, &nonce, &ed, &pq, "ed-other", &pq_id).unwrap()
        );
        assert!(proof_input(0, 1, &nonce, &ed, &pq, "ed", "pq").is_err());
        assert!(proof_input(42, 0, &nonce, &ed, &pq, "ed", "pq").is_err());
        assert!(proof_input(42, 1, &nonce, &ed[..31], &pq, "ed", "pq").is_err());
    }
}
