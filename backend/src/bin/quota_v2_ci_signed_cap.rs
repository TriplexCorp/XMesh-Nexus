//! Disposable CI-only SQL -> genuine persistent `PolicySigner` -> Xray cap.
//! Not installed in Docker, not enabled by default Cargo features and cannot
//! be reached through the production Nexus API or gateway. The disposable
//! installed rehearsal delivers only committed outbox bytes; its trusted
//! runner observes both local guests, not arbitrary remote production Nodes.
#[path = "../node_policy.rs"]
mod node_policy;
#[path = "../quota_v2_cap_signing.rs"]
mod quota_v2_cap_signing;

use anyhow::{Context, Result, anyhow, ensure};
use quota_v2_cap_signing::{Alias, SqlSnapshot, sign_snapshot};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgConnection, PgPool};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

#[derive(FromRow)]
struct Preflight {
    user_id: i64,
    node_id: i64,
    epoch: String,
    meter_epoch: String,
    reservation_id: String,
    revision: i64,
    request_challenge: String,
    prepared_runtime_id: String,
    reported_container_id: String,
    reported_pid: i64,
    reported_policy_sha256: String,
    first_activation_sha256: String,
    reported_wal_floor_bytes: i64,
    account_limit_bytes: i64,
    account_floor_bytes: i64,
    all_node_held_bytes: i64,
    acknowledged_bytes: i64,
    ceiling_bytes: i64,
    expires_ms: i64,
}

#[derive(FromRow)]
struct Account {
    limit_bytes: i64,
    settled_bytes: i64,
    observed_floor_bytes: i64,
    closed: bool,
}
#[derive(FromRow)]
struct Lease {
    reservation_id: String,
    revision: i64,
    node_confirmed: bool,
    acknowledged_bytes: i64,
    ceiling_bytes: i64,
    valid_until_ms: i64,
    conservative_burn_floor_bytes: i64,
    conservative_burned_at: Option<i64>,
}
#[derive(FromRow)]
struct Genesis {
    first_activation_sha256: String,
    runtime_id: String,
    prepared_ms: i64,
    challenge: String,
    receipt_signature: String,
    policy_path_used: bool,
}

fn require_ci() -> Result<(String, PathBuf)> {
    ensure!(
        env::var("GITHUB_ACTIONS").as_deref() == Ok("true")
            && env::var("XMESH_AUDIT_DISPOSABLE").as_deref() == Ok("1")
            && env::var("RUNNER_ENVIRONMENT").as_deref() == Ok("github-hosted"),
        "positive issuer is NOT available outside disposable GitHub-hosted CI"
    );
    let dsn = env::var("QUOTA_TEST_DSN")?;
    let address = reqwest::Url::parse(&dsn)?;
    ensure!(
        matches!(address.scheme(), "postgres" | "postgresql")
            && address.host_str() == Some("127.0.0.1")
            && (address.path() == "/quota_test"
                || (address.path() == "/quota_wal_installed"
                    && env::var("XMESH_INSTALLED_GENESIS_LEASE").as_deref() == Ok("1")))
            && address.query().is_none()
            && address.fragment().is_none(),
        "refuse non-disposable PostgreSQL"
    );
    let root = PathBuf::from(env::var("RUNNER_TEMP")?);
    let key = PathBuf::from(env::var("XMESH_CI_CAP_POLICY_KEY")?);
    ensure!(
        key.starts_with(root) && key.file_name().is_some(),
        "only private ephemeral hosted-runner policy signer key allowed"
    );
    Ok((dsn, key))
}

fn args() -> Result<(i64, String, i64, String)> {
    let v: Vec<String> = env::args().skip(1).collect();
    ensure!(
        v.len() == 4,
        "usage: quota-v2-ci-signed-cap NODE NONCE XRAY_PID POLICY_SHA256"
    );
    let node = v[0].parse::<i64>()?;
    let pid = v[2].parse::<i64>()?;
    ensure!(
        (node == 47 || node == 48)
            && pid > 0
            && v[1].len() == 64
            && v[3].len() == 64
            && v[1]
                .bytes()
                .chain(v[3].bytes())
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "only fixed first-Genesis CI Nodes and digests supported"
    );
    Ok((node, v[1].clone(), pid, v[3].clone()))
}

struct InstalledInput {
    user_id: i64,
    container: String,
    config: PathBuf,
}

fn hex64(value: &str) -> bool {
    value.len() == 64 && value.bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn installed_args() -> Result<(i64, String, i64, String, InstalledInput)> {
    let v: Vec<String> = env::args().skip(1).collect();
    ensure!(
        env::var("XMESH_INSTALLED_GENESIS_LEASE").as_deref() == Ok("1")
            && v.len() == 8 && v[0] == "--installed",
        "installed signer requires the isolated runner test and exact observed inputs"
    );
    let node = v[1].parse::<i64>()?;
    let user = v[2].parse::<i64>()?;
    let pid = v[4].parse::<i64>()?;
    let config = PathBuf::from(&v[7]);
    ensure!(
        node > 0 && user > 0 && pid > 0 && hex64(&v[3])
            && hex64(&v[5]) && hex64(&v[6])
            && config.starts_with(PathBuf::from(env::var("RUNNER_TEMP")?))
            && fs::symlink_metadata(&config)?.file_type().is_file()
            && fs::metadata(&config)?.len() <= 262144,
        "invalid independently measured disposable installed candidate"
    );
    Ok((node, v[3].clone(), pid, v[6].clone(), InstalledInput {
        user_id: user, container: v[5].clone(), config,
    }))
}

/// The hosted-runner controller owns the disposable guest/root and reads
/// the actual config and kernel identity, not a remote Node assertion.
/// This is NOT a general remote attestation mechanism.
async fn installed_scope(
    conn: &mut PgConnection,
    p: &Preflight,
    candidate: &InstalledInput,
    key_path: &Path,
) -> Result<Vec<Alias>> {
    let signer = node_policy::PolicySigner::load(key_path)?;
    let q: (Vec<u8>, String, String, String) = sqlx::query_as(
        "SELECT signed_policy_bytes,policy_signature,signer_public_key,profile_revision
         FROM quota_v2_genesis_quarantine_policies
         WHERE node_id=$1 AND policy_sha256=$2 AND runtime_id=$3
           AND first_activation_sha256=$4 AND authorized_bytes=0
         FOR SHARE",
    )
    .bind(p.node_id)
    .bind(&p.reported_policy_sha256)
    .bind(&p.prepared_runtime_id)
    .bind(&p.first_activation_sha256)
    .fetch_one(&mut *conn)
    .await?;
    let policy: Value = serde_json::from_slice(&q.0)?;
    ensure!(serde_json::to_vec(&policy)? == q.0
            && hex::encode(Sha256::digest(&q.0)) == p.reported_policy_sha256
            && signer.public_key() == q.2 && signer.sign(&policy)? == q.1
            && policy["configSha256"].as_str() == Some(q.3.as_str())
            && policy["nodeId"] == p.node_id,
            "original installed signed quarantine not verified");
    let raw = fs::read(&candidate.config)?;
    let config: Value = serde_json::from_slice(&raw)?;
    ensure!(serde_json::to_vec(&config)? == raw
            && hex::encode(Sha256::digest(&raw)) == q.3,
            "trusted runner config is not the actual signed profile");
    let users = policy["users"].as_array().context("signed runtime user roster")?;
    let roster: Vec<_> = users.iter().filter(|u| u["userId"] == p.user_id).collect();
    ensure!(roster.len() == 1 && roster[0]["onHold"] == true
            && roster[0]["offlineBudgetBytes"] == 0, "user absent from original scope");
    let uuid = roster[0]["xrayId"].as_str().context("signed Xray identity")?;

    let lease: (Vec<u8>, String) = sqlx::query_as(
        "SELECT signed_reply,signer_public_key FROM quota_v2_genesis_lease_replies
         WHERE node_id=$1 AND user_id=$2 AND stage='confirm' AND policy_sha256=$3",
    )
    .bind(p.node_id).bind(p.user_id).bind(&p.reported_policy_sha256)
    .fetch_one(&mut *conn).await?;
    let signed: Value = serde_json::from_slice(&lease.0)?;
    let payload = &signed["payload"];
    let r = &payload["reservation"];
    ensure!(signer.public_key() == lease.1
            && serde_json::to_vec(&signed)? == lease.0
            && signed["signature"].as_str() == Some(signer.sign(payload)?.as_str())
            && payload["authorizedBytes"] == 0 && payload["canSpend"] == false
            && payload["status"] == "confirmed"
            && r["epoch"].as_str() == Some(p.epoch.as_str())
            && r["meterEpoch"].as_str() == Some(p.meter_epoch.as_str())
            && r["reservationId"].as_str() == Some(p.reservation_id.as_str())
            && r["revision"] == p.revision && r["ceilingBytes"] == p.ceiling_bytes,
            "installed runner cap does not match original confirmed SQL lease");

    let mut aliases = Vec::new();
    for inbound in config["inbounds"].as_array().context("original inbounds")? {
        let tag = inbound["tag"].as_str().context("inbound tag")?;
        if tag == "xmesh_stats_in" && inbound["protocol"] == "dokodemo-door" {
            continue;
        }
        ensure!(inbound["protocol"] == "vless", "unmetered installed protocol");
        let class = match tag {
            "vless-main" => "main",
            "vless-cdn" => "cdn",
            _ => anyhow::bail!("unknown installed scope"),
        };
        let email = format!("xmesh-u{}--{tag}", p.user_id);
        let clients = inbound["settings"]["clients"].as_array().context("real clients")?;
        ensure!(clients.len() == 1
            && clients[0]["email"].as_str() == Some(email.as_str())
            && clients[0]["id"].as_str() == Some(uuid),
            "disposable profile must contain exactly the intended real user");
        aliases.push(Alias { email, class: class.to_owned() });
    }
    ensure!(aliases.len() == 1, "one actual MAIN/CDN VLESS inbound per installed test Node");
    Ok(aliases)
}

#[tokio::main]
async fn main() -> Result<()> {
    let (dsn, key_path) = require_ci()?;
    // Authenticated bootstrap pins the Nexus Ed25519 identity BEFORE
    // the first signed cap; the caller never trusts the key bundled in a
    // later grant reply. This command is CI-only, not a real bootstrap API.
    if env::args().nth(1).as_deref() == Some("--public") {
        let signer = node_policy::PolicySigner::load(&key_path)?;
        println!("{}", signer.public_key());
        return Ok(());
    }
    let (node, nonce, observed_pid, policy_sha, installed) =
        if env::args().nth(1).as_deref() == Some("--installed") {
            let (node, nonce, pid, policy, candidate) = installed_args()?;
            (node, nonce, pid, policy, Some(candidate))
        } else {
            let (node, nonce, pid, policy) = args()?;
            (node, nonce, pid, policy, None)
        };
    let pool = PgPool::connect(&dsn).await?;
    let mut tx = pool.begin().await?;

    let fake_container = "f".repeat(64);
    let expected_user = installed.as_ref().map_or(101, |v| v.user_id);
    let expected_container = installed.as_ref().map_or(fake_container.as_str(), |v| v.container.as_str());
    let p = load_preflight(&mut tx, node, &nonce, observed_pid, &policy_sha,
                           expected_user, expected_container).await?;
    let snapshot = lock_snapshot(&mut tx, &p).await?;
    let scope = if let Some(candidate) = &installed {
        Some(installed_scope(&mut tx, &p, candidate, &key_path).await?)
    } else { None };
    let Snapshot {
        account,
        lease,
        held,
        now,
        genesis_expires_ms,
    } = snapshot;
    // The exact signed envelope is an immutable transaction outbox. A
    // retry after COMMIT or lost HTTP response must return identical bytes,
    // not quietly refresh TTL or offer a second signed grant.
    let existing: Option<(Vec<u8>, String, i64, i64)> = sqlx::query_as(
        "SELECT signed_envelope,signer_public_key,grant_bytes,install_before_ms
           FROM quota_v2_signed_first_cap_outbox
          WHERE node_id=$1 AND request_challenge=$2",
    )
    .bind(node)
    .bind(&nonce)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((saved, old_pub, old_grant, install_before)) = existing {
        ensure!(
            now < install_before && old_grant == lease.ceiling_bytes,
            "expired or reallocated signed-cap outbox cannot be replayed"
        );
        let same = node_policy::PolicySigner::load(&key_path)
            .context("load original Nexus test signing identity")?;
        ensure!(
            same.public_key() == old_pub,
            "issuer signing identity was rotated during pending delivery"
        );
        tx.commit().await?;
        print_cap(node, (saved, old_pub, old_grant))?;
        return Ok(());
    }
    let ceiling = lease.ceiling_bytes;
    let signing = signing_input(p, &account, &lease, held, now, genesis_expires_ms, scope)?;
    let saved = persist_cap(&mut tx, &key_path, &signing, now).await?;
    ensure!(saved.2 == ceiling, "stored cap ceiling changed");
    tx.commit().await?;
    print_cap(node, saved)?;
    Ok(())
}

async fn load_preflight(
    conn: &mut PgConnection,
    node: i64,
    nonce: &str,
    observed_pid: i64,
    policy_sha: &str,
    expected_user: i64,
    expected_container: &str,
) -> Result<Preflight> {
    // Immutable preflight identifies account/epoch; cannot itself grant.
    let p: Preflight = sqlx::query_as(
        "SELECT user_id,node_id,epoch::text,meter_epoch::text,
            reservation_id::text,revision,request_challenge,prepared_runtime_id,
            reported_container_id,reported_pid,reported_policy_sha256,
            first_activation_sha256,reported_wal_floor_bytes,account_limit_bytes,
            account_floor_bytes,all_node_held_bytes,lease_acknowledged_bytes AS acknowledged_bytes,
            lease_ceiling_bytes AS ceiling_bytes,(EXTRACT(EPOCH FROM expires_at)*1000)::bigint AS expires_ms
         FROM quota_v2_runtime_admission_preflights
         WHERE node_id=$1 AND request_challenge=$2",
    )
    .bind(node)
    .bind(nonce)
    .fetch_one(&mut *conn)
    .await?;

    ensure!(
        p.user_id == expected_user && p.node_id == node && p.request_challenge == nonce,
        "foreign candidate or wrong Node"
    );
    ensure!(
        p.reported_pid == observed_pid
            && p.reported_policy_sha256 == policy_sha
            && p.reported_container_id == expected_container,
        "unproven candidate process/container/policy mismatch"
    );
    Ok(p)
}

struct Snapshot {
    account: Account,
    lease: Lease,
    held: i64,
    now: i64,
    genesis_expires_ms: i64,
}

async fn lock_snapshot(conn: &mut PgConnection, p: &Preflight) -> Result<Snapshot> {
    let node = p.node_id;
    // Match the actual account-first, lease-second transaction order.
    sqlx::query("SET LOCAL synchronous_commit TO on")
        .execute(&mut *conn)
        .await?;
    let account: Account = sqlx::query_as(
        "SELECT limit_bytes,settled_bytes,observed_floor_bytes,closed
           FROM quota_v2_accounts WHERE user_id=$1 AND epoch=$2::uuid FOR UPDATE",
    )
    .bind(p.user_id)
    .bind(&p.epoch)
    .fetch_one(&mut *conn)
    .await?;
    let lease: Lease = sqlx::query_as(
        "SELECT reservation_id::text,revision,node_confirmed,acknowledged_bytes,
              ceiling_bytes,(EXTRACT(EPOCH FROM valid_until)*1000)::bigint AS valid_until_ms,
              conservative_burn_floor_bytes,
              (EXTRACT(EPOCH FROM conservative_burned_at)*1000)::bigint AS conservative_burned_at
         FROM quota_v2_reservations
         WHERE user_id=$1 AND epoch=$2::uuid AND node_id=$3
           AND meter_epoch=$4::uuid FOR UPDATE",
    )
    .bind(p.user_id)
    .bind(&p.epoch)
    .bind(node)
    .bind(&p.meter_epoch)
    .fetch_one(&mut *conn)
    .await?;
    let genesis: Genesis = sqlx::query_as(
        "SELECT first_activation_sha256,runtime_id,prepared_ms,challenge,
                receipt_signature,policy_path_used
           FROM quota_v2_xray_genesis WHERE node_id=$1 FOR SHARE",
    )
    .bind(node)
    .fetch_one(&mut *conn)
    .await?;
    let active: (String, Vec<u8>) =
        sqlx::query_as("SELECT state,receipt_sha256 FROM node_xsp_product_nodes WHERE node_id=$1")
            .bind(node)
            .fetch_one(&mut *conn)
            .await?;
    ensure!(
        active.0 == "active" && hex::encode(active.1) == p.first_activation_sha256,
        "only active exact first activation may issue"
    );
    let held:i64=sqlx::query_scalar(
        "SELECT COALESCE(SUM(GREATEST(
            r.ceiling_bytes::numeric-GREATEST(r.acknowledged_bytes,r.conservative_burn_floor_bytes),0
        )),0)::bigint FROM quota_v2_reservations AS r
        WHERE r.user_id=$1 AND r.epoch=$2::uuid")
        .bind(p.user_id).bind(&p.epoch).fetch_one(&mut *conn).await?;
    let blocked = has_revocation_or_old_debt(conn, p).await?;
    let now: i64 =
        sqlx::query_scalar("SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint")
            .fetch_one(&mut *conn)
            .await?;

    ensure!(
        !account.closed
            && !blocked
            && lease.node_confirmed
            && !genesis.policy_path_used
            && lease.conservative_burn_floor_bytes == 0
            && lease.conservative_burned_at.is_none()
            && lease.reservation_id == p.reservation_id
            && lease.revision == p.revision
            && lease.acknowledged_bytes == p.acknowledged_bytes
            && lease.ceiling_bytes == p.ceiling_bytes
            && p.reported_wal_floor_bytes == 0
            && genesis.runtime_id == p.prepared_runtime_id
            && genesis.first_activation_sha256 == p.first_activation_sha256
            && !genesis.receipt_signature.is_empty()
            && !genesis.challenge.is_empty()
            && genesis.prepared_ms <= now
            && now < genesis.prepared_ms.saturating_add(120_000)
            && (i128::from(held)
                + i128::from(account.settled_bytes.max(account.observed_floor_bytes)))
                <= i128::from(account.limit_bytes),
        "stale, unsafe, changed or already spent signed reservation preflight"
    );
    // Prevent the only first-genesis cap from being minted after stage expiry.
    ensure!(
        now < p.expires_ms && now < lease.valid_until_ms,
        "expired SQL/Genesis reservation"
    );

    Ok(Snapshot {
        account,
        lease,
        held,
        now,
        genesis_expires_ms: genesis.prepared_ms.saturating_add(120_000),
    })
}

async fn has_revocation_or_old_debt(conn: &mut PgConnection, p: &Preflight) -> Result<bool> {
    let revoked: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM quota_v2_revocation_requests
          WHERE user_id=$1 AND epoch=$2::uuid AND node_id=$3 AND
           meter_epoch=$4::uuid AND reservation_id=$5::uuid)",
    )
    .bind(p.user_id)
    .bind(&p.epoch)
    .bind(p.node_id)
    .bind(&p.meter_epoch)
    .bind(&p.reservation_id)
    .fetch_one(&mut *conn)
    .await?;
    let old_epoch_debt: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM quota_v2_reservations r
           JOIN quota_v2_accounts a USING(user_id,epoch)
          WHERE r.user_id=$1 AND a.closed
            AND r.ceiling_bytes>GREATEST(
                 r.acknowledged_bytes,r.conservative_burn_floor_bytes))",
    )
    .bind(p.user_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(revoked || old_epoch_debt)
}

fn signing_input(
    p: Preflight,
    account: &Account,
    lease: &Lease,
    held: i64,
    now: i64,
    genesis_expires_ms: i64,
    installed_scope: Option<Vec<Alias>>,
) -> Result<SqlSnapshot> {
    // For NEW issuance, the immutable preflight must still match the
    // account-wide snapshot. For an ALREADY fsynced outbox replay, other
    // Nodes are allowed to reserve more of the still-conserved account
    // budget; such a legitimate concurrent reservation must not make the
    // original byte-identical reply permanently inaccessible.
    ensure!(
        account.limit_bytes == p.account_limit_bytes
            && account.settled_bytes.max(account.observed_floor_bytes) == p.account_floor_bytes
            && held == p.all_node_held_bytes,
        "shared quota snapshot changed before FIRST signed cap issuance"
    );
    // Do NOT derive positive capacity from user-supplied counters.
    // SQL's existing immutable lease and independently staged Node are the
    // budget source; synthetic inbound membership is fixed by CI only.
    let until = (now + 3_600_000).min(lease.valid_until_ms);
    let install_before = (now + 60_000).min(p.expires_ms).min(genesis_expires_ms);
    let cdn_ceiling = installed_scope.as_ref().map_or(150.min(lease.ceiling_bytes), |aliases| {
        if aliases.iter().any(|a| a.class == "cdn") { lease.ceiling_bytes } else { 0 }
    });
    Ok(SqlSnapshot {
        user_id: p.user_id,
        node_id: p.node_id,
        activation_sha: p.first_activation_sha256,
        runtime_id: p.prepared_runtime_id,
        policy_sha: p.reported_policy_sha256,
        account_epoch: p.epoch,
        meter_epoch: p.meter_epoch,
        reservation_id: p.reservation_id,
        revision: p.revision,
        nonce: p.request_challenge,
        original_inventory_head: "0".repeat(64),
        acknowledged: lease.acknowledged_bytes,
        measured_wal: p.reported_wal_floor_bytes,
        measured_cdn_wal: 0,
        ceiling: lease.ceiling_bytes,
        node_ceiling: lease.ceiling_bytes,
        cdn_ceiling,
        shared_account_limit: account.limit_bytes,
        shared_account_floor: account.settled_bytes.max(account.observed_floor_bytes),
        all_node_held: held,
        sql_preflight_expires_ms: p.expires_ms,
        lease_expires_ms: lease.valid_until_ms,
        issued_at_ms: now - 1000,
        install_before_ms: install_before,
        valid_until_ms: until,
        aliases: installed_scope.unwrap_or_else(|| vec![
            Alias {
                email: "xmesh-u101--vless-cdn".into(),
                class: "cdn".into(),
            },
            Alias {
                email: "xmesh-u101--vless-main".into(),
                class: "main".into(),
            },
        ]),
    })
}

async fn persist_cap(
    conn: &mut PgConnection,
    key_path: &Path,
    signing: &SqlSnapshot,
    now: i64,
) -> Result<(Vec<u8>, String, i64)> {
    let signer = node_policy::PolicySigner::load(key_path)
        .context("load disposable exact Nexus PolicySigner")?;
    let bytes = sign_snapshot(&signer, signing, now)?;
    let public = signer.public_key();
    // The SQL function RECHECKS the locked first-Genesis lease, all held
    // reservations, the immutable source and the signed envelope's critical
    // byte/time/scope fields. PostgreSQL WAL fsync must complete BEFORE the
    // caller receives the exact positive spending grant bytes.
    let saved: (Vec<u8>, String, i64) = sqlx::query_as(
        "SELECT signed_envelope,signer_public_key,grant_bytes
           FROM quota_v2_store_signed_first_cap($1,$2,$3,$4)",
    )
    .bind(signing.node_id)
    .bind(&signing.nonce)
    .bind(&public)
    .bind(&bytes)
    .fetch_one(conn)
    .await?;
    ensure!(
        saved.0 == bytes && saved.1 == public && saved.2 == signing.ceiling,
        "signed-cap outbox failed exact-byte persistence check"
    );
    Ok(saved)
}

fn print_cap(node: i64, saved: (Vec<u8>, String, i64)) -> Result<()> {
    println!(
        "{}",
        json!({
            "nodeId":node,"ceiling":saved.2,
            "signedEnvelope":String::from_utf8(saved.0).map_err(|_|anyhow!("non-utf8 cap"))?,
            "publicKeyHex":saved.1,
            "phase":"sql-committed-nexus-policy-signer-disposable"
        })
    );
    Ok(())
}
