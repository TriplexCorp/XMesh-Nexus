"""Independent, hosted-only verifier of a detached archive possession claim.

The expected Node key, activation receipt, and policy key are read from the
actual strict-PQ lab enrollment/outbox, not from either archive or reply.
This signature cannot prove meter truth, final bytes or spending authority.
"""
import os
from pathlib import Path
import re
import subprocess
import tempfile

from quota_v2_retirement_evidence import canonical, sha, strict

DOMAIN = b"XMESH_QUOTA_V2_HISTORICAL_RETIREMENT_ARCHIVE_POSSESSION_V1\x00"
ED25519_SPKI = bytes.fromhex("302a300506032b6570032100")
CANDIDATE_VERSION = "control-v6.0.39"
CANDIDATE_REVISION = "f277addfd7667b800e658ce176a79f909cb73d85"
CANDIDATE_ARTIFACT = "e8d285d98b089627870fd79ea0f72d25ee7891982bea2bb1fd63c14601e278b8"
PRODUCT = "/usr/local/bin/xmesh-agent-xspv2-product"


def expected_claim(archive, witness, observation, node, activation, node_public, policy_public):
    assert len(node_public) == len(policy_public) == 32
    assert witness["nodeId"] == observation["nodeId"] == node
    assert witness["activationReceiptSha256"] == activation
    assert witness["runtimeId"] == observation["runtimeId"]
    record = strict(archive)
    assert archive == canonical(record) + b"\n"
    assert canonical(record["observation"]) == canonical(observation)
    assert sha(record["nexusResponse"].encode()) == observation["signedWalReadbackSha256"]
    # The caller already independently verified historical policy signature,
    # times, scope and exact SQL-to-disk WAL/denial evidence (verify_record).
    return {
        "schemaVersion": 1,
        "kind": "xmesh.quota-v2.historical-retirement-archive-possession",
        "nodeId": node,
        "activationReceiptSha256": activation,
        "nodePublicKey": node_public.hex(),
        "nexusPublicKey": policy_public.hex(),
        "runtimeId": observation["runtimeId"],
        "archiveSha256": sha(archive),
        "signedWalReadbackSha256": observation["signedWalReadbackSha256"],
        "nexusIssuedAtMs": witness["issuedAtMs"],
        "nexusValidUntilMs": witness["validUntilMs"],
        "archivePossessionOnly": True,
        "localObservationsVerified": False,
        "liveMeterVerified": False,
        "deliveredBytesVerified": False,
        "finalMeterVerified": False,
        "settlementEligible": False,
        "canServePublic": False,
        "canSpend": False,
        "canStart": False,
        "canResume": False,
        "authorizedBytes": 0,
        "refundableBytes": 0,
    }


def verify_possession(raw, archive, witness, observation, node, activation, node_public, policy_public):
    assert 0 < len(raw) <= 8192
    envelope = strict(raw)
    assert set(envelope) == {"algorithm", "payload", "signature"}
    assert raw == canonical(envelope) + b"\n"
    assert envelope["algorithm"] == "Ed25519"
    assert re.fullmatch(r"[0-9a-f]{128}", envelope["signature"])
    expected = expected_claim(archive, witness, observation, node, activation, node_public, policy_public)
    assert canonical(envelope["payload"]) == canonical(expected), "claim differs from independent evidence"
    with tempfile.TemporaryDirectory(prefix="xmesh-retirement-possession-") as tmp:
        root = Path(tmp)
        key, message, signature = (root / name for name in ("key.der", "message", "signature"))
        key.write_bytes(ED25519_SPKI + node_public)
        message.write_bytes(DOMAIN + canonical(expected))
        signature.write_bytes(bytes.fromhex(envelope["signature"]))
        result = subprocess.run(
            ["openssl", "pkeyutl", "-verify", "-pubin", "-keyform", "DER", "-rawin",
             "-inkey", key, "-in", message, "-sigfile", signature],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=8)
        assert result.returncode == 0, "not a signature by the enrolled Node key"
    return expected


def enrolled_scope(db, node, activation):
    rows = db.execute(
        "SELECT encode(p.receipt_sha256,'hex'),k.ed25519_public,p.release_version,"
        "p.release_source_revision,p.release_artifact_sha256,o.signer_public_key "
        "FROM node_xsp_product_nodes p JOIN node_xsp_public_keysets k "
        "ON k.node_id=p.node_id AND k.purpose='node_request' AND k.key_epoch=p.key_epoch "
        "AND k.ed25519_key_id=p.ed25519_key_id AND k.mldsa65_key_id=p.mldsa65_key_id "
        "JOIN quota_v2_public_tls_authority_outbox o ON o.node_id=p.node_id "
        "WHERE p.node_id=%s AND p.state='active' AND p.key_epoch=1 AND k.revoked_at IS NULL",
        (node,)).fetchall()
    assert len(rows) == 1
    receipt, node_key, version, revision, digest, signer = rows[0]
    assert receipt == activation
    assert (version, revision, digest) == (CANDIDATE_VERSION, CANDIDATE_REVISION, CANDIDATE_ARTIFACT)
    der = subprocess.check_output(["openssl", "pkey", "-pubin", "-in",
                                   os.environ["XMESH_TEST_POLICY_PUBLIC_KEY"], "-outform", "DER"], timeout=8)
    assert len(der) == 44 and der.startswith(ED25519_SPKI) and der[12:].hex() == signer
    return bytes(node_key), der[12:]


def collect(guest, panel, db, archive, witness, observation, activation):
    from quota_v2_installed_native_live import require_live
    require_live()
    node_key, policy_key = enrolled_scope(db, guest.node, activation)
    assert guest.exec("cat", "/var/lib/xmesh-xray-sync/policy-public-key").strip() == policy_key.hex().encode()
    command = (PRODUCT, "retirement-archive-possession", "--panel", panel,
               "--node-id", str(guest.node), "--runtime-id")
    raw = guest.exec(*command, observation["runtimeId"], timeout=20)
    verify_possession(raw, archive, witness, observation, guest.node, activation, node_key, policy_key)
    assert guest.exec(*command, observation["runtimeId"], timeout=20) == raw
    absent = "0"*64 if observation["runtimeId"] != "0"*64 else "1"*64
    bad = subprocess.run(["docker", "exec", guest.name, *command, absent],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
    assert bad.returncode != 0 and not bad.stdout, "missing runtime yielded signed evidence"
    return raw, node_key, policy_key
