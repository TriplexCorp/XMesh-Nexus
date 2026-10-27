//! PR01 test-only XSP-v2 canonical byte encoder.
//! No production v2 authentication, ML-DSA signatures or downgrade changes.
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Clone, Deserialize)]
struct WireVector {
    id: String,
    direction_id: u8,
    message_type: String,
    issuer_id: String,
    node_id: u64,
    method: String,
    path: String,
    ed_key_id: String,
    pq_key_id: String,
    key_epoch: u64,
    issued_at_ms: i64,
    expires_at_ms: i64,
    nonce_hex: String,
    request_id: String,
    revision: String,
    payload_utf8: String,
    payload_sha256: String,
    signing_input_hex: String,
}

#[derive(Deserialize)]
struct VectorDocument {
    schema: String,
    vectors: Vec<WireVector>,
}

fn put_ascii(
    output: &mut Vec<u8>,
    value: &str,
    max_len: usize,
    optional: bool,
) -> Result<(), &'static str> {
    if value.len() > max_len || (!optional && value.is_empty()) {
        return Err("invalid string size");
    }
    if !value.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err("non-ASCII metadata");
    }
    let len = u32::try_from(value.len()).map_err(|_| "oversized string")?;
    output.extend_from_slice(&len.to_be_bytes());
    output.extend_from_slice(value.as_bytes());
    Ok(())
}

fn canonical_input(vector: &WireVector) -> Result<Vec<u8>, &'static str> {
    let allowed_direction = match vector.message_type.as_str() {
        "node.enroll"
        | "node.desired-config.request"
        | "node.heartbeat"
        | "metrics.ingest"
        | "node.command.poll"
        | "node.command.ack" => 1_u8,
        "node.desired-config.response" | "node.command.response" => 2,
        "node.security.activate" | "node.keys.rotate" | "node.security.recover" => 3,
        _ => return Err("unknown message type"),
    };
    if !matches!(vector.direction_id, 1 | 2)
        || allowed_direction & vector.direction_id == 0
    {
        return Err("invalid direction");
    }
    if vector.node_id == 0
        || vector.key_epoch == 0
        || vector.issued_at_ms <= 0
        || vector.expires_at_ms <= vector.issued_at_ms
        || vector
            .expires_at_ms
            .checked_sub(vector.issued_at_ms)
            .is_none_or(|duration| duration > 300_000)
    {
        return Err("invalid metadata or lifetime");
    }
    if vector.method != "POST"
        || !vector.path.starts_with("/api/v2/node/")
        || vector.path.contains(&['?', '#', '\\'][..])
        || vector.path.contains("..")
    {
        return Err("invalid HTTP binding");
    }
    if vector.payload_utf8.len() > 524_288 {
        return Err("oversized payload");
    }
    let nonce = hex::decode(&vector.nonce_hex).map_err(|_| "invalid nonce")?;
    if nonce.len() != 16 || hex::encode(&nonce) != vector.nonce_hex {
        return Err("invalid nonce");
    }

    let mut result = b"XSP2-SIGNED-MESSAGE\0".to_vec();
    result.extend_from_slice(&[2, 1, vector.direction_id]);
    put_ascii(&mut result, &vector.message_type, 64, false)?;
    put_ascii(&mut result, &vector.issuer_id, 64, false)?;
    result.extend_from_slice(&vector.node_id.to_be_bytes());
    put_ascii(&mut result, &vector.method, 8, false)?;
    put_ascii(&mut result, &vector.path, 256, false)?;
    put_ascii(&mut result, &vector.ed_key_id, 64, false)?;
    put_ascii(&mut result, &vector.pq_key_id, 64, false)?;
    result.extend_from_slice(&vector.key_epoch.to_be_bytes());
    result.extend_from_slice(&vector.issued_at_ms.to_be_bytes());
    result.extend_from_slice(&vector.expires_at_ms.to_be_bytes());
    result.extend_from_slice(&nonce);
    put_ascii(&mut result, &vector.request_id, 64, false)?;
    put_ascii(&mut result, &vector.revision, 128, true)?;
    result.extend_from_slice(&Sha256::digest(vector.payload_utf8.as_bytes()));
    Ok(result)
}

#[test]
fn xsp_v2_shared_canonical_vectors_and_negative_cases() {
    let document: VectorDocument =
        serde_json::from_str(include_str!("../../docs/XSP_V2_VECTORS.json"))
            .expect("shared fixture JSON");
    assert_eq!(document.schema, "xsp2-wire-candidate-1");
    assert_eq!(document.vectors.len(), 2);
    for vector in document.vectors {
        let input = canonical_input(&vector).expect("canonical input");
        assert_eq!(hex::encode(&input), vector.signing_input_hex, "{}", vector.id);
        assert_eq!(
            hex::encode(Sha256::digest(vector.payload_utf8.as_bytes())),
            vector.payload_sha256,
            "{}",
            vector.id
        );
        let mut changed = vector.clone();
        changed.payload_utf8.push('!');
        assert_ne!(canonical_input(&changed).unwrap(), input, "payload binding");
        changed = vector.clone();
        changed.path.push_str("/altered");
        assert_ne!(canonical_input(&changed).unwrap(), input, "endpoint binding");
        changed = vector.clone();
        changed.direction_id = 3;
        assert!(canonical_input(&changed).is_err(), "direction rejection");
        changed = vector.clone();
        changed.expires_at_ms = changed.issued_at_ms - 1;
        assert!(canonical_input(&changed).is_err(), "lifetime rejection");
        changed = vector.clone();
        changed.nonce_hex = "abcd".into();
        assert!(canonical_input(&changed).is_err(), "nonce rejection");
        changed = vector;
        changed.key_epoch = 0;
        assert!(canonical_input(&changed).is_err(), "key epoch rejection");
    }
}
