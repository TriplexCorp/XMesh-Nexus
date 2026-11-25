//! Independently recompute the Node's first-Genesis signed Xray cap roster digest.
//!
//! This is a READ-ONLY pure verifier, not an HTTP issuer or public TLS permit.
//! The signed cap bytes must originate from the immutable PostgreSQL outbox,
//! and the expected user IDs from the independently enrolled Genesis policy.
//! Caller must additionally lock/check the current SQL leases, revocations,
//! complete WAL, installed Xray caps, certificates and strict-PQ identity.
//! In particular, this hash alone NEVER authorizes a public listener.
use crate::{node_policy::PolicySigner, quota_v2_cap_signing::DOMAIN};
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const MAX_USERS: usize = 2048;
const MAX_CAP_BYTES: usize = 8192;
const MAX_CAP_LIFETIME_MS: i64 = 86_400_000;

pub struct FirstTlsIdentity<'a> {
    pub node_id: i64,
    pub activation_sha256: &'a str,
    pub genesis_policy_sha256: &'a str,
    pub runtime_id: &'a str,
}

fn hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch))
}

fn canonical_uuid(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|raw| uuid::Uuid::parse_str(raw).is_ok_and(|parsed| parsed.to_string() == raw))
}

fn verified_aliases(cap: &Value, user_id: i64) -> Result<&Vec<Value>> {
    let aliases = cap["aliasScopes"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("signed cap aliases are missing"))?;
    ensure!(
        (1..=2).contains(&aliases.len()),
        "invalid signed VLESS MAIN/CDN alias count"
    );
    let mut previous_alias = "";
    for alias in aliases {
        ensure!(
            alias.as_object().is_some_and(|a| {
                a.len() == 2 && a.contains_key("email") && a.contains_key("class")
            }),
            "malformed signed VLESS class alias"
        );
        let class = alias["class"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing signed alias class"))?;
        let email = alias["email"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing signed alias email"))?;
        ensure!(
            matches!(class, "main" | "cdn")
                && email == format!("xmesh-u{user_id}--vless-{class}")
                && email > previous_alias,
            "duplicate, unordered or cross-user signed VLESS alias"
        );
        previous_alias = email;
    }
    Ok(aliases)
}

/// Computes exactly the SHA-256 of Node `SignedCapRosterWatch`'s canonical
/// list of {userId, grantSha256, aliases}; no trusting Node-provided digest.
///
/// All inputs must be obtained from the SAME database transaction/snapshot.
/// The caller must separately verify every row's current SQL lease and WAL,
/// because a valid historical Ed25519 cap is not evidence of live spending.
pub fn verified_signed_first_cap_roster_sha256(
    signer: &PolicySigner,
    identity: &FirstTlsIdentity<'_>,
    expected_users: &[i64],
    outbox: &[(i64, Vec<u8>)],
    now_ms: i64,
    required_lifetime_ms: i64,
) -> Result<String> {
    ensure!(
        identity.node_id > 0
            && now_ms > 0
            && (1_000..=120_000).contains(&required_lifetime_ms)
            && [
                identity.activation_sha256,
                identity.genesis_policy_sha256,
                identity.runtime_id
            ]
            .into_iter()
            .all(hex64),
        "untrusted TLS roster identity or clock"
    );
    let latest = now_ms
        .checked_add(required_lifetime_ms)
        .ok_or_else(|| anyhow::anyhow!("TLS witness expiry overflow"))?;
    ensure!(
        (1..=MAX_USERS).contains(&expected_users.len()) && expected_users.len() == outbox.len(),
        "incomplete original Genesis cap roster"
    );
    let mut result = Vec::<Value>::with_capacity(outbox.len());
    let mut previous = 0_i64;
    for (index, (user_id, raw)) in outbox.iter().enumerate() {
        ensure!(
            *user_id > previous
                && *user_id == expected_users[index]
                && (100..=MAX_CAP_BYTES).contains(&raw.len()),
            "unexpected, duplicated or missing signed Genesis user"
        );
        previous = *user_id;
        let doc: Value = serde_json::from_slice(raw)?;
        ensure!(
            doc.is_object()
                && doc.as_object().is_some_and(|obj| {
                    obj.len() == 3
                        && obj.contains_key("algorithm")
                        && obj.contains_key("payload")
                        && obj.contains_key("signature")
                })
                && doc["algorithm"] == "Ed25519"
                && doc["payload"].is_object(),
            "malformed signed Xray cap outbox envelope"
        );
        let mut canonical = serde_json::to_vec(&doc)?;
        canonical.push(b'\n');
        ensure!(
            raw.as_slice() == canonical.as_slice()
                && doc["signature"].as_str()
                    == Some(signer.sign_domain(DOMAIN, &doc["payload"])?.as_str()),
            "noncanonical, unsigned or foreign signed cap"
        );
        let cap = &doc["payload"];
        let issued = cap["issuedAtMs"].as_i64();
        let expires = cap["validUntilMs"].as_i64();
        ensure!(
            cap["schemaVersion"] == 1
                && cap["kind"] == "xmesh.quota-v2.xray-cap-admission"
                && cap["nodeId"].as_i64() == Some(identity.node_id)
                && cap["userId"].as_i64() == Some(*user_id)
                && cap["activationReceiptSha256"].as_str() == Some(identity.activation_sha256)
                && cap["policySha256"].as_str() == Some(identity.genesis_policy_sha256)
                && cap["runtimeId"].as_str() == Some(identity.runtime_id)
                && cap["canSpend"] == true
                && cap["canStart"] == false
                && cap["canResume"] == false
                && cap["finalMeterVerified"] == false
                && cap["refundableBytes"] == 0
                && cap["reservationRevision"].as_i64().is_some_and(|v| v > 0)
                && canonical_uuid(&cap["accountEpoch"])
                && canonical_uuid(&cap["meterEpoch"])
                && canonical_uuid(&cap["reservationId"])
                && issued.is_some_and(|value| value > 0 && value <= now_ms)
                && matches!((issued, expires), (Some(i), Some(e))
                     if e > latest && e - i <= MAX_CAP_LIFETIME_MS),
            "expired, foreign or authorizing Xray cap cannot enter TLS roster"
        );
        let aliases = verified_aliases(cap, *user_id)?;
        // Do not hash reserialized grant JSON: Node hashes the EXACT stored
        // Ed25519 wire bytes, including the canonical trailing newline.
        result.push(json!({
            "userId": *user_id,
            "grantSha256": hex::encode(Sha256::digest(raw)),
            "aliases": aliases,
        }));
    }
    let canonical_roster = serde_json::to_vec(&result)?;
    Ok(hex::encode(Sha256::digest(&canonical_roster)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn identity() -> FirstTlsIdentity<'static> {
        FirstTlsIdentity {
            node_id: 47,
            activation_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            genesis_policy_sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            runtime_id: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        }
    }

    fn signing_key() -> PolicySigner {
        let path = std::env::temp_dir().join(format!(
            "xmesh-first-tls-cap-roster-{}",
            uuid::Uuid::new_v4()
        ));
        let key = PolicySigner::load(&path).expect("ephemeral signing key");
        fs::remove_file(path).expect("remove ephemeral fixture key");
        key
    }

    fn cap(signer: &PolicySigner, user: i64, override_claim: impl FnOnce(&mut Value)) -> Vec<u8> {
        let binding = identity();
        let mut payload = json!({
            "schemaVersion":1, "kind":"xmesh.quota-v2.xray-cap-admission",
            "nodeId":binding.node_id,"userId":user,
            "activationReceiptSha256":binding.activation_sha256,
            "policySha256":binding.genesis_policy_sha256,
            "runtimeId":binding.runtime_id,
            "accountEpoch":"11111111-1111-4111-8111-111111111111",
            "meterEpoch":"22222222-2222-4222-8222-222222222222",
            "reservationId":"33333333-3333-4333-8333-333333333333",
            "reservationRevision":1,"issuedAtMs":1_800_000_000_000_i64,
            "validUntilMs":1_800_000_060_000_i64,"canSpend":true,
            "canStart":false,"canResume":false,"finalMeterVerified":false,
            "refundableBytes":0,
            "aliasScopes":[
                {"email":format!("xmesh-u{user}--vless-cdn"),"class":"cdn"},
                {"email":format!("xmesh-u{user}--vless-main"),"class":"main"}
            ],
        });
        override_claim(&mut payload);
        let sig = signer.sign_domain(DOMAIN, &payload).expect("sign fixture");
        let mut wire = serde_json::to_vec(&json!({
            "algorithm":"Ed25519","payload":payload,"signature":sig
        }))
        .expect("canonical cap");
        wire.push(b'\n');
        wire
    }

    fn compute(signer: &PolicySigner, ids: &[i64], caps: &[(i64, Vec<u8>)]) -> Result<String> {
        verified_signed_first_cap_roster_sha256(
            signer,
            &identity(),
            ids,
            caps,
            1_800_000_001_000,
            1_000,
        )
    }

    #[test]
    fn exact_signed_wire_digest_matches_node_canonical_roster() {
        let signer = signing_key();
        let rows = vec![
            (15, cap(&signer, 15, |_| {})),
            (21, cap(&signer, 21, |_| {})),
        ];
        let digest = compute(&signer, &[15, 21], &rows).unwrap();
        let expected = json!(
            rows.iter()
                .map(|(user, raw)| json!({
                    "userId":user,"grantSha256":hex::encode(Sha256::digest(raw)),
                    "aliases":[
                        {"email":format!("xmesh-u{user}--vless-cdn"),"class":"cdn"},
                        {"email":format!("xmesh-u{user}--vless-main"),"class":"main"}
                    ]
                }))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            digest,
            hex::encode(Sha256::digest(serde_json::to_vec(&expected).unwrap()))
        );
    }

    #[test]
    fn missing_duplicate_extra_and_reordered_users_always_fail() {
        let signer = signing_key();
        let row = (15, cap(&signer, 15, |_| {}));
        assert!(compute(&signer, &[15], std::slice::from_ref(&row)).is_ok());
        for (ids, rows) in [
            (vec![15, 21], vec![row.clone()]),
            (vec![15], vec![row.clone(), (21, cap(&signer, 21, |_| {}))]),
            (vec![15, 15], vec![row.clone(), row.clone()]),
            (
                vec![21, 15],
                vec![(21, cap(&signer, 21, |_| {})), row],
            ),
            (vec![15], vec![(99, cap(&signer, 99, |_| {}))]),
        ] {
            assert!(compute(&signer, &ids, &rows).is_err());
        }
    }

    #[test]
    fn wire_forgery_and_wrong_signing_key_are_denied() {
        let signer = signing_key();
        let foreign = signing_key();
        let original = cap(&signer, 15, |_| {});
        assert!(compute(&foreign, &[15], &[(15, original.clone())]).is_err());
        let mut modified = original.clone();
        let index = modified.iter().position(|c| *c == b'1').unwrap();
        modified[index] = b'0';
        assert!(compute(&signer, &[15], &[(15, modified)]).is_err());
        let mut noncanonical = original.clone();
        noncanonical.insert(0, b' ');
        assert!(compute(&signer, &[15], &[(15, noncanonical)]).is_err());
        assert!(
            compute(
                &signer,
                &[15],
                &[(15, original[..original.len() - 1].to_vec())]
            )
            .is_err()
        );
    }

    #[test]
    fn signed_stale_authorizing_or_foreign_class_caps_are_denied() {
        let signer = signing_key();
        for mutate in [
            |v: &mut Value| v["validUntilMs"] = json!(1_800_000_001_100_i64),
            |v: &mut Value| v["canStart"] = json!(true),
            |v: &mut Value| v["refundableBytes"] = json!(100),
            |v: &mut Value| v["runtimeId"] = json!("f".repeat(64)),
            |v: &mut Value| v["aliasScopes"][0]["email"] = json!("xmesh-u22--vless-cdn"),
            |v: &mut Value| v["aliasScopes"][0]["class"] = json!("foreign"),
            |v: &mut Value| v["aliasScopes"][0]["email"] = json!("xmesh-u15--vless-main"),
            |v: &mut Value| v["reservationRevision"] = json!(0),
        ] {
            assert!(compute(&signer, &[15], &[(15, cap(&signer, 15, mutate))]).is_err());
        }
    }
}
