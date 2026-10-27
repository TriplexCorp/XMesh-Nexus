use crate::{ApiError, AppState, auth::AuthUser};
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Claim {
    token: String,
    public_key: String,
    proof: String,
}

/// Normal bootstrap issuance refuses key replacement. Re-enrollment must
/// be explicitly approved through the separate owner-only recovery route.
pub async fn issue(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(node_id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    issue_token(&state, &actor, node_id, false).await
}

/// Owner-mediated repair: no key is revoked until the new Node proves
/// possession of its own private key and redeems this exact one-use token.
pub async fn reissue(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(node_id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    issue_token(&state, &actor, node_id, true).await
}

async fn issue_token(
    state: &AppState,
    actor: &AuthUser,
    node_id: i64,
    replace: bool,
) -> Result<Json<Value>, ApiError> {
    crate::require_owner(actor)?;
    if node_id <= 0 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Invalid node ID"));
    }
    let mut tx = state.pool.begin().await?;
    // All issue/claim flows lock the Node record before touching token rows.
    let found =
        sqlx::query("SELECT id FROM panel_records WHERE collection='nodes' AND id=$1 FOR UPDATE")
            .bind(node_id)
            .fetch_optional(&mut *tx)
            .await?;
    if found.is_none() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Node not found"));
    }
    let has_key =
        sqlx::query_scalar::<_, i64>("SELECT node_id FROM node_metric_keys WHERE node_id=$1")
            .bind(node_id)
            .fetch_optional(&mut *tx)
            .await?
            .is_some();
    if has_key && !replace {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Node already has a registered key. Owner must explicitly approve re-enrollment.",
        ));
    }
    if replace && !has_key {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "No registered key to recover. Use normal initial enrollment.",
        ));
    }
    if replace {
        require_legacy_key_replacement(&mut tx, node_id).await?;
    }
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let hash = hex::encode(Sha256::digest(token.as_bytes()));
    sqlx::query("DELETE FROM node_enrollment_tokens WHERE node_id=$1")
        .bind(node_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO node_enrollment_tokens
         (token_hash,node_id,expires_at,allow_key_replacement)
         VALUES($1,$2,NOW()+INTERVAL '10 minutes',$3)",
    )
    .bind(hash)
    .bind(node_id)
    .bind(replace)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    crate::audit(
        &state.pool,
        &actor.username,
        if replace {
            "node.enrollment_recovery_approved"
        } else {
            "node.enrollment_issued"
        },
        Some("nodes"),
        Some(node_id),
        json!({"keyReplacementAuthorized": replace}),
    )
    .await;
    Ok(Json(json!({
        "nodeId":node_id,
        "token":token,
        "expiresInSeconds":600,
        "keyReplacementAuthorized":replace
    })))
}

/// Legacy owner-recovery must not bypass XSP-v2 key/suite pinning.
async fn require_legacy_key_replacement(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    node_id: i64,
) -> Result<(), ApiError> {
    let row = sqlx::query(
        "SELECT minimum_suite,activation_phase,key_epoch
         FROM node_xsp_suite_state WHERE node_id=$1",
    )
    .bind(node_id)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(row) = row {
        let floor: i16 = row.try_get("minimum_suite")?;
        let epoch: i64 = row.try_get("key_epoch")?;
        let phase: String = row.try_get("activation_phase")?;
        if floor != 1 || epoch != 0 || !matches!(phase.as_str(), "legacy" | "discovered") {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "XSP-v2 identity already enrolled: legacy re-enrollment cannot rotate it.",
            ));
        }
    }
    Ok(())
}

pub async fn claim(
    State(state): State<AppState>,
    Json(input): Json<Claim>,
) -> Result<Json<Value>, ApiError> {
    if input.token.len() != 64
        || !input.token.bytes().all(|c| c.is_ascii_hexdigit())
        || input.public_key.len() != 64
        || !input
            .public_key
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid enrollment credentials",
        ));
    }
    let raw: [u8; 32] = hex::decode(&input.public_key)
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Invalid public key"))?;
    VerifyingKey::from_bytes(&raw)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid public key"))?;
    // The claimant must prove possession of the private key, not merely supply a public key.
    // The token and key are both bound to this protocol-specific signed message.
    if input.proof.len() != 128
        || !input
            .proof
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid Ed25519 enrollment proof",
        ));
    }
    let signature_bytes: [u8; 64] = hex::decode(&input.proof)
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or_else(|| {
            ApiError::new(StatusCode::BAD_REQUEST, "Invalid Ed25519 enrollment proof")
        })?;
    let signature = Signature::from_bytes(&signature_bytes);
    let challenge = format!("XMESH-ENROLL-V1\n{}\n{}\n", input.token, input.public_key);
    let key = VerifyingKey::from_bytes(&raw)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid Ed25519 public key"))?;
    key.verify(challenge.as_bytes(), &signature).map_err(|_| {
        ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Enrollment key ownership proof failed",
        )
    })?;
    let hash = hex::encode(Sha256::digest(input.token.as_bytes()));
    let mut tx = state.pool.begin().await?;
    let (node_id, replacement_authorized) = validated_claim_token(&mut tx, &hash).await?;
    let replaced =
        register_enrollment_key(&mut tx, node_id, &input.public_key, replacement_authorized)
            .await?;
    sqlx::query("UPDATE node_enrollment_tokens SET consumed_at=NOW() WHERE token_hash=$1")
        .bind(hash)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    if replaced {
        crate::audit(
            &state.pool,
            "owner-approved-enrollment",
            "node.legacy_key_replaced",
            Some("nodes"),
            Some(node_id),
            json!({"replacementProvenByEd25519":true}),
        )
        .await;
    }
    Ok(Json(
        json!({"nodeId":node_id,"enrolled":true,"keyReplaced":replaced}),
    ))
}

/// Lock the Node identity before its one-use token, even if the owner
/// concurrently reissues an enrollment, to avoid opposite lock ordering.
async fn validated_claim_token(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    hash: &str,
) -> Result<(i64, bool), ApiError> {
    // Look up the candidate token without locking it, to find its Node ID.
    // The Node row is always locked FIRST; then the still-valid token is
    // rechecked FOR UPDATE, avoiding deadlocks with owner re-issuance.
    let node_id = sqlx::query_scalar::<_, i64>(
        "SELECT node_id FROM node_enrollment_tokens
         WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>NOW()",
    )
    .bind(hash)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Enrollment token expired or invalid",
        )
    })?;
    let node =
        sqlx::query("SELECT id FROM panel_records WHERE collection='nodes' AND id=$1 FOR UPDATE")
            .bind(node_id)
            .fetch_optional(&mut **tx)
            .await?;
    if node.is_none() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Node not found"));
    }
    let token_row = sqlx::query(
        "SELECT node_id,allow_key_replacement FROM node_enrollment_tokens
         WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>NOW() FOR UPDATE",
    )
    .bind(hash)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Enrollment token expired or invalid",
        )
    })?;
    let confirmed_node: i64 = token_row.try_get("node_id")?;
    if confirmed_node != node_id {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Enrollment token scope changed",
        ));
    }
    let replacement_authorized: bool = token_row.try_get("allow_key_replacement")?;
    Ok((node_id, replacement_authorized))
}

/// Commit key replacement only after the token and Ed25519 proof were verified.
/// Never let a normal enrollment token replace an already trusted identity.
async fn register_enrollment_key(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    node_id: i64,
    public_key: &str,
    replacement_authorized: bool,
) -> Result<bool, ApiError> {
    let existing = sqlx::query("SELECT public_key FROM node_metric_keys WHERE node_id=$1")
        .bind(node_id)
        .fetch_optional(&mut **tx)
        .await?;
    if let Some(row) = existing {
        let old: String = row.try_get("public_key")?;
        if old != public_key {
            if !replacement_authorized {
                return Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "Node already enrolled with another key. Owner re-enrollment required.",
                ));
            }
            require_legacy_key_replacement(tx, node_id).await?;
            sqlx::query(
                "UPDATE node_metric_keys
                 SET public_key=$2,enrolled_at=NOW(),last_seen_at=NULL WHERE node_id=$1",
            )
            .bind(node_id)
            .bind(public_key)
            .execute(&mut **tx)
            .await?;
            sqlx::query("DELETE FROM node_metric_nonces WHERE node_id=$1")
                .bind(node_id)
                .execute(&mut **tx)
                .await?;
            return Ok(true);
        }
        return Ok(false);
    }
    sqlx::query("INSERT INTO node_metric_keys(node_id,public_key) VALUES($1,$2)")
        .bind(node_id)
        .bind(public_key)
        .execute(&mut **tx)
        .await?;
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    #[test]
    fn enrollment_proof_binds_token_and_public_key() {
        let secret = SigningKey::from_bytes(&[11u8; 32]);
        let pubhex = hex::encode(secret.verifying_key().to_bytes());
        let token = "a".repeat(64);
        let message = format!("XMESH-ENROLL-V1\n{token}\n{pubhex}\n");
        let signature = secret.sign(message.as_bytes());
        assert!(
            secret
                .verifying_key()
                .verify(message.as_bytes(), &signature)
                .is_ok()
        );
        let altered = format!("XMESH-ENROLL-V1\n{}\n{}\n", "b".repeat(64), pubhex);
        assert!(
            secret
                .verifying_key()
                .verify(altered.as_bytes(), &signature)
                .is_err()
        );
    }
}
