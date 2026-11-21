//! Disposable CI-only SQL -> genuine persistent PolicySigner -> Xray cap.
//! Not installed in Docker, not enabled by default Cargo features and cannot
//! be reached through Nexus HTTP or the live XSP/2 gateway.
//! Cross-process Xray process/scope attestation is simulated by CI fixtures.
#[path = "../node_policy.rs"]
mod node_policy;
#[path = "../quota_v2_cap_signing.rs"]
mod quota_v2_cap_signing;

use anyhow::{Context, Result, anyhow, ensure};
use quota_v2_cap_signing::{Alias, SqlSnapshot, sign_snapshot};
use serde_json::json;
use sqlx::{PgPool, FromRow};
use std::{env, path::PathBuf};

#[derive(FromRow)]
struct Preflight {
    user_id:i64,
    node_id:i64,
    epoch:String,
    meter_epoch:String,
    reservation_id:String,
    revision:i64,
    request_challenge:String,
    prepared_runtime_id:String,
    reported_container_id:String,
    reported_pid:i64,
    reported_policy_sha256:String,
    first_activation_sha256:String,
    reported_wal_floor_bytes:i64,
    account_limit_bytes:i64,
    account_floor_bytes:i64,
    all_node_held_bytes:i64,
    lease_acknowledged_bytes:i64,
    lease_ceiling_bytes:i64,
    expires_ms:i64,
}

#[derive(FromRow)]
struct Account {
    limit_bytes:i64, settled_bytes:i64, observed_floor_bytes:i64, closed:bool
}
#[derive(FromRow)]
struct Lease {
    reservation_id:String, revision:i64, node_confirmed:bool,
    acknowledged_bytes:i64,ceiling_bytes:i64, valid_until_ms:i64,
    conservative_burn_floor_bytes:i64,conservative_burned_at:Option<i64>,
}
#[derive(FromRow)]
struct Genesis {
    first_activation_sha256:String,runtime_id:String,
    prepared_ms:i64, challenge:String, receipt_signature:String,
    policy_path_used:bool
}

fn require_ci() -> Result<(String,PathBuf)> {
    ensure!(env::var("GITHUB_ACTIONS").as_deref()==Ok("true")
        && env::var("XMESH_AUDIT_DISPOSABLE").as_deref()==Ok("1")
        && env::var("RUNNER_ENVIRONMENT").as_deref()==Ok("github-hosted"),
        "positive issuer is NOT available outside disposable GitHub-hosted CI");
    let dsn=env::var("QUOTA_TEST_DSN")?;
    ensure!(dsn.contains("/quota_test") && dsn.contains("127.0.0.1"),
        "refuse non-disposable PostgreSQL");
    let root=PathBuf::from(env::var("RUNNER_TEMP")?);
    let key=PathBuf::from(env::var("XMESH_CI_CAP_POLICY_KEY")?);
    ensure!(key.starts_with(root) && key.file_name().is_some(),
        "only private ephemeral hosted-runner policy signer key allowed");
    Ok((dsn,key))
}

fn args() -> Result<(i64,String,i64,String)> {
    let v:Vec<String>=env::args().skip(1).collect();
    ensure!(v.len()==4,"usage: quota-v2-ci-signed-cap NODE NONCE XRAY_PID POLICY_SHA256");
    let node=v[0].parse::<i64>()?;
    let pid=v[2].parse::<i64>()?;
    ensure!((node==47 || node==48) && pid>0 && v[1].len()==64
        && v[3].len()==64
        && v[1].bytes().chain(v[3].bytes()).all(|b|
            b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "only fixed first-Genesis CI Nodes and digests supported");
    Ok((node,v[1].clone(),pid,v[3].clone()))
}

#[tokio::main]
async fn main() -> Result<()> {
    let (dsn,key_path)=require_ci()?;
    // Authenticated bootstrap pins the Nexus Ed25519 identity BEFORE
    // the first signed cap; the caller never trusts the key bundled in a
    // later grant reply. This command is CI-only, not a real bootstrap API.
    if env::args().nth(1).as_deref()==Some("--public") {
        let signer=node_policy::PolicySigner::load(&key_path)?;
        println!("{}",signer.public_key());
        return Ok(());
    }
    let (node,nonce,observed_pid,policy_sha)=args()?;
    let pool=PgPool::connect(&dsn).await?;
    let mut tx=pool.begin().await?;

    // Immutable preflight identifies account/epoch; cannot itself grant.
    let p:Preflight=sqlx::query_as(
        "SELECT user_id,node_id,epoch::text,meter_epoch::text,
            reservation_id::text,revision,request_challenge,prepared_runtime_id,
            reported_container_id,reported_pid,reported_policy_sha256,
            first_activation_sha256,reported_wal_floor_bytes,account_limit_bytes,
            account_floor_bytes,all_node_held_bytes,lease_acknowledged_bytes,
            lease_ceiling_bytes,(EXTRACT(EPOCH FROM expires_at)*1000)::bigint AS expires_ms
         FROM quota_v2_runtime_admission_preflights
         WHERE node_id=$1 AND request_challenge=$2")
        .bind(node).bind(&nonce).fetch_one(&mut *tx).await?;

    ensure!(p.user_id==101 && p.node_id==node && p.request_challenge==nonce,
        "foreign candidate or wrong Node");
    ensure!(p.reported_pid==observed_pid
        && p.reported_policy_sha256==policy_sha
        && p.reported_container_id=="f".repeat(64),
        "unproven candidate process/container/policy mismatch");
    // Match the actual account-first, lease-second transaction order.
    sqlx::query("SET LOCAL synchronous_commit TO on").execute(&mut *tx).await?;
    let account:Account=sqlx::query_as(
        "SELECT limit_bytes,settled_bytes,observed_floor_bytes,closed
           FROM quota_v2_accounts WHERE user_id=$1 AND epoch=$2::uuid FOR UPDATE")
        .bind(p.user_id).bind(&p.epoch).fetch_one(&mut *tx).await?;
    let lease:Lease=sqlx::query_as(
        "SELECT reservation_id::text,revision,node_confirmed,acknowledged_bytes,
              ceiling_bytes,(EXTRACT(EPOCH FROM valid_until)*1000)::bigint AS valid_until_ms,
              conservative_burn_floor_bytes,
              (EXTRACT(EPOCH FROM conservative_burned_at)*1000)::bigint AS conservative_burned_at
         FROM quota_v2_reservations
         WHERE user_id=$1 AND epoch=$2::uuid AND node_id=$3
           AND meter_epoch=$4::uuid FOR UPDATE")
        .bind(p.user_id).bind(&p.epoch).bind(node).bind(&p.meter_epoch)
        .fetch_one(&mut *tx).await?;
    let genesis:Genesis=sqlx::query_as(
        "SELECT first_activation_sha256,runtime_id,prepared_ms,challenge,
                receipt_signature,policy_path_used
           FROM quota_v2_xray_genesis WHERE node_id=$1 FOR SHARE")
        .bind(node).fetch_one(&mut *tx).await?;
    let active:(String,Vec<u8>)=sqlx::query_as(
        "SELECT state,receipt_sha256 FROM node_xsp_product_nodes WHERE node_id=$1")
        .bind(node).fetch_one(&mut *tx).await?;
    ensure!(active.0=="active" && hex::encode(active.1)==p.first_activation_sha256,
        "only active exact first activation may issue");
    let held:i64=sqlx::query_scalar(
        "SELECT COALESCE(SUM(GREATEST(
            r.ceiling_bytes::numeric-GREATEST(r.acknowledged_bytes,r.conservative_burn_floor_bytes),0
        )),0)::bigint FROM quota_v2_reservations AS r
        WHERE r.user_id=$1 AND r.epoch=$2::uuid")
        .bind(p.user_id).bind(&p.epoch).fetch_one(&mut *tx).await?;
    let revoked:bool=sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM quota_v2_revocation_requests
          WHERE user_id=$1 AND epoch=$2::uuid AND node_id=$3 AND
           meter_epoch=$4::uuid AND reservation_id=$5::uuid)")
        .bind(p.user_id).bind(&p.epoch).bind(node)
        .bind(&p.meter_epoch).bind(&p.reservation_id)
        .fetch_one(&mut *tx).await?;
    let old_epoch_debt:bool=sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM quota_v2_reservations r
           JOIN quota_v2_accounts a USING(user_id,epoch)
          WHERE r.user_id=$1 AND a.closed
            AND r.ceiling_bytes>GREATEST(
                 r.acknowledged_bytes,r.conservative_burn_floor_bytes))")
        .bind(p.user_id).fetch_one(&mut *tx).await?;
    let now:i64=sqlx::query_scalar(
        "SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint")
        .fetch_one(&mut *tx).await?;

    ensure!(!account.closed && !revoked && !old_epoch_debt
        && lease.node_confirmed && !genesis.policy_path_used
        && lease.conservative_burn_floor_bytes==0
        && lease.conservative_burned_at.is_none()
        && lease.reservation_id==p.reservation_id
        && lease.revision==p.revision
        && lease.acknowledged_bytes==p.lease_acknowledged_bytes
        && lease.ceiling_bytes==p.lease_ceiling_bytes
        && account.limit_bytes==p.account_limit_bytes
        && account.settled_bytes.max(account.observed_floor_bytes)==p.account_floor_bytes
        && held==p.all_node_held_bytes
        && p.reported_wal_floor_bytes==0
        && genesis.runtime_id==p.prepared_runtime_id
        && genesis.first_activation_sha256==p.first_activation_sha256
        && !genesis.receipt_signature.is_empty()
        && !genesis.challenge.is_empty()
        && genesis.prepared_ms<=now && now<genesis.prepared_ms+120000
        && (i128::from(held) + i128::from(account.settled_bytes.max(account.observed_floor_bytes)))
           <=i128::from(account.limit_bytes),
        "stale, unsafe, changed or already spent signed reservation preflight");
    // Prevent the only first-genesis cap from being minted after stage expiry.
    ensure!(now<p.expires_ms && now<lease.valid_until_ms,
        "expired SQL/Genesis reservation");

    // The exact signed envelope is an immutable transaction outbox. A
    // retry after COMMIT or lost HTTP response must return identical bytes,
    // not quietly refresh TTL or offer a second signed grant.
    let existing:Option<(Vec<u8>,String,i64,i64)>=sqlx::query_as(
        "SELECT signed_envelope,signer_public_key,grant_bytes,install_before_ms
           FROM quota_v2_signed_first_cap_outbox
          WHERE node_id=$1 AND request_challenge=$2")
        .bind(node).bind(&nonce).fetch_optional(&mut *tx).await?;
    if let Some((saved,old_pub,old_grant,install_before))=existing {
        ensure!(now<install_before && old_grant==lease.ceiling_bytes,
            "expired or reallocated signed-cap outbox cannot be replayed");
        let same=node_policy::PolicySigner::load(&key_path)
            .context("load original Nexus test signing identity")?;
        ensure!(same.public_key()==old_pub,
            "issuer signing identity was rotated during pending delivery");
        tx.commit().await?;
        println!("{}",json!({
            "nodeId":node,"ceiling":old_grant,
            "signedEnvelope":String::from_utf8(saved)
                .map_err(|_|anyhow!("non-utf8 stored cap"))?,
            "publicKeyHex":old_pub,
            "phase":"sql-committed-nexus-policy-signer-disposable"
        }));
        return Ok(());
    }
    // Do NOT derive positive capacity from user-supplied counters.
    // SQL's existing immutable lease and independently staged Node are the
    // budget source; synthetic inbound membership is fixed by CI only.
    let until=(now+3_600_000).min(lease.valid_until_ms);
    let install_before=(now+60_000).min(p.expires_ms);
    let signing=SqlSnapshot{
        user_id:p.user_id,node_id:p.node_id,
        activation_sha:p.first_activation_sha256,
        runtime_id:p.prepared_runtime_id,policy_sha:p.reported_policy_sha256,
        account_epoch:p.epoch,meter_epoch:p.meter_epoch,
        reservation_id:p.reservation_id,revision:p.revision,
        nonce:p.request_challenge,original_inventory_head:"0".repeat(64),
        acknowledged:lease.acknowledged_bytes,measured_wal:p.reported_wal_floor_bytes,
        measured_cdn_wal:0,ceiling:lease.ceiling_bytes,
        node_ceiling:lease.ceiling_bytes,cdn_ceiling:150.min(lease.ceiling_bytes),
        shared_account_limit:account.limit_bytes,
        shared_account_floor:account.settled_bytes.max(account.observed_floor_bytes),
        all_node_held:held,sql_preflight_expires_ms:p.expires_ms,
        lease_expires_ms:lease.valid_until_ms,
        issued_at_ms:now-1000,install_before_ms:install_before,valid_until_ms:until,
        aliases:vec![
            Alias{email:"xmesh-u101--vless-cdn".into(),class:"cdn".into()},
            Alias{email:"xmesh-u101--vless-main".into(),class:"main".into()}
        ],
    };

    let signer=node_policy::PolicySigner::load(&key_path)
        .context("load disposable exact Nexus PolicySigner")?;
    let bytes=sign_snapshot(&signer,&signing,now)?;
    let public=signer.public_key();
    // The SQL function RECHECKS the locked first-Genesis lease, all held
    // reservations, the immutable source and the signed envelope's critical
    // byte/time/scope fields. PostgreSQL WAL fsync must complete BEFORE the
    // caller receives the exact positive spending grant bytes.
    let saved:(Vec<u8>,String,i64)=sqlx::query_as(
        "SELECT signed_envelope,signer_public_key,grant_bytes
           FROM quota_v2_store_signed_first_cap($1,$2,$3,$4)")
        .bind(node).bind(&nonce).bind(&public).bind(&bytes)
        .fetch_one(&mut *tx).await?;
    ensure!(saved.0==bytes && saved.1==public && saved.2==lease.ceiling_bytes,
        "signed-cap outbox failed exact-byte persistence check");
    tx.commit().await?;
    println!("{}",json!({
        "nodeId":node,"ceiling":saved.2,
        "signedEnvelope":String::from_utf8(saved.0).map_err(|_|anyhow!("non-utf8 cap"))?,
        "publicKeyHex":saved.1,
        "phase":"sql-committed-nexus-policy-signer-disposable"
    }));
    Ok(())
}
