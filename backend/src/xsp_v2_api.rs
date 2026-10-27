//! Experimental XSP-v2 HEARTBEAT ONLY. Requires xsp-v2-experimental build
//! feature AND XSP_V2_EXPERIMENTAL_HEARTBEAT=staging-only at runtime.
//! Never returns config, commands or a success assurance to a control client.
//! Current production Docker excludes the feature entirely.
use crate::{ApiError, AppState};
use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode, header},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, Verifier as _, VerifyingKey};
use openssl::{
    pkey::{KeyType, PKey},
    sign::Verifier as PQVerifier,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_RAW: usize = 1_048_576;
const MAX_PAYLOAD: usize = 524_288;
const SIGNING_PREFIX: &[u8] = b"XSP2-SIGNED-MESSAGE\0";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Signed {
    ed25519: String,
    mldsa65: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    protocol: String,
    suite: String,
    direction: u8,
    message_type: String,
    issuer_id: String,
    node_id: i64,
    method: String,
    path: String,
    ed25519_key_id: String,
    mldsa65_key_id: String,
    key_epoch: i64,
    issued_at_ms: i64,
    expires_at_ms: i64,
    nonce_hex: String,
    request_id: String,
    revision: String,
    payload_b64: String,
    signatures: Signed,
}

struct Parsed {
    value: Envelope,
    canonical: Vec<u8>,
    nonce: [u8; 16],
    ed_signature: [u8; 64],
    pq_signature: Vec<u8>,
}

fn bad() -> ApiError {
    ApiError::new(StatusCode::UNAUTHORIZED, "Invalid XSP-v2 signed heartbeat")
}

fn put_ascii(bytes: &mut Vec<u8>, value: &str, max: usize, optional: bool) -> Result<(), ApiError> {
    if value.len() > max
        || (!optional && value.is_empty())
        || !value.bytes().all(|ch| ch.is_ascii_graphic())
    {
        return Err(bad());
    }
    let length = u32::try_from(value.len()).map_err(|_| bad())?;
    bytes.extend_from_slice(&length.to_be_bytes());
    bytes.extend_from_slice(value.as_bytes());
    Ok(())
}

fn decode_b64(src: &str, limit: usize, exact: Option<usize>) -> Result<Vec<u8>, ApiError> {
    if src.len() > limit.div_ceil(3) * 4 {
        return Err(bad());
    }
    let raw = STANDARD.decode(src).map_err(|_| bad())?;
    if raw.len() > limit
        || exact.is_some_and(|size| size != raw.len())
        || STANDARD.encode(&raw) != src
    {
        return Err(bad());
    }
    Ok(raw)
}

fn parse_for(raw: &[u8], now_ms: i64, message_type: &str, path: &str) -> Result<Parsed, ApiError> {
    if raw.is_empty() || raw.len() > MAX_RAW {
        return Err(bad());
    }
    // serde's derived structs reject duplicate and unknown keys, including
    // the nested signature object. JSON numbers must have exact integer types.
    let e: Envelope = serde_json::from_slice(raw).map_err(|_| bad())?;
    if e.protocol != "XSP/2"
        || e.suite != "Ed25519+ML-DSA-65"
        || e.direction != 1
        || e.message_type != message_type
        || e.method != "POST"
        || e.path != path
        || e.node_id <= 0
        || e.key_epoch <= 0
        || e.issuer_id != format!("node-{}", e.node_id)
        || e.issued_at_ms <= 0
        || e.expires_at_ms <= e.issued_at_ms
        || e.expires_at_ms
            .checked_sub(e.issued_at_ms)
            .is_none_or(|ms| ms > 300_000)
        || now_ms.abs_diff(e.issued_at_ms) > 120_000
        || now_ms > e.expires_at_ms
    {
        return Err(bad());
    }
    let nonce: [u8; 16] = hex::decode(&e.nonce_hex)
        .map_err(|_| bad())?
        .try_into()
        .map_err(|_| bad())?;
    if hex::encode(nonce) != e.nonce_hex || nonce.iter().all(|byte| *byte == 0) {
        return Err(bad());
    }
    let payload = decode_b64(&e.payload_b64, MAX_PAYLOAD, None)?;
    let ed_signature: [u8; 64] = decode_b64(&e.signatures.ed25519, 64, Some(64))?
        .try_into()
        .map_err(|_| bad())?;
    let pq_signature = decode_b64(&e.signatures.mldsa65, 3309, Some(3309))?;

    let mut bytes = SIGNING_PREFIX.to_vec();
    bytes.extend_from_slice(&[2, 1, e.direction]);
    put_ascii(&mut bytes, &e.message_type, 64, false)?;
    put_ascii(&mut bytes, &e.issuer_id, 64, false)?;
    bytes.extend_from_slice(&e.node_id.to_be_bytes());
    put_ascii(&mut bytes, &e.method, 8, false)?;
    put_ascii(&mut bytes, &e.path, 256, false)?;
    put_ascii(&mut bytes, &e.ed25519_key_id, 64, false)?;
    put_ascii(&mut bytes, &e.mldsa65_key_id, 64, false)?;
    bytes.extend_from_slice(&e.key_epoch.to_be_bytes());
    bytes.extend_from_slice(&e.issued_at_ms.to_be_bytes());
    bytes.extend_from_slice(&e.expires_at_ms.to_be_bytes());
    bytes.extend_from_slice(&nonce);
    put_ascii(&mut bytes, &e.request_id, 64, false)?;
    put_ascii(&mut bytes, &e.revision, 128, true)?;
    bytes.extend_from_slice(&Sha256::digest(&payload));
    Ok(Parsed {
        value: e,
        canonical: bytes,
        nonce,
        ed_signature,
        pq_signature,
    })
}

fn parse(raw: &[u8], now_ms: i64) -> Result<Parsed, ApiError> {
    parse_for(raw, now_ms, "node.heartbeat", "/api/v2/node/heartbeat")
}

#[allow(dead_code)] // Staging-only: no authenticated PQ ingress or route is wired.
const ACK_RECOVERY_PATH: &str = "/api/v2/node/keys/rotation/ack";
#[allow(dead_code)] // Domain reserved for the isolated recovery verifier.
const ACK_RECOVERY_MESSAGE: &str = "node.rotation.ack.recovery";

/// Decode an independently signed Node identity assertion bound to the exact
/// original ACK bytes. A signed ACK is NOT itself transport authentication.
#[allow(dead_code)] // Parsed only by the feature-gated, currently uncalled verifier.
fn parse_recovery_authority(
    raw_auth: &[u8],
    exact_saved_ack: &[u8],
    trusted_transport_node_id: i64,
    request_id: &str,
    now_ms: i64,
) -> Result<Parsed, ApiError> {
    if trusted_transport_node_id <= 0
        || exact_saved_ack.is_empty()
        || exact_saved_ack.len() > 16 * 1024
        || request_id.is_empty()
        || request_id.len() > 64
    {
        return Err(bad());
    }
    let parsed = parse_for(raw_auth, now_ms, ACK_RECOVERY_MESSAGE, ACK_RECOVERY_PATH)?;
    if parsed.value.node_id != trusted_transport_node_id || parsed.value.request_id != request_id {
        return Err(bad());
    }
    // The canonical XSP2 envelope signs SHA-256 of the decoded payload.
    // Comparing the original bytes disallows unrelated signed requests.
    let payload = decode_b64(&parsed.value.payload_b64, 16 * 1024, None)?;
    if payload != exact_saved_ack {
        return Err(bad());
    }
    Ok(parsed)
}

fn verify_both(parsed: &Parsed, ed: &[u8], pq: &[u8]) -> Result<(), ApiError> {
    let ed_bytes: [u8; 32] = ed.try_into().map_err(|_| bad())?;
    let key = VerifyingKey::from_bytes(&ed_bytes).map_err(|_| bad())?;
    key.verify(
        &parsed.canonical,
        &Signature::from_bytes(&parsed.ed_signature),
    )
    .map_err(|_| bad())?;
    if pq.len() != 1952 {
        return Err(bad());
    }
    let public = PKey::public_key_from_raw_bytes_ex(None, KeyType::ML_DSA_65, None, pq)
        .map_err(|_| bad())?;
    let mut verifier = PQVerifier::new_without_digest(&public).map_err(|_| bad())?;
    if !verifier
        .verify_oneshot(&parsed.pq_signature, &parsed.canonical)
        .map_err(|_| bad())?
    {
        return Err(bad());
    }
    Ok(())
}

/// Optional STAGING-only handler. The only successful side effect is storing
/// a nonce. An UNSIGNED 204 response MUST NOT be interpreted as a policy ACK.
pub async fn heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, ApiError> {
    if std::env::var("XSP_V2_EXPERIMENTAL_HEARTBEAT").as_deref() != Ok("staging-only") {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Not found"));
    }
    if !headers
        .get(header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| h.eq_ignore_ascii_case("application/json"))
    {
        return Err(bad());
    }
    let now_ms = i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| bad())?
            .as_millis(),
    )
    .map_err(|_| bad())?;
    let parsed = parse(&body, now_ms)?;
    let e = &parsed.value;
    let mut tx = state.pool.begin().await?;
    // Lock the suite state to serialize with owner-mediated epoch activation.
    let suite = sqlx::query(
        "SELECT minimum_suite,activation_phase,key_epoch
         FROM node_xsp_suite_state WHERE node_id=$1 FOR UPDATE",
    )
    .bind(e.node_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(bad)?;
    let floor: i16 = suite.try_get("minimum_suite")?;
    let phase: String = suite.try_get("activation_phase")?;
    let epoch: i64 = suite.try_get("key_epoch")?;
    // NEVER allow production/strict traffic on a staging heartbeat endpoint.
    if floor != 1 || phase != "shadow" || epoch != e.key_epoch {
        return Err(bad());
    }
    let key = sqlx::query(
        "SELECT ed25519_public,mldsa65_public FROM node_xsp_public_keysets
         WHERE node_id=$1 AND purpose='node_request' AND key_epoch=$2
           AND ed25519_key_id=$3 AND mldsa65_key_id=$4 AND revoked_at IS NULL",
    )
    .bind(e.node_id)
    .bind(e.key_epoch)
    .bind(&e.ed25519_key_id)
    .bind(&e.mldsa65_key_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(bad)?;
    let ed: Vec<u8> = key.try_get("ed25519_public")?;
    let pq: Vec<u8> = key.try_get("mldsa65_public")?;
    verify_both(&parsed, &ed, &pq)?;
    let inserted = sqlx::query(
        "INSERT INTO node_xsp_replay_nonces(node_id,key_epoch,direction,nonce,request_id)
         VALUES($1,$2,1,$3,$4) ON CONFLICT DO NOTHING",
    )
    .bind(e.node_id)
    .bind(e.key_epoch)
    .bind(parsed.nonce.to_vec())
    .bind(&e.request_id)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() != 1 {
        return Err(bad());
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Authenticate an independent, doubly-signed Node recovery assertion against
/// the OWNER-ENROLLED public keyset and consume its nonce exactly once.
///
/// This is a feature-gated STAGING verifier, not a network route or TLS server.
/// The trusted Node ID MUST be obtained from an independently authenticated,
/// verified TLS 1.3 X25519MLKEM768 ingress; never derive it from headers, the
/// caller's envelope, the ACK, or the legacy XMESH1 identity. A future route
/// MUST additionally verify the original committed ACK and signed receipt.
/// A successful assertion is NOT authorization to issue a new receipt.
///
/// # Errors
/// Fails on wrong Node/path/type/ACK/request/nonce/timestamps, non-staging
/// suite, unapproved or revoked keys, missing Ed25519 OR ML-DSA-65 signature,
/// concurrent/replayed nonce, and any database failure.
#[allow(dead_code)] // Deliberately not wired into any production or staging HTTP route.
pub async fn authenticate_committed_ack_recovery_staging(
    pool: &sqlx::PgPool,
    trusted_transport_node_id: i64,
    request_id: &str,
    signed_auth_envelope: &[u8],
    exact_saved_ack: &[u8],
) -> Result<(), ApiError> {
    let now_ms = i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| bad())?
            .as_millis(),
    )
    .map_err(|_| bad())?;
    let parsed = parse_recovery_authority(
        signed_auth_envelope,
        exact_saved_ack,
        trusted_transport_node_id,
        request_id,
        now_ms,
    )?;
    let e = &parsed.value;
    let mut tx = pool.begin().await?;
    let suite = sqlx::query(
        "SELECT minimum_suite,activation_phase,key_epoch
         FROM node_xsp_suite_state WHERE node_id=$1 FOR UPDATE",
    )
    .bind(trusted_transport_node_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(bad)?;
    let floor: i16 = suite.try_get("minimum_suite")?;
    let phase: String = suite.try_get("activation_phase")?;
    let epoch: i64 = suite.try_get("key_epoch")?;
    if floor != 1 || !matches!(phase.as_str(), "dual_enrolled" | "shadow") || epoch != e.key_epoch {
        return Err(bad());
    }
    let key = sqlx::query(
        "SELECT ed25519_public,mldsa65_public
         FROM node_xsp_public_keysets
         WHERE node_id=$1 AND purpose='node_request' AND key_epoch=$2
           AND ed25519_key_id=$3 AND mldsa65_key_id=$4 AND revoked_at IS NULL",
    )
    .bind(trusted_transport_node_id)
    .bind(e.key_epoch)
    .bind(&e.ed25519_key_id)
    .bind(&e.mldsa65_key_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(bad)?;
    let ed: Vec<u8> = key.try_get("ed25519_public")?;
    let pq: Vec<u8> = key.try_get("mldsa65_public")?;
    verify_both(&parsed, &ed, &pq)?;
    let inserted = sqlx::query(
        "INSERT INTO node_xsp_replay_nonces(node_id,key_epoch,direction,nonce,request_id)
         VALUES($1,$2,1,$3,$4) ON CONFLICT DO NOTHING",
    )
    .bind(trusted_transport_node_id)
    .bind(e.key_epoch)
    .bind(parsed.nonce.to_vec())
    .bind(request_id)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() != 1 {
        return Err(bad());
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
pub fn recovery_signing_input_for_test(
    raw_auth: &[u8],
    exact_ack: &[u8],
    node_id: i64,
    request_id: &str,
    now_ms: i64,
) -> Result<Vec<u8>, ApiError> {
    parse_recovery_authority(raw_auth, exact_ack, node_id, request_id, now_ms)
        .map(|parsed| parsed.canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    #[test]
    fn recovery_identity_requires_distinct_domain_exact_body_and_pinned_node() {
        let sample: Value =
            serde_json::from_str(include_str!("../../docs/XSP_V2_VECTORS.json")).unwrap();
        let vector = &sample["vectors"][0];
        let now = vector["issued_at_ms"].as_i64().unwrap();
        let node = vector["node_id"].as_i64().unwrap();
        let request = vector["request_id"].as_str().unwrap();
        let ack = b"exact-signed-ack-serialization";
        let mut v = json!({
            "protocol":"XSP/2","suite":"Ed25519+ML-DSA-65",
            "direction":1,"messageType":ACK_RECOVERY_MESSAGE,
            "issuerId":format!("node-{node}"),"nodeId":node,
            "method":"POST","path":ACK_RECOVERY_PATH,
            "ed25519KeyId":vector["ed_key_id"],
            "mldsa65KeyId":vector["pq_key_id"],
            "keyEpoch":vector["key_epoch"],
            "issuedAtMs":now,"expiresAtMs":now + 60_000,
            "nonceHex":"99".repeat(16),"requestId":request,
            "revision":"","payloadB64":STANDARD.encode(ack),
            "signatures":{
                "ed25519":STANDARD.encode([0u8;64]),
                "mldsa65":STANDARD.encode(vec![0u8;3309])
            }
        });
        let encoded = serde_json::to_vec(&v).unwrap();
        let parsed = parse_recovery_authority(&encoded, ack, node, request, now).unwrap();
        assert!(verify_both(&parsed, &[1u8; 32], &[2u8; 1952]).is_err());
        assert!(
            parse(&encoded, now).is_err(),
            "heartbeat domain must differ"
        );
        assert!(parse_recovery_authority(&encoded, ack, node + 1, request, now).is_err());
        assert!(parse_recovery_authority(&encoded, b"changed", node, request, now).is_err());
        assert!(parse_recovery_authority(&encoded, ack, node, "wrong-id", now).is_err());
        assert!(parse_recovery_authority(&encoded, ack, node, request, now + 120_001).is_err());
        for (field, invalid) in [
            ("messageType", json!("node.heartbeat")),
            ("path", json!("/api/v2/node/heartbeat")),
            ("method", json!("GET")),
            ("nonceHex", json!("00".repeat(16))),
            ("issuerId", json!("untrusted")),
            ("payloadB64", json!(STANDARD.encode(b"other-ack"))),
            ("keyEpoch", json!(0)),
        ] {
            let saved = v[field].clone();
            v[field] = invalid;
            assert!(
                parse_recovery_authority(&serde_json::to_vec(&v).unwrap(), ack, node, request, now)
                    .is_err(),
                "{field} must be rejected"
            );
            v[field] = saved;
        }
    }

    #[test]
    fn shared_wire_heartbeat_canonical_and_invalid_cases() {
        let input: Value =
            serde_json::from_str(include_str!("../../docs/XSP_V2_VECTORS.json")).unwrap();
        let sample = &input["vectors"][0];
        let now = sample["issued_at_ms"].as_i64().unwrap();
        let mut envelope = json!({
            "protocol":"XSP/2","suite":"Ed25519+ML-DSA-65",
            "direction":sample["direction_id"],"messageType":sample["message_type"],
            "issuerId":sample["issuer_id"],"nodeId":sample["node_id"],
            "method":sample["method"],"path":sample["path"],
            "ed25519KeyId":sample["ed_key_id"],"mldsa65KeyId":sample["pq_key_id"],
            "keyEpoch":sample["key_epoch"],
            "issuedAtMs":sample["issued_at_ms"],"expiresAtMs":sample["expires_at_ms"],
            "nonceHex":sample["nonce_hex"],"requestId":sample["request_id"],
            "revision":sample["revision"],
            "payloadB64":STANDARD.encode(sample["payload_utf8"].as_str().unwrap()),
            "signatures":{"ed25519":STANDARD.encode([0u8;64]),"mldsa65":STANDARD.encode(vec![0u8;3309])}
        });
        let parsed = parse(&serde_json::to_vec(&envelope).unwrap(), now).unwrap();
        assert_eq!(hex::encode(&parsed.canonical), sample["signing_input_hex"]);
        assert!(verify_both(&parsed, &[1u8; 32], &[1u8; 1952]).is_err());
        // Provider-backed dual-signature positive/negative tests run in the
        // isolated OpenSSL 3.5+ workflow. The standard backend CI may use
        // older OpenSSL without the ML-DSA private-key generation API.
        // Keep wire-format and strict parser regression tests here.
        for (field, replacement) in [
            ("suite", json!("Ed25519")),
            ("path", json!("/api/v1/node/heartbeat")),
            ("issuerId", json!("panel")),
            ("direction", json!(2)),
            ("keyEpoch", json!(0)),
            ("issuedAtMs", json!(now - 121_000)),
            ("nonceHex", json!("BAD")),
            ("payloadB64", json!("Zh==")),
        ] {
            let save = envelope[field].clone();
            envelope[field] = replacement;
            assert!(
                parse(&serde_json::to_vec(&envelope).unwrap(), now).is_err(),
                "{field}"
            );
            envelope[field] = save;
        }
        let raw = serde_json::to_string(&envelope).unwrap();
        let double = raw.replacen(
            "\"protocol\":\"XSP/2\"",
            "\"protocol\":\"XSP/2\",\"protocol\":\"XSP/2\"",
            1,
        );
        assert!(parse(double.as_bytes(), now).is_err());
        let nested = raw.replacen("\"ed25519\":", "\"extra\":1,\"ed25519\":", 1);
        assert!(parse(nested.as_bytes(), now).is_err());
        assert!(parse(&[b'x'; 16], now).is_err());
    }
}
