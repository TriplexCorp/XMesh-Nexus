//! Experimental, dormant dual-signed Node quota attestation.
//! Signed assertions do not prove a live Linux Xray process, WAL completeness,
//! real inbound membership or writer finality. NO production HTTP route.
use crate::{ApiError, xsp_v2_api::{ParsedQuotaCapAttestation,
    parse_quota_cap_attestation_staging, verify_quota_cap_dual_signatures_staging}};
use axum::http::StatusCode;
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use sqlx::{PgPool,Row};
use std::time::{SystemTime,UNIX_EPOCH};

const KIND:&str="xmesh.quota-v2.first-genesis-cap-attestation";
fn deny()->ApiError {
    ApiError::new(StatusCode::UNAUTHORIZED,"Untrusted XSP/2 quota-cap attestation")
}
fn hex64(v:&str)->bool {
    v.len()==64 && v.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))
}
#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct Claims {
    schema_version:u8,
    kind:String,
    node_id:i64,
    user_id:i64,
    account_epoch:String,
    meter_epoch:String,
    reservation_id:String,
    reservation_revision:i64,
    request_challenge:String,
    activation_receipt_sha256:String,
    runtime_id:String,
    container_id:String,
    host_pid:i64,
    policy_sha256:String,
    inventory_tail_digest:String,
    wal_floor_bytes:i64,
    observed_at_ms:i64,
    can_start:bool,
    can_resume:bool,
    final_meter_verified:bool,
    refundable_bytes:i64,
}
fn validate_claims(
    parsed:&ParsedQuotaCapAttestation, trusted_node:i64,now:i64
)->Result<Claims,ApiError>{
    if trusted_node<=0||parsed.node_id!=trusted_node{return Err(deny())}
    // Typed Deserialize rejects duplicate keys, unknown fields and float
    // substitutions; raw original bytes remain bound by XSP payload SHA256.
    let p:Claims=serde_json::from_slice(&parsed.payload).map_err(|_|deny())?;
    if p.schema_version!=1||p.kind!=KIND||p.node_id!=trusted_node
       ||p.user_id<=0||p.reservation_revision<=0
       ||p.request_challenge!=parsed.request_id
       ||parsed.revision!=p.reservation_revision.to_string()
       ||!hex64(&p.request_challenge)||!hex64(&p.activation_receipt_sha256)
       ||!hex64(&p.runtime_id)||!hex64(&p.container_id)
       ||!hex64(&p.policy_sha256)||p.inventory_tail_digest!="0".repeat(64)
       ||p.host_pid<=0||p.wal_floor_bytes!=0
       ||p.refundable_bytes!=0||p.can_start||p.can_resume
       ||p.final_meter_verified||p.observed_at_ms<=0
       ||now.abs_diff(p.observed_at_ms)>120_000 {
        return Err(deny())
    }
    Ok(p)
}

/// Record an authenticated owner-enrolled *claim* from a caller whose Node
/// identity and X25519MLKEM768 TLS channel were separately verified by the
/// future strict ingress. Never take trusted_pq_tls_node_id from client JSON.
/// This function cannot generate traffic authority and has no public route.
///
/// # Errors
/// Denies wrong path, key epoch, signatures, Node identity, scope, nonce,
/// stale immutable preflight, reenrollment, rotation, or SQL failure.
#[allow(dead_code)]
pub(crate) async fn record_staging(
    pool:&PgPool, trusted_pq_tls_node_id:i64, signed_wire:&[u8]
)->Result<(),ApiError>{
    let now:i64=SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_|deny())?.as_millis().try_into().map_err(|_|deny())?;
    let req=parse_quota_cap_attestation_staging(signed_wire,now)?;
    let claim=validate_claims(&req,trusted_pq_tls_node_id,now)?;
    let mut tx=pool.begin().await?;
    // The suite row is locked BEFORE reading keys, serializing with epoch
    // rotation. Only staging/dual-enrolled state is permitted here.
    let state=sqlx::query("SELECT minimum_suite,activation_phase,key_epoch
            FROM node_xsp_suite_state WHERE node_id=$1 FOR UPDATE")
        .bind(trusted_pq_tls_node_id).fetch_optional(&mut *tx).await?
        .ok_or_else(deny)?;
    let floor:i16=state.try_get("minimum_suite")?;
    let phase:String=state.try_get("activation_phase")?;
    let key_epoch:i64=state.try_get("key_epoch")?;
    if floor!=1||!matches!(phase.as_str(),"shadow"|"dual_enrolled")
       ||key_epoch!=req.key_epoch{return Err(deny())}
    let registered=sqlx::query("SELECT ed25519_public,mldsa65_public
         FROM node_xsp_public_keysets WHERE node_id=$1
           AND purpose='node_request' AND key_epoch=$2
           AND ed25519_key_id=$3 AND mldsa65_key_id=$4
           AND revoked_at IS NULL")
        .bind(trusted_pq_tls_node_id).bind(req.key_epoch)
        .bind(&req.ed_key_id).bind(&req.pq_key_id)
        .fetch_optional(&mut *tx).await?.ok_or_else(deny)?;
    let ed:Vec<u8>=registered.try_get("ed25519_public")?;
    let pq:Vec<u8>=registered.try_get("mldsa65_public")?;
    verify_quota_cap_dual_signatures_staging(&req,&ed,&pq)?;
    let product=sqlx::query("SELECT state,encode(receipt_sha256,'hex') AS activation
        FROM node_xsp_product_nodes WHERE node_id=$1")
        .bind(trusted_pq_tls_node_id)
        .fetch_optional(&mut *tx).await?.ok_or_else(deny)?;
    let product_state:String=product.try_get("state")?;
    let active_receipt:Option<String>=product.try_get("activation")?;
    if product_state!="active"
        ||active_receipt.as_deref()!=Some(claim.activation_receipt_sha256.as_str()){
        return Err(deny())
    }
    // Preflight is immutable and still ZERO AUTHORITY. This compares
    // signed claims against the original SQL source, NOT self-reported
    // Node/PID/policy fields pretending to be independent attestation.
    let p=sqlx::query("SELECT user_id,epoch::text AS epoch,
       meter_epoch::text AS meter_epoch,reservation_id::text AS reservation_id,
       revision,prepared_runtime_id,reported_container_id,reported_pid,
       reported_policy_sha256,first_activation_sha256,reported_wal_floor_bytes,
       lease_acknowledged_bytes,expires_at>clock_timestamp() AS current
       FROM quota_v2_runtime_admission_preflights
       WHERE node_id=$1 AND request_challenge=$2 FOR SHARE")
       .bind(trusted_pq_tls_node_id).bind(&claim.request_challenge)
       .fetch_optional(&mut *tx).await?.ok_or_else(deny)?;
    let current:bool=p.try_get("current")?;
    let user:i64=p.try_get("user_id")?;
    let epoch:String=p.try_get("epoch")?;
    let meter:String=p.try_get("meter_epoch")?;
    let reserve:String=p.try_get("reservation_id")?;
    let revision:i64=p.try_get("revision")?;
    let runtime:String=p.try_get("prepared_runtime_id")?;
    let container:String=p.try_get("reported_container_id")?;
    let pid:i64=p.try_get("reported_pid")?;
    let policy:String=p.try_get("reported_policy_sha256")?;
    let activation:String=p.try_get("first_activation_sha256")?;
    let floor:i64=p.try_get("reported_wal_floor_bytes")?;
    let ack:i64=p.try_get("lease_acknowledged_bytes")?;
    if !current||user!=claim.user_id||epoch!=claim.account_epoch
      ||meter!=claim.meter_epoch||reserve!=claim.reservation_id
      ||revision!=claim.reservation_revision||runtime!=claim.runtime_id
      ||container!=claim.container_id||pid!=claim.host_pid
      ||policy!=claim.policy_sha256||activation!=claim.activation_receipt_sha256
      ||floor!=0||ack!=0{return Err(deny())}
    // Replay protection shares the same one-use, owner-enrolled XSP
    // nonce ledger as the existing heartbeat/recovery authentication.
    sqlx::query("SET LOCAL synchronous_commit TO on").execute(&mut *tx).await?;
    let inserted=sqlx::query("INSERT INTO node_xsp_replay_nonces(
      node_id,key_epoch,direction,nonce,request_id)
      VALUES($1,$2,1,$3,$4) ON CONFLICT DO NOTHING")
      .bind(trusted_pq_tls_node_id).bind(req.key_epoch)
      .bind(&req.nonce).bind(&req.request_id)
      .execute(&mut *tx).await?;
    if inserted.rows_affected()!=1{return Err(deny())}
    let digest=hex::encode(Sha256::digest(signed_wire));
    sqlx::query("INSERT INTO quota_v2_xsp2_cap_attestations(
        node_id,request_challenge,user_id,epoch,meter_epoch,reservation_id,
        reservation_revision,key_epoch,ed25519_key_id,mldsa65_key_id,
        xsp_nonce,assertion_sha256,signed_envelope)
        VALUES($1,$2,$3,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,$10,$11,$12,$13)")
       .bind(trusted_pq_tls_node_id).bind(&claim.request_challenge)
       .bind(claim.user_id).bind(&claim.account_epoch).bind(&claim.meter_epoch)
       .bind(&claim.reservation_id).bind(claim.reservation_revision)
       .bind(req.key_epoch).bind(&req.ed_key_id).bind(&req.pq_key_id)
       .bind(&req.nonce).bind(digest).bind(signed_wire)
       .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD,Engine};
    use serde_json::json;
    fn fixture()->(serde_json::Value,i64){
        let now=1_800_000_000_000i64;
        let v=json!({
          "schemaVersion":1,"kind":KIND,"nodeId":47,"userId":101,
          "accountEpoch":"11111111-1111-4111-8111-111111111111",
          "meterEpoch":"22222222-2222-4222-8222-222222222247",
          "reservationId":"33333333-3333-4333-8333-333333333347",
          "reservationRevision":1,"requestChallenge":"a".repeat(64),
          "activationReceiptSha256":"c".repeat(64),"runtimeId":"b".repeat(64),
          "containerId":"f".repeat(64),"hostPid":31415,
          "policySha256":"d".repeat(64),"inventoryTailDigest":"0".repeat(64),
          "walFloorBytes":0,"observedAtMs":now,
          "canStart":false,"canResume":false,
          "finalMeterVerified":false,"refundableBytes":0
        });
        (v,now)
    }
    fn wire(v:&serde_json::Value,now:i64)->Vec<u8>{
        serde_json::to_vec(&json!({
            "protocol":"XSP/2","suite":"Ed25519+ML-DSA-65",
            "direction":1,"messageType":"node.quota-v2.cap.attest",
            "issuerId":"node-47","nodeId":47,"method":"POST",
            "path":"/api/v2/node/quota-v2/cap/attest",
            "ed25519KeyId":"ed-test","mldsa65KeyId":"pq-test",
            "keyEpoch":1,"issuedAtMs":now,"expiresAtMs":now+60000,
            "nonceHex":"12".repeat(16),"requestId":"a".repeat(64),
            "revision":"1","payloadB64":STANDARD.encode(serde_json::to_vec(v).unwrap()),
            "signatures":{"ed25519":STANDARD.encode([0u8;64]),
                "mldsa65":STANDARD.encode(vec![0u8;3309])}
        })).unwrap()
    }
    #[test]
    fn strict_first_genesis_claims_and_unique_xsp_domain(){
        let (v,now)=fixture();
        let w=wire(&v,now);
        let parsed=parse_quota_cap_attestation_staging(&w,now).unwrap();
        assert!(validate_claims(&parsed,47,now).is_ok());
        assert!(validate_claims(&parsed,48,now).is_err());
        assert!(crate::xsp_v2_api::recovery_signing_input_for_test(
          &w,b"some-ack",47,&"a".repeat(64),now).is_err());
        for (field,value) in [
          ("nodeId",json!(48)),("reservationRevision",json!(2)),
          ("walFloorBytes",json!(1)),("hostPid",json!(0)),
          ("canStart",json!(true)),("canResume",json!(true)),
          ("refundableBytes",json!(1)),
          ("inventoryTailDigest",json!("f".repeat(64))),
          ("observedAtMs",json!(now-120001))
        ]{
            let mut altered=v.clone();
            altered[field]=value;
            let q=parse_quota_cap_attestation_staging(&wire(&altered,now),now).unwrap();
            assert!(validate_claims(&q,47,now).is_err(),"{field}");
        }
        let mut extra=v.clone();
        extra["unknownGrant"]=json!(1);
        let q=parse_quota_cap_attestation_staging(&wire(&extra,now),now).unwrap();
        assert!(validate_claims(&q,47,now).is_err());
    }
    #[test]
    fn real_enrolled_ed25519_and_mldsa65_signatures_required() {
        use ed25519_dalek::{Signer as _,SigningKey};
        use openssl::{pkey::PKey,sign::Signer as PQSigner};
        use std::process::Command;
        let generated=Command::new("openssl")
            .args(["genpkey","-algorithm","ML-DSA-65"])
            .output().expect("OpenSSL CLI required");
        if !generated.status.success() {
            assert_ne!(std::env::var("XSP_V2_REQUIRE_PQ_CAP_TESTS").as_deref(),
                Ok("1"),"ML-DSA-65 is REQUIRED in the dedicated crypto job");
            return;
        }
        let pq=PKey::private_key_from_pem(&generated.stdout)
            .expect("real ML-DSA-65 test key");
        let der=pq.public_key_to_der().unwrap();
        let pq_pub=&der[der.len()-1952..];
        let ed=SigningKey::from_bytes(&[23u8;32]);
        let ed_pub=ed.verifying_key().to_bytes();
        let (payload,now)=fixture();
        let original=wire(&payload,now);
        let input=crate::xsp_v2_api::quota_cap_signing_input_for_test(
            &original,now).unwrap();
        let mut pq_sign=PQSigner::new_without_digest(&pq).unwrap();
        let pq_signature=pq_sign.sign_oneshot_to_vec(&input).unwrap();
        let mut envelope:serde_json::Value=
            serde_json::from_slice(&original).unwrap();
        envelope["signatures"]["ed25519"]=json!(
            STANDARD.encode(ed.sign(&input).to_bytes()));
        envelope["signatures"]["mldsa65"]=json!(STANDARD.encode(pq_signature));
        let signed=serde_json::to_vec(&envelope).unwrap();
        let parsed=parse_quota_cap_attestation_staging(&signed,now).unwrap();
        assert!(verify_quota_cap_dual_signatures_staging(
            &parsed,&ed_pub,pq_pub).is_ok());
        assert!(validate_claims(&parsed,47,now).is_ok());
        // Real Ed25519 alone, or real ML-DSA alone, is never accepted.
        let mut wrong=envelope.clone();
        wrong["signatures"]["mldsa65"]=json!(STANDARD.encode([0u8;3309]));
        let p=parse_quota_cap_attestation_staging(
            &serde_json::to_vec(&wrong).unwrap(),now).unwrap();
        assert!(verify_quota_cap_dual_signatures_staging(
            &p,&ed_pub,pq_pub).is_err());
        wrong=envelope.clone();
        wrong["signatures"]["ed25519"]=json!(STANDARD.encode([0u8;64]));
        let p=parse_quota_cap_attestation_staging(
            &serde_json::to_vec(&wrong).unwrap(),now).unwrap();
        assert!(verify_quota_cap_dual_signatures_staging(
            &p,&ed_pub,pq_pub).is_err());
        assert!(verify_quota_cap_dual_signatures_staging(
            &parsed,&[2u8;32],pq_pub).is_err());
        assert!(verify_quota_cap_dual_signatures_staging(
            &parsed,&ed_pub,&[2u8;1952]).is_err());
        wrong=envelope;
        let raw=STANDARD.decode(wrong["payloadB64"].as_str().unwrap()).unwrap();
        let mut replaced:String=String::from_utf8(raw).unwrap();
        replaced=replaced.replace("vless","other");
        if replaced==String::from_utf8(STANDARD.decode(wrong["payloadB64"].as_str().unwrap()).unwrap()).unwrap() {
            replaced.push(' ');
        }
        wrong["payloadB64"]=json!(STANDARD.encode(replaced.as_bytes()));
        let p=parse_quota_cap_attestation_staging(
            &serde_json::to_vec(&wrong).unwrap(),now).unwrap();
        assert!(verify_quota_cap_dual_signatures_staging(
            &p,&ed_pub,pq_pub).is_err(),"signed payload bytes cannot change");
    }

}
