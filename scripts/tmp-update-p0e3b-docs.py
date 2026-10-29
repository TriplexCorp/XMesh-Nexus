#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MERGE = "0afffa3933991861607c27d8410115bc2054cd7c"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def update_readme(path: Path) -> None:
    text = path.read_text()
    text = replace_once(
        text,
        "**Latest verified Nexus recovery/security checkpoint:** [`f19d01e021efaa727bbba82672143005a96338b7`](https://github.com/TriplexCorp/XMesh-Nexus/commit/f19d01e021efaa727bbba82672143005a96338b7), merge of [PR #112](https://github.com/TriplexCorp/XMesh-Nexus/pull/112).",
        f"**Latest verified Nexus recovery/security checkpoint:** [`{MERGE}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{MERGE}), merge of [PR #114](https://github.com/TriplexCorp/XMesh-Nexus/pull/114).",
        f"{path.name} latest checkpoint",
    )
    text = replace_once(
        text,
        "**P0-C2-D and P0-D are COMPLETE. P0-E remains the CURRENT P0. P0-E1a, P0-E2a, P0-E2b and P0-E3a are COMPLETE within their explicitly bounded scopes; P0-E3b is the CURRENT sub-gate.** The production-capable Agent path remains default-disabled and production rollout remains unauthorized.",
        "**P0-C2-D and P0-D are COMPLETE. P0-E remains the CURRENT P0. P0-E1a, P0-E2a, P0-E2b, P0-E3a and P0-E3b are COMPLETE within their explicitly bounded scopes; P0-E4a is the CURRENT sub-gate.** The production-capable Agent path remains default-disabled and production rollout remains unauthorized.",
        f"{path.name} headline status",
    )
    anchor = "- **PR #112 / P0-E3a owner/off-host monotonic recovery checkpoint:** an experimental-only offline verifier introduces the independent third trust domain needed for coordinated-rollback detection without adding a second mutable security state machine. The monotonic recovery floor is derived from the existing immutable dual-signed commit receipt `toEpoch`; the exact receipt bytes are verified against independently provisioned `panel_response` Ed25519 and ML-DSA-65 public pins. Local state below the off-host floor and same-epoch receipt divergence fail closed. There is no HTTP route, database mutation, automatic reset/rekey, weaker fallback or production activation. The bounded proof assumes the owner presents the newest trusted checkpoint and that the off-host checkpoint/pins are outside the Agent and Nexus/PostgreSQL rollback domains."
    e3b = "- **PR #114 / P0-E3b coordinated backup/restore recovery:** a disposable recovery proof snapshots/restores a real PostgreSQL custom-format dump together with the complete real-Agent XSP-v2 private state root, protected `panel_response` Ed25519 + ML-DSA-65 signer identity and persistent mTLS identity. The newest P0-E3a checkpoint/pins remain outside that rollback domain. An exact current set restores and validates without epoch/replay reset, key regeneration, enrollment replacement or receipt rewriting; a mutually consistent old coordinated set is rejected by the newer off-host floor without mutating restored Agent/DB security state. Missing, mixed-generation and tampered components fail closed, and restore-time signer/C2-C least-privilege ACL re-hardening must leave the XSP-v2 tuple unchanged."
    text = replace_once(text, anchor, anchor + "\n" + e3b, f"{path.name} E3b bullet")

    heading = "Exact post-merge P0-E3a evidence on `f19d01e021efaa727bbba82672143005a96338b7`:"
    evidence = f"Exact post-merge P0-E3b evidence on `{MERGE}`:\n\n- [XSP-v2 P0-E3b Coordinated Backup Restore #24](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40953999674) — **success** on the exact merge SHA, including real coordinated PostgreSQL + Agent + signer + mTLS restore, old-set rejection against the independent E3a witness and mixed/missing/tampered component negatives.\n- [Backend CI #3658](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40953999812) — **success** on the exact merge SHA, including strict Clippy, Docker build and disposable PostgreSQL/Redis/API authentication regression coverage.\n\nPrevious P0-E3a evidence remains on `f19d01e021efaa727bbba82672143005a96338b7`:"
    text = replace_once(text, heading, evidence, f"{path.name} evidence")

    text = replace_once(
        text,
        "P0-D completion and P0-E1a/P0-E2a/P0-E2b/P0-E3a evidence do **not** authorize production VPS/DNS/firewall/public-Nginx/key-material changes, Agent cutover or rollout.",
        "P0-D completion and P0-E1a/P0-E2a/P0-E2b/P0-E3a/P0-E3b evidence do **not** authorize production VPS/DNS/firewall/public-Nginx/key-material changes, Agent cutover or rollout.",
        f"{path.name} production evidence",
    )

    completed = "- **P0-E3a COMPLETE — owner/off-host monotonic recovery checkpoint:** PR #112 proves an offline third-domain checkpoint can derive its floor from the existing dual-signed commit receipt, independently verify both signer keys/signatures, reject coordinated old local state and same-epoch receipt divergence, and do so without a new mutable counter, remote API, DB mutation or recovery bypass. The bounded trust assumption is that the newest checkpoint and its independently provisioned pins do not roll back with Agent/Nexus state."
    text = replace_once(
        text,
        completed,
        completed + "\n- **P0-E3b COMPLETE — coordinated backup/restore recovery:** PR #114 proves a disposable exact-current restore and coordinated-old restore boundary across PostgreSQL, complete Agent state, signer identity and mTLS identity. The current set validates against the owner-held E3a witness without resets/regeneration; the old set and mixed/missing/tampered components fail closed, while database ACL re-hardening preserves the security tuple.",
        f"{path.name} completed E3b",
    )

    old_current = """### CURRENT sub-gate — P0-E3b coordinated backup/restore proof

P0-E3b must bind the completed E3a off-host witness to a **real disposable coordinated Agent + Nexus/PostgreSQL backup/restore procedure**. The proof must snapshot an older mutually consistent Agent/DB state, advance normally to a newer committed epoch/receipt, preserve the newest off-host checkpoint outside both rollback domains, restore both local sides to the old snapshots, and reject that coordinated restore before any security operation or network mutation. An exact current/new restore must validate; wrong-node, tampered, mismatched or stale checkpoint inputs must fail closed. The restore procedure must reuse the existing Agent/Nexus journals and E3a witness rather than create another security state machine, automatic epoch/replay reset, key regeneration, enrollment replacement or weaker fallback.

After P0-E3b, P0-E still must close:

1. physical power-loss / storage-controller-cache behavior beyond the bounded process-crash proof;
2. production-grade backup/restore handling for persistent signing/encryption/Agent identities and operational recovery procedures beyond the disposable coordinated proof;
3. owner-authorized key rotation/recovery and explicit old-key retirement policy;
4. parser/protocol fuzzing plus FIPS 204 / algorithm known-answer validation where applicable;
5. independent security review of the final migration/production architecture and operational observability without secret/key leakage."""
    new_current = """### CURRENT sub-gate — P0-E4a physical power-loss / storage durability

P0-E4a must move beyond P0-E1a's process-crash/fsync-order proof and establish an explicit **host/storage power-loss qualification boundary**. A normal process kill or successful `fsync(2)` call alone is not sufficient evidence for this gate.

Acceptance requires a reviewed supported-storage test matrix that exercises abrupt host/power loss at the critical Agent keyring/journal and PostgreSQL durability boundaries, records the filesystem/virtual-disk/controller/cache flush semantics being relied on, and proves recovery is either the previous complete state or the next complete state — never a lowered epoch floor, torn active identity, fabricated ACK/receipt success or silently reconstructed security state. Configurations whose storage stack cannot provide the required durable-flush semantics must fail qualification rather than weaken the protocol. The independent E3a witness remains the external rollback floor. `strict-pq` stays OFF and production topology remains unchanged.

After P0-E4a, P0-E still must close:

1. owner-authorized key rotation/recovery and explicit old-key retirement policy;
2. parser/protocol fuzzing plus FIPS 204 / algorithm known-answer validation where applicable;
3. independent security review of the final migration/production architecture;
4. operational observability without secret/key leakage."""
    text = replace_once(text, old_current, new_current, f"{path.name} current E4a")

    text = replace_once(
        text,
        "- Completed P0-D capabilities/evidence and bounded P0-E1a/P0-E2a/P0-E2b/P0-E3a proofs remain default-disabled staging/production-capable foundations; none authorize production rollout.\n- P0-E3a adds an independent coordinated-rollback witness only when the newest trusted checkpoint/pins remain outside the rolled-back local domains; P0-E3b must prove the real coordinated restore procedure consumes that witness correctly.",
        "- Completed P0-D capabilities/evidence and bounded P0-E1a/P0-E2a/P0-E2b/P0-E3a/P0-E3b proofs remain default-disabled staging/production-capable foundations; none authorize production rollout.\n- P0-E3a provides the independent coordinated-rollback witness and P0-E3b proves the disposable coordinated restore procedure consumes it correctly; P0-E4a now owns the remaining host/storage power-loss durability boundary.",
        f"{path.name} guardrails",
    )

    link = "- [XSP-v2 P0-E owner/off-host recovery checkpoint](docs/XSP_V2_P0E_OFFHOST_RECOVERY_CHECKPOINT.md)"
    text = replace_once(
        text,
        link,
        link + "\n- [XSP-v2 P0-E coordinated backup/restore recovery](docs/XSP_V2_P0E_COORDINATED_BACKUP_RESTORE.md)",
        f"{path.name} doc link",
    )
    path.write_text(text)


def update_roadmap(path: Path) -> None:
    text = path.read_text()
    old_latest = "- **Latest completed Nexus P0-E recovery/security checkpoint:** [`f19d01e021efaa727bbba82672143005a96338b7`](https://github.com/TriplexCorp/XMesh-Nexus/commit/f19d01e021efaa727bbba82672143005a96338b7), merge of [PR #112](https://github.com/TriplexCorp/XMesh-Nexus/pull/112). P0-E3a proves a bounded independent owner/off-host monotonic rollback witness derived from the existing authoritative dual-signed commit receipt; P0-E3b coordinated backup/restore recovery is the current sub-gate."
    new_latest = f"- **Latest completed Nexus P0-E recovery/security checkpoint:** [`{MERGE}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{MERGE}), merge of [PR #114](https://github.com/TriplexCorp/XMesh-Nexus/pull/114). P0-E3b proves the bounded disposable coordinated PostgreSQL + Agent + signer + mTLS backup/restore procedure against the independent E3a owner/off-host witness; P0-E4a physical power-loss/storage durability is the current sub-gate."
    text = replace_once(text, old_latest, new_latest, "roadmap latest checkpoint")

    e3a = "- **P0-E3a / PR #112:** the experimental-only offline checkpoint binds Node identity, the dual-signed receipt `toEpoch` recovery floor, exact receipt digest/bytes and independently provisioned `panel_response` Ed25519 + ML-DSA-65 pins. A coordinated old local restore below that floor, same-epoch receipt divergence, wrong identity/pins or either invalid signature fail closed. No second recovery counter, automatic state reset/rekey, network route, DB mutation or production activation was introduced."
    e3b = f"- **P0-E3b / PR #114:** a disposable coordinated recovery proof captures a real PostgreSQL custom-format dump, complete real-Agent XSP-v2 state root, protected `panel_response` Ed25519 + ML-DSA-65 signer identity and persistent mTLS identity while the newest E3a checkpoint/pins remain outside the backup rollback domain. Exact-current restore validates without reset/regeneration/receipt rewriting; an internally consistent old coordinated restore is rejected by the newer E3a floor without mutating restored Agent/DB security state; mixed, missing and tampered components fail closed; signer/C2-C ACL re-hardening preserves the XSP-v2 tuple.\n- On exact Nexus merge SHA `{MERGE}`, [P0-E3b Coordinated Backup Restore #24](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40953999674) and [Backend CI #3658](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40953999812) completed **success**, including the full real coordinated restore proof and the backend/disposable API regression matrix."
    text = replace_once(text, e3a, e3b + "\n" + e3a, "roadmap E3b source checkpoint")

    text = replace_once(
        text,
        "| **P0-E3b coordinated backup/restore recovery procedure** | **CURRENT sub-gate** | Bind real PostgreSQL + persistent Agent/signing/encryption identity backups to the independent E3a witness and prove old coordinated restore rejects before mutation |\n| **P0-E recovery/security release gates** | **CURRENT P0** | E1a/E2a/E2b/E3a complete within bounded scopes; still requires E3b coordinated backup/restore, physical power-loss proof, owner-authorized recovery + old-key retirement, fuzz/KAT, independent review and observability |",
        "| **P0-E3b coordinated backup/restore recovery procedure** | **COMPLETE — disposable coordinated recovery proof** | PR #114; exact current Agent+DB+signer+mTLS restore validates against E3a, old/mixed/missing/tampered sets fail closed |\n| **P0-E4a physical power-loss / storage durability** | **CURRENT sub-gate** | Qualify real host/storage durable-flush behavior beyond process-kill/fsync-order evidence; no torn/lowered security state after abrupt power loss |\n| **P0-E recovery/security release gates** | **CURRENT P0** | E1a/E2a/E2b/E3a/E3b complete within bounded scopes; still requires E4a power-loss qualification, owner-authorized recovery + old-key retirement, fuzz/KAT, independent review and observability |",
        "roadmap status table",
    )

    old_section = """### CURRENT sub-gate — P0-E3b coordinated backup/restore recovery procedure

P0-E3b must turn the E3a witness into a complete disposable disaster-recovery proof. A backup set must capture PostgreSQL together with the persistent Agent and cryptographic identity material needed to interpret that security state, while the newest E3a checkpoint remains independently owner-held/off-host.

Acceptance requires:

- restore a mutually consistent **old** Agent + Nexus/PostgreSQL + identity backup and reject it against the newer E3a witness before any security-state mutation or network action;
- restore an exact **current** backup set and prove it validates against the witness without epoch/replay reset, key regeneration, enrollment replacement or receipt rewriting;
- prove missing, mismatched or mixed-generation backup components fail closed rather than being silently reconstructed;
- restore reviewed signer/C2-C least-privilege database ACLs without changing the XSP-v2 security tuple;
- keep caller-controlled URLs/scripts/commands and weaker transport/legacy fallback out of the recovery path;
- keep `strict-pq` OFF and production topology unchanged.

After P0-E3b, P0-E still must close:

1. physical power-loss / storage-controller-cache behavior beyond P0-E1a's bounded process-crash/fsync proof;
2. owner-authorized key rotation/recovery and explicit old-key retirement policy;
3. parser/protocol fuzzing plus FIPS 204 / algorithm known-answer validation where applicable;
4. independent security review of the final migration/production architecture;
5. operational observability without secret/key leakage."""
    new_section = f"""#### P0-E3b — coordinated backup/restore recovery procedure — COMPLETE

PR #114 closes the disposable coordinated-recovery boundary on top of E3a. The proof creates/restores a real custom-format PostgreSQL dump together with the complete real-Agent XSP-v2 state root, protected panel-response Ed25519 + ML-DSA-65 signer identity and persistent mTLS identity. The newest E3a checkpoint and independently retained panel public pins stay outside the backup/rollback set as the third trust domain.

An exact current backup restores and cross-checks Node identity, epoch, Agent journals, authoritative receipt, PostgreSQL tuple, signer identity/pins and mTLS SPKI without epoch/replay reset, key regeneration, enrollment replacement or receipt rewriting. A mutually consistent older coordinated set is locally restorable but the newer E3a floor rejects it before it can be accepted as current; the proof verifies that rejection leaves restored Agent and DB security state unchanged. Missing, mixed-generation and tampered components fail closed. Database recreation re-applies the reviewed signer/C2-C least-privilege ACLs and requires that re-hardening not mutate the XSP-v2 tuple.

Exact post-merge evidence on `{MERGE}`: [P0-E3b #24](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40953999674) and [Backend CI #3658](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40953999812) are **success**. This remains a disposable recovery proof, not production activation.

### CURRENT sub-gate — P0-E4a physical power-loss / storage durability

P0-E4a must extend beyond P0-E1a's process-crash/fsync-order evidence and establish a reviewed host/storage durability qualification boundary. A process kill, VM snapshot test, or successful `fsync(2)` return by itself does **not** prove physical power-loss/controller-cache behavior.

Acceptance requires:

- exercise abrupt host/power-loss events at the critical Agent keyring/journal and PostgreSQL durability boundaries on representative supported storage stacks whose flush/barrier/cache semantics are explicitly recorded;
- prove recovery is always a previously complete or next complete security state — never a lowered epoch floor, torn active identity, fabricated ACK/receipt success, replay rewind or silently reconstructed state;
- verify the storage stack actually honors the durable-flush assumptions required by the existing fsync/rename protocol, including virtual-disk/controller/cache configuration where applicable;
- fail qualification for configurations that cannot provide the required durability semantics rather than weakening XSP-v2 state checks;
- keep the independent E3a off-host witness as the external rollback floor and preserve all E3b backup/restore invariants;
- keep `strict-pq` OFF and production topology unchanged.

After P0-E4a, P0-E still must close:

1. owner-authorized key rotation/recovery and explicit old-key retirement policy;
2. parser/protocol fuzzing plus FIPS 204 / algorithm known-answer validation where applicable;
3. independent security review of the final migration/production architecture;
4. operational observability without secret/key leakage."""
    text = replace_once(text, old_section, new_section, "roadmap detailed E3b/E4a")

    text = replace_once(
        text,
        "No production activation is authorized by C2-D, P0-D or the completed bounded P0-E1a/P0-E2a/P0-E2b/P0-E3a proofs.",
        "No production activation is authorized by C2-D, P0-D or the completed bounded P0-E1a/P0-E2a/P0-E2b/P0-E3a/P0-E3b proofs.",
        "roadmap production gate",
    )
    text = replace_once(
        text,
        "- Completed P0-D gates through Node PR #37 and Nexus PR #105, plus bounded P0-E1a/P0-E2a/P0-E2b/P0-E3a evidence, remain default-disabled foundations/proofs; none authorize production migration.\n- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate validation.\n- P0-E3a detects coordinated local rollback only while the independent owner/off-host witness remains current; P0-E3b must now bind complete backup/restore procedures and persistent identities to that witness.",
        "- Completed P0-D gates through Node PR #37 and Nexus PR #105, plus bounded P0-E1a/P0-E2a/P0-E2b/P0-E3a/P0-E3b evidence, remain default-disabled foundations/proofs; none authorize production migration.\n- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate validation.\n- P0-E3a supplies the independent rollback floor and P0-E3b proves the disposable coordinated backup/restore procedure consumes it correctly; P0-E4a now owns the real host/storage power-loss durability qualification boundary.",
        "roadmap guardrails",
    )
    path.write_text(text)


for name in ("README.md", "README.en.md"):
    update_readme(ROOT / name)
update_roadmap(ROOT / "docs/ENTERPRISE_ROADMAP.md")
print("P0-E3b docs checkpoint updated")
