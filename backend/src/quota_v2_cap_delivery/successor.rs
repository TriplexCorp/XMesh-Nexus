//! Signed, zero-authority calendar successor preparation over enrolled XSP/2.
//!
//! Does NOT allocate a new spending reserve. Reusing the old Xray WAL stream
//! in a fresh lease would misattribute late writes to the new period. This
//! stage records only a durable successor identity after the old calendar
//! has permanently closed. A separate meter/runtime proof and signed spend
//! grant are still required before traffic can resume.
use super::{Request, database_now_ms, deny, lock_open_account, lock_signed_user};
use crate::{ApiError, AppState};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Row};

pub(super) const DOMAIN: &[u8] = b"XMESH_QUOTA_V2_CALENDAR_SUCCESSOR_V1\0";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RequestFields {
    pub(super) predecessor_id: String,
}

#[derive(sqlx::FromRow)]
struct Previous {
    predecessor_id: String,
    account_epoch: String,
    meter_epoch: String,
    predecessor_runtime_id: String,
    policy_sha256: String,
    valid_until_ms: i64,
}

fn canonical_predecessor(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|parsed| parsed.to_string() == id)
}

fn expected_challenge(predecessor: &str) -> String {
    let message = format!("XMESH_QUOTA_V2_CALENDAR_SUCCESSOR_REQUEST_V1\0{predecessor}");
    format!("{:x}", Sha256::digest(message.as_bytes()))
}

fn valid_archived_preparation_lifetime(payload: &Value, predecessor_end: i64, now: i64) -> bool {
    let (Some(issued), Some(expires)) = (
        payload["issuedAtMs"].as_i64(),
        payload["validUntilMs"].as_i64(),
    ) else {
        return false;
    };
    // The prepared stage has ZERO spending authority. Its exact historical
    // identity survives a lost reply even if the clock passes its deadline.
    // A future positive grant still requires fresh, separate proof.
    issued >= predecessor_end
        && issued <= now
        && expires > issued
        && expires <= issued.saturating_add(120_000)
}

fn verified_saved(
    state: &AppState,
    raw: &[u8],
    req: &Request,
    previous: &Previous,
    activation: &str,
    now: i64,
) -> Result<String, ApiError> {
    let doc: Value = serde_json::from_slice(raw).map_err(|_| deny())?;
    let p = &doc["payload"];
    if serde_json::to_vec(&doc).map_err(|_| deny())? != raw
        || doc["algorithm"] != "Ed25519"
        || doc["signature"].as_str()
            != Some(
                state
                    .node_policy_signer
                    .sign_domain(DOMAIN, p)
                    .map_err(|_| deny())?
                    .as_str(),
            )
        || p["schemaVersion"] != 1
        || p["kind"] != "xmesh.quota-v2.calendar-successor-prepared"
        || p["nodeId"] != req.node_id
        || p["userId"] != req.user_id
        || p["nonce"] != req.challenge
        || p["activationReceiptSha256"] != activation
        || p["policySha256"] != previous.policy_sha256
        || p["predecessorRuntimeId"] != previous.predecessor_runtime_id
        || p["predecessorId"] != previous.predecessor_id
        || p["accountEpoch"] != previous.account_epoch
        || p["authorizedBytes"] != 0
        || p["canSpend"] != false
        || p["canStart"] != false
        || p["canResume"] != false
        || p["finalMeterVerified"] != false
        || p["refundableBytes"] != 0
        || p["meterEpoch"] == previous.meter_epoch
        || p["reservationId"] == previous.predecessor_id
        || p["reservationId"] == p["meterEpoch"]
        || !valid_archived_preparation_lifetime(p, previous.valid_until_ms, now)
    {
        return Err(deny());
    }
    String::from_utf8(raw.to_vec()).map_err(|_| deny())
}

async fn original_predecessor(
    conn: &mut PgConnection,
    req: &Request,
    activation: &str,
    public_key: &str,
    now: i64,
) -> Result<Previous, ApiError> {
    sqlx::query_as::<_, Previous>(
        "SELECT f.reservation_id::text AS predecessor_id,
                f.epoch::text AS account_epoch,
                f.meter_epoch::text AS meter_epoch,
                f.runtime_id AS predecessor_runtime_id,
                f.policy_sha256,f.valid_until_ms
         FROM quota_v2_wal_admission_caps f
         JOIN quota_v2_reservations r ON r.reservation_id=f.reservation_id
              AND r.node_id=f.node_id AND r.user_id=f.user_id
              AND r.epoch=f.epoch AND r.meter_epoch=f.meter_epoch
         JOIN quota_v2_calendar_closures c ON c.reservation_id=r.reservation_id
         JOIN quota_v2_genesis_quarantine_policies q ON q.node_id=f.node_id
              AND (q.runtime_id=f.runtime_id OR f.successor)
              AND q.policy_sha256=f.policy_sha256
         JOIN node_xsp_product_nodes p ON p.node_id=f.node_id
              AND p.state='active' AND encode(p.receipt_sha256,'hex')=$4
         JOIN node_xsp_public_keysets k ON k.node_id=p.node_id
              AND k.purpose='node_request' AND k.key_epoch=p.key_epoch
              AND k.ed25519_key_id=p.ed25519_key_id
              AND k.mldsa65_key_id=p.mldsa65_key_id AND k.revoked_at IS NULL
         JOIN panel_records n ON n.id=f.node_id AND n.collection='nodes'
         WHERE f.reservation_id=$1::uuid AND f.node_id=$2 AND f.user_id=$3
           AND f.signer_public_key=$5 AND q.first_activation_sha256=$4
           AND convert_from(f.signed_envelope,'UTF8')::jsonb
               ->'payload'->>'activationReceiptSha256'=$4
           AND r.node_confirmed
           AND (n.data->'disabled') IS DISTINCT FROM 'true'::jsonb
           AND f.valid_until_ms <= $6
           AND c.observed_at >= c.boundary_at
           AND NOT EXISTS (SELECT 1 FROM quota_v2_revocation_requests v
              WHERE v.reservation_id=r.reservation_id)
         FOR SHARE OF r,c,q,p,k,n",
    )
    .bind(
        &req.calendar_successor
            .as_ref()
            .ok_or_else(deny)?
            .predecessor_id,
    )
    .bind(req.node_id)
    .bind(req.user_id)
    .bind(activation)
    .bind(public_key)
    .bind(now)
    .fetch_optional(conn)
    .await?
    .ok_or_else(deny)
}

fn verify_preparation_replay(
    row: &sqlx::postgres::PgRow,
    state: &AppState,
    req: &Request,
    old: &Previous,
    activation: &str,
    signer: &str,
    now: i64,
) -> Result<String, ApiError> {
    let node: i64 = row.try_get("node_id")?;
    let user: i64 = row.try_get("user_id")?;
    let challenge: String = row.try_get("request_challenge")?;
    let public: String = row.try_get("signer_public_key")?;
    let account_epoch: String = row.try_get("account_epoch")?;
    let runtime: String = row.try_get("predecessor_runtime_id")?;
    let policy: String = row.try_get("policy_sha256")?;
    if node != req.node_id
        || user != req.user_id
        || challenge != req.challenge
        || public != signer
        || account_epoch != old.account_epoch
        || runtime != old.predecessor_runtime_id
        || policy != old.policy_sha256
    {
        return Err(deny());
    }
    let raw: Vec<u8> = row.try_get("signed_envelope")?;
    let exact = verified_saved(state, &raw, req, old, activation, now)?;
    // The SQL row and signed immutable bytes must carry the SAME
    // successor identifiers and validity. This guards against any
    // partial/restored outbox state being mistaken for exact replay.
    let saved_envelope: Value = serde_json::from_slice(&raw).map_err(|_| deny())?;
    let payload = &saved_envelope["payload"];
    let meter: String = row.try_get("candidate_meter_epoch")?;
    let reservation: String = row.try_get("candidate_reservation_id")?;
    let issued: i64 = row.try_get("issued_at_ms")?;
    let until: i64 = row.try_get("valid_until_ms")?;
    if payload["meterEpoch"] != meter
        || payload["reservationId"] != reservation
        || payload["issuedAtMs"] != issued
        || payload["validUntilMs"] != until
    {
        return Err(deny());
    }
    Ok(exact)
}

async fn persist_zero_successor_preparation(
    conn: &mut PgConnection,
    state: &AppState,
    req: &Request,
    fields: &RequestFields,
    old: &Previous,
    (signer, earlier_epoch, activation, now): (&str, &str, &str, i64),
) -> Result<String, ApiError> {
    // These are UNFUNDED candidate identifiers, not quota_v2_reservations.
    // Never advertise this receipt as a positive cap or a right to resume.
    let meter = uuid::Uuid::new_v4().to_string();
    let reservation = uuid::Uuid::new_v4().to_string();
    let expires = now.saturating_add(120_000);
    let payload = json!({
        "schemaVersion": 1, "kind": "xmesh.quota-v2.calendar-successor-prepared",
        "nodeId": req.node_id, "userId": req.user_id,
        "nonce": req.challenge, "activationReceiptSha256": activation,
        "policySha256": old.policy_sha256,
        "predecessorRuntimeId": old.predecessor_runtime_id,
        "predecessorId": old.predecessor_id,
        "accountEpoch": old.account_epoch,
        "meterEpoch": meter, "reservationId": reservation,
        "issuedAtMs": now, "validUntilMs": expires,
        "authorizedBytes": 0, "canSpend": false, "canStart": false,
        "canResume": false, "finalMeterVerified": false,
        "refundableBytes": 0
    });
    let signature = state
        .node_policy_signer
        .sign_domain(DOMAIN, &payload)
        .map_err(|_| deny())?;
    let exact = serde_json::to_string(&json!({
        "algorithm": "Ed25519", "payload": payload, "signature": signature
    }))
    .map_err(|_| deny())?;
    if exact.len() > 8192 {
        return Err(deny());
    }
    sqlx::query(
        "INSERT INTO quota_v2_calendar_successor_preparations
         (predecessor_id,node_id,user_id,request_challenge,signer_public_key,
          account_epoch,predecessor_runtime_id,policy_sha256,
          candidate_meter_epoch,candidate_reservation_id,
          issued_at_ms,valid_until_ms,signed_envelope)
         VALUES($1::uuid,$2,$3,$4,$5,$6::uuid,$7,$8,$9::uuid,$10::uuid,$11,$12,$13)",
    )
    .bind(&fields.predecessor_id)
    .bind(req.node_id)
    .bind(req.user_id)
    .bind(&req.challenge)
    .bind(signer)
    .bind(earlier_epoch)
    .bind(&old.predecessor_runtime_id)
    .bind(&old.policy_sha256)
    .bind(&meter)
    .bind(&reservation)
    .bind(now)
    .bind(expires)
    .bind(exact.as_bytes())
    .execute(&mut *conn)
    .await?;
    Ok(exact)
}

pub(super) async fn prepare(
    state: &AppState,
    req: &Request,
    fields: &RequestFields,
    activation: &str,
) -> Result<String, ApiError> {
    if !canonical_predecessor(&fields.predecessor_id)
        || req.challenge != expected_challenge(&fields.predecessor_id)
        || req.measurement.is_some()
        || req.renewal.is_some()
    {
        return Err(deny());
    }
    let mut tx = state.pool.begin().await?;
    lock_signed_user(&mut tx, req.user_id)
        .await?
        .ok_or_else(deny)?;
    let (_open_epoch, _limit, _floor) = lock_open_account(&mut tx, req.user_id).await?;
    let earlier_epoch: String = sqlx::query_scalar(
        "SELECT epoch::text FROM quota_v2_reservations
         WHERE reservation_id=$1::uuid AND node_id=$2 AND user_id=$3",
    )
    .bind(&fields.predecessor_id)
    .bind(req.node_id)
    .bind(req.user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(deny)?;
    // Preserve a crossed calendar boundary even if an operator turns the
    // clock back. Holding the per-user allocator lock serializes issuance.
    super::observe_closed_calendars(&mut tx, req.user_id, req.node_id, &earlier_epoch).await?;
    // A denied successor must not undo an already observed boundary. Commit
    // closure separately from the future outbox write: rollback of signing,
    // current-user checks or lost XSP replies must never reopen the old cap.
    tx.commit().await?;
    let mut tx = state.pool.begin().await?;
    let current_user = lock_signed_user(&mut tx, req.user_id)
        .await?
        .ok_or_else(deny)?;
    let (open_epoch, _limit, _floor) = lock_open_account(&mut tx, req.user_id).await?;
    let now = database_now_ms(&mut tx).await?;
    if !crate::node_runtime::first_genesis_active_until(&current_user, now, now.saturating_add(1)) {
        return Err(deny());
    }
    let signer = state.node_policy_signer.public_key();
    let old = original_predecessor(&mut tx, req, activation, &signer, now).await?;
    // The V1 preparation contract signs the PREDECESSOR account epoch.
    // Do not prepare an unusable/misleading successor when the GLOBAL
    // account epoch has also rotated. A future cross-account transition
    // needs a separately signed successor account epoch and conservation
    // proof; pretending it is the old epoch is not a valid shortcut.
    if old.account_epoch != open_epoch {
        return Err(deny());
    }
    let prior = sqlx::query(
        "SELECT node_id,user_id,request_challenge,signer_public_key,
                account_epoch::text AS account_epoch,
                predecessor_runtime_id,policy_sha256,signed_envelope,
                candidate_meter_epoch::text AS candidate_meter_epoch,
                candidate_reservation_id::text AS candidate_reservation_id,
                issued_at_ms,valid_until_ms
         FROM quota_v2_calendar_successor_preparations
         WHERE predecessor_id=$1::uuid FOR SHARE",
    )
    .bind(&fields.predecessor_id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(row) = prior {
        let exact = verify_preparation_replay(&row, state, req, &old, activation, &signer, now)?;
        tx.commit().await?;
        return Ok(exact);
    }
    let exact = persist_zero_successor_preparation(
        &mut tx,
        state,
        req,
        fields,
        &old,
        (&signer, &earlier_epoch, activation, now),
    )
    .await?;
    tx.commit().await?;
    Ok(exact)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_predecessor_is_required_for_idempotent_challenge() {
        let original = "11111111-1111-4111-8111-111111111111";
        assert!(canonical_predecessor(original));
        assert_eq!(
            expected_challenge(original),
            "f349433b9bd3422baecb87c6b2ef6003a9e9f16650428b8783e5e3a7a79c64da"
        );
        assert!(!canonical_predecessor(
            "11111111-1111-4111-8111-11111111111Z"
        ));
        assert!(!canonical_predecessor(
            "11111111-1111-4111-8111-111111111111 "
        ));
        assert_ne!(
            expected_challenge(original),
            expected_challenge("22222222-2222-4222-8222-222222222222")
        );
    }

    #[test]
    fn archived_zero_spend_receipt_replays_after_expiry_but_not_with_bad_window() {
        // Its expiry is NOT a new Xray permission or an install window.
        // Historical bytes replay after a lost COMMIT response, but no
        // future-dated, pre-boundary or overlong preparation is accepted.
        let valid = json!({"issuedAtMs":120_000,"validUntilMs":240_000});
        assert!(valid_archived_preparation_lifetime(
            &valid, 119_999, 300_000
        ));
        assert!(!valid_archived_preparation_lifetime(
            &valid, 120_001, 300_000
        ));
        assert!(!valid_archived_preparation_lifetime(
            &valid, 119_999, 119_999
        ));
        for invalid in [
            json!({"issuedAtMs":120_000,"validUntilMs":120_000}),
            json!({"issuedAtMs":120_000,"validUntilMs":119_999}),
            json!({"issuedAtMs":120_000,"validUntilMs":240_001}),
            json!({"issuedAtMs":120_000.5,"validUntilMs":240_000}),
            json!({"issuedAtMs":120_000,"validUntilMs":"240000"}),
        ] {
            assert!(!valid_archived_preparation_lifetime(
                &invalid, 119_999, 300_000
            ));
        }
    }
}
