//! Authenticated, nonauthorizing transport for the external Xray WAL index.
use crate::{ApiError, AppState, node_auth, node_policy::PolicySigner};
use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    routing::{MethodRouter, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgConnection;

pub const PATH: &str = "/api/v1/node/quota-v2/wal";
const REQUEST_LIMIT: usize = 544 * 1024;
// Leave room for the two Base64 layers and the XSP/2 envelope signatures.
const INDEX_LIMIT: usize = 384 * 1024;
const WITNESS_LIMIT: usize = 4096;
const WITNESS_DOMAIN: &[u8] = b"XMESH_QUOTA_V2_OFFHOST_WAL_BIRTH_WITNESS_V1\0";
const RECEIPT_DOMAIN: &[u8] = b"XMESH_QUOTA_V2_REMOTE_WAL_BIRTH_STORED_V1\0";
const HEAD_DOMAIN: &[u8] = b"XMESH_QUOTA_V2_REMOTE_WAL_HEAD_V1\0";

#[derive(Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Request {
    Store {
        node_id: i64,
        witness: String,
        inventory: String,
    },
    Head {
        node_id: i64,
        challenge: String,
    },
}

#[derive(Serialize, Deserialize)]
#[expect(clippy::struct_excessive_bools, reason = "fixed signed witness schema")]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Witness {
    schema_version: u8,
    kind: String,
    node_id: i64,
    old_container_id: String,
    old_started_at: String,
    inventory_sequence: i32,
    inventory_sha256: String,
    inventory_tail_digest: String,
    indexed_wal_count: i32,
    local_births_independently_checked: bool,
    nexus_persisted: bool,
    carryforward_applied: bool,
    can_resume: bool,
    final_meter_verified: bool,
    refundable_bytes: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    algorithm: String,
    payload: Witness,
    signature: String,
}

// Field order is the byte-level serialization contract of the Go WAL writer.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Birth {
    schema_version: u8,
    sequence: i32,
    filename: String,
    runtime_id: String,
    email: String,
    direction: String,
    first_wal_digest: String,
    previous_digest: String,
    digest: String,
}

#[derive(sqlx::FromRow)]
struct Anchor {
    inventory_sequence: i32,
    inventory_sha256: String,
    inventory_tail_digest: String,
    original_node_witness_sha256: String,
    old_container_id: String,
    old_started_at: String,
    inventory_bytes: Vec<u8>,
    first_external_witness: bool,
    witness_bytes: Option<Vec<u8>>,
}

fn invalid() -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, "Invalid signed WAL checkpoint.")
}

fn conflict() -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        "WAL checkpoint conflicts with durable history.",
    )
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn decode(value: &str, max: usize) -> Result<Vec<u8>, ApiError> {
    if value.len() > max.div_ceil(3) * 4 {
        return Err(invalid());
    }
    let data = STANDARD.decode(value).map_err(|_| invalid())?;
    if data.is_empty() || data.len() > max {
        return Err(invalid());
    }
    Ok(data)
}

fn valid_email(value: &str) -> bool {
    let Some((id, tag)) = value
        .strip_prefix("xmesh-u")
        .and_then(|v| v.split_once("--"))
    else {
        return false;
    };
    !id.is_empty()
        && id.len() <= 19
        && !id.starts_with('0')
        && id.bytes().all(|b| b.is_ascii_digit())
        && (1..=128).contains(&tag.chars().count())
        && !tag
            .chars()
            .any(|c| c <= ' ' || matches!(c, '<' | '>' | '&' | '\u{2028}' | '\u{2029}'))
}

fn verify_index(index: &[u8], witness: &Witness) -> Result<(), ApiError> {
    let raw_lines = index.strip_suffix(b"\n").ok_or_else(invalid)?;
    let mut previous = "0".repeat(64);
    let mut seen = std::collections::HashSet::new();
    for (offset, line) in raw_lines.split(|byte| *byte == b'\n').enumerate() {
        let sequence = i32::try_from(offset + 1).map_err(|_| invalid())?;
        if line.len() > 1024 || sequence > witness.inventory_sequence {
            return Err(invalid());
        }
        let mut birth: Birth = serde_json::from_slice(line).map_err(|_| invalid())?;
        if birth.schema_version != 1
            || birth.sequence != sequence
            || birth.previous_digest != previous
            || !lower_hex(&birth.runtime_id, 64)
            || !lower_hex(&birth.first_wal_digest, 64)
            || !valid_email(&birth.email)
            || !matches!(birth.direction.as_str(), "uplink" | "downlink")
            || serde_json::to_vec(&birth).map_err(|_| invalid())? != line
        {
            return Err(invalid());
        }
        let source = format!("{}\0{}\0{}", birth.runtime_id, birth.email, birth.direction);
        if birth.filename != format!("meter-{}.jsonl", sha256(source.as_bytes()))
            || !seen.insert(birth.filename.clone())
        {
            return Err(invalid());
        }
        let digest = std::mem::take(&mut birth.digest);
        let mut canonical = serde_json::to_vec(&birth).map_err(|_| invalid())?;
        canonical.push(b'\n');
        if digest != sha256(&canonical) {
            return Err(invalid());
        }
        previous = digest;
    }
    if previous != witness.inventory_tail_digest
        || usize::try_from(witness.inventory_sequence).ok() != Some(seen.len())
    {
        return Err(invalid());
    }
    Ok(())
}

fn verify_witness(
    raw: &[u8],
    index: &[u8],
    node_id: i64,
    key: &VerifyingKey,
) -> Result<Witness, ApiError> {
    if raw.is_empty() || raw.len() > WITNESS_LIMIT || index.is_empty() || index.len() > INDEX_LIMIT
    {
        return Err(invalid());
    }
    let envelope: Envelope = serde_json::from_slice(raw).map_err(|_| invalid())?;
    let w = envelope.payload;
    if envelope.algorithm != "Ed25519"
        || !lower_hex(&envelope.signature, 128)
        || w.schema_version != 1
        || w.kind != "xmesh.quota-v2.offhost-wal-birth-witness"
        || w.node_id != node_id
        || !lower_hex(&w.old_container_id, 64)
        || !(15..=64).contains(&w.old_started_at.chars().count())
        || !w.old_started_at.contains('T')
        || !(1..=4096).contains(&w.inventory_sequence)
        || w.indexed_wal_count != w.inventory_sequence
        || w.inventory_sha256 != sha256(index)
        || !lower_hex(&w.inventory_tail_digest, 64)
        || !w.local_births_independently_checked
        || w.nexus_persisted
        || w.carryforward_applied
        || w.can_resume
        || w.final_meter_verified
        || w.refundable_bytes != 0
    {
        return Err(invalid());
    }
    let payload = serde_json::to_value(&w).map_err(|_| invalid())?;
    let canonical = canonical_envelope(&payload, &envelope.signature)?;
    let signature_bytes = hex::decode(&envelope.signature).map_err(|_| invalid())?;
    let signature = Signature::from_slice(&signature_bytes).map_err(|_| invalid())?;
    let mut message = WITNESS_DOMAIN.to_vec();
    serde_json::to_writer(&mut message, &payload).map_err(|_| invalid())?;
    if canonical != raw || key.verify_strict(&message, &signature).is_err() {
        return Err(invalid());
    }
    verify_index(index, &w)?;
    Ok(w)
}

fn canonical_envelope(payload: &Value, sig: &str) -> Result<Vec<u8>, ApiError> {
    let mut bytes = serde_json::to_vec(&json!({
        "algorithm":"Ed25519", "payload":payload, "signature":sig,
    }))
    .map_err(|_| invalid())?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn signed(signer: &PolicySigner, domain: &[u8], payload: &Value) -> Result<Vec<u8>, ApiError> {
    let signature = signer.sign_domain(domain, payload).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "WAL signature unavailable.",
        )
    })?;
    canonical_envelope(payload, &signature)
}

fn receipt(
    signer: &PolicySigner,
    witness: &Witness,
    witness_sha: &str,
    bootstrap: bool,
) -> Result<Vec<u8>, ApiError> {
    signed(
        signer,
        RECEIPT_DOMAIN,
        &json!({
            "schemaVersion":1, "kind":"xmesh.quota-v2.external-wal-birth-stored",
            "nodeId":witness.node_id, "inventorySequence":witness.inventory_sequence,
            "inventorySha256":witness.inventory_sha256, "inventoryTailDigest":witness.inventory_tail_digest,
            "originalNodeWitnessSha256":witness_sha, "oldContainerId":witness.old_container_id,
            "oldStartedAt":witness.old_started_at, "offhostFullIndexCommitted":true,
            "bootstrapOnly":bootstrap, "canResume":false, "carryforwardApplied":false,
            "finalMeterVerified":false, "refundableBytes":0,
        }),
    )
}

async fn enrolled_key(conn: &mut PgConnection, node_id: i64) -> Result<VerifyingKey, ApiError> {
    // The product activation and enrollment path uses its real signing key.
    // The scripts' local compatibility key is not an XSP/2 credential.
    let key = sqlx::query_scalar::<_, Option<Vec<u8>>>(
        "SELECT CASE WHEN p.node_id IS NULL THEN decode(m.public_key,'hex')
                     WHEN p.state='active' THEN k.ed25519_public END
           FROM panel_records AS n JOIN node_metric_keys AS m ON m.node_id=n.id
           LEFT JOIN node_xsp_product_nodes AS p ON p.node_id=n.id
           LEFT JOIN node_xsp_public_keysets AS k ON k.node_id=p.node_id
             AND k.purpose='node_request' AND k.key_epoch=p.key_epoch
             AND k.ed25519_key_id=p.ed25519_key_id AND k.revoked_at IS NULL
          WHERE n.collection='nodes' AND n.id=$1
            AND (n.data->'disabled') IS DISTINCT FROM 'true'::jsonb
          FOR SHARE OF n,m",
    )
    .bind(node_id)
    .fetch_optional(conn)
    .await?
    .flatten();
    let key = key
        .and_then(|raw| raw.try_into().ok())
        .and_then(|raw: [u8; 32]| VerifyingKey::from_bytes(&raw).ok())
        .ok_or_else(|| ApiError::new(StatusCode::FORBIDDEN, "WAL identity unavailable."))?;
    Ok(key)
}

async fn store(
    state: &AppState,
    node_id: i64,
    witness: &str,
    inventory: &str,
) -> Result<Value, ApiError> {
    let raw = decode(witness, WITNESS_LIMIT)?;
    let index = decode(inventory, INDEX_LIMIT)?;
    let mut tx = state.pool.begin().await?;
    let key = enrolled_key(&mut tx, node_id).await?;
    let w = verify_witness(&raw, &index, node_id, &key)?;
    let fingerprint = sha256(&raw);
    sqlx::query("SET LOCAL synchronous_commit TO on")
        .execute(&mut *tx)
        .await?;
    let bootstrap: bool = sqlx::query_scalar(
        "SELECT first_external_witness FROM quota_v2_store_external_wal_birth_anchor($1,$2,$3,$4,$5,$6,$7,$8)",
    ).bind(node_id).bind(w.inventory_sequence).bind(&w.inventory_sha256)
        .bind(&w.inventory_tail_digest).bind(&fingerprint).bind(&w.old_container_id)
        .bind(&w.old_started_at).bind(&index).fetch_one(&mut *tx).await
        .map_err(|e| {
            if e.as_database_error().and_then(sqlx::error::DatabaseError::code).as_deref() == Some("22023") {
                conflict()
            } else {
                ApiError::from(e)
            }
        })?;
    sqlx::query(
        "INSERT INTO quota_v2_external_wal_birth_sources(node_id,inventory_sequence,witness_bytes)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
    )
    .bind(node_id)
    .bind(w.inventory_sequence)
    .bind(&raw)
    .execute(&mut *tx)
    .await?;
    let saved: Vec<u8> = sqlx::query_scalar(
        "SELECT witness_bytes FROM quota_v2_external_wal_birth_sources
          WHERE node_id=$1 AND inventory_sequence=$2",
    )
    .bind(node_id)
    .bind(w.inventory_sequence)
    .fetch_one(&mut *tx)
    .await?;
    if saved != raw {
        return Err(conflict());
    }
    tx.commit().await?;
    let ack = receipt(&state.node_policy_signer, &w, &fingerprint, bootstrap)?;
    Ok(json!({"receipt":STANDARD.encode(ack)}))
}

async fn head(state: &AppState, node_id: i64, challenge: &str) -> Result<Value, ApiError> {
    if !lower_hex(challenge, 64) {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    let key = enrolled_key(&mut tx, node_id).await?;
    let row = sqlx::query_as::<_, Anchor>(
        "SELECT a.inventory_sequence,a.inventory_sha256,a.inventory_tail_digest,
                a.original_node_witness_sha256,a.old_container_id,a.old_started_at,
                a.inventory_bytes,a.first_external_witness,s.witness_bytes
           FROM quota_v2_external_wal_birth_anchors AS a
           LEFT JOIN quota_v2_external_wal_birth_sources AS s USING(node_id,inventory_sequence)
          WHERE a.node_id=$1 ORDER BY a.inventory_sequence DESC LIMIT 1",
    )
    .bind(node_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "No committed WAL checkpoint."))?;
    tx.commit().await?;
    let raw = row.witness_bytes.ok_or_else(conflict)?;
    let w = verify_witness(&raw, &row.inventory_bytes, node_id, &key).map_err(|_| conflict())?;
    let fingerprint = sha256(&raw);
    if row.inventory_sequence != w.inventory_sequence
        || row.inventory_sha256 != w.inventory_sha256
        || row.inventory_tail_digest != w.inventory_tail_digest
        || row.original_node_witness_sha256 != fingerprint
        || row.old_container_id != w.old_container_id
        || row.old_started_at != w.old_started_at
    {
        return Err(conflict());
    }
    let ack = receipt(
        &state.node_policy_signer,
        &w,
        &fingerprint,
        row.first_external_witness,
    )?;
    // This independent proof binds the PostgreSQL snapshot and receipt to
    // the caller's fresh challenge. A reusable stored receipt has no challenge.
    let proof = signed(
        &state.node_policy_signer,
        HEAD_DOMAIN,
        &json!({
            "schemaVersion":1, "kind":"xmesh.quota-v2.external-wal-head",
            "nodeId":node_id, "challenge":challenge, "sequence":row.inventory_sequence,
            "registrySha256":row.inventory_sha256, "receiptSha256":sha256(&ack),
        }),
    )?;
    Ok(json!({
        "head":STANDARD.encode(proof), "receipt":STANDARD.encode(ack),
        "witness":STANDARD.encode(raw), "inventory":STANDARD.encode(row.inventory_bytes),
    }))
}

pub fn route() -> MethodRouter<AppState> {
    post(handle).layer(tower_http::limit::RequestBodyLimitLayer::new(REQUEST_LIMIT))
}

async fn handle(
    State(state): State<AppState>,
    headers: HeaderMap,
    raw: Bytes,
) -> Result<([(header::HeaderName, &'static str); 1], Json<Value>), ApiError> {
    if !std::env::var("XMESH_QUOTA_V2_WAL_TRANSPORT").is_ok_and(|v| v == "1") {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "WAL transport disabled.",
        ));
    }
    let request: Request = serde_json::from_slice(&raw).map_err(|_| invalid())?;
    let node_id = match &request {
        Request::Store { node_id, .. } | Request::Head { node_id, .. } => *node_id,
    };
    if node_id <= 0 {
        return Err(invalid());
    }
    node_auth::authenticate_for(&state, &headers, node_id, &raw, PATH).await?;
    let result = match request {
        Request::Store {
            witness, inventory, ..
        } => store(&state, node_id, &witness, &inventory).await?,
        Request::Head { challenge, .. } => head(&state, node_id, &challenge).await?,
    };
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(result)))
}
