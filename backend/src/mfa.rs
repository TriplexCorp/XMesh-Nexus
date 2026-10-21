//! RFC 6238 SHA1 TOTP with AES-256-GCM encrypted secrets.
//! The possession of a valid password is required to enroll or disable MFA;
//! a password-only login never creates a session when 2FA is enabled.
use crate::{auth::{self, AuthUser}, ApiError, AppState};
use aes_gcm::{aead::{Aead, KeyInit, OsRng, rand_core::RngCore}, Aes256Gcm, Nonce};
use argon2::{password_hash::{PasswordHash, PasswordVerifier}, Argon2};
use axum::{extract::{Extension, State}, http::{HeaderMap, StatusCode}, Json};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use sqlx::Row;
use subtle::ConstantTimeEq;
use uuid::Uuid;

type HmacSha1 = Hmac<Sha1>;
const MFA_WINDOW: i64 = 30;
const INVALID_CODE: &str = "Неверный или уже использованный код подтверждения.";
fn err(status: StatusCode, message: &str) -> ApiError { ApiError::new(status, message) }
fn hash(value: &str) -> String { hex::encode(Sha256::digest(value.as_bytes())) }

pub fn decode_key(input: &str) -> anyhow::Result<[u8; 32]> {
    let decoded=hex::decode(input)?;
    decoded.try_into().map_err(|_| anyhow::anyhow!("TOTP_ENCRYPTION_KEY must contain 64 hexadecimal characters"))
}

fn cipher(state: &AppState) -> Result<Aes256Gcm, ApiError> {
    let key=state.totp_key.as_ref().ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE,
        "TOTP_ENCRYPTION_KEY отсутствует. Настройте секретный ключ сервера."))?;
    Ok(Aes256Gcm::new_from_slice(key).expect("validated AES-256 key"))
}

fn encrypt(state: &AppState, secret: &[u8]) -> Result<String, ApiError> {
    let mut nonce=[0u8;12]; OsRng.fill_bytes(&mut nonce);
    let ciphertext=cipher(state)?.encrypt(Nonce::from_slice(&nonce),secret)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Не удалось зашифровать ключ TOTP."))?;
    let mut all=nonce.to_vec();all.extend(ciphertext);Ok(hex::encode(all))
}
fn decrypt(state: &AppState, encoded: &str) -> Result<Vec<u8>, ApiError> {
    let bytes=hex::decode(encoded).map_err(|_|err(StatusCode::SERVICE_UNAVAILABLE,"Ключ TOTP повреждён."))?;
    if bytes.len()<29 {return Err(err(StatusCode::SERVICE_UNAVAILABLE,"Ключ TOTP повреждён."));}
    cipher(state)?.decrypt(Nonce::from_slice(&bytes[..12]),&bytes[12..])
        .map_err(|_|err(StatusCode::SERVICE_UNAVAILABLE,"Не удалось расшифровать ключ TOTP. Проверьте TOTP_ENCRYPTION_KEY."))
}
fn base32(bytes: &[u8]) -> String {
    const SYMBOLS: &[u8]=b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut out=String::new();let mut acc=0u32;let mut bits=0;
    for b in bytes {acc=(acc<<8)|u32::from(*b);bits+=8;
        while bits>=5 {bits-=5;out.push(SYMBOLS[((acc>>bits)&31)as usize] as char);}
        acc&=(1<<bits)-1;
    }
    if bits>0 {out.push(SYMBOLS[((acc<<(5-bits))&31)as usize] as char);}
    out
}
fn code_at(secret: &[u8], step: u64) -> String {
    let mut mac=<HmacSha1 as Mac>::new_from_slice(secret).expect("HMAC accepts any key");
    mac.update(&step.to_be_bytes());
    let digest=mac.finalize().into_bytes();
    let index=(digest[19]&15) as usize;
    let v=(((digest[index]&127)as u32)<<24)|((digest[index+1]as u32)<<16)|
        ((digest[index+2]as u32)<<8)|(digest[index+3]as u32);
    format!("{:06}",v%1_000_000)
}
fn matching_step(secret: &[u8], input: &str, last: i64, now: i64) -> Option<i64> {
    if input.len()!=6 || !input.bytes().all(|x|x.is_ascii_digit()) {return None;}
    let step=now.div_euclid(MFA_WINDOW);
    [step-1,step,step+1].into_iter().find(|&candidate|
        candidate>last && candidate>=0 &&
        bool::from(code_at(secret,candidate as u64).as_bytes().ct_eq(input.as_bytes()))
    )
}
fn current_seconds() -> i64 {std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default().as_secs() as i64}
fn recovery_hash(code: &str) -> Option<String> {
    let cleaned=code.trim().replace('-',"").to_ascii_uppercase();
    if cleaned.len()!=32 || !cleaned.bytes().all(|x|x.is_ascii_hexdigit()){return None;}
    Some(hash(&cleaned))
}
fn new_recovery_codes() -> Vec<String> {
    (0..10).map(|_|{
        let mut bytes=[0u8;16]; OsRng.fill_bytes(&mut bytes);
        let raw=hex::encode_upper(bytes);format!("{}-{}-{}-{}",&raw[..8],&raw[8..16],&raw[16..24],&raw[24..32])
    }).collect()
}
async fn guarded_password(state:&AppState,id:i64,password:&str)->Result<(),ApiError>{
    let key=format!("mfa-action:{id}");
    if auth::is_rate_limited(state,&key).await? {
        return Err(err(StatusCode::TOO_MANY_REQUESTS,"Слишком много попыток. Попробуйте через 15 минут."));
    }
    if !password_is_valid(state,id,password).await? {
        auth::record_failed_login(state,&key).await?;
        return Err(err(StatusCode::UNAUTHORIZED,"Неверный пароль администратора."));
    }
    Ok(())
}
async fn password_is_valid(state: &AppState, id: i64, password: &str) -> Result<bool, ApiError> {
    if password.is_empty() || password.len()>1024 {return Ok(false);}
    let row=sqlx::query("SELECT password_hash FROM panel_auth_users WHERE id=$1 AND is_active=TRUE")
        .bind(id).fetch_optional(&state.pool).await?;
    let Some(row)=row else{return Ok(false)};
    let stored:String=row.try_get("password_hash")?;
    let parsed=PasswordHash::new(&stored).map_err(|_|err(StatusCode::INTERNAL_SERVER_ERROR,"Ошибка проверки пароля."))?;
    Ok(Argon2::default().verify_password(password.as_bytes(),&parsed).is_ok())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupRequest { password: String }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CodeRequest { code: String }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisableRequest { password: String, code: String }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChallengeRequest { challenge: String, code: String }

pub async fn enabled(state: &AppState, id: i64) -> Result<bool, ApiError> {
    Ok(sqlx::query_scalar::<_, bool>("SELECT enabled FROM panel_totp WHERE admin_id=$1")
        .bind(id).fetch_optional(&state.pool).await?.unwrap_or(false))
}
pub async fn new_challenge_in_transaction(
    state:&AppState,
    tx:&mut sqlx::Transaction<'_,sqlx::Postgres>,
    id:i64,
)->Result<String,ApiError> {
    // Account lock is held by the caller; changing a password cannot
    // revoke a challenge before this insertion finishes.
    let _=cipher(state)?;
    let challenge=format!("{}{}",Uuid::new_v4().simple(),Uuid::new_v4().simple());
    sqlx::query("DELETE FROM panel_mfa_challenges WHERE admin_id=$1 OR expires_at<NOW()")
        .bind(id).execute(&mut **tx).await?;
    sqlx::query("INSERT INTO panel_mfa_challenges (token_hash,admin_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '5 minutes')")
        .bind(hash(&challenge)).bind(id).execute(&mut **tx).await?;
    Ok(challenge)
}
pub async fn status(State(state): State<AppState>,Extension(actor): Extension<AuthUser>)
    -> Result<Json<Value>,ApiError> {
    Ok(Json(json!({"enabled": enabled(&state,actor.id).await?,
        "available": state.totp_key.is_some()})))
}
pub async fn setup(State(state): State<AppState>,Extension(actor): Extension<AuthUser>,
    Json(body):Json<SetupRequest>) -> Result<Json<Value>,ApiError> {
    guarded_password(&state,actor.id,&body.password).await?;
    let mut secret=[0u8;20]; OsRng.fill_bytes(&mut secret);
    let encrypted=encrypt(&state,&secret)?;
    let current=enabled(&state,actor.id).await?;
    if current {return Err(err(StatusCode::CONFLICT,"Двухфакторная защита уже подключена."));}
    sqlx::query("INSERT INTO panel_totp (admin_id,secret_encrypted,enabled,pending_expires_at,setup_attempts,last_used_step) \
         VALUES ($1,$2,FALSE,NOW()+INTERVAL '10 minutes',0,-1) ON CONFLICT (admin_id) \
         DO UPDATE SET secret_encrypted=EXCLUDED.secret_encrypted,enabled=FALSE, \
         pending_expires_at=EXCLUDED.pending_expires_at,setup_attempts=0,last_used_step=-1 WHERE panel_totp.enabled=FALSE")
        .bind(actor.id).bind(encrypted).execute(&state.pool).await?;
    auth::clear_failed_login(&state,&format!("mfa-action:{}",actor.id)).await?;
    let b32=base32(&secret);
    let label=actor.username.bytes().map(|c|if c.is_ascii_alphanumeric()||b"_.-".contains(&c){(c as char).to_string()}else{format!("%{c:02X}")}).collect::<String>();
    let uri=format!("otpauth://totp/XMesh%20Nexus:{label}?secret={b32}&issuer=XMesh%20Nexus&algorithm=SHA1&digits=6&period=30");
    Ok(Json(json!({"secret":b32,"otpauth":uri,"expiresInSeconds":600})))
}
pub async fn confirm(State(state): State<AppState>,Extension(actor): Extension<AuthUser>,
    headers:HeaderMap,Json(body):Json<CodeRequest>) -> Result<Json<Value>,ApiError> {
    let mut tx=state.pool.begin().await?;
    // Lock the account before the TOTP record, and recheck that this session
    // has not already been revoked by a password or role change.
    let active=sqlx::query("SELECT id FROM panel_auth_users WHERE id=$1 AND is_active=TRUE FOR UPDATE")
        .bind(actor.id).fetch_optional(&mut *tx).await?;
    let live=if let Some(token_hash)=auth::session_token_hash(&headers) {
        sqlx::query_scalar::<_,bool>(
            "SELECT EXISTS(SELECT 1 FROM panel_sessions WHERE admin_id=$1 AND token_hash=$2 AND expires_at>NOW())"
        ).bind(actor.id).bind(token_hash).fetch_one(&mut *tx).await?
    } else {false};
    if active.is_none() || !live {
        return Err(err(StatusCode::UNAUTHORIZED,"Сессия истекла. Войдите снова."));
    }
    let row=sqlx::query("SELECT secret_encrypted,enabled,setup_attempts FROM panel_totp \
          WHERE admin_id=$1 AND (pending_expires_at>NOW()) FOR UPDATE")
        .bind(actor.id).fetch_optional(&mut *tx).await?
        .ok_or_else(||err(StatusCode::BAD_REQUEST,"Начните подключение 2FA заново."))?;
    if row.try_get::<bool,_>("enabled")? {return Err(err(StatusCode::CONFLICT,"2FA уже включена."));}
    let attempts:i32=row.try_get("setup_attempts")?;
    if attempts>=5 {return Err(err(StatusCode::TOO_MANY_REQUESTS,"Слишком много неверных попыток подключения."));}
    let encrypted:String=row.try_get("secret_encrypted")?;
    let secret=decrypt(&state,&encrypted)?;
    let Some(step)=matching_step(&secret,&body.code,-1,current_seconds()) else {
        sqlx::query("UPDATE panel_totp SET setup_attempts=setup_attempts+1 WHERE admin_id=$1")
            .bind(actor.id).execute(&mut *tx).await?;
        tx.commit().await?;
        return Err(err(StatusCode::UNAUTHORIZED,INVALID_CODE));
    };
    let codes=new_recovery_codes();
    sqlx::query("DELETE FROM panel_totp_recovery WHERE admin_id=$1").bind(actor.id).execute(&mut *tx).await?;
    for code in &codes {
        sqlx::query("INSERT INTO panel_totp_recovery (admin_id,code_hash) VALUES ($1,$2)")
            .bind(actor.id).bind(recovery_hash(code).expect("generated valid recovery code"))
            .execute(&mut *tx).await?;
    }
    sqlx::query("UPDATE panel_totp SET enabled=TRUE,enabled_at=NOW(),pending_expires_at=NULL, \
         last_used_step=$2,setup_attempts=0 WHERE admin_id=$1")
        .bind(actor.id).bind(step).execute(&mut *tx).await?;
    if let Some(current)=auth::session_token_hash(&headers){
        sqlx::query("DELETE FROM panel_sessions WHERE admin_id=$1 AND token_hash<>$2")
            .bind(actor.id).bind(current).execute(&mut *tx).await?;
    } else {
        sqlx::query("DELETE FROM panel_sessions WHERE admin_id=$1")
            .bind(actor.id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    super::audit(&state.pool,&actor.username,"mfa.enabled",None,None,json!({})).await;
    Ok(Json(json!({"enabled":true,"recoveryCodes":codes})))
}

pub async fn disable(State(state): State<AppState>,Extension(actor): Extension<AuthUser>,
    headers:HeaderMap,Json(body):Json<DisableRequest>) -> Result<Json<Value>,ApiError> {
    guarded_password(&state,actor.id,&body.password).await?;
    let mut tx=state.pool.begin().await?;
    let active=sqlx::query("SELECT id FROM panel_auth_users WHERE id=$1 AND is_active=TRUE FOR UPDATE")
        .bind(actor.id).fetch_optional(&mut *tx).await?;
    let live=if let Some(token_hash)=auth::session_token_hash(&headers) {
        sqlx::query_scalar::<_,bool>(
            "SELECT EXISTS(SELECT 1 FROM panel_sessions WHERE admin_id=$1 AND token_hash=$2 AND expires_at>NOW())"
        ).bind(actor.id).bind(token_hash).fetch_one(&mut *tx).await?
    } else {false};
    if active.is_none() || !live || !password_is_valid(&state,actor.id,&body.password).await? {
        return Err(err(StatusCode::UNAUTHORIZED,"Учётная запись изменилась. Войдите снова."));
    }
    let row=sqlx::query("SELECT secret_encrypted,last_used_step FROM panel_totp \
      WHERE admin_id=$1 AND enabled=TRUE FOR UPDATE").bind(actor.id)
      .fetch_optional(&mut *tx).await?
      .ok_or_else(||err(StatusCode::BAD_REQUEST,"2FA не подключена."))?;
    let encrypted:String=row.try_get("secret_encrypted")?;
    let secret=decrypt(&state,&encrypted)?;
    let last:i64=row.try_get("last_used_step")?;
    let step=matching_step(&secret,&body.code,last,current_seconds());
    let recovery=if step.is_none(){recovery_hash(&body.code)}else{None};
    let valid_recovery=if let Some(ref code_hash)=recovery {
        sqlx::query("DELETE FROM panel_totp_recovery WHERE admin_id=$1 AND code_hash=$2 RETURNING code_hash")
          .bind(actor.id).bind(code_hash).fetch_optional(&mut *tx).await?.is_some()
    } else {false};
    if step.is_none() && !valid_recovery {
        tx.rollback().await?;
        auth::record_failed_login(&state,&format!("mfa-action:{}",actor.id)).await?;
        return Err(err(StatusCode::UNAUTHORIZED,INVALID_CODE));
    }
    sqlx::query("DELETE FROM panel_totp WHERE admin_id=$1").bind(actor.id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM panel_totp_recovery WHERE admin_id=$1").bind(actor.id).execute(&mut *tx).await?;
    if let Some(current)=auth::session_token_hash(&headers) {
        sqlx::query("DELETE FROM panel_sessions WHERE admin_id=$1 AND token_hash<>$2")
          .bind(actor.id).bind(current).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    auth::clear_failed_login(&state,&format!("mfa-action:{}",actor.id)).await?;
    super::audit(&state.pool,&actor.username,"mfa.disabled",None,None,json!({})).await;
    Ok(Json(json!({"enabled":false})))
}
pub async fn verify_challenge(State(state):State<AppState>,
    Json(body):Json<ChallengeRequest>)
    ->Result<(StatusCode,HeaderMap,Json<Value>),ApiError> {
    if body.challenge.len()!=64 || !body.challenge.bytes().all(|x|x.is_ascii_hexdigit()) {
        return Err(err(StatusCode::UNAUTHORIZED,INVALID_CODE));
    }
    let token_hash=hash(&body.challenge);
    let mut tx=state.pool.begin().await?;
    // Find the administrator without locking the challenge yet: locking the
    // challenge before the administrator can deadlock with credential updates.
    let id=sqlx::query_scalar::<_,i64>(
        "SELECT admin_id FROM panel_mfa_challenges WHERE token_hash=$1 AND expires_at>NOW()"
    ).bind(&token_hash).fetch_optional(&mut *tx).await?
        .ok_or_else(||err(StatusCode::UNAUTHORIZED,"Подтверждение истекло. Войдите снова."))?;
    let account=sqlx::query("SELECT username,role,is_active FROM panel_auth_users WHERE id=$1 FOR UPDATE")
        .bind(id).fetch_optional(&mut *tx).await?
        .ok_or_else(||err(StatusCode::UNAUTHORIZED,"Войдите снова."))?;
    if !account.try_get::<bool,_>("is_active")? {
        return Err(err(StatusCode::UNAUTHORIZED,"Войдите снова."));
    }
    // Another transaction could have revoked this challenge while we waited
    // for the administrator lock; therefore re-check it under its own lock.
    let challenge=sqlx::query("SELECT admin_id,attempts FROM panel_mfa_challenges \
       WHERE token_hash=$1 AND expires_at>NOW() FOR UPDATE")
       .bind(&token_hash).fetch_optional(&mut *tx).await?
       .ok_or_else(||err(StatusCode::UNAUTHORIZED,"Подтверждение истекло. Войдите снова."))?;
    if challenge.try_get::<i64,_>("admin_id")?!=id {
        return Err(err(StatusCode::UNAUTHORIZED,"Войдите снова."));
    }
    let attempts:i32=challenge.try_get("attempts")?;
    if attempts>=5 {return Err(err(StatusCode::TOO_MANY_REQUESTS,"Слишком много попыток. Начните вход заново."));}
    let username:String=account.try_get("username")?;
    let role:String=account.try_get("role")?;
    let factor=sqlx::query("SELECT secret_encrypted,last_used_step FROM panel_totp \
       WHERE admin_id=$1 AND enabled=TRUE FOR UPDATE")
       .bind(id).fetch_optional(&mut *tx).await?
       .ok_or_else(||err(StatusCode::UNAUTHORIZED,"Войдите снова."))?;
    let encrypted:String=factor.try_get("secret_encrypted")?;
    let secret=decrypt(&state,&encrypted)?;
    let last:i64=factor.try_get("last_used_step")?;
    let step=matching_step(&secret,&body.code,last,current_seconds());
    let recovery=if step.is_none(){recovery_hash(&body.code)}else{None};
    let valid_recovery=if let Some(ref hashed)=recovery {
        sqlx::query("DELETE FROM panel_totp_recovery WHERE admin_id=$1 AND code_hash=$2 RETURNING code_hash")
            .bind(id).bind(hashed).fetch_optional(&mut *tx).await?.is_some()
    } else {false};
    if step.is_none() && !valid_recovery {
        sqlx::query("UPDATE panel_mfa_challenges SET attempts=attempts+1 WHERE token_hash=$1")
            .bind(&token_hash).execute(&mut *tx).await?;
        tx.commit().await?;
        auth::record_failed_login(&state,&username.to_ascii_lowercase()).await?;
        return Err(err(StatusCode::UNAUTHORIZED,INVALID_CODE));
    }
    if let Some(step)=step {
        sqlx::query("UPDATE panel_totp SET last_used_step=$2 WHERE admin_id=$1")
            .bind(id).bind(step).execute(&mut *tx).await?;
    }
    sqlx::query("DELETE FROM panel_mfa_challenges WHERE admin_id=$1")
        .bind(id).execute(&mut *tx).await?;
    // Session insertion and consumption of the one-time factor are atomic.
    let response=auth::issue_session_in_transaction(&state,&mut tx,id,&username,&role).await?;
    tx.commit().await?;
    auth::clear_failed_login(&state,&username.to_ascii_lowercase()).await?;
    Ok(response)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rfc_totp_vector_and_replay() {
        let seed=b"12345678901234567890";
        assert_eq!(code_at(seed,59/30),"287082");
        assert_eq!(matching_step(seed,"287082",-1,59),Some(1));
        assert_eq!(matching_step(seed,"287082",1,59),None);
        assert_eq!(matching_step(seed,"000000",-1,59),None);
        assert_eq!(base32(b"Hello!"),"JBSWY3DPEE");
    }
    #[test]
    fn recoveries_have_entropy_and_one_way_hash() {
        let codes=new_recovery_codes();
        assert_eq!(codes.len(),10);
        let h=recovery_hash(&codes[0]).unwrap();
        assert_eq!(h.len(),64);
        assert!(recovery_hash("000000").is_none());
        assert_eq!(recovery_hash(&codes[0].replace('-',"")),Some(h));
        assert_eq!(codes.iter().collect::<std::collections::HashSet<_>>().len(),10);
    }
    #[test]
    fn key_format_requires_256_bits() {
        assert!(decode_key(&hex::encode([2u8;32])).is_ok());
        assert!(decode_key("bad").is_err());
    }
}
