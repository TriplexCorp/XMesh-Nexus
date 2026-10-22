use crate::{ApiError,AppState,auth::AuthUser};
use axum::{extract::{Extension,Path,State},http::StatusCode,Json};
use serde::Deserialize;
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use ed25519_dalek::{VerifyingKey, Signature, Verifier};
use sqlx::Row;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Claim { token:String, public_key:String, proof:String }

pub async fn issue(State(state):State<AppState>,Extension(actor):Extension<AuthUser>,Path(node_id):Path<i64>)
 ->Result<Json<Value>,ApiError>{
 crate::require_owner(&actor)?;
 if node_id<=0 {return Err(ApiError::new(StatusCode::BAD_REQUEST,"Invalid node ID"))}
 let found=sqlx::query_scalar::<_,i64>("SELECT id FROM panel_records WHERE collection='nodes' AND id=$1")
  .bind(node_id).fetch_optional(&state.pool).await?;
 if found.is_none(){return Err(ApiError::new(StatusCode::NOT_FOUND,"Node not found"))}
 let token=format!("{}{}",Uuid::new_v4().simple(),Uuid::new_v4().simple());
 let hash=hex::encode(Sha256::digest(token.as_bytes()));
 sqlx::query("DELETE FROM node_enrollment_tokens WHERE node_id=$1").bind(node_id).execute(&state.pool).await?;
 sqlx::query("INSERT INTO node_enrollment_tokens(token_hash,node_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '10 minutes')")
  .bind(hash).bind(node_id).execute(&state.pool).await?;
 crate::audit(&state.pool,&actor.username,"node.enrollment_issued",Some("nodes"),Some(node_id),json!({})).await;
 Ok(Json(json!({"nodeId":node_id,"token":token,"expiresInSeconds":600})))
}

pub async fn claim(State(state):State<AppState>,Json(input):Json<Claim>)->Result<Json<Value>,ApiError>{
 if input.token.len()!=64||!input.token.bytes().all(|c|c.is_ascii_hexdigit())
 ||input.public_key.len()!=64||!input.public_key.bytes().all(|c|c.is_ascii_hexdigit()&&!c.is_ascii_uppercase()){
  return Err(ApiError::new(StatusCode::BAD_REQUEST,"Invalid enrollment credentials"))
 }
 let raw:[u8;32]=hex::decode(&input.public_key).ok().and_then(|v|v.try_into().ok())
  .ok_or_else(||ApiError::new(StatusCode::BAD_REQUEST,"Invalid public key"))?;
 VerifyingKey::from_bytes(&raw).map_err(|_|ApiError::new(StatusCode::BAD_REQUEST,"Invalid public key"))?;
 // The claimant must prove possession of the private key, not merely supply a public key.
 // The token and key are both bound to this protocol-specific signed message.
 if input.proof.len()!=128 || !input.proof.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase()) {
  return Err(ApiError::new(StatusCode::BAD_REQUEST,"Invalid Ed25519 enrollment proof"));
 }
 let signature_bytes:[u8;64]=hex::decode(&input.proof).ok().and_then(|v|v.try_into().ok())
  .ok_or_else(||ApiError::new(StatusCode::BAD_REQUEST,"Invalid Ed25519 enrollment proof"))?;
 let signature=Signature::from_bytes(&signature_bytes);
 let challenge=format!("XMESH-ENROLL-V1\n{}\n{}\n",input.token,input.public_key);
 let key=VerifyingKey::from_bytes(&raw)
  .map_err(|_|ApiError::new(StatusCode::BAD_REQUEST,"Invalid Ed25519 public key"))?;
 key.verify(challenge.as_bytes(),&signature)
  .map_err(|_|ApiError::new(StatusCode::UNAUTHORIZED,"Enrollment key ownership proof failed"))?;
 let hash=hex::encode(Sha256::digest(input.token.as_bytes()));
 let mut tx=state.pool.begin().await?;
 let row=sqlx::query("SELECT node_id FROM node_enrollment_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>NOW() FOR UPDATE")
  .bind(&hash).fetch_optional(&mut *tx).await?
  .ok_or_else(||ApiError::new(StatusCode::UNAUTHORIZED,"Enrollment token expired or invalid"))?;
 let node_id:i64=row.try_get("node_id")?;
 let node=sqlx::query("SELECT id FROM panel_records WHERE collection='nodes' AND id=$1 FOR UPDATE")
  .bind(node_id).fetch_optional(&mut *tx).await?;
 if node.is_none(){return Err(ApiError::new(StatusCode::NOT_FOUND,"Node not found"))}
 // Refuse accidental credential rotation. Owner can revoke an old key first.
 let existing=sqlx::query("SELECT public_key FROM node_metric_keys WHERE node_id=$1")
  .bind(node_id).fetch_optional(&mut *tx).await?;
 if let Some(row)=existing {
  let key:String=row.try_get("public_key")?;
  if key!=input.public_key {return Err(ApiError::new(StatusCode::CONFLICT,"Node already enrolled with another key. Revoke its previous key first."))}
 } else {
  sqlx::query("INSERT INTO node_metric_keys(node_id,public_key) VALUES($1,$2)")
   .bind(node_id).bind(&input.public_key).execute(&mut *tx).await?;
 }
 sqlx::query("UPDATE node_enrollment_tokens SET consumed_at=NOW() WHERE token_hash=$1")
  .bind(hash).execute(&mut *tx).await?;
 tx.commit().await?;
 Ok(Json(json!({"nodeId":node_id,"enrolled":true})))
}
