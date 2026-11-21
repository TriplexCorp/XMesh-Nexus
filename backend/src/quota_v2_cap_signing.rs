//! First-genesis signed positive *spending-only* cap contract.
//!
//! This module is compiled only by unit tests and the disposable CI issuer.
//! No shipping API route calls it. The production issuer MUST additionally
//! verify XSP/2 Node identity, independently measured kernel Xray process,
//! registered policy scope and off-host historical WAL before invoking this.
use crate::node_policy::PolicySigner;
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashSet;

pub const DOMAIN: &[u8] = b"XMESH_QUOTA_V2_XRAY_CAP_ADMISSION_V1\0";
pub const MAX_CAP: i64 = 67_108_864;
const MAX_INSTALL_MS: i64 = 120_000;
const MAX_LEASE_MS: i64 = 24 * 60 * 60 * 1000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Alias {
    pub email: String,
    pub class: String,
}

#[derive(Clone, Debug)]
pub struct SqlSnapshot {
    pub user_id: i64,
    pub node_id: i64,
    pub activation_sha: String,
    pub runtime_id: String,
    pub policy_sha: String,
    pub account_epoch: String,
    pub meter_epoch: String,
    pub reservation_id: String,
    pub revision: i64,
    pub nonce: String,
    pub original_inventory_head: String,
    pub acknowledged: i64,
    pub measured_wal: i64,
    pub measured_cdn_wal: i64,
    pub ceiling: i64,
    pub node_ceiling: i64,
    pub cdn_ceiling: i64,
    pub shared_account_limit: i64,
    pub shared_account_floor: i64,
    pub all_node_held: i64,
    pub sql_preflight_expires_ms: i64,
    pub lease_expires_ms: i64,
    pub issued_at_ms: i64,
    pub install_before_ms: i64,
    pub valid_until_ms: i64,
    pub aliases: Vec<Alias>,
}

fn hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn uuid(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 36
        && [8, 13, 18, 23].iter().all(|&i| b[i] == b'-')
        && b.iter().enumerate().all(|(i, c)| {
            [8, 13, 18, 23].contains(&i) || c.is_ascii_digit() || (b'a'..=b'f').contains(c)
        })
}

fn valid_alias(alias: &Alias, user_id: i64) -> bool {
    let prefix = format!("xmesh-u{user_id}--");
    let Some(tag) = alias.email.strip_prefix(&prefix) else {
        return false;
    };
    (alias.class == "main" || alias.class == "cdn")
        && !tag.is_empty()
        && tag.len() <= 128
        && tag
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn validate(snapshot: &SqlSnapshot, now_ms: i64) -> Result<()> {
    ensure!(
        snapshot.user_id > 0 && snapshot.node_id > 0 && snapshot.revision > 0,
        "missing committed user/Node/reservation revision"
    );
    ensure!(
        hex64(&snapshot.activation_sha)
            && hex64(&snapshot.runtime_id)
            && hex64(&snapshot.policy_sha)
            && hex64(&snapshot.nonce)
            && hex64(&snapshot.original_inventory_head),
        "invalid independent activation/process/policy/WAL digest"
    );
    ensure!(
        uuid(&snapshot.account_epoch)
            && uuid(&snapshot.meter_epoch)
            && uuid(&snapshot.reservation_id),
        "invalid immutable lease identity"
    );
    ensure!(
        snapshot.acknowledged == 0
            && snapshot.measured_wal == 0
            && snapshot.measured_cdn_wal == 0
            && snapshot.original_inventory_head == "0".repeat(64),
        "existing or unknown WAL cannot be minted as first genesis"
    );
    ensure!(
        (1..=MAX_CAP).contains(&snapshot.ceiling)
            && snapshot.node_ceiling >= snapshot.ceiling
            && snapshot.node_ceiling <= MAX_CAP
            && (0..=MAX_CAP).contains(&snapshot.cdn_ceiling)
            && snapshot.cdn_ceiling <= snapshot.ceiling,
        "out-of-range or inconsistent shared/Node/CDN capacity"
    );
    ensure!(
        snapshot.shared_account_limit > 0
            && snapshot.shared_account_floor >= 0
            && snapshot.all_node_held >= snapshot.ceiling
            && (i128::from(snapshot.shared_account_floor) + i128::from(snapshot.all_node_held))
                <= i128::from(snapshot.shared_account_limit),
        "unconserved PostgreSQL shared account reservation"
    );
    ensure!(
        now_ms > 0
            && snapshot.issued_at_ms > 0
            && snapshot.issued_at_ms <= now_ms
            && now_ms < snapshot.install_before_ms
            && snapshot.install_before_ms <= snapshot.sql_preflight_expires_ms
            && snapshot.install_before_ms - snapshot.issued_at_ms <= MAX_INSTALL_MS
            && snapshot.valid_until_ms > snapshot.install_before_ms
            && snapshot.valid_until_ms <= snapshot.lease_expires_ms
            && snapshot.valid_until_ms - snapshot.issued_at_ms <= MAX_LEASE_MS,
        "expired, future or expanded signed reservation validity"
    );
    ensure!(
        !snapshot.aliases.is_empty() && snapshot.aliases.len() <= 16,
        "missing signed MAIN/CDN policy scope"
    );
    let mut seen = HashSet::new();
    let mut previous = "";
    let mut has_cdn = false;
    for alias in &snapshot.aliases {
        ensure!(
            valid_alias(alias, snapshot.user_id)
                && alias.email.as_str() > previous
                && seen.insert(alias.email.as_str()),
            "unattributed, unsorted or duplicate inbound alias"
        );
        if alias.class == "cdn" {
            has_cdn = true;
        }
        previous = &alias.email;
    }
    ensure!(
        has_cdn || snapshot.cdn_ceiling == 0,
        "CDN capacity exists without an explicitly signed CDN inbound"
    );
    Ok(())
}

/// Produces exactly the canonical format verified by the pinned Xray Go
/// `verifySignedCapCandidate`: no general-purpose start or refund privilege.
pub fn sign_snapshot(signer: &PolicySigner, s: &SqlSnapshot, now_ms: i64) -> Result<Vec<u8>> {
    validate(s, now_ms)?;
    let payload: Value = json!({
        "schemaVersion":1, "kind":"xmesh.quota-v2.xray-cap-admission",
        "nodeId":s.node_id, "userId":s.user_id,
        "activationReceiptSha256":s.activation_sha,
        "runtimeId":s.runtime_id, "policySha256":s.policy_sha,
        "accountEpoch":s.account_epoch, "meterEpoch":s.meter_epoch,
        "reservationId":s.reservation_id, "reservationRevision":s.revision,
        "nonce":s.nonce, "inventoryTailDigest":s.original_inventory_head,
        "witnessedWalBytes":s.measured_wal,
        "witnessedCdnBytes":s.measured_cdn_wal,
        "sharedCeilingBytes":s.ceiling, "nodeCeilingBytes":s.node_ceiling,
        "cdnCeilingBytes":s.cdn_ceiling, "aliasScopes":s.aliases,
        "issuedAtMs":s.issued_at_ms, "installBeforeMs":s.install_before_ms,
        "validUntilMs":s.valid_until_ms, "canSpend":true,
        "canStart":false, "canResume":false,
        "finalMeterVerified":false, "refundableBytes":0
    });
    let signature = signer.sign_domain(DOMAIN, &payload)?;
    let envelope: Value = json!({"algorithm":"Ed25519","payload":payload,
        "signature":signature});
    let mut encoded = serde_json::to_vec(&envelope)?;
    ensure!(encoded.len() <= 8191, "oversize signed Xray cap envelope");
    encoded.push(b'\n');
    Ok(encoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    use serde_json::Value;
    use std::fs;
    use std::path::Path;

    fn fixture() -> SqlSnapshot {
        SqlSnapshot {
            user_id: 101,
            node_id: 47,
            revision: 1,
            activation_sha: "a".repeat(64),
            runtime_id: "b".repeat(64),
            policy_sha: "c".repeat(64),
            nonce: "d".repeat(64),
            original_inventory_head: "0".repeat(64),
            account_epoch: "11111111-1111-4111-8111-111111111111".into(),
            meter_epoch: "22222222-2222-4222-8222-222222222222".into(),
            reservation_id: "33333333-3333-4333-8333-333333333333".into(),
            acknowledged: 0,
            measured_wal: 0,
            measured_cdn_wal: 0,
            ceiling: 700,
            node_ceiling: 700,
            cdn_ceiling: 150,
            shared_account_limit: 1000,
            shared_account_floor: 0,
            all_node_held: 1000,
            issued_at_ms: 2_000_000,
            install_before_ms: 2_050_000,
            sql_preflight_expires_ms: 2_060_000,
            valid_until_ms: 3_000_000,
            lease_expires_ms: 3_000_000,
            aliases: vec![
                Alias {
                    email: "xmesh-u101--vless-cdn".into(),
                    class: "cdn".into(),
                },
                Alias {
                    email: "xmesh-u101--vless-main".into(),
                    class: "main".into(),
                },
            ],
        }
    }

    #[test]
    fn exact_nexus_policy_signer_domain_verifies_at_xray() -> Result<()> {
        let path =
            std::env::temp_dir().join(format!("xmesh-ci-cap-signer-{}", uuid::Uuid::new_v4()));
        let signer = PolicySigner::load(Path::new(&path))?;
        let proof = sign_snapshot(&signer, &fixture(), 2_010_000)?;
        let root: Value = serde_json::from_slice(&proof)?;
        let data = serde_json::to_vec(&root["payload"])?;
        let mut msg = DOMAIN.to_vec();
        msg.extend_from_slice(&data);
        let public: [u8; 32] = hex::decode(signer.public_key())?
            .try_into()
            .map_err(|_| anyhow::anyhow!("bad Ed25519 key"))?;
        let verify = VerifyingKey::from_bytes(&public)?;
        let sig = Signature::from_slice(&hex::decode(
            root["signature"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("missing cap signature"))?,
        )?)?;
        verify.verify(&msg, &sig)?;
        assert_eq!(root["payload"]["nodeId"], 47);
        assert_eq!(root["payload"]["cdnCeilingBytes"], 150);
        assert_eq!(root["payload"]["canStart"], false);
        assert_eq!(root["payload"]["canResume"], false);
        assert_eq!(root["payload"]["refundableBytes"], 0);
        assert!(proof.ends_with(b"\n"));
        let _ = fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn invalid_signer_input_matrix_fails_closed() {
        type Case = (&'static str, fn(&mut SqlSnapshot));
        let now = 2_010_000;
        let tests: &[Case] = &[
            ("shared overcommit", |s| s.all_node_held = 1001),
            ("foreign user", |s| s.user_id = 102),
            ("ack nonzero", |s| s.acknowledged = 1),
            ("previous WAL", |s| s.measured_wal = 1),
            ("other WAL head", |s| {
                s.original_inventory_head = "e".repeat(64);
            }),
            ("negative shared", |s| s.ceiling = -1),
            ("greater 64 MB", |s| s.ceiling = MAX_CAP + 1),
            ("node ceiling below shared", |s| s.node_ceiling = 10),
            ("cdn > total", |s| s.cdn_ceiling = 800),
            ("no CDN scope", |s| {
                s.aliases.remove(0);
            }),
            ("duplicate alias", |s| s.aliases[0] = s.aliases[1].clone()),
            ("reclassified main", |s| s.aliases[0].class = "main".into()),
            ("unsorted aliases", |s| s.aliases.swap(0, 1)),
            ("noncanonical uuid", |s| s.account_epoch = "BAD".into()),
            ("bad policy hash", |s| s.policy_sha = "fF".repeat(32)),
            ("expired preflight", |s| {
                s.sql_preflight_expires_ms = 2_020_000;
            }),
            ("expired lease", |s| s.lease_expires_ms = 2_020_000),
            ("already expired install", |s| {
                s.install_before_ms = 2_010_000;
            }),
            ("later issue", |s| s.issued_at_ms = 2_010_001),
            ("long install", |s| {
                s.install_before_ms = s.issued_at_ms + 120_001;
            }),
            ("large grant lifetime", |s| {
                s.valid_until_ms = s.issued_at_ms + MAX_LEASE_MS + 1;
            }),
            ("zero Node", |s| s.node_id = 0),
        ];
        for (name, mutate) in tests {
            let mut snapshot = fixture();
            mutate(&mut snapshot);
            assert!(validate(&snapshot, now).is_err(), "{name}");
        }
    }
}
