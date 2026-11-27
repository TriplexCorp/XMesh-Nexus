//! Settle contiguous Xray WAL intents as conservative spend against an
//! existing immutable cap. A WAL intent is persisted before network delivery.
use super::{Birth, INDEX_LIMIT, conflict, decode, invalid, lower_hex, sha256, signed};
use crate::{ApiError, AppState, quota_v2_cap_signing};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgConnection;

const BATCH_LIMIT: usize = 64 * 1024;
pub(super) const CHARGE_DOMAIN: &[u8] = b"XMESH_QUOTA_V2_WAL_CHARGE_V1\0";
const ZERO_DIGEST: &str = "0000000000000000000000000000000000000000000000000000000000000000";

// Field order matches the Xray WAL encoding and its hash input.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Step {
    schema_version: u8,
    runtime_id: String,
    email: String,
    direction: String,
    sequence: i64,
    previous_bytes: i64,
    next_bytes: i64,
    previous_digest: String,
    digest: String,
}

#[derive(sqlx::FromRow)]
struct Cap {
    user_id: i64,
    epoch: String,
    meter_epoch: String,
    runtime_id: String,
    grant_bytes: i64,
    signed_envelope: Vec<u8>,
    successor: bool,
}

#[derive(sqlx::FromRow)]
struct Cursor {
    last_sequence: i64,
    last_digest: String,
    stream_bytes: i64,
}

fn verify_batch(raw: &[u8], birth: &Birth, cursor: Option<&Cursor>) -> Result<Cursor, ApiError> {
    let lines = raw.strip_suffix(b"\n").ok_or_else(invalid)?;
    let (mut sequence, mut total, mut previous) = cursor.map_or_else(
        || (0, 0, ZERO_DIGEST.to_owned()),
        |head| {
            (
                head.last_sequence,
                head.stream_bytes,
                head.last_digest.clone(),
            )
        },
    );
    for line in lines.split(|b| *b == b'\n') {
        if line.is_empty() || line.len() > 1024 {
            return Err(invalid());
        }
        let mut step: Step = serde_json::from_slice(line).map_err(|_| invalid())?;
        if step.schema_version != 1
            || step.runtime_id != birth.runtime_id
            || step.email != birth.email
            || step.direction != birth.direction
            || step.sequence.checked_sub(1) != Some(sequence)
            || step.previous_bytes != total
            || step.next_bytes <= total
            || step.previous_digest != previous
            || serde_json::to_vec(&step).map_err(|_| invalid())? != line
        {
            return Err(conflict());
        }
        let digest = std::mem::take(&mut step.digest);
        let mut canonical = serde_json::to_vec(&step).map_err(|_| invalid())?;
        canonical.push(b'\n');
        if sha256(&canonical) != digest || (sequence == 0 && digest != birth.first_wal_digest) {
            return Err(conflict());
        }
        sequence = step.sequence;
        total = step.next_bytes;
        previous = digest;
    }
    Ok(Cursor {
        last_sequence: sequence,
        last_digest: previous,
        stream_bytes: total,
    })
}

async fn lock_account(
    conn: &mut PgConnection,
    node_id: i64,
    reservation: &str,
) -> Result<Cap, ApiError> {
    let initial = sqlx::query_as::<_, Cap>(
        "SELECT user_id, epoch::text, meter_epoch::text, runtime_id, grant_bytes, signed_envelope,
                false AS successor
           FROM quota_v2_signed_first_cap_outbox WHERE node_id=$1 AND reservation_id=$2::uuid",
    )
    .bind(node_id)
    .bind(reservation)
    .fetch_optional(&mut *conn)
    .await?;
    let from_first_genesis = initial.is_some();
    // The successor is an entirely NEW metered Xray process, not a
    // relabeled old-cap lease. Late old WAL must still select its original
    // signed outbox and cannot be charged under the new reservation ID.
    let mut cap = match initial {
        Some(cap) => cap,
        None => sqlx::query_as::<_, Cap>(
            "SELECT user_id, account_epoch::text AS epoch,
                    meter_epoch::text, fresh_runtime_id AS runtime_id,
                    grant_bytes, signed_envelope, true AS successor
             FROM quota_v2_calendar_successor_positive_caps
             WHERE node_id=$1 AND reservation_id=$2::uuid",
        )
        .bind(node_id)
        .bind(reservation)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(conflict)?,
    };

    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(cap.user_id ^ 0x51_4D_45_53_48_i64)
        .execute(&mut *conn)
        .await?;
    sqlx::query("SELECT 1 FROM quota_v2_accounts WHERE user_id=$1 AND epoch=$2::uuid FOR UPDATE")
        .bind(cap.user_id)
        .bind(&cap.epoch)
        .fetch_one(&mut *conn)
        .await?;
    // There is no successor renewal protocol yet. The legacy renewal
    // table is permanently forbidden from mixing with this new WAL epoch.
    if from_first_genesis
        && let Some((ceiling, envelope)) = sqlx::query_as::<_, (i64, Vec<u8>)>(
            "SELECT grant_bytes,signed_envelope FROM quota_v2_cap_renewals
             WHERE reservation_id=$1::uuid ORDER BY revision DESC LIMIT 1",
        )
        .bind(reservation)
        .fetch_optional(conn)
        .await?
    {
        cap.grant_bytes = ceiling;
        cap.signed_envelope = envelope;
    }
    Ok(cap)
}

fn cap_cdn_ceiling(
    state: &AppState,
    cap: &Cap,
    birth: &Birth,
    activation: &str,
    node_id: i64,
    reservation: &str,
) -> Result<(bool, i64), ApiError> {
    let doc: Value = serde_json::from_slice(&cap.signed_envelope).map_err(|_| conflict())?;
    let payload = &doc["payload"];
    let signature = state
        .node_policy_signer
        .sign_domain(quota_v2_cap_signing::DOMAIN, payload)
        .map_err(|_| conflict())?;
    if doc["algorithm"] != "Ed25519"
        || doc["signature"] != signature
        || !matches!(
            payload["kind"].as_str(),
            Some("xmesh.quota-v2.xray-cap-admission" | "xmesh.quota-v2.xray-cap-renewal")
        )
        || payload["activationReceiptSha256"] != activation
        || payload["runtimeId"] != cap.runtime_id
        || payload["nodeId"] != node_id
        || payload["userId"] != cap.user_id
        || payload["reservationId"] != reservation
        || payload["accountEpoch"] != cap.epoch
        || payload["meterEpoch"] != cap.meter_epoch
        || payload["sharedCeilingBytes"] != cap.grant_bytes
        || birth.runtime_id != cap.runtime_id
    {
        return Err(conflict());
    }
    let alias = payload["aliasScopes"]
        .as_array()
        .and_then(|aliases| aliases.iter().find(|a| a["email"] == birth.email))
        .ok_or_else(conflict)?;
    let is_cdn = match alias["class"].as_str() {
        Some("main") => false,
        Some("cdn") => true,
        _ => return Err(conflict()),
    };
    let cdn_ceiling = payload["cdnCeilingBytes"].as_i64().ok_or_else(conflict)?;
    Ok((is_cdn, cdn_ceiling))
}

#[derive(sqlx::FromRow)]
struct Lease {
    ceiling: i64,
    acknowledged: i64,
    charge_floor: i64,
}

async fn load_anchored_birth(
    conn: &mut PgConnection,
    node_id: i64,
    activation: &str,
    filename: &str,
    runtime: Option<&str>,
) -> Result<Birth, ApiError> {
    let still_enrolled = sqlx::query_scalar::<_, i32>(
        "SELECT 1 FROM node_xsp_product_nodes p
         JOIN node_xsp_public_keysets k ON k.node_id=p.node_id
              AND k.purpose='node_request' AND k.key_epoch=p.key_epoch
              AND k.ed25519_key_id=p.ed25519_key_id AND k.mldsa65_key_id=p.mldsa65_key_id
              AND k.revoked_at IS NULL
         JOIN panel_records n ON n.collection='nodes' AND n.id=p.node_id
         WHERE p.node_id=$1 AND p.state='active' AND encode(p.receipt_sha256,'hex')=$2
         AND (n.data->'disabled') IS DISTINCT FROM 'true'::jsonb
         FOR SHARE OF p,k,n",
    )
    .bind(node_id)
    .bind(activation)
    .fetch_optional(&mut *conn)
    .await?;
    if still_enrolled.is_none() {
        return Err(conflict());
    }
    let index: Vec<u8> = if let Some(runtime) = runtime {
        sqlx::query_scalar(
            "SELECT inventory_bytes FROM quota_v2_runtime_wal_anchors
             WHERE node_id=$1 AND runtime_id=$2 ORDER BY inventory_sequence DESC LIMIT 1",
        )
        .bind(node_id)
        .bind(runtime)
        .fetch_optional(conn)
        .await?
    } else {
        sqlx::query_scalar(
            "SELECT inventory_bytes FROM quota_v2_external_wal_birth_anchors
         WHERE node_id=$1 ORDER BY inventory_sequence DESC LIMIT 1",
        )
        .bind(node_id)
        .fetch_optional(&mut *conn)
        .await?
    }
    .ok_or_else(conflict)?;
    if index.len() > INDEX_LIMIT {
        return Err(conflict());
    }
    // The immutable anchor is produced only after the authenticated index's
    // sequence, hash chain and canonical filenames have been verified.
    index
        .split(|b| *b == b'\n')
        .filter_map(|line| serde_json::from_slice::<Birth>(line).ok())
        .find(|entry| entry.filename == filename)
        .ok_or_else(conflict)
}

async fn apply_conservative_floor(
    conn: &mut PgConnection,
    cap: &Cap,
    lease: &Lease,
    reservation: &str,
    total: i64,
) -> Result<(), ApiError> {
    let already_charged = lease.acknowledged.max(lease.charge_floor);
    if total > already_charged {
        // Advance the conservative floor, leaving confirmed delivery counters
        // intact. The same amount moves from held reserve to settled spend.
        // An unrelated telemetry floor above settled spend is ambiguous.
        let changed = sqlx::query(
            "UPDATE quota_v2_accounts SET settled_bytes=settled_bytes+$3
             WHERE user_id=$1 AND epoch=$2::uuid AND observed_floor_bytes<=settled_bytes",
        )
        .bind(cap.user_id)
        .bind(&cap.epoch)
        .bind(total - already_charged)
        .execute(&mut *conn)
        .await?;
        if changed.rows_affected() != 1 {
            return Err(conflict());
        }
        sqlx::query(
            "UPDATE quota_v2_reservations SET conservative_burn_floor_bytes=$2
             WHERE reservation_id=$1::uuid",
        )
        .bind(reservation)
        .bind(total)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

pub async fn committed_charge_totals(
    conn: &mut PgConnection,
    reservation: &str,
) -> Result<(i64, i64), ApiError> {
    sqlx::query_as(
        "SELECT COALESCE(SUM(stream_bytes),0)::bigint,
                COALESCE(SUM(stream_bytes) FILTER (WHERE is_cdn),0)::bigint
         FROM (SELECT DISTINCT ON (filename) stream_bytes, is_cdn
                 FROM quota_v2_wal_charges WHERE reservation_id=$1::uuid
                 ORDER BY filename,first_sequence DESC) heads",
    )
    .bind(reservation)
    .fetch_one(conn)
    .await
    .map_err(ApiError::from)
}

async fn reservation_totals(
    conn: &mut PgConnection,
    reservation: &str,
    previous: Option<&Cursor>,
    head: &Cursor,
    is_cdn: bool,
) -> Result<(i64, i64), ApiError> {
    let (prior_total, prior_cdn) = committed_charge_totals(conn, reservation).await?;
    let delta = head.stream_bytes - previous.map_or(0, |p| p.stream_bytes);
    let total = prior_total.checked_add(delta).ok_or_else(conflict)?;
    let cdn = prior_cdn
        .checked_add(if is_cdn { delta } else { 0 })
        .ok_or_else(conflict)?;
    Ok((total, cdn))
}

fn validate_charge_request(
    reservation: &str,
    filename: &str,
    journal: &str,
) -> Result<(Vec<u8>, Step), ApiError> {
    if !filename
        .strip_prefix("meter-")
        .and_then(|s| s.strip_suffix(".jsonl"))
        .is_some_and(|digest| lower_hex(digest, 64))
        || !uuid::Uuid::parse_str(reservation).is_ok_and(|id| id.to_string() == reservation)
    {
        return Err(invalid());
    }
    let raw = decode(journal, BATCH_LIMIT)?;
    let first: Step = raw
        .split(|b| *b == b'\n')
        .next()
        .filter(|line| line.len() <= 1024)
        .and_then(|line| serde_json::from_slice(line).ok())
        .ok_or_else(invalid)?;
    if first.sequence <= 0 {
        return Err(invalid());
    }
    Ok((raw, first))
}

async fn previous_charge_receipt(
    conn: &mut PgConnection,
    reservation: &str,
    filename: &str,
    first_sequence: i64,
    raw: &[u8],
) -> Result<Option<Vec<u8>>, ApiError> {
    let replay: Option<(Vec<u8>, Vec<u8>)> = sqlx::query_as(
        "SELECT journal,signed_receipt FROM quota_v2_wal_charges
         WHERE reservation_id=$1::uuid AND filename=$2 AND first_sequence=$3",
    )
    .bind(reservation)
    .bind(filename)
    .bind(first_sequence)
    .fetch_optional(conn)
    .await?;
    if let Some((saved, receipt)) = replay {
        if raw != saved.as_slice() {
            return Err(conflict());
        }
        return Ok(Some(receipt));
    }
    Ok(None)
}

pub(super) async fn charge(
    state: &AppState,
    node_id: i64,
    activation: &str,
    reservation: &str,
    filename: &str,
    journal: &str,
) -> Result<Value, ApiError> {
    let (raw, first) = validate_charge_request(reservation, filename, journal)?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("SET LOCAL synchronous_commit TO on")
        .execute(&mut *tx)
        .await?;
    let cap = lock_account(&mut tx, node_id, reservation).await?;
    let lease = sqlx::query_as::<_, Lease>(
        "SELECT ceiling_bytes AS ceiling,acknowledged_bytes AS acknowledged,
                conservative_burn_floor_bytes AS charge_floor
           FROM quota_v2_reservations WHERE reservation_id=$1::uuid AND node_id=$2 FOR UPDATE",
    )
    .bind(reservation)
    .bind(node_id)
    .fetch_one(&mut *tx)
    .await?;
    let birth = load_anchored_birth(
        &mut tx,
        node_id,
        activation,
        filename,
        cap.successor.then_some(cap.runtime_id.as_str()),
    )
    .await?;
    let (is_cdn, cdn_ceiling) =
        cap_cdn_ceiling(state, &cap, &birth, activation, node_id, reservation)?;
    // Charge transactions may arrive after Xray has stopped at the
    // boundary. Persist that observation without refusing old debt.
    crate::quota_v2_cap_delivery::observe_closed_calendars(
        &mut tx,
        cap.user_id,
        node_id,
        &cap.epoch,
    )
    .await?;
    if let Some(receipt) =
        previous_charge_receipt(&mut tx, reservation, filename, first.sequence, &raw).await?
    {
        tx.commit().await?;
        return Ok(json!({"receipt":STANDARD.encode(receipt)}));
    }
    let previous = sqlx::query_as::<_, Cursor>(
        "SELECT last_sequence,last_digest,stream_bytes FROM quota_v2_wal_charges
         WHERE reservation_id=$1::uuid AND filename=$2 ORDER BY first_sequence DESC LIMIT 1",
    )
    .bind(reservation)
    .bind(filename)
    .fetch_optional(&mut *tx)
    .await?;
    let head = verify_batch(&raw, &birth, previous.as_ref())?;
    let (total, cdn) =
        reservation_totals(&mut tx, reservation, previous.as_ref(), &head, is_cdn).await?;
    if total > cap.grant_bytes.min(lease.ceiling) || cdn > cdn_ceiling {
        return Err(conflict());
    }

    apply_conservative_floor(&mut tx, &cap, &lease, reservation, total).await?;
    let receipt = signed(
        &state.node_policy_signer,
        CHARGE_DOMAIN,
        &json!({
            "schemaVersion":1, "kind":"xmesh.quota-v2.wal-intent-charge", "nodeId":node_id,
            "userId":cap.user_id, "reservationId":reservation, "runtimeId":cap.runtime_id,
            "filename":filename, "firstSequence":first.sequence, "lastSequence":head.last_sequence,
            "lastDigest":head.last_digest, "journalSha256":sha256(&raw),
            "streamBytes":head.stream_bytes, "conservativeWalBytes":total, "conservativeCdnWalBytes":cdn,
            "canResume":false, "finalMeterVerified":false, "refundableBytes":0,
        }),
    )?;
    sqlx::query(
        "INSERT INTO quota_v2_wal_charges(reservation_id,filename,first_sequence,last_sequence,
                         last_digest,stream_bytes,is_cdn,journal,signed_receipt)
         VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(reservation)
    .bind(filename)
    .bind(first.sequence)
    .bind(head.last_sequence)
    .bind(&head.last_digest)
    .bind(head.stream_bytes)
    .bind(is_cdn)
    .bind(&raw)
    .bind(&receipt)
    .execute(&mut *tx)
    .await
    .map_err(|error| {
        if error.as_database_error().and_then(|err| err.constraint())
            == Some("quota_v2_wal_charge_stream_owner")
        {
            conflict()
        } else {
            error.into()
        }
    })?;
    tx.commit().await?;
    Ok(json!({"receipt":STANDARD.encode(receipt)}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(
        birth: &Birth,
        sequence: i64,
        previous_bytes: i64,
        previous_digest: &str,
    ) -> (Vec<u8>, String) {
        let mut step = Step {
            schema_version: 1,
            runtime_id: birth.runtime_id.clone(),
            email: birth.email.clone(),
            direction: birth.direction.clone(),
            sequence,
            previous_bytes,
            next_bytes: previous_bytes + 17,
            previous_digest: previous_digest.to_owned(),
            digest: String::new(),
        };
        let mut message = serde_json::to_vec(&step).unwrap();
        message.push(b'\n');
        step.digest = sha256(&message);
        let mut record = serde_json::to_vec(&step).unwrap();
        record.push(b'\n');
        (record, step.digest)
    }

    #[test]
    fn accepts_only_canonical_contiguous_wal_intents_with_matching_birth() {
        let mut birth = Birth {
            schema_version: 1,
            sequence: 1,
            filename: String::new(),
            runtime_id: "a".repeat(64),
            email: "xmesh-u19--main".into(),
            direction: "uplink".into(),
            first_wal_digest: String::new(),
            previous_digest: ZERO_DIGEST.into(),
            digest: String::new(),
        };
        let (first, digest) = line(&birth, 1, 0, ZERO_DIGEST);
        assert!(verify_batch(&first, &birth, None).is_err());
        birth.first_wal_digest.clone_from(&digest);
        let cursor = verify_batch(&first, &birth, None).unwrap();
        assert_eq!(cursor.stream_bytes, 17);

        let (second, _) = line(&birth, 2, 17, &digest);
        let head = verify_batch(&second, &birth, Some(&cursor)).unwrap();
        assert_eq!(head.stream_bytes, 34);
        assert_eq!(head.last_sequence, 2);
        assert!(verify_batch(&second, &birth, None).is_err());
        assert!(verify_batch(&first, &birth, Some(&head)).is_err());
        assert!(verify_batch(&second[..second.len() - 1], &birth, Some(&cursor)).is_err());
        assert!(verify_batch(&line(&birth, 3, 17, &digest).0, &birth, Some(&cursor)).is_err());
        assert!(verify_batch(&line(&birth, 2, 16, &digest).0, &birth, Some(&cursor)).is_err());
        assert!(verify_batch(&line(&birth, 2, 17, ZERO_DIGEST).0, &birth, Some(&cursor)).is_err());

        let duplicate = [b"{\"schemaVersion\":1,".as_slice(), &second[1..]].concat();
        assert!(verify_batch(&duplicate, &birth, Some(&cursor)).is_err());
        birth.direction = "downlink".into();
        assert!(verify_batch(&second, &birth, Some(&cursor)).is_err());
    }
}
