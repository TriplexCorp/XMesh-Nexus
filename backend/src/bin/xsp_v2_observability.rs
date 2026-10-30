use anyhow::{Context, Result, bail};
use serde::Serialize;
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use std::env;

const GATE: &str = "staging-only";
const SCHEMA: &str = "xsp2-nexus-observability-1";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SuiteState {
    minimum_suite: i32,
    activation_phase: String,
    key_epoch: i64,
    updated_at_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreparationState {
    from_epoch: i64,
    to_epoch: i64,
    ed25519_key_id: String,
    mldsa65_key_id: String,
    proved: bool,
    expires_at_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PermitCounts {
    total: i64,
    issued: i64,
    ack_verified: i64,
    receipt_sent: i64,
    aborted: i64,
    latest_ack_verified_at_ms: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DurableCounts {
    receipt_outbox: i64,
    replay_nonces: i64,
    latest_receipt_at_ms: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentUpdateCounts {
    total: i64,
    pending: i64,
    claimed: i64,
    succeeded: i64,
    failed: i64,
    exact_ack_evidence: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    schema: &'static str,
    node_id: i64,
    suite: Option<SuiteState>,
    preparation: Option<PreparationState>,
    permits: PermitCounts,
    durable: DurableCounts,
    agent_updates: AgentUpdateCounts,
    read_only: bool,
    production_activated: bool,
    strict_pq_enabled: bool,
}

fn parse_node_id() -> Result<i64> {
    let mut args = env::args().skip(1);
    let flag = args
        .next()
        .context("exactly --node-id <positive integer> is required")?;
    if flag != "--node-id" {
        bail!("exactly --node-id <positive integer> is required");
    }
    let raw = args
        .next()
        .context("exactly --node-id <positive integer> is required")?;
    if args.next().is_some() {
        bail!("exactly --node-id <positive integer> is required");
    }
    let node_id: i64 = raw.parse().context("node id must be a positive integer")?;
    if node_id <= 0 {
        bail!("node id must be a positive integer");
    }
    Ok(node_id)
}

async fn collect(pool: &PgPool, node_id: i64) -> Result<Snapshot> {
    let suite = sqlx::query(
        "SELECT minimum_suite::INT AS minimum_suite, activation_phase, key_epoch, \
         (EXTRACT(EPOCH FROM updated_at) * 1000)::BIGINT AS updated_at_ms \
         FROM node_xsp_suite_state WHERE node_id=$1",
    )
    .bind(node_id)
    .fetch_optional(pool)
    .await
    .context("read suite state")?
    .map(|row| -> Result<SuiteState, sqlx::Error> {
        Ok(SuiteState {
            minimum_suite: row.try_get("minimum_suite")?,
            activation_phase: row.try_get("activation_phase")?,
            key_epoch: row.try_get("key_epoch")?,
            updated_at_ms: row.try_get("updated_at_ms")?,
        })
    })
    .transpose()
    .context("decode suite state")?;

    let preparation = sqlx::query(
        "SELECT from_epoch, to_epoch, ed25519_key_id, mldsa65_key_id, \
         (proved_at IS NOT NULL) AS proved, \
         (EXTRACT(EPOCH FROM expires_at) * 1000)::BIGINT AS expires_at_ms \
         FROM node_xsp_rotation_preparations WHERE node_id=$1 AND purpose='node_request'",
    )
    .bind(node_id)
    .fetch_optional(pool)
    .await
    .context("read rotation preparation")?
    .map(|row| -> Result<PreparationState, sqlx::Error> {
        Ok(PreparationState {
            from_epoch: row.try_get("from_epoch")?,
            to_epoch: row.try_get("to_epoch")?,
            ed25519_key_id: row.try_get("ed25519_key_id")?,
            mldsa65_key_id: row.try_get("mldsa65_key_id")?,
            proved: row.try_get("proved")?,
            expires_at_ms: row.try_get("expires_at_ms")?,
        })
    })
    .transpose()
    .context("decode rotation preparation")?;

    let permit_row = sqlx::query(
        "SELECT COUNT(*)::BIGINT AS total, \
         COUNT(*) FILTER (WHERE state='issued')::BIGINT AS issued, \
         COUNT(*) FILTER (WHERE state='ack_verified')::BIGINT AS ack_verified, \
         COUNT(*) FILTER (WHERE state='receipt_sent')::BIGINT AS receipt_sent, \
         COUNT(*) FILTER (WHERE state='aborted')::BIGINT AS aborted, \
         (EXTRACT(EPOCH FROM MAX(ack_verified_at)) * 1000)::BIGINT AS latest_ack_verified_at_ms \
         FROM node_xsp_cutover_permit_ledger WHERE node_id=$1",
    )
    .bind(node_id)
    .fetch_one(pool)
    .await
    .context("read permit counts")?;
    let permits = PermitCounts {
        total: permit_row.try_get("total")?,
        issued: permit_row.try_get("issued")?,
        ack_verified: permit_row.try_get("ack_verified")?,
        receipt_sent: permit_row.try_get("receipt_sent")?,
        aborted: permit_row.try_get("aborted")?,
        latest_ack_verified_at_ms: permit_row.try_get("latest_ack_verified_at_ms")?,
    };

    let durable_row = sqlx::query(
        "SELECT \
         (SELECT COUNT(*)::BIGINT FROM node_xsp_signed_commit_receipt_outbox WHERE node_id=$1) AS receipt_outbox, \
         (SELECT COUNT(*)::BIGINT FROM node_xsp_replay_nonces WHERE node_id=$1) AS replay_nonces, \
         (SELECT (EXTRACT(EPOCH FROM MAX(created_at)) * 1000)::BIGINT \
            FROM node_xsp_signed_commit_receipt_outbox WHERE node_id=$1) AS latest_receipt_at_ms",
    )
    .bind(node_id)
    .fetch_one(pool)
    .await
    .context("read durable counts")?;
    let durable = DurableCounts {
        receipt_outbox: durable_row.try_get("receipt_outbox")?,
        replay_nonces: durable_row.try_get("replay_nonces")?,
        latest_receipt_at_ms: durable_row.try_get("latest_receipt_at_ms")?,
    };

    let update_row = sqlx::query(
        "SELECT COUNT(*)::BIGINT AS total, \
         COUNT(*) FILTER (WHERE state='pending')::BIGINT AS pending, \
         COUNT(*) FILTER (WHERE state='claimed')::BIGINT AS claimed, \
         COUNT(*) FILTER (WHERE state='succeeded')::BIGINT AS succeeded, \
         COUNT(*) FILTER (WHERE state='failed')::BIGINT AS failed, \
         COUNT(*) FILTER (WHERE release_ack_received_at IS NOT NULL)::BIGINT AS exact_ack_evidence \
         FROM node_restart_commands \
         WHERE node_id=$1 AND action='update_agent' AND release_manifest_id IS NOT NULL",
    )
    .bind(node_id)
    .fetch_one(pool)
    .await
    .context("read bound Agent update counts")?;
    let agent_updates = AgentUpdateCounts {
        total: update_row.try_get("total")?,
        pending: update_row.try_get("pending")?,
        claimed: update_row.try_get("claimed")?,
        succeeded: update_row.try_get("succeeded")?,
        failed: update_row.try_get("failed")?,
        exact_ack_evidence: update_row.try_get("exact_ack_evidence")?,
    };

    Ok(Snapshot {
        schema: SCHEMA,
        node_id,
        suite,
        preparation,
        permits,
        durable,
        agent_updates,
        read_only: true,
        production_activated: false,
        strict_pq_enabled: false,
    })
}

async fn run() -> Result<()> {
    let node_id = parse_node_id()?;
    if env::var("XSP_V2_OBSERVABILITY").ok().as_deref() != Some(GATE) {
        bail!("XSP_V2_OBSERVABILITY must equal staging-only");
    }
    let database_url = env::var("DATABASE_URL").context("DATABASE_URL is required")?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .context("connect PostgreSQL")?;
    let snapshot = collect(&pool, node_id).await?;
    serde_json::to_writer(std::io::stdout(), &snapshot).context("encode observability JSON")?;
    println!();
    Ok(())
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}
