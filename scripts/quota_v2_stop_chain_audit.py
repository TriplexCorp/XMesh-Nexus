#!/usr/bin/env python3
"""INDEPENDENT, OFFLINE Nexus audit for Node NONFINAL quota-v2 stop chains.

This is deliberately NOT an HTTP route, settlement verifier, refund issuer,
or trusted terminal-meter implementation. It authenticates two Node-signed,
immutable records against a trusted enrolled Node public key and an
independently supplied reservation+revocation scope, and ALWAYS refuses
refund authority. The host's physical stop was observed by Node; Nexus
cannot infer kernel/Xray writer finality from that signed statement alone.

The input records are EXACT canonical JSON + one newline, as written by
XMesh-Node. Do not accept claimed keys, lease IDs or final bytes from either
untrusted record in place of the caller's trusted database state.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

OBSERVATION_DOMAIN = b"XMESH_QUOTA_V2_NONFINAL_OBSERVATION_V1\x00"
STOP_DOMAIN = b"XMESH_QUOTA_V2_NONFINAL_STOP_CHAIN_V1\x00"
OBSERVATION_KIND = "xmesh.quota-v2.nonfinal-observation"
STOP_KIND = "xmesh.quota-v2.nonfinal-stop-chain"
MAX_RECORD = 8192
MAX_METER = (1 << 63) - 1
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
HEX128 = re.compile(r"[0-9a-f]{128}\Z")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z")
SCOPE = ("nodeId", "userId", "epoch", "meterEpoch",
         "reservationId", "revision", "revocationId")
STOP_FLAGS = ("oldPidfdExited", "managedContainerStopped",
              "restartDisabled", "durableDenyArmed")


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate signed evidence JSON field")
        result[key] = value
    return result


def _canonical(document):
    return json.dumps(document, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _decode(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_RECORD:
        raise ValueError("missing or oversized signed stop evidence")
    try:
        document = json.loads(
            raw.decode("utf-8"), object_pairs_hook=_pairs,
            parse_constant=lambda val: (_ for _ in ()).throw(
                ValueError("non-finite signed evidence number")))
    except (UnicodeError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid signed stop JSON") from exc
    if not isinstance(document, dict) or raw != _canonical(document) + b"\n":
        raise ValueError("signed stop evidence is not immutable canonical bytes")
    return document


def _exact(document, fields, name):
    if not isinstance(document, dict) or set(document) != set(fields):
        raise ValueError(f"unknown or omitted {name} fields")


def _meter(value, name):
    if type(value) is not int or not 0 <= value <= MAX_METER:
        raise ValueError(f"invalid {name}")
    return value


def _scope(scope):
    _exact(scope, SCOPE, "trusted reservation")
    for key in ("nodeId", "userId", "revision"):
        if type(scope[key]) is not int or scope[key] <= 0:
            raise ValueError("invalid trusted quota-v2 reservation ID")
    for key in ("epoch", "meterEpoch", "reservationId", "revocationId"):
        if (not isinstance(scope[key], str) or
                UUID.fullmatch(scope[key]) is None or
                scope[key] == "00000000-0000-0000-0000-000000000000"):
            raise ValueError("invalid trusted quota-v2 reservation epoch")


def _envelope(value, name):
    _exact(value, ("algorithm", "payload", "signature"), name)
    if (value["algorithm"] != "Ed25519" or
            not isinstance(value["signature"], str) or
            HEX128.fullmatch(value["signature"]) is None):
        raise ValueError("invalid Ed25519 signed stop envelope")


def _verify_ed25519(payload, signature, domain, public_key):
    # OpenSSL checks signatures with a trusted Node key selected OUTSIDE the
    # supplied evidence, never with a key embedded in an attacker message.
    if not Path(public_key).is_file():
        raise ValueError("trusted enrolled Node public key unavailable")
    with tempfile.TemporaryDirectory(prefix="xmesh-nonfinal-verify-") as tmp:
        message = Path(tmp) / "message"
        sig = Path(tmp) / "signature"
        message.write_bytes(domain + _canonical(payload))
        sig.write_bytes(bytes.fromhex(signature))
        try:
            result = subprocess.run(
                ["openssl", "pkeyutl", "-verify", "-rawin",
                 "-in", str(message), "-pubin", "-inkey",
                 str(public_key), "-sigfile", str(sig)],
                capture_output=True, timeout=10, check=False)
        except (OSError, subprocess.SubprocessError) as exc:
            raise ValueError("Node Ed25519 verifier unavailable") from exc
        if result.returncode:
            raise ValueError("Node Ed25519 signed stop evidence mismatch")


def _trusted_inbound_roster(aliases, expected_scope):
    """Require the exact independently trusted issued CONFIGURED inbound roster.

    This must originate from an independently authenticated committed policy
    or Nexus database, NEVER Node telemetry, checkpoint or the caller's HTTP
    payload. A signed claim 'completeSignedInboundScopeObserved=true' cannot
    prove it included a provisioned but idle CDN inbound.
    """
    if not isinstance(aliases, (tuple, list)) or not 0 < len(aliases) <= 16:
        raise ValueError("independently trusted signed inbound roster is required")
    prefix = "xmesh-u" + str(expected_scope["userId"]) + "--"
    prior = ""
    for email in aliases:
        if (not isinstance(email, str) or not email.startswith(prefix) or
                len(email) <= len(prefix) or
                len(email.encode("utf-8")) > 128 or
                (prior and email <= prior)):
            raise ValueError("untrusted, foreign or duplicate signed inbound roster")
        prior = email
    return tuple(aliases)


def verify_nonfinal_stop_chain(raw_observation, raw_stop, trusted_public_key,
                               expected_scope, trusted_committed_inbound_emails):
    """Return an AUDIT-ONLY result; never grant terminal or refund authority."""
    _scope(expected_scope)
    trusted_roster = _trusted_inbound_roster(
        trusted_committed_inbound_emails, expected_scope)
    observation = _decode(raw_observation)
    stop = _decode(raw_stop)
    _envelope(observation, "observed Xray")
    _envelope(stop, "physical stop")

    o = observation["payload"]
    _exact(o, (
        "schemaVersion", "kind", "nodeId", "checkpoint", "checkpointSha256",
        "boundToCommittedPolicy", "completeSignedInboundScopeObserved",
        "liveRuntimeIndependentlyVerified", "monotonicLedgerFloorVerified",
        "durableAbsoluteFloorBytes", "finalMeterVerified",
        "settlementEligible", "refundableBytes"), "Node observation")
    if (type(o["schemaVersion"]) is not int or o["schemaVersion"] != 2 or
            o["kind"] != OBSERVATION_KIND or
            type(o["nodeId"]) is not int or
            o["nodeId"] != expected_scope["nodeId"] or
            o["boundToCommittedPolicy"] is not True or
            o["completeSignedInboundScopeObserved"] is not True or
            o["liveRuntimeIndependentlyVerified"] is not True or
            o["monotonicLedgerFloorVerified"] is not True or
            o["finalMeterVerified"] is not False or
            o["settlementEligible"] is not False or
            type(o["refundableBytes"]) is not int or
            o["refundableBytes"] != 0):
        raise ValueError("observation cannot authorize terminal quota settlement")
    _meter(o["durableAbsoluteFloorBytes"], "durable absolute lower bound")
    cp = o["checkpoint"]
    _exact(cp, (
        "schemaVersion", "nodeId", "userId", "email", "epoch",
        "meterEpoch", "reservationId", "revision", "revocationId",
        "runtimeId", "uplinkBytes", "downlinkBytes", "inboundMeters",
        "drained", "finalMeterVerified", "refundableBytes"),
        "Xray checkpoint")
    if (type(cp["schemaVersion"]) is not int or cp["schemaVersion"] != 3 or
            cp["drained"] is not True or
            cp["finalMeterVerified"] is not False or
            type(cp["refundableBytes"]) is not int or cp["refundableBytes"] != 0 or
            not isinstance(cp["runtimeId"], str) or
            HEX64.fullmatch(cp["runtimeId"]) is None or
            not isinstance(cp["email"], str) or not cp["email"]):
        raise ValueError("untrusted nonterminal Xray checkpoint")
    if any(cp[field] != expected_scope[field] or
           type(cp[field]) is not type(expected_scope[field])
           for field in SCOPE):
        raise ValueError("observed lease does not match trusted Nexus reservation")
    inbound = cp["inboundMeters"]
    if not isinstance(inbound, list) or not 0 < len(inbound) <= 16:
        raise ValueError("missing complete per-inbound meter")
    total_up = total_down = 0
    last_email = ""
    seen_request = False
    observed_roster = []
    for entry in inbound:
        _exact(entry, ("email", "uplinkBytes", "downlinkBytes"),
               "signed per-inbound meter")
        email = entry["email"]
        if (not isinstance(email, str) or not email or
                len(email.encode("utf-8")) > 128 or
                (last_email and email <= last_email)):
            raise ValueError("unsorted or repeated signed inbound meter")
        if email == cp["email"]:
            seen_request = True
        observed_roster.append(email)
        last_email = email
        total_up += _meter(entry["uplinkBytes"], "Xray uplink")
        total_down += _meter(entry["downlinkBytes"], "Xray downlink")
        if total_up + total_down > MAX_METER:
            raise ValueError("signed Xray meter overflow")
    if tuple(observed_roster) != trusted_roster:
        raise ValueError("signed Xray evidence omits or adds a trusted configured inbound")
    if (not seen_request or total_up != _meter(cp["uplinkBytes"], "total uplink") or
            total_down != _meter(cp["downlinkBytes"], "total downlink") or
            o["checkpointSha256"] != hashlib.sha256(_canonical(cp)).hexdigest()):
        raise ValueError("signed Xray checkpoint digest or totals mismatch")

    s = stop["payload"]
    _exact(s, (*SCOPE, "schemaVersion", "kind", "observationSha256",
               "checkpointSha256", "oldRuntimeId", "oldContainerId",
               "oldStartedAt", *STOP_FLAGS, "finalMeterVerified",
               "settlementEligible", "refundableBytes"),
           "Node stop-chain")
    if (type(s["schemaVersion"]) is not int or s["schemaVersion"] != 1 or
            s["kind"] != STOP_KIND or
            s["finalMeterVerified"] is not False or
            s["settlementEligible"] is not False or
            type(s["refundableBytes"]) is not int or s["refundableBytes"] != 0 or
            any(s[flag] is not True for flag in STOP_FLAGS) or
            any(s[field] != expected_scope[field] or
                type(s[field]) is not type(expected_scope[field])
                for field in SCOPE) or
            s["oldRuntimeId"] != cp["runtimeId"] or
            not isinstance(s["oldContainerId"], str) or
            HEX64.fullmatch(s["oldContainerId"]) is None or
            not isinstance(s["oldStartedAt"], str) or
            "T" not in s["oldStartedAt"] or
            s["oldStartedAt"].startswith("0001-01-01") or
            s["checkpointSha256"] != o["checkpointSha256"] or
            s["observationSha256"] != hashlib.sha256(raw_observation).hexdigest()):
        raise ValueError("signed Node stop claim does not match immutable quota evidence")

    _verify_ed25519(o, observation["signature"], OBSERVATION_DOMAIN,
                    trusted_public_key)
    _verify_ed25519(s, stop["signature"], STOP_DOMAIN, trusted_public_key)

    # No method here computes final bytes or invokes SQL. Nexus cannot
    # independently conclude Xray background writers are finished.
    return {
        "authenticatedNodeId": expected_scope["nodeId"],
        "authenticatedSignedReservation": True,
        "nodeAttestedOldPidfdExit": True,
        "trustedSignedInboundCount": len(trusted_roster),
        "observedRawBytesForAudit": total_up + total_down,
        "durableAbsoluteFloorBytesForAudit": o["durableAbsoluteFloorBytes"],
        "finalMeterVerified": False,
        "settlementEligible": False,
        "refundableBytes": 0,
    }
