//! Candidate server-side archival verifier. Not linked into the runtime API.
//!
//! The caller must independently recover the full historical scope from
//! trusted enrollment and immutable SQL records. Observed local denials,
//! ledger digest and stopped-PID claims remain statements in the archive,
//! NOT independently established kernel facts or final byte accounting.
//! Neither a valid Node signature nor the retained historical Nexus response
//! can authorize a successor, settlement, refund, public listener or spend.
use super::{lower_hex, sha256};
use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::{Value, json};
use std::collections::BTreeSet;

const POSSESSION_DOMAIN: &[u8] = b"XMESH_QUOTA_V2_HISTORICAL_RETIREMENT_ARCHIVE_POSSESSION_V1\0";
const WAL_HEAD_DOMAIN: &[u8] = b"XMESH_QUOTA_V2_PUBLIC_TLS_WAL_HEAD_V2\0";
const LIMIT: usize = 8192;

type Check<T> = Result<T, &'static str>;

/// All fields come from independent trusted history, never the archive.
/// This first contract supports only the independently committed nonempty
/// birth-index path with every stream charged and a complete cap roster.
#[derive(Clone, Copy)]
struct Scope<'a> {
    node: i64,
    activation: &'a str,
    node_key: &'a VerifyingKey,
    policy_key: &'a VerifyingKey,
    runtime: &'a str,
    container: &'a str,
    pid: i64,
    started_at: &'a str,
    genesis: &'a str,
    profile: &'a str,
    roster: &'a str,
    users: &'a [i64],
    witness_user: i64,
    sequence: i64,
    inventory: &'a str,
    inventory_tail: &'a str,
    charge_heads: &'a str,
}

impl Scope<'_> {
    fn validate(&self) -> Check<()> {
        let roster: BTreeSet<_> = self.users.iter().copied().collect();
        require(
            self.node > 0
                && self.pid > 1
                && (1..=4096).contains(&self.sequence)
                && !roster.is_empty()
                && roster.len() <= 4096
                && roster.len() == self.users.len()
                && roster.iter().all(|user| *user > 0)
                && roster.contains(&self.witness_user),
            "invalid trusted historical roster or scope",
        )?;
        require(
            [
                self.activation,
                self.runtime,
                self.container,
                self.genesis,
                self.profile,
                self.roster,
                self.inventory,
                self.inventory_tail,
                self.charge_heads,
            ]
            .iter()
            .all(|digest| lower_hex(digest, 64))
                && (20..=64).contains(&self.started_at.len())
                && self.started_at.contains('T')
                && self.started_at.ends_with('Z')
                && self.started_at.bytes().all(|b| b.is_ascii_graphic()),
            "invalid trusted historical digests",
        )
    }
}

/// Successful verification proves possession only. The result deliberately
/// carries no authority, local truth, meter or amount.
#[derive(Debug, PartialEq, Eq)]
struct VerifiedPossession {
    node: i64,
    runtime: String,
    archive_sha256: String,
    response_sha256: String,
}

const fn require(condition: bool, reason: &'static str) -> Check<()> {
    if condition { Ok(()) } else { Err(reason) }
}

fn object(raw: &[u8], newline: bool) -> Check<Value> {
    require(!raw.is_empty() && raw.len() <= LIMIT, "invalid wire size")?;
    let value: Value = serde_json::from_slice(raw).map_err(|_| "invalid JSON")?;
    require(value.is_object(), "expected JSON object")?;
    let mut canonical = serde_json::to_vec(&value).map_err(|_| "invalid canonical JSON")?;
    if newline {
        canonical.push(b'\n');
    }
    // Duplicate keys, extra whitespace, alternate escapes and integer
    // spellings cannot survive exact canonical reconstruction.
    require(canonical == raw, "noncanonical wire bytes")?;
    Ok(value)
}

fn digest(value: &Value) -> Check<&str> {
    value
        .as_str()
        .filter(|s| lower_hex(s, 64))
        .ok_or("invalid digest")
}

fn verify_envelope(
    envelope: &Value,
    expected: &Value,
    domain: &[u8],
    key: &VerifyingKey,
) -> Check<()> {
    require(
        envelope.as_object().is_some_and(|doc| doc.len() == 3)
            && envelope["algorithm"] == "Ed25519"
            && envelope["payload"] == *expected,
        "signature envelope differs from independently reconstructed payload",
    )?;
    let signature = envelope["signature"]
        .as_str()
        .filter(|raw| lower_hex(raw, 128))
        .ok_or("invalid detached signature")?;
    let bytes = hex::decode(signature).map_err(|_| "invalid signature encoding")?;
    let signature = Signature::from_slice(&bytes).map_err(|_| "invalid signature size")?;
    let mut message = domain.to_vec();
    serde_json::to_writer(&mut message, expected).map_err(|_| "invalid signature message")?;
    key.verify_strict(&message, &signature)
        .map_err(|_| "wrong key, domain or signature")
}

fn verify_observation(observation: &Value, scope: &Scope<'_>, response_sha: &str) -> Check<()> {
    let denials = observation["durableUserDenials"]
        .as_object()
        .ok_or("invalid durable denials")?;
    require(
        denials.len() == scope.users.len()
            && scope.users.iter().all(|uid| {
                denials
                    .get(&uid.to_string())
                    .is_some_and(|v| digest(v).is_ok())
            }),
        "archived denial roster differs from independently known roster",
    )?;
    let retired_ledger = digest(&observation["retiredLedgerSha256"])?;
    // Preserve the local assertions in the historical record, not as
    // verified facts. Reconstruct every other field and all exact flags.
    let expected = json!({
        "schemaVersion":1, "kind":"xmesh.quota-v2.nonfinal-first-meter-retirement",
        "nodeId":scope.node, "runtimeId":scope.runtime, "containerId":scope.container,
        "startedAt":scope.started_at, "signedWalReadbackSha256":response_sha,
        "inventorySha256":scope.inventory, "committedChargeHeadsSha256":scope.charge_heads,
        "durableUserDenials":denials, "originalMeterPidfdExited":true,
        "lifetimeLockReleased":true, "retiredLedgerSha256":retired_ledger,
        "finalMeterVerified":false, "settlementEligible":false, "canResume":false,
        "refundableBytes":0, "deliveredBytesVerified":false, "nodeSignatureVerified":false,
        "canServePublic":false, "canStart":false,
    });
    require(
        *observation == expected,
        "unexpected historical observation",
    )
}

fn verify_readback(response: &[u8], scope: &Scope<'_>) -> Check<(i64, i64)> {
    let outer = object(response, false)?;
    require(
        outer.as_object().is_some_and(|doc| doc.len() == 1),
        "unexpected historical response",
    )?;
    let raw = outer["signedEnvelope"]
        .as_str()
        .ok_or("missing historical envelope")?;
    let envelope = object(raw.as_bytes(), true)?;
    let payload = &envelope["payload"];
    let challenge = digest(&payload["challenge"])?;
    let issued = payload["issuedAtMs"]
        .as_i64()
        .ok_or("invalid issued time")?;
    let expires = payload["validUntilMs"].as_i64().ok_or("invalid expiry")?;
    // Historical validation, not acceptance as a fresh witness. Bounds
    // avoid overflow and reject an authorizing long-lived response.
    require(
        issued > 0 && expires > issued && expires - issued <= 7000,
        "invalid original lifetime",
    )?;
    let expected = json!({
        "schemaVersion":2, "kind":"xmesh.quota-v2.public-tls-wal-head",
        "nodeId":scope.node, "userId":scope.witness_user,
        "activationReceiptSha256":scope.activation, "genesisPolicySha256":scope.genesis,
        "runtimeId":scope.runtime, "profileRevision":scope.profile, "capRosterSha256":scope.roster,
        "challenge":challenge, "containerId":scope.container, "hostPid":scope.pid,
        "startedAt":scope.started_at, "issuedAtMs":issued, "validUntilMs":expires,
        "historyState":"committed_birth_index", "inventorySequence":scope.sequence,
        "inventorySha256":scope.inventory, "inventoryTailDigest":scope.inventory_tail,
        "committedChargeStreamCount":scope.sequence, "committedChargeHeadsSha256":scope.charge_heads,
        "preBootstrapHistoryCompletenessVerified":false, "liveMeterVerified":false,
        "finalMeterVerified":false, "canServePublic":false, "canSpend":false, "canStart":false,
        "canResume":false, "authorizedBytes":0, "refundableBytes":0,
    });
    verify_envelope(&envelope, &expected, WAL_HEAD_DOMAIN, scope.policy_key)?;
    Ok((issued, expires))
}

fn verify(archive: &[u8], possession: &[u8], scope: &Scope<'_>) -> Check<VerifiedPossession> {
    scope.validate()?;
    let record = object(archive, true)?;
    require(
        record.as_object().is_some_and(|doc| doc.len() == 2),
        "unexpected archive shape",
    )?;
    let response = record["nexusResponse"]
        .as_str()
        .ok_or("missing historical response")?
        .as_bytes();
    let response_sha = sha256(response);
    verify_observation(&record["observation"], scope, &response_sha)?;
    let (issued, expires) = verify_readback(response, scope)?;
    let archive_sha = sha256(archive);
    let expected = json!({
        "schemaVersion":1, "kind":"xmesh.quota-v2.historical-retirement-archive-possession",
        "nodeId":scope.node, "activationReceiptSha256":scope.activation,
        "nodePublicKey":hex::encode(scope.node_key.to_bytes()),
        "nexusPublicKey":hex::encode(scope.policy_key.to_bytes()), "runtimeId":scope.runtime,
        "archiveSha256":archive_sha, "signedWalReadbackSha256":response_sha,
        "nexusIssuedAtMs":issued, "nexusValidUntilMs":expires,
        "archivePossessionOnly":true, "localObservationsVerified":false,
        "liveMeterVerified":false, "deliveredBytesVerified":false, "finalMeterVerified":false,
        "settlementEligible":false, "canServePublic":false, "canSpend":false,
        "canStart":false, "canResume":false, "authorizedBytes":0, "refundableBytes":0,
    });
    verify_envelope(
        &object(possession, true)?,
        &expected,
        POSSESSION_DOMAIN,
        scope.node_key,
    )?;
    Ok(VerifiedPossession {
        node: scope.node,
        runtime: scope.runtime.to_owned(),
        archive_sha256: archive_sha,
        response_sha256: response_sha,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    // Public synthetic fixture keys only; not enrolled product keys.
    const NODE_TEST_SEED: [u8; 32] = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
        25, 26, 27, 28, 29, 30, 31,
    ];
    const POLICY_TEST_SEED: [u8; 32] = [
        32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54,
        55, 56, 57, 58, 59, 60, 61, 62, 63,
    ];

    struct Fixture {
        archive: String,
        payload: Value,
        proof: Vec<u8>,
        node: VerifyingKey,
        policy: VerifyingKey,
    }

    fn wire(value: &Value) -> Vec<u8> {
        let mut raw = serde_json::to_vec(value).unwrap();
        raw.push(b'\n');
        raw
    }

    fn sign(payload: &Value, domain: &[u8], seed: &[u8; 32]) -> Vec<u8> {
        let mut message = domain.to_vec();
        serde_json::to_writer(&mut message, payload).unwrap();
        let sig = SigningKey::from_bytes(seed).sign(&message);
        wire(&json!({
            "algorithm":"Ed25519", "payload":payload, "signature":hex::encode(sig.to_bytes()),
        }))
    }

    impl Fixture {
        fn new() -> Self {
            let vector: Value =
                serde_json::from_str(include_str!("fixtures/retirement_possession.json")).unwrap();
            let message = hex::decode(vector["messageHex"].as_str().unwrap()).unwrap();
            let payload: Value =
                serde_json::from_slice(message.strip_prefix(POSSESSION_DOMAIN).unwrap()).unwrap();
            let proof = wire(&json!({
                "algorithm":"Ed25519", "payload":payload, "signature":vector["signature"],
            }));
            let node = SigningKey::from_bytes(&NODE_TEST_SEED).verifying_key();
            let policy = SigningKey::from_bytes(&POLICY_TEST_SEED).verifying_key();
            assert_eq!(
                hex::encode(node.to_bytes()),
                vector["nodePublicKey"].as_str().unwrap()
            );
            assert_eq!(
                hex::encode(policy.to_bytes()),
                vector["nexusPublicKey"].as_str().unwrap()
            );
            Self {
                archive: vector["archive"].as_str().unwrap().to_owned(),
                payload,
                proof,
                node,
                policy,
            }
        }

        const fn scope(&self) -> Scope<'_> {
            // Independently pinned literal SQL-shaped fixture, not derived
            // from the archive, signed response or possession payload.
            Scope {
                node: 42,
                activation: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                node_key: &self.node,
                policy_key: &self.policy,
                runtime: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                container: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                pid: 731,
                started_at: "2026-11-27T04:00:00.123456789Z",
                genesis: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                profile: "1111111111111111111111111111111111111111111111111111111111111111",
                roster: "2222222222222222222222222222222222222222222222222222222222222222",
                users: &[100, 101],
                witness_user: 100,
                sequence: 2,
                inventory: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                inventory_tail: "4444444444444444444444444444444444444444444444444444444444444444",
                charge_heads: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            }
        }
    }

    #[test]
    fn python_vector_verifies_exact_possession_only() {
        let f = Fixture::new();
        let result = verify(f.archive.as_bytes(), &f.proof, &f.scope()).unwrap();
        assert_eq!(result.node, 42);
        assert_eq!(result.runtime, f.scope().runtime);
        assert_eq!(result.archive_sha256, sha256(f.archive.as_bytes()));
        assert_eq!(
            result.response_sha256,
            f.payload["signedWalReadbackSha256"].as_str().unwrap()
        );
        assert_eq!(
            sign(&f.payload, POSSESSION_DOMAIN, &NODE_TEST_SEED),
            f.proof
        );
    }

    #[test]
    fn even_correct_signature_cannot_assert_authority() {
        let f = Fixture::new();
        for (name, bad) in [
            ("archivePossessionOnly", json!(false)),
            ("localObservationsVerified", json!(true)),
            ("liveMeterVerified", json!(true)),
            ("deliveredBytesVerified", json!(true)),
            ("finalMeterVerified", json!(true)),
            ("settlementEligible", json!(true)),
            ("canServePublic", json!(true)),
            ("canSpend", json!(true)),
            ("canStart", json!(true)),
            ("canResume", json!(true)),
            ("authorizedBytes", json!(1)),
            ("refundableBytes", json!(false)),
            ("schemaVersion", json!(true)),
            ("archiveSha256", json!("0".repeat(64))),
        ] {
            let mut payload = f.payload.clone();
            payload[name] = bad;
            let signed = sign(&payload, POSSESSION_DOMAIN, &NODE_TEST_SEED);
            assert!(
                verify(f.archive.as_bytes(), &signed, &f.scope()).is_err(),
                "{name}"
            );
        }
    }

    #[test]
    fn scope_wrong_key_domain_and_encoding_fail_closed() {
        let f = Fixture::new();
        let mut scope = f.scope();
        scope.witness_user = 101;
        assert!(verify(f.archive.as_bytes(), &f.proof, &scope).is_err());
        scope = f.scope();
        scope.users = &[100];
        assert!(verify(f.archive.as_bytes(), &f.proof, &scope).is_err());
        scope = f.scope();
        scope.node_key = &f.policy;
        assert!(verify(f.archive.as_bytes(), &f.proof, &scope).is_err());
        scope = f.scope();
        scope.policy_key = &f.node;
        assert!(verify(f.archive.as_bytes(), &f.proof, &scope).is_err());
        let wrong_domain = sign(&f.payload, b"different\0", &NODE_TEST_SEED);
        assert!(verify(f.archive.as_bytes(), &wrong_domain, &f.scope()).is_err());
        let duplicate = String::from_utf8(f.proof.clone()).unwrap().replacen(
            "\"algorithm\":",
            "\"algorithm\":\"Ed25519\",\"algorithm\":",
            1,
        );
        assert!(verify(f.archive.as_bytes(), duplicate.as_bytes(), &f.scope()).is_err());
        assert!(
            verify(
                f.archive.as_bytes(),
                &f.proof[..f.proof.len() - 1],
                &f.scope()
            )
            .is_err()
        );
        assert!(verify(f.archive.as_bytes(), &[0; LIMIT + 1], &f.scope()).is_err());
    }

    #[test]
    fn possession_does_not_establish_local_ledger_truth() {
        let f = Fixture::new();
        let mut archive: Value = serde_json::from_str(&f.archive).unwrap();
        archive["observation"]["retiredLedgerSha256"] = json!("9".repeat(64));
        let raw = wire(&archive);
        let mut claim = f.payload.clone();
        claim["archiveSha256"] = json!(sha256(&raw));
        let proof = sign(&claim, POSSESSION_DOMAIN, &NODE_TEST_SEED);
        let verified = verify(&raw, &proof, &f.scope()).unwrap();
        assert_eq!(verified.archive_sha256, sha256(&raw));
        assert_ne!(verified.archive_sha256, sha256(f.archive.as_bytes()));
    }

    #[test]
    fn re_signed_local_or_nexus_authority_does_not_bypass_scope() {
        let f = Fixture::new();
        let mut archive: Value = serde_json::from_str(&f.archive).unwrap();
        archive["observation"]["settlementEligible"] = json!(true);
        let raw = wire(&archive);
        let mut claim = f.payload.clone();
        claim["archiveSha256"] = json!(sha256(&raw));
        let proof = sign(&claim, POSSESSION_DOMAIN, &NODE_TEST_SEED);
        assert!(verify(&raw, &proof, &f.scope()).is_err());

        let mut archive: Value = serde_json::from_str(&f.archive).unwrap();
        let response: Value =
            serde_json::from_str(archive["nexusResponse"].as_str().unwrap()).unwrap();
        let mut envelope: Value =
            serde_json::from_str(response["signedEnvelope"].as_str().unwrap()).unwrap();
        envelope["payload"]["authorizedBytes"] = json!(1);
        let signed = sign(&envelope["payload"], WAL_HEAD_DOMAIN, &POLICY_TEST_SEED);
        let response = serde_json::to_string(&json!({
            "signedEnvelope":String::from_utf8(signed).unwrap(),
        }))
        .unwrap();
        let response_sha = sha256(response.as_bytes());
        archive["nexusResponse"] = json!(response);
        archive["observation"]["signedWalReadbackSha256"] = json!(response_sha);
        let raw = wire(&archive);
        let mut claim = f.payload.clone();
        claim["archiveSha256"] = json!(sha256(&raw));
        claim["signedWalReadbackSha256"] = json!(response_sha);
        let proof = sign(&claim, POSSESSION_DOMAIN, &NODE_TEST_SEED);
        assert!(verify(&raw, &proof, &f.scope()).is_err());
    }
}
