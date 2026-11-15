//! Sender-constrained Integration API tokens.
//! An opaque bearer is insufficient when a token has a registered Ed25519 key.
//! Proofs cover exact method/path+query/body, token digest, timestamp and nonce.
//! This is a deterministic XMesh PoP contract, not the DPoP RFC JWT format.
use super::{Problem, now_ms};
use crate::AppState;
use axum::{
    body::{Body, to_bytes},
    extract::Request,
    http::{HeaderMap, Method, StatusCode, header::HeaderName},
};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};

const BODY_LIMIT: usize = 64 * 1024;
const CLOCK_SKEW_SECONDS: i64 = 60;
const REPLAY_TTL_SECONDS: u64 = 180;

fn denied() -> Problem {
    Problem::new(
        StatusCode::UNAUTHORIZED,
        "invalid_request_proof",
        "Valid sender-constrained request proof required",
    )
}

fn single_header(headers: &HeaderMap, name: &'static str) -> Result<String, Problem> {
    let name = HeaderName::from_static(name);
    let mut values = headers.get_all(name).iter();
    let value = values.next().and_then(|v| v.to_str().ok()).ok_or_else(denied)?;
    if values.next().is_some() {
        return Err(denied());
    }
    Ok(value.to_owned())
}

fn lowercase_hex(value: &str, len: usize) -> bool {
    value.len() == len && value.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

pub(super) fn proof_message(
    token_hash: &str,
    method: &Method,
    path_and_query: &str,
    timestamp: i64,
    nonce: &str,
    body: &[u8],
) -> Vec<u8> {
    let body_hash = hex::encode(Sha256::digest(body));
    format!(
        "xmesh-proof-v1\n{token_hash}\n{method}\n{path_and_query}\n{timestamp}\n{nonce}\n{body_hash}"
    )
    .into_bytes()
}

fn validate_signature(
    public_key: &[u8],
    token_hash: &str,
    method: &Method,
    path: &str,
    body: &[u8],
    headers: &HeaderMap,
) -> Result<String, Problem> {
    let timestamp = single_header(headers, "x-xmesh-proof-ts")?;
    let nonce = single_header(headers, "x-xmesh-proof-nonce")?;
    let signature_hex = single_header(headers, "x-xmesh-proof-sig")?;
    let now = now_ms() / 1000;
    let timestamp_value = timestamp.parse::<i64>().map_err(|_| denied())?;
    if timestamp != timestamp_value.to_string()
        || timestamp_value.abs_diff(now) > CLOCK_SKEW_SECONDS as u64
        || !lowercase_hex(&nonce, 32)
        || !lowercase_hex(&signature_hex, 128)
    {
        return Err(denied());
    }
    let key_array: [u8; 32] = public_key.try_into().map_err(|_| denied())?;
    let key = VerifyingKey::from_bytes(&key_array).map_err(|_| denied())?;
    let signature_bytes = hex::decode(signature_hex).map_err(|_| denied())?;
    let signature = Signature::from_slice(&signature_bytes).map_err(|_| denied())?;
    key.verify(
        &proof_message(token_hash, method, path, timestamp_value, &nonce, body),
        &signature,
    )
    .map_err(|_| denied())?;
    // The verified nonce is returned separately to store only a hash in Redis.
    Ok(nonce)
}

/// The incoming request has already passed token validation. A stolen bearer
/// cannot be used on another machine without the Ed25519 private key.
/// Redis outages fail closed. Legacy unbound tokens remain valid until rotated.
pub(super) async fn constrain(
    state: &AppState,
    request: Request,
    token_hash: &str,
    proof_key: Option<&[u8]>,
    token_id: i64,
) -> Result<Request, Problem> {
    let Some(proof_key) = proof_key else {
        return Ok(request);
    };
    let (parts, body) = request.into_parts();
    let bytes = to_bytes(body, BODY_LIMIT).await.map_err(|_| {
        Problem::new(StatusCode::PAYLOAD_TOO_LARGE, "payload_too_large", "Payload too large")
    })?;
    let path = parts.uri.path_and_query().map_or("/", |p| p.as_str());
    let nonce = validate_signature(
        proof_key, token_hash, &parts.method, path, &bytes, &parts.headers,
    )?;
    let nonce_hash = hex::encode(Sha256::digest(nonce.as_bytes()));
    let mut redis = state.redis.clone();
    let stored: Option<String> = redis::cmd("SET")
        .arg(format!("xmesh:int:proof:v1:{token_id}:{nonce_hash}"))
        .arg("1")
        .arg("NX")
        .arg("EX")
        .arg(REPLAY_TTL_SECONDS)
        .query_async(&mut redis)
        .await
        .map_err(|_| Problem::unavailable())?;
    if stored.is_none() {
        return Err(denied());
    }
    Ok(Request::from_parts(parts, Body::from(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn signatures_are_bound_to_every_request_dimension() {
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let token = hex::encode(Sha256::digest(b"example-token"));
        let nonce = "0".repeat(32);
        let time = now_ms() / 1000;
        let expected = proof_message(&token, &Method::POST, "/api/v1/integrations/users?a=1", time, &nonce, b"{}");
        let signature = hex::encode(key.sign(&expected).to_bytes());
        let mut headers = HeaderMap::new();
        headers.insert("x-xmesh-proof-ts", time.to_string().parse().unwrap());
        headers.insert("x-xmesh-proof-nonce", nonce.parse().unwrap());
        headers.insert("x-xmesh-proof-sig", signature.parse().unwrap());
        let pubkey = key.verifying_key().to_bytes();
        assert!(validate_signature(&pubkey, &token, &Method::POST, "/api/v1/integrations/users?a=1", b"{}", &headers).is_ok());
        assert!(validate_signature(&pubkey, &token, &Method::POST, "/api/v1/integrations/users?a=2", b"{}", &headers).is_err());
        assert!(validate_signature(&pubkey, &token, &Method::GET, "/api/v1/integrations/users?a=1", b"{}", &headers).is_err());
        assert!(validate_signature(&pubkey, &token, &Method::POST, "/api/v1/integrations/users?a=1", b"{ }", &headers).is_err());
        assert!(validate_signature(&pubkey, &hex::encode(Sha256::digest(b"stolen-other-token")), &Method::POST, "/api/v1/integrations/users?a=1", b"{}", &headers).is_err());
    }

    #[test]
    fn malformed_or_expired_proofs_fail_closed() {
        assert!(!lowercase_hex("AA", 2));
        assert!(!lowercase_hex("gg", 2));
        assert!(!lowercase_hex("", 32));
        assert_eq!(proof_message(&"a".repeat(64), &Method::GET, "/abc", 1, &"b".repeat(32), b"").len() > 110, true);
    }
}
