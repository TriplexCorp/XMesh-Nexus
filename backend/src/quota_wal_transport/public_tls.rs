//! Short-lived, strict-PQ first-Genesis WAL readback for the TLS supervisor.
//!
//! This is evidence of what PostgreSQL currently holds, NOT a proof of the
//! remote kernel, every transmitted byte, or an empty host journal. V2
//! additionally binds exact committed charge tails, not just stream births. A fresh
//! signed `empty_remote_history` is deliberately not an ingress authorization.
use super::{
    Anchor, Birth, authenticate_runtime, canonical_envelope, conflict, enrolled_key, sha256, signed,
    verify_witness,
};
use crate::{
    ApiError, AppState,
    node_policy::PolicySigner,
    quota_v2_public_tls_preflight::{Request, signed_roster, valid},
};
use axum::http::HeaderMap;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::BTreeMap, time::Duration};

const DOMAIN: &[u8] = b"XMESH_QUOTA_V2_PUBLIC_TLS_WAL_HEAD_V2\0";
const LIFETIME_MS: i64 = 7_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ProofRequest {
    scope: Request,
    challenge: String,
    container_id: String,
    host_pid: i64,
    started_at: String,
}

impl ProofRequest {
    fn valid(&self, node_id: i64) -> bool {
        valid(&self.scope)
            && self.scope.node_id == node_id
            && self.scope.required_lifetime_ms == LIFETIME_MS
            && super::lower_hex(&self.challenge, 64)
            && super::lower_hex(&self.container_id, 64)
            && self.host_pid > 1
            && (15..=64).contains(&self.started_at.len())
            && self.started_at.contains('T')
            && self.started_at.bytes().all(|b| b.is_ascii_graphic())
    }
}

struct History {
    sequence: i32,
    hash: String,
    tail: String,
    charge_stream_count: usize,
    charge_heads_sha256: String,
}

impl History {
    fn empty() -> Self {
        Self {
            sequence: 0,
            hash: sha256(&[]),
            tail: "0".repeat(64),
            charge_stream_count: 0,
            charge_heads_sha256: sha256(b"[]"),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct AliasOwner {
    user_id: i64,
    reservation_id: String,
    is_cdn: bool,
}

// Exact latest immutable charge row, including the already signed receipt.
// Never accept a bare count/filename as proof of a committed stream tail.
#[derive(Clone, sqlx::FromRow)]
struct ChargeHead {
    filename: String,
    reservation_id: String,
    user_id: i64,
    first_sequence: i64,
    last_sequence: i64,
    last_digest: String,
    stream_bytes: i64,
    is_cdn: bool,
    journal_sha256: String,
    signed_receipt: Vec<u8>,
}

impl ChargeHead {
    fn manifest(&self) -> Value {
        json!({
            "filename": self.filename,
            "reservationId": self.reservation_id,
            "userId": self.user_id,
            "lastSequence": self.last_sequence,
            "lastDigest": self.last_digest,
            "streamBytes": self.stream_bytes,
            "isCdn": self.is_cdn,
        })
    }

    fn verify(
        &self,
        birth: &Birth,
        owner: &AliasOwner,
        proof: &ProofRequest,
        signer: &PolicySigner,
    ) -> Result<(), ApiError> {
        if self.filename != birth.filename
            || self.user_id != owner.user_id
            || self.reservation_id != owner.reservation_id
            || self.is_cdn != owner.is_cdn
            || self.first_sequence <= 0
            || self.last_sequence < self.first_sequence
            || self.stream_bytes <= 0
            || (self.last_sequence == 1 && self.last_digest != birth.first_wal_digest)
            || !super::lower_hex(&self.last_digest, 64)
            || !super::lower_hex(&self.journal_sha256, 64)
        {
            return Err(conflict());
        }
        let doc: Value = serde_json::from_slice(&self.signed_receipt).map_err(|_| conflict())?;
        let claims = &doc["payload"];
        // The cumulative receipt totals are as of its original commit,
        // NOT the current total across other subsequently charged streams.
        let total = claims["conservativeWalBytes"].as_i64().ok_or_else(conflict)?;
        let cdn = claims["conservativeCdnWalBytes"].as_i64().ok_or_else(conflict)?;
        if total < self.stream_bytes || !(0..=total).contains(&cdn)
            || (self.is_cdn && cdn < self.stream_bytes)
        {
            return Err(conflict());
        }
        let expected = json!({
            "schemaVersion":1, "kind":"xmesh.quota-v2.wal-intent-charge",
            "nodeId": proof.scope.node_id, "userId": self.user_id,
            "reservationId": self.reservation_id, "runtimeId": birth.runtime_id,
            "filename": self.filename, "firstSequence": self.first_sequence,
            "lastSequence": self.last_sequence, "lastDigest": self.last_digest,
            "journalSha256": self.journal_sha256, "streamBytes": self.stream_bytes,
            "conservativeWalBytes": total, "conservativeCdnWalBytes": cdn,
            "canResume":false, "finalMeterVerified":false, "refundableBytes":0,
        });
        let signature = signer
            .sign_domain(super::charge::CHARGE_DOMAIN, &expected)
            .map_err(|_| conflict())?;
        if canonical_envelope(&expected, &signature)? != self.signed_receipt {
            return Err(conflict());
        }
        Ok(())
    }
}

// Recheck the actual original cap-delivery measurements (not another runtime
// with matching user IDs). The locked, cryptographically verified roster is
// the ONLY source of the grant and alias set.
async fn verify_measurement(
    conn: &mut sqlx::PgConnection,
    proof: &ProofRequest,
) -> Result<(BTreeMap<String, AliasOwner>, i64), ApiError> {
    let scope = &proof.scope;
    let records: Vec<(Vec<u8>, bool, i64)> = sqlx::query_as(
        "SELECT o.signed_envelope,
                pf.reported_container_id=$2 AND pf.reported_pid=$3
                  AND pf.prepared_runtime_id=$4 AND pf.reported_wal_floor_bytes=0
                  AND pf.first_activation_sha256=$5,
                LEAST(o.valid_until_ms,(EXTRACT(EPOCH FROM r.valid_until)*1000)::BIGINT,
                      (EXTRACT(EPOCH FROM pf.expires_at)*1000)::BIGINT)
           FROM quota_v2_signed_first_cap_outbox o
           JOIN quota_v2_runtime_admission_preflights pf
             ON pf.node_id=o.node_id AND pf.request_challenge=o.request_challenge
           JOIN quota_v2_reservations r ON r.reservation_id=o.reservation_id
          WHERE o.node_id=$1
          ORDER BY o.user_id LIMIT 2049",
    )
    .bind(scope.node_id)
    .bind(&proof.container_id)
    .bind(proof.host_pid)
    .bind(&scope.runtime_id)
    .bind(&scope.activation_receipt_sha256)
    .fetch_all(&mut *conn)
    .await?;
    if records.is_empty() || records.len() > 2048 {
        return Err(conflict());
    }
    let mut aliases = BTreeMap::new();
    let mut expires = i64::MAX;
    for (raw, matched, end) in records {
        if !matched {
            return Err(conflict());
        }
        // locked_digest verified the complete immutable signed cap roster.
        let doc: Value = serde_json::from_slice(&raw).map_err(|_| conflict())?;
        let cap = &doc["payload"];
        let user_id = cap["userId"].as_i64().ok_or_else(conflict)?;
        let reservation_id = cap["reservationId"].as_str().ok_or_else(conflict)?;
        for alias in cap["aliasScopes"].as_array().ok_or_else(conflict)? {
            let is_cdn = match alias["class"].as_str() {
                Some("main") => false,
                Some("cdn") => true,
                _ => return Err(conflict()),
            };
            let owner = AliasOwner {
                user_id,
                reservation_id: reservation_id.to_owned(),
                is_cdn,
            };
            if aliases
                .insert(
                    alias["email"].as_str().ok_or_else(conflict)?.to_owned(),
                    owner,
                )
                .is_some()
            {
                return Err(conflict());
            }
        }
        expires = expires.min(end);
    }
    Ok((aliases, expires))
}

async fn committed_history(
    conn: &mut sqlx::PgConnection,
    proof: &ProofRequest,
    aliases: &BTreeMap<String, AliasOwner>,
    signer: &PolicySigner,
) -> Result<History, ApiError> {
    let node = proof.scope.node_id;
    // Serialize against the original WAL store even when the table is empty.
    // Account/lease/Genesis locks were taken first by locked_digest.
    let locked: bool =
        sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(1794501,hashtext($1::text))")
            .bind(node.to_string())
            .fetch_one(&mut *conn)
            .await?;
    if !locked {
        return Err(conflict());
    }
    let later: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM quota_v2_runtime_wal_anchors WHERE node_id=$1)",
    )
    .bind(node)
    .fetch_one(&mut *conn)
    .await?;
    if later {
        // No cross-generation or successor fallback on this first-Genesis path.
        return Err(conflict());
    }
    // Account locks serialize the actual charge worker against this read.
    // Compute the bounded latest-per-owner query, not all stored WAL batch
    // bytes; hash only each latest immutable journal in PostgreSQL.
    let charges: Vec<ChargeHead> = sqlx::query_as(
        "SELECT filename,reservation_id::text,user_id,first_sequence,last_sequence,
                last_digest,stream_bytes,is_cdn,encode(sha256(journal),'hex') AS journal_sha256,
                signed_receipt
           FROM (
             SELECT DISTINCT ON (c.filename,c.reservation_id) c.*,r.user_id
               FROM quota_v2_wal_charges c
               JOIN quota_v2_reservations r USING(reservation_id)
              WHERE r.node_id=$1
              ORDER BY c.filename,c.reservation_id,c.first_sequence DESC LIMIT 4097
           ) AS heads",
    )
    .bind(node)
    .fetch_all(&mut *conn)
    .await?;
    if charges.len() > 4096 {
        return Err(conflict());
    }
    let row = sqlx::query_as::<_, Anchor>(
        "SELECT a.inventory_sequence,a.inventory_sha256,a.inventory_tail_digest,
                a.original_node_witness_sha256,a.old_container_id,a.old_started_at,
                a.inventory_bytes,a.first_external_witness,s.witness_bytes
           FROM quota_v2_external_wal_birth_anchors a
           LEFT JOIN quota_v2_external_wal_birth_sources s USING(node_id,inventory_sequence)
          WHERE a.node_id=$1 ORDER BY a.inventory_sequence DESC LIMIT 1",
    )
    .bind(node)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(row) = row {
        let key = enrolled_key(conn, node).await?;
        return validate_anchor(row, proof, aliases, &charges, &key, signer);
    }
    // Absence is never obtained by accepting an HTTP 404. Sign exactly the
    // SQL snapshot with no committed history, only if no reservation on this
    // Node already reports charged/burned bytes or has a durable charge.
    let spent: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM quota_v2_reservations WHERE node_id=$1
          AND (acknowledged_bytes<>0 OR conservative_burn_floor_bytes<>0
               OR conservative_burned_at IS NOT NULL))",
    )
    .bind(node)
    .fetch_one(&mut *conn)
    .await?;
    if spent || !charges.is_empty() {
        return Err(conflict());
    }
    Ok(History::empty())
}

fn validate_anchor(
    row: Anchor,
    proof: &ProofRequest,
    aliases: &BTreeMap<String, AliasOwner>,
    charges: &[ChargeHead],
    key: &ed25519_dalek::VerifyingKey,
    signer: &PolicySigner,
) -> Result<History, ApiError> {
    let raw = row.witness_bytes.as_deref().ok_or_else(conflict)?;
    let w = verify_witness(raw, &row.inventory_bytes, proof.scope.node_id, key)
        .map_err(|_| conflict())?;
    if row.inventory_sequence != w.inventory_sequence
        || row.inventory_sha256 != w.inventory_sha256
        || row.inventory_tail_digest != w.inventory_tail_digest
        || row.original_node_witness_sha256 != sha256(raw)
        || row.old_container_id != w.old_container_id
        || row.old_started_at != w.old_started_at
        || w.old_container_id != proof.container_id
        || w.old_started_at != proof.started_at
    {
        return Err(conflict());
    }
    let mut remaining = BTreeMap::new();
    for charge in charges {
        if remaining.insert(charge.filename.as_str(), charge).is_some() {
            return Err(conflict());
        }
    }
    let mut verified = BTreeMap::new();
    for line in row.inventory_bytes[..row.inventory_bytes.len() - 1].split(|b| *b == b'\n') {
        let birth: Birth = serde_json::from_slice(line).map_err(|_| conflict())?;
        let owner = aliases.get(&birth.email).ok_or_else(conflict)?;
        if birth.runtime_id != proof.scope.runtime_id {
            return Err(conflict());
        }
        if let Some(charge) = remaining.remove(birth.filename.as_str()) {
            charge.verify(&birth, owner, proof, signer)?;
            verified.insert(birth.filename, charge.manifest());
        }
    }
    if !remaining.is_empty() {
        return Err(conflict());
    }
    let manifest: Vec<_> = verified.into_values().collect();
    let charge_heads_sha256 = sha256(&serde_json::to_vec(&manifest).map_err(|_| conflict())?);
    Ok(History {
        sequence: row.inventory_sequence,
        hash: row.inventory_sha256,
        tail: row.inventory_tail_digest,
        charge_stream_count: charges.len(),
        charge_heads_sha256,
    })
}

fn payload(proof: &ProofRequest, history: &History, now: i64, end: i64) -> Value {
    let scope = &proof.scope;
    json!({
        "schemaVersion": 2, "kind": "xmesh.quota-v2.public-tls-wal-head",
        "nodeId": scope.node_id, "userId": scope.user_id,
        "activationReceiptSha256": scope.activation_receipt_sha256,
        "genesisPolicySha256": scope.genesis_policy_sha256,
        "runtimeId": scope.runtime_id, "profileRevision": scope.profile_revision,
        "capRosterSha256": scope.cap_roster_sha256,
        "challenge": proof.challenge, "containerId": proof.container_id,
        "hostPid": proof.host_pid, "startedAt": proof.started_at,
        "issuedAtMs": now, "validUntilMs": end,
        "historyState": if history.sequence == 0 { "empty_remote_history" } else { "committed_birth_index" },
        "inventorySequence": history.sequence, "inventorySha256": history.hash,
        "inventoryTailDigest": history.tail, "committedChargeStreamCount": history.charge_stream_count,
        "committedChargeHeadsSha256": history.charge_heads_sha256,
        "preBootstrapHistoryCompletenessVerified": false, "liveMeterVerified": false,
        "finalMeterVerified": false, "canServePublic": false, "canSpend": false,
        "canStart": false, "canResume": false, "authorizedBytes": 0, "refundableBytes": 0,
    })
}

async fn read_snapshot(
    state: &AppState,
    proof: &ProofRequest,
    activation: &str,
) -> Result<Value, ApiError> {
    let mut tx = state.pool.begin().await?;
    signed_roster::configure_transaction(&mut tx).await?;
    if signed_roster::locked_digest(&mut tx, state, &proof.scope, activation)
        .await?
        .is_none()
    {
        return Err(conflict());
    }
    let (aliases, cap_end) = verify_measurement(&mut tx, proof).await?;
    let history = committed_history(&mut tx, proof, &aliases, &state.node_policy_signer).await?;
    let now: i64 =
        sqlx::query_scalar("SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT")
            .fetch_one(&mut *tx)
            .await?;
    let end = now.saturating_add(LIFETIME_MS).min(cap_end);
    if end <= now {
        return Err(conflict());
    }
    // Sign while the same roster/lease and WAL writer locks are held; do
    // not persist allocator helper writes from an inspection.
    let wire = signed(
        &state.node_policy_signer,
        DOMAIN,
        &payload(proof, &history, now, end),
    )?;
    tx.rollback().await?;
    let envelope = String::from_utf8(wire).map_err(|_| conflict())?;
    Ok(json!({"signedEnvelope": envelope}))
}

pub(super) async fn snapshot(
    state: &AppState,
    headers: &HeaderMap,
    node_id: i64,
    proof: &ProofRequest,
) -> Result<Value, ApiError> {
    if !proof.valid(node_id) {
        return Err(conflict());
    }
    let activation = authenticate_runtime(state, headers, node_id, &proof.scope.runtime_id).await?;
    if activation != proof.scope.activation_receipt_sha256 {
        return Err(conflict());
    }
    tokio::time::timeout(
        Duration::from_secs(2),
        read_snapshot(state, proof, activation),
    )
    .await
    .map_err(|_| conflict())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quota_wal_transport::{WITNESS_DOMAIN, Witness, canonical_envelope};
    use ed25519_dalek::{Signer, SigningKey};

    fn request() -> ProofRequest {
        serde_json::from_value(json!({
            "scope": {
                "nodeId": 47, "userId": 91, "activationReceiptSha256": "a".repeat(64),
                "genesisPolicySha256": "b".repeat(64), "runtimeId": "c".repeat(64),
                "profileRevision": "d".repeat(64), "capRosterSha256": "e".repeat(64),
                "requiredLifetimeMs": 7000,
            },
            "containerId": "f".repeat(64), "hostPid": 1234,
            "startedAt": "2026-11-26T19:30:01.012345678Z",
            "challenge": "1".repeat(64),
        }))
        .expect("fixture request")
    }

    fn anchor(proof: &ProofRequest, runtime: &str, email: &str) -> (Anchor, SigningKey, String) {
        let key = SigningKey::from_bytes(&[17; 32]);
        let source = format!("{runtime}\0{email}\0uplink");
        let filename = format!("meter-{}.jsonl", sha256(source.as_bytes()));
        let mut birth = Birth {
            schema_version: 1,
            sequence: 1,
            filename: filename.clone(),
            runtime_id: runtime.to_owned(),
            email: email.to_owned(),
            direction: "uplink".into(),
            first_wal_digest: "2".repeat(64),
            previous_digest: "0".repeat(64),
            digest: String::new(),
        };
        let mut unsigned = serde_json::to_vec(&birth).expect("birth");
        unsigned.push(b'\n');
        birth.digest = sha256(&unsigned);
        let mut index = serde_json::to_vec(&birth).expect("index");
        index.push(b'\n');
        let w = Witness {
            schema_version: 1,
            kind: "xmesh.quota-v2.offhost-wal-birth-witness".into(),
            node_id: proof.scope.node_id,
            old_container_id: proof.container_id.clone(),
            old_started_at: proof.started_at.clone(),
            inventory_sequence: 1,
            inventory_sha256: sha256(&index),
            inventory_tail_digest: birth.digest,
            indexed_wal_count: 1,
            local_births_independently_checked: true,
            nexus_persisted: false,
            carryforward_applied: false,
            can_resume: false,
            final_meter_verified: false,
            refundable_bytes: 0,
        };
        let payload = serde_json::to_value(&w).expect("witness");
        let mut message = WITNESS_DOMAIN.to_vec();
        serde_json::to_writer(&mut message, &payload).expect("canonical witness");
        let signature = hex::encode(key.sign(&message).to_bytes());
        let raw = canonical_envelope(&payload, &signature).expect("envelope");
        (
            Anchor {
                inventory_sequence: 1,
                inventory_sha256: w.inventory_sha256,
                inventory_tail_digest: w.inventory_tail_digest,
                original_node_witness_sha256: sha256(&raw),
                old_container_id: w.old_container_id,
                old_started_at: w.old_started_at,
                inventory_bytes: index,
                first_external_witness: true,
                witness_bytes: Some(raw),
            },
            key,
            filename,
        )
    }

    #[test]
    fn empty_remote_snapshot_never_attests_an_empty_host_or_allows_traffic() {
        let req = request();
        assert!(req.valid(47));
        assert!(!req.valid(48));
        let empty = payload(&req, &History::empty(), 1000, 8000);
        assert_eq!(empty["historyState"], "empty_remote_history");
        assert_eq!(empty["inventorySequence"], 0);
        assert_eq!(empty["inventorySha256"], sha256(b""));
        assert_eq!(empty["inventoryTailDigest"], "0".repeat(64));
        assert_eq!(empty["schemaVersion"], 2);
        assert_eq!(empty["committedChargeHeadsSha256"], sha256(b"[]"));
        assert_eq!(empty["committedChargeStreamCount"], 0);
        for flag in [
            "preBootstrapHistoryCompletenessVerified",
            "liveMeterVerified",
            "finalMeterVerified",
            "canServePublic",
            "canSpend",
            "canStart",
            "canResume",
        ] {
            assert_eq!(empty[flag], false, "{flag}");
        }
        assert_eq!(empty["authorizedBytes"], 0);
        assert_eq!(empty["refundableBytes"], 0);
    }

    fn test_signer() -> PolicySigner {
        let path = std::env::temp_dir().join(format!("xmesh-wal-v2-test-{}", uuid::Uuid::new_v4()));
        let signer = PolicySigner::load(&path).expect("ephemeral policy signer");
        std::fs::remove_file(path).expect("remove ephemeral signer file");
        signer
    }

    fn aliases() -> BTreeMap<String, AliasOwner> {
        BTreeMap::from([(
            "xmesh-u91--vless-main".into(),
            AliasOwner {
                user_id: 91,
                reservation_id: "12345678-1234-1234-1234-123456789012".into(),
                is_cdn: false,
            },
        )])
    }

    fn signed_head(
        req: &ProofRequest,
        signer: &PolicySigner,
        filename: &str,
        sequence: i64,
    ) -> ChargeHead {
        let mut head = ChargeHead {
            filename: filename.into(),
            reservation_id: "12345678-1234-1234-1234-123456789012".into(),
            user_id: 91,
            first_sequence: sequence,
            last_sequence: sequence,
            last_digest: if sequence == 1 { "2".repeat(64) } else { "3".repeat(64) },
            stream_bytes: sequence * 17,
            is_cdn: false,
            journal_sha256: "4".repeat(64),
            signed_receipt: Vec::new(),
        };
        // Independent construction of the real historical charge receipt.
        head.signed_receipt = signed(
            signer,
            super::super::charge::CHARGE_DOMAIN,
            &json!({
                "schemaVersion":1, "kind":"xmesh.quota-v2.wal-intent-charge",
                "nodeId":47, "userId":91, "reservationId":head.reservation_id,
                "runtimeId":req.scope.runtime_id, "filename":filename,
                "firstSequence":sequence, "lastSequence":sequence,
                "lastDigest":head.last_digest, "journalSha256":head.journal_sha256,
                "streamBytes":sequence*17, "conservativeWalBytes":sequence*17,
                "conservativeCdnWalBytes":0, "canResume":false,
                "finalMeterVerified":false, "refundableBytes":0,
            }),
        )
        .expect("signed historical charge");
        head
    }

    #[test]
    fn exact_signed_anchor_and_charge_coverage_required() {
        let req = request();
        let email = "xmesh-u91--vless-main";
        let aliases = aliases();
        let signer = test_signer();
        let validate = |row: Anchor, req: &ProofRequest, charges: &[ChargeHead], key: &SigningKey| {
            validate_anchor(row, req, &aliases, charges, &key.verifying_key(), &signer)
        };

        let (row, key, filename) = anchor(&req, &req.scope.runtime_id, email);
        let head = signed_head(&req, &signer, &filename, 1);
        let confirmed = validate(row, &req, std::slice::from_ref(&head), &key)
            .expect("independently verified anchor and charge");
        assert_eq!(confirmed.sequence, 1);
        assert_eq!(confirmed.charge_stream_count, 1);
        let proof = payload(&req, &confirmed, 1000, 8000);
        assert_eq!(proof["historyState"], "committed_birth_index");
        assert_eq!(proof["canServePublic"], false);
        let (row, key, _) = anchor(&req, &req.scope.runtime_id, email);
        let foreign_head = signed_head(&req, &signer, "foreign", 1);
        assert!(validate(row, &req, &[foreign_head], &key).is_err());
        let (row, key, _) = anchor(&req, &"9".repeat(64), email);
        assert!(validate(row, &req, &[], &key).is_err());
        let (row, key, _) = anchor(&req, &req.scope.runtime_id, "xmesh-u92--vless-cdn");
        assert!(validate(row, &req, &[], &key).is_err());
        let (mut row, key, _) = anchor(&req, &req.scope.runtime_id, email);
        row.old_started_at = "2026-11-26T19:30:02Z".into();
        assert!(validate(row, &req, &[], &key).is_err());
        let (row, key, _) = anchor(&req, &req.scope.runtime_id, email);
        let mut replaced = request();
        replaced.started_at = "2026-11-26T19:30:03Z".into();
        assert!(validate(row, &replaced, &[], &key).is_err());
        let (mut row, key, _) = anchor(&req, &req.scope.runtime_id, email);
        row.inventory_sha256 = "0".repeat(64);
        assert!(validate(row, &req, &[], &key).is_err());
        let (row, _, _) = anchor(&req, &req.scope.runtime_id, email);
        let foreign = SigningKey::from_bytes(&[18; 32]);
        assert!(validate(row, &req, &[], &foreign).is_err());
    }

    #[test]
    fn exact_tail_digest_changes_without_birth_index_and_rejects_modified_receipts() {
        let req = request();
        let aliases = aliases();
        let signer = test_signer();
        let email = "xmesh-u91--vless-main";
        let (row, key, filename) = anchor(&req, &req.scope.runtime_id, email);
        let key = key.verifying_key();
        let initial = signed_head(&req, &signer, &filename, 1);
        let old = validate_anchor(
            row,
            &req,
            &aliases,
            std::slice::from_ref(&initial),
            &key,
            &signer,
        )
        .expect("first charge");
        let (row, _, _) = anchor(&req, &req.scope.runtime_id, email);
        let latest = signed_head(&req, &signer, &filename, 2);
        let new = validate_anchor(row, &req, &aliases, &[latest], &key, &signer)
            .expect("new charge for same birth");
        assert_eq!(old.sequence, new.sequence);
        assert_eq!(old.hash, new.hash);
        assert_eq!(old.tail, new.tail);
        assert_eq!(old.charge_stream_count, new.charge_stream_count);
        assert_ne!(old.charge_heads_sha256, new.charge_heads_sha256);
        let expected = json!([{
            "filename":filename, "reservationId":"12345678-1234-1234-1234-123456789012",
            "userId":91, "lastSequence":2, "lastDigest":"3".repeat(64),
            "streamBytes":34, "isCdn":false,
        }]);
        assert_eq!(
            new.charge_heads_sha256,
            sha256(&serde_json::to_vec(&expected).expect("canonical manifest"))
        );

        let (row, _, _) = anchor(&req, &req.scope.runtime_id, email);
        let birth_only = validate_anchor(row, &req, &aliases, &[], &key, &signer)
            .expect("signed SQL snapshot can legitimately have a pending stream");
        assert_eq!(birth_only.sequence, 1);
        assert_eq!(birth_only.charge_stream_count, 0);
        assert_eq!(birth_only.charge_heads_sha256, sha256(b"[]"));

        let mutations: [fn(&mut ChargeHead); 7] = [
            |head: &mut ChargeHead| head.last_digest = "9".repeat(64),
            |head: &mut ChargeHead| head.stream_bytes += 1,
            |head: &mut ChargeHead| head.last_sequence += 1,
            |head: &mut ChargeHead| head.journal_sha256 = "8".repeat(64),
            |head: &mut ChargeHead| head.user_id += 1,
            |head: &mut ChargeHead| head.is_cdn = true,
            |head: &mut ChargeHead| head.reservation_id = "0".repeat(36),
        ];
        for modify in mutations {
            let (row, _, _) = anchor(&req, &req.scope.runtime_id, email);
            let mut edited = initial.clone();
            modify(&mut edited);
            assert!(validate_anchor(row, &req, &aliases, &[edited], &key, &signer).is_err());
        }
        let (row, _, _) = anchor(&req, &req.scope.runtime_id, email);
        assert!(
            validate_anchor(row, &req, &aliases, &[initial.clone(), initial], &key, &signer)
                .is_err()
        );
    }
}
