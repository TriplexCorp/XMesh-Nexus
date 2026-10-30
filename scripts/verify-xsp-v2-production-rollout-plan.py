#!/usr/bin/env python3
"""Validate a separately reviewed XSP-v2 production rollout plan.

This verifier never executes a rollout.  It checks that an operator-authored plan
is explicit about topology/DNS/firewall/Nginx/database/key deltas, rollback and
evidence binding.  `--require-gate-eligible` additionally requires the external
P0-E gates, the exact-candidate final canary and separate plan review to be
recorded as complete, but the output still never claims production activation.
"""

from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import re
import sys
from typing import Any, NoReturn

DEFAULT_CONTRACT = Path("deploy/xsp-v2-production-rollout-plan.contract.json")
MAX_JSON = 512 * 1024
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
TOKEN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
FQDN = re.compile(
    r"^(?=.{1,253}\.?$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}\.?$"
)
PRIVATE_MATERIAL = re.compile(
    r"-----BEGIN (?:ENCRYPTED |RSA |EC |OPENSSH )?PRIVATE KEY-----", re.IGNORECASE
)


class ValidationError(ValueError):
    pass


def fail(message: str) -> NoReturn:
    raise ValidationError(message)


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            fail(f"duplicate JSON field: {key}")
        out[key] = value
    return out


def load_json(path: Path, where: str) -> dict[str, Any]:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        fail(f"cannot read {where}: {exc}")
    if not raw or len(raw) > MAX_JSON:
        fail(f"{where} size must be 1..{MAX_JSON} bytes")
    try:
        value = json.loads(raw, object_pairs_hook=unique_object)
    except json.JSONDecodeError as exc:
        fail(f"invalid JSON in {where}: {exc}")
    return require_dict(value, where)


def require_dict(value: Any, where: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{where} must be an object")
    return value


def require_list(value: Any, where: str) -> list[Any]:
    if not isinstance(value, list):
        fail(f"{where} must be an array")
    return value


def exact_keys(value: dict[str, Any], expected: set[str], where: str) -> None:
    actual = set(value)
    missing = sorted(expected - actual)
    unknown = sorted(actual - expected)
    if missing or unknown:
        fail(f"{where} key mismatch: missing={missing}, unknown={unknown}")


def nonempty(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"{where} must be a non-empty string")
    return value.strip()


def bool_value(value: Any, where: str) -> bool:
    if not isinstance(value, bool):
        fail(f"{where} must be boolean")
    return value


def sha40(value: Any, where: str) -> str:
    text = nonempty(value, where)
    if not SHA40.fullmatch(text):
        fail(f"{where} must be a lowercase 40-hex revision")
    return text


def sha64(value: Any, where: str) -> str:
    text = nonempty(value, where)
    if not SHA64.fullmatch(text):
        fail(f"{where} must be lowercase 64-hex SHA-256")
    return text


def sha256_prefixed(value: Any, where: str) -> str:
    text = nonempty(value, where)
    if not text.startswith("sha256:") or not SHA64.fullmatch(text[7:]):
        fail(f"{where} must be sha256:<64 lowercase hex>")
    return text


def timestamp(value: Any, where: str) -> str:
    text = nonempty(value, where)
    normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        fail(f"{where} must be ISO-8601: {exc}")
    if parsed.tzinfo is None:
        fail(f"{where} must include timezone")
    return text


def fqdn(value: Any, where: str) -> str:
    text = nonempty(value, where).lower().rstrip(".")
    if not FQDN.fullmatch(text):
        fail(f"{where} must be a DNS FQDN")
    return text


def port(value: Any, where: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1 or value > 65535:
        fail(f"{where} must be integer 1..65535")
    return value


def string_list(value: Any, where: str, *, nonempty_required: bool = True) -> list[str]:
    rows = require_list(value, where)
    if nonempty_required and not rows:
        fail(f"{where} must not be empty")
    out = [nonempty(row, f"{where}[{i}]") for i, row in enumerate(rows)]
    if len(out) != len(set(out)):
        fail(f"{where} must not contain duplicates")
    return out


def optional_note(value: Any, where: str) -> str | None:
    if value is None:
        return None
    return nonempty(value, where)


def optional_hash(value: Any, where: str, *, required: bool) -> str | None:
    if value is None:
        if required:
            fail(f"{where} is required when the gate is accepted")
        return None
    return sha64(value, where)


def scan_for_forbidden_material(value: Any, contract: dict[str, Any], where: str = "plan") -> None:
    forbidden = {
        nonempty(item, "contract.forbiddenFieldNames[]").lower()
        for item in require_list(contract["forbiddenFieldNames"], "contract.forbiddenFieldNames")
    }
    if isinstance(value, dict):
        for key, child in value.items():
            lowered = key.lower()
            if lowered in forbidden:
                fail(f"{where}.{key} is a forbidden field name")
            scan_for_forbidden_material(child, contract, f"{where}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            scan_for_forbidden_material(child, contract, f"{where}[{index}]")
    elif isinstance(value, str):
        if PRIVATE_MATERIAL.search(value):
            fail(f"{where} contains private key material")


def validate_release_candidate(plan: dict[str, Any]) -> dict[str, Any]:
    value = require_dict(plan["releaseCandidate"], "plan.releaseCandidate")
    exact_keys(
        value,
        {"nexusRevision", "nodeRevision", "nexusImageSha256", "agentArtifactSha256", "canaryResultSha256"},
        "plan.releaseCandidate",
    )
    return {
        "nexusRevision": sha40(value["nexusRevision"], "plan.releaseCandidate.nexusRevision"),
        "nodeRevision": sha40(value["nodeRevision"], "plan.releaseCandidate.nodeRevision"),
        "nexusImageSha256": sha256_prefixed(value["nexusImageSha256"], "plan.releaseCandidate.nexusImageSha256"),
        "agentArtifactSha256": sha64(value["agentArtifactSha256"], "plan.releaseCandidate.agentArtifactSha256"),
        "canaryResultSha256": (
            None
            if value["canaryResultSha256"] is None
            else sha64(value["canaryResultSha256"], "plan.releaseCandidate.canaryResultSha256")
        ),
    }


def validate_gates(plan: dict[str, Any]) -> dict[str, bool]:
    value = require_dict(plan["gates"], "plan.gates")
    exact_keys(
        value,
        {
            "p0EComplete",
            "independentSecurityReviewAccepted",
            "independentSecurityReviewResultSha256",
            "physicalPowerQualificationAccepted",
            "physicalPowerQualificationResultSha256",
            "finalCanaryPassed",
        },
        "plan.gates",
    )
    p0e = bool_value(value["p0EComplete"], "plan.gates.p0EComplete")
    review = bool_value(value["independentSecurityReviewAccepted"], "plan.gates.independentSecurityReviewAccepted")
    power = bool_value(value["physicalPowerQualificationAccepted"], "plan.gates.physicalPowerQualificationAccepted")
    canary = bool_value(value["finalCanaryPassed"], "plan.gates.finalCanaryPassed")
    optional_hash(value["independentSecurityReviewResultSha256"], "plan.gates.independentSecurityReviewResultSha256", required=review)
    optional_hash(value["physicalPowerQualificationResultSha256"], "plan.gates.physicalPowerQualificationResultSha256", required=power)
    if p0e and not (review and power):
        fail("p0EComplete=true requires accepted independent security review and physical-power qualification")
    if canary and not p0e:
        fail("finalCanaryPassed=true requires p0EComplete=true")
    return {"p0EComplete": p0e, "securityReview": review, "physicalPower": power, "finalCanary": canary}


def validate_topology(plan: dict[str, Any], contract: dict[str, Any]) -> None:
    value = require_dict(plan["topology"], "plan.topology")
    exact_keys(
        value,
        {"panelFqdn", "panelPublicPorts", "panelAppBind", "panelAppPort", "databaseHostPublished", "redisHostPublished", "xspIngress"},
        "plan.topology",
    )
    baseline = require_dict(contract["baselineInvariants"], "contract.baselineInvariants")
    fqdn(value["panelFqdn"], "plan.topology.panelFqdn")
    ports = require_list(value["panelPublicPorts"], "plan.topology.panelPublicPorts")
    if ports != baseline["panelPublicPorts"]:
        fail("plan.topology.panelPublicPorts must remain exactly [80, 443]")
    if value["panelAppBind"] != baseline["panelAppBind"]:
        fail("panel application must remain loopback-bound")
    app_port = port(value["panelAppPort"], "plan.topology.panelAppPort")
    if app_port in (80, 443):
        fail("panel application port must be distinct from public Nginx ports")
    if value["databaseHostPublished"] is not False or value["redisHostPublished"] is not False:
        fail("PostgreSQL and Redis must remain unexposed on host ports")

    ingress = require_dict(value["xspIngress"], "plan.topology.xspIngress")
    exact_keys(
        ingress,
        {"fqdn", "port", "tlsProtocols", "keyExchange", "clientIdentity", "legacySharedListener", "unknownSniRejected", "exactRoutes"},
        "plan.topology.xspIngress",
    )
    fqdn(ingress["fqdn"], "plan.topology.xspIngress.fqdn")
    port(ingress["port"], "plan.topology.xspIngress.port")
    if ingress["tlsProtocols"] != baseline["xspIngressTlsProtocols"]:
        fail("XSP-v2 ingress must be TLS 1.3 only")
    if ingress["keyExchange"] != baseline["xspIngressKeyExchange"]:
        fail("XSP-v2 ingress must use X25519MLKEM768")
    if ingress["clientIdentity"] != baseline["xspIngressClientIdentity"]:
        fail("XSP-v2 ingress must use ML-DSA-65 client identity")
    if ingress["legacySharedListener"] is not False or ingress["unknownSniRejected"] is not True:
        fail("XSP-v2 ingress must remain dedicated and reject unknown SNI")
    routes = string_list(ingress["exactRoutes"], "plan.topology.xspIngress.exactRoutes")
    for route in routes:
        if not route.startswith("/api/v2/") or "*" in route or route.endswith("/"):
            fail(f"XSP-v2 ingress route must be exact /api/v2 path: {route}")


def validate_dns(plan: dict[str, Any], contract: dict[str, Any]) -> None:
    value = require_dict(plan["dns"], "plan.dns")
    exact_keys(value, {"changes", "noChangeReason"}, "plan.dns")
    changes = require_list(value["changes"], "plan.dns.changes")
    note = optional_note(value["noChangeReason"], "plan.dns.noChangeReason")
    if bool(changes) == bool(note):
        fail("plan.dns requires either changes or noChangeReason, exclusively")
    allowed = set(string_list(contract["allowedDnsTypes"], "contract.allowedDnsTypes"))
    seen: set[str] = set()
    for i, raw in enumerate(changes):
        row = require_dict(raw, f"plan.dns.changes[{i}]")
        exact_keys(row, {"id", "name", "type", "before", "after", "ttl", "rollbackValue"}, f"plan.dns.changes[{i}]")
        ident = nonempty(row["id"], f"plan.dns.changes[{i}].id")
        if not TOKEN.fullmatch(ident) or ident in seen:
            fail(f"invalid/duplicate DNS change id: {ident}")
        seen.add(ident)
        fqdn(row["name"], f"plan.dns.changes[{i}].name")
        if row["type"] not in allowed:
            fail(f"unsupported DNS type: {row['type']}")
        if row["before"] is not None:
            nonempty(row["before"], f"plan.dns.changes[{i}].before")
        nonempty(row["after"], f"plan.dns.changes[{i}].after")
        if row["rollbackValue"] is not None:
            nonempty(row["rollbackValue"], f"plan.dns.changes[{i}].rollbackValue")
        if not isinstance(row["ttl"], int) or isinstance(row["ttl"], bool) or not 30 <= row["ttl"] <= 86400:
            fail(f"plan.dns.changes[{i}].ttl must be 30..86400")


def validate_firewall(plan: dict[str, Any], contract: dict[str, Any]) -> None:
    value = require_dict(plan["firewall"], "plan.firewall")
    exact_keys(value, {"changes", "noChangeReason"}, "plan.firewall")
    changes = require_list(value["changes"], "plan.firewall.changes")
    note = optional_note(value["noChangeReason"], "plan.firewall.noChangeReason")
    if bool(changes) == bool(note):
        fail("plan.firewall requires either changes or noChangeReason, exclusively")
    allowed = set(string_list(contract["allowedFirewallActions"], "contract.allowedFirewallActions"))
    seen: set[str] = set()
    for i, raw in enumerate(changes):
        row = require_dict(raw, f"plan.firewall.changes[{i}]")
        exact_keys(row, {"id", "direction", "protocol", "port", "source", "action", "rationale", "rollbackAction"}, f"plan.firewall.changes[{i}]")
        ident = nonempty(row["id"], f"plan.firewall.changes[{i}].id")
        if not TOKEN.fullmatch(ident) or ident in seen:
            fail(f"invalid/duplicate firewall change id: {ident}")
        seen.add(ident)
        if row["direction"] != "ingress" or row["protocol"] != "tcp":
            fail("rollout firewall changes are limited to explicit TCP ingress rules")
        port(row["port"], f"plan.firewall.changes[{i}].port")
        nonempty(row["source"], f"plan.firewall.changes[{i}].source")
        if row["action"] not in allowed:
            fail(f"unsupported firewall action: {row['action']}")
        if row["rollbackAction"] not in allowed | {"remove"}:
            fail(f"unsupported firewall rollback action: {row['rollbackAction']}")
        nonempty(row["rationale"], f"plan.firewall.changes[{i}].rationale")


def validate_nginx(plan: dict[str, Any]) -> None:
    value = require_dict(plan["nginx"], "plan.nginx")
    exact_keys(value, {"changes", "noChangeReason"}, "plan.nginx")
    changes = require_list(value["changes"], "plan.nginx.changes")
    note = optional_note(value["noChangeReason"], "plan.nginx.noChangeReason")
    if bool(changes) == bool(note):
        fail("plan.nginx requires either changes or noChangeReason, exclusively")
    seen: set[str] = set()
    for i, raw in enumerate(changes):
        row = require_dict(raw, f"plan.nginx.changes[{i}]")
        exact_keys(
            row,
            {"id", "purpose", "serverName", "listen", "upstream", "tlsProtocols", "keyExchange", "clientIdentity", "configSha256", "rollbackConfigSha256", "accessLog", "exactLocationsOnly"},
            f"plan.nginx.changes[{i}]",
        )
        ident = nonempty(row["id"], f"plan.nginx.changes[{i}].id")
        if not TOKEN.fullmatch(ident) or ident in seen:
            fail(f"invalid/duplicate Nginx change id: {ident}")
        seen.add(ident)
        purpose = nonempty(row["purpose"], f"plan.nginx.changes[{i}].purpose")
        if purpose not in {"panel", "xsp-v2-ingress"}:
            fail(f"unsupported Nginx purpose: {purpose}")
        fqdn(row["serverName"], f"plan.nginx.changes[{i}].serverName")
        nonempty(row["listen"], f"plan.nginx.changes[{i}].listen")
        nonempty(row["upstream"], f"plan.nginx.changes[{i}].upstream")
        protocols = string_list(row["tlsProtocols"], f"plan.nginx.changes[{i}].tlsProtocols")
        sha64(row["configSha256"], f"plan.nginx.changes[{i}].configSha256")
        sha64(row["rollbackConfigSha256"], f"plan.nginx.changes[{i}].rollbackConfigSha256")
        bool_value(row["accessLog"], f"plan.nginx.changes[{i}].accessLog")
        bool_value(row["exactLocationsOnly"], f"plan.nginx.changes[{i}].exactLocationsOnly")
        if purpose == "xsp-v2-ingress":
            if protocols != ["TLSv1.3"] or row["keyExchange"] != "X25519MLKEM768" or row["clientIdentity"] != "ML-DSA-65":
                fail("XSP-v2 Nginx change must preserve TLS1.3/X25519MLKEM768/ML-DSA-65")
            if row["accessLog"] is not False or row["exactLocationsOnly"] is not True:
                fail("XSP-v2 Nginx change must disable access log and use exact locations only")
        else:
            if row["keyExchange"] is not None or row["clientIdentity"] is not None:
                fail("panel Nginx change must not claim XSP-v2 transport identity settings")


def validate_database(plan: dict[str, Any]) -> None:
    value = require_dict(plan["database"], "plan.database")
    exact_keys(
        value,
        {"backupSha256", "backupMethod", "restoreVerified", "migrationIds", "aclManifestSha256", "recoveryCheckpointSha256", "secretsPreserved", "databaseHostPublished", "rollbackTested"},
        "plan.database",
    )
    sha64(value["backupSha256"], "plan.database.backupSha256")
    if value["backupMethod"] != "pg_dump-custom":
        fail("plan.database.backupMethod must be pg_dump-custom")
    for key in ("restoreVerified", "secretsPreserved", "rollbackTested"):
        if value[key] is not True:
            fail(f"plan.database.{key} must be true")
    if value["databaseHostPublished"] is not False:
        fail("plan.database.databaseHostPublished must be false")
    string_list(value["migrationIds"], "plan.database.migrationIds", nonempty_required=False)
    sha64(value["aclManifestSha256"], "plan.database.aclManifestSha256")
    sha64(value["recoveryCheckpointSha256"], "plan.database.recoveryCheckpointSha256")


def validate_key_material(plan: dict[str, Any]) -> None:
    value = require_dict(plan["keyMaterial"], "plan.keyMaterial")
    exact_keys(value, {"entries", "noChangeReason", "ownerPrivateKeysRemainOffline", "persistentSecretsPreserved", "signerKeysReadOnly"}, "plan.keyMaterial")
    entries = require_list(value["entries"], "plan.keyMaterial.entries")
    note = optional_note(value["noChangeReason"], "plan.keyMaterial.noChangeReason")
    if bool(entries) == bool(note):
        fail("plan.keyMaterial requires either entries or noChangeReason, exclusively")
    for key in ("ownerPrivateKeysRemainOffline", "persistentSecretsPreserved", "signerKeysReadOnly"):
        if value[key] is not True:
            fail(f"plan.keyMaterial.{key} must be true")
    seen: set[str] = set()
    for i, raw in enumerate(entries):
        row = require_dict(raw, f"plan.keyMaterial.entries[{i}]")
        exact_keys(row, {"purpose", "keyId", "publicFingerprintSha256", "custodyDomain", "source", "activationStage"}, f"plan.keyMaterial.entries[{i}]")
        key_id = nonempty(row["keyId"], f"plan.keyMaterial.entries[{i}].keyId")
        if key_id in seen:
            fail(f"duplicate keyId: {key_id}")
        seen.add(key_id)
        nonempty(row["purpose"], f"plan.keyMaterial.entries[{i}].purpose")
        sha64(row["publicFingerprintSha256"], f"plan.keyMaterial.entries[{i}].publicFingerprintSha256")
        nonempty(row["custodyDomain"], f"plan.keyMaterial.entries[{i}].custodyDomain")
        nonempty(row["source"], f"plan.keyMaterial.entries[{i}].source")
        nonempty(row["activationStage"], f"plan.keyMaterial.entries[{i}].activationStage")


def validate_stages(plan: dict[str, Any], contract: dict[str, Any]) -> None:
    rows = require_list(plan["stages"], "plan.stages")
    if not rows:
        fail("plan.stages must not be empty")
    allowed = set(string_list(contract["allowedStageDomains"], "contract.allowedStageDomains"))
    seen: set[str] = set()
    orders: list[int] = []
    for i, raw in enumerate(rows):
        row = require_dict(raw, f"plan.stages[{i}]")
        exact_keys(row, {"id", "order", "domains", "preChecks", "successChecks", "rollbackRef"}, f"plan.stages[{i}]")
        ident = nonempty(row["id"], f"plan.stages[{i}].id")
        if not TOKEN.fullmatch(ident) or ident in seen:
            fail(f"invalid/duplicate rollout stage id: {ident}")
        seen.add(ident)
        order = row["order"]
        if not isinstance(order, int) or isinstance(order, bool) or order < 1:
            fail(f"plan.stages[{i}].order must be a positive integer")
        orders.append(order)
        domains = string_list(row["domains"], f"plan.stages[{i}].domains")
        unknown = sorted(set(domains) - allowed)
        if unknown:
            fail(f"plan.stages[{i}] has unsupported domains: {unknown}")
        string_list(row["preChecks"], f"plan.stages[{i}].preChecks")
        string_list(row["successChecks"], f"plan.stages[{i}].successChecks")
        nonempty(row["rollbackRef"], f"plan.stages[{i}].rollbackRef")
    if sorted(orders) != list(range(1, len(rows) + 1)) or len(set(orders)) != len(orders):
        fail("plan.stages.order must be unique and contiguous from 1")


def validate_rollback(plan: dict[str, Any]) -> None:
    value = require_dict(plan["rollback"], "plan.rollback")
    exact_keys(
        value,
        {"databaseBackupSha256", "nginxRollbackConfigSha256", "dnsRollbackPrepared", "firewallRollbackPrepared", "agentLastKnownGood", "offhostRecoveryCheckpointSha256", "abortOnFailedCheck", "noSecurityStateRewind"},
        "plan.rollback",
    )
    sha64(value["databaseBackupSha256"], "plan.rollback.databaseBackupSha256")
    sha64(value["nginxRollbackConfigSha256"], "plan.rollback.nginxRollbackConfigSha256")
    sha64(value["offhostRecoveryCheckpointSha256"], "plan.rollback.offhostRecoveryCheckpointSha256")
    for key in ("dnsRollbackPrepared", "firewallRollbackPrepared", "agentLastKnownGood", "abortOnFailedCheck", "noSecurityStateRewind"):
        if value[key] is not True:
            fail(f"plan.rollback.{key} must be true")
    if value["databaseBackupSha256"] != plan["database"]["backupSha256"]:
        fail("rollback database backup must match plan.database.backupSha256")
    if value["offhostRecoveryCheckpointSha256"] != plan["database"]["recoveryCheckpointSha256"]:
        fail("rollback off-host checkpoint must match plan.database.recoveryCheckpointSha256")
    nginx_changes = plan["nginx"]["changes"]
    if nginx_changes:
        rollback_hashes = {row["rollbackConfigSha256"] for row in nginx_changes}
        if value["nginxRollbackConfigSha256"] not in rollback_hashes:
            fail("rollback Nginx config must match a planned Nginx rollbackConfigSha256")


def validate_observability(plan: dict[str, Any]) -> None:
    value = require_dict(plan["observability"], "plan.observability")
    exact_keys(value, {"healthChecks", "redacted", "noSecretLogging", "newNetworkRoute"}, "plan.observability")
    string_list(value["healthChecks"], "plan.observability.healthChecks")
    if value["redacted"] is not True or value["noSecretLogging"] is not True:
        fail("rollout observability must remain redacted and exclude secret logging")
    if value["newNetworkRoute"] is not False:
        fail("this rollout plan gate cannot introduce a new observability network route")


def validate_review(plan: dict[str, Any]) -> bool:
    value = require_dict(plan["review"], "plan.review")
    exact_keys(value, {"author", "reviewer", "reviewerOrganization", "separateFromAuthor", "approved", "reviewedAt", "evidence"}, "plan.review")
    author = nonempty(value["author"], "plan.review.author")
    reviewer = nonempty(value["reviewer"], "plan.review.reviewer")
    nonempty(value["reviewerOrganization"], "plan.review.reviewerOrganization")
    separate = bool_value(value["separateFromAuthor"], "plan.review.separateFromAuthor")
    approved = bool_value(value["approved"], "plan.review.approved")
    string_list(value["evidence"], "plan.review.evidence")
    if separate and author.casefold() == reviewer.casefold():
        fail("separate plan reviewer must differ from author")
    if approved:
        if not separate:
            fail("approved rollout plan requires separateFromAuthor=true")
        timestamp(value["reviewedAt"], "plan.review.reviewedAt")
    elif value["reviewedAt"] is not None:
        timestamp(value["reviewedAt"], "plan.review.reviewedAt")
    return approved and separate


def validate_separate_decisions(plan: dict[str, Any], contract: dict[str, Any]) -> None:
    actual = require_dict(plan["separateDecisions"], "plan.separateDecisions")
    expected = require_dict(contract["requiredSeparateDecisions"], "contract.requiredSeparateDecisions")
    if actual != expected:
        fail("strict-PQ activation and XMESH1 retirement must remain separate, unapproved decisions in this gate")


def validate_claims(plan: dict[str, Any], contract: dict[str, Any]) -> None:
    required = string_list(contract["requiredFalseClaims"], "contract.requiredFalseClaims")
    claims = require_dict(plan["claims"], "plan.claims")
    exact_keys(claims, set(required), "plan.claims")
    for key in required:
        if claims[key] is not False:
            fail(f"plan.claims.{key} must be false")


def validate(plan: dict[str, Any], contract: dict[str, Any]) -> dict[str, Any]:
    exact_keys(
        plan,
        {"schema", "planId", "createdAt", "releaseCandidate", "gates", "topology", "dns", "firewall", "nginx", "database", "keyMaterial", "stages", "rollback", "observability", "review", "separateDecisions", "claims"},
        "plan",
    )
    if plan["schema"] != contract["planSchema"]:
        fail("unsupported rollout plan schema")
    plan_id = nonempty(plan["planId"], "plan.planId")
    if not TOKEN.fullmatch(plan_id):
        fail("plan.planId must be a bounded token")
    timestamp(plan["createdAt"], "plan.createdAt")
    scan_for_forbidden_material(plan, contract)

    candidate = validate_release_candidate(plan)
    gates = validate_gates(plan)
    if gates["finalCanary"] and candidate["canaryResultSha256"] is None:
        fail("finalCanaryPassed=true requires releaseCandidate.canaryResultSha256")
    validate_topology(plan, contract)
    validate_dns(plan, contract)
    validate_firewall(plan, contract)
    validate_nginx(plan)
    validate_database(plan)
    validate_key_material(plan)
    validate_stages(plan, contract)
    validate_rollback(plan)
    validate_observability(plan)
    reviewed = validate_review(plan)
    validate_separate_decisions(plan, contract)
    validate_claims(plan, contract)

    eligible = all(gates.values()) and reviewed
    return {
        "status": "valid-production-rollout-plan",
        "planId": plan_id,
        "releaseCandidate": candidate,
        "reviewReady": True,
        "rolloutPlanGateEligible": eligible,
        "requiresP0EComplete": not gates["p0EComplete"],
        "requiresIndependentSecurityReview": not gates["securityReview"],
        "requiresPhysicalPowerQualification": not gates["physicalPower"],
        "requiresFinalCanary": not gates["finalCanary"],
        "requiresSeparatePlanReview": not reviewed,
        "productionActivation": False,
        "strictPQEnabled": False,
        "legacyXMESH1Retired": False,
    }


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--plan", required=True)
    p.add_argument("--contract", default=str(DEFAULT_CONTRACT))
    p.add_argument("--expected-nexus-revision")
    p.add_argument("--expected-node-revision")
    p.add_argument("--expected-canary-result-sha256")
    p.add_argument("--require-gate-eligible", action="store_true")
    return p


def main() -> int:
    args = parser().parse_args()
    try:
        contract = load_json(Path(args.contract), "contract")
        exact_keys(
            contract,
            {"schema", "planSchema", "requiredChangeDomains", "allowedDnsTypes", "allowedFirewallActions", "allowedStageDomains", "requiredFalseClaims", "requiredSeparateDecisions", "forbiddenFieldNames", "baselineInvariants"},
            "contract",
        )
        if contract["schema"] != "xsp2-production-rollout-plan-contract-1":
            fail("unsupported contract schema")
        string_list(contract["requiredChangeDomains"], "contract.requiredChangeDomains")
        plan = load_json(Path(args.plan), "plan")
        result = validate(plan, contract)
        candidate = result["releaseCandidate"]

        expected = {
            "nexusRevision": args.expected_nexus_revision,
            "nodeRevision": args.expected_node_revision,
            "canaryResultSha256": args.expected_canary_result_sha256,
        }
        if args.require_gate_eligible and any(value is None for value in expected.values()):
            fail("--require-gate-eligible requires all three --expected-* candidate bindings")
        for key, value in expected.items():
            if value is None:
                continue
            if key in {"nexusRevision", "nodeRevision"}:
                sha40(value, f"expected.{key}")
            else:
                sha64(value, f"expected.{key}")
            if candidate[key] != value:
                fail(f"release candidate mismatch for {key}")
        if args.require_gate_eligible and result["rolloutPlanGateEligible"] is not True:
            fail("rollout plan is valid but not eligible to satisfy the separately reviewed rollout-plan gate")
        print(json.dumps(result, sort_keys=True, separators=(",", ":")))
        return 0
    except ValidationError as exc:
        print(f"rollout-plan-invalid: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
