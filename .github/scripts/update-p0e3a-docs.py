from pathlib import Path

MERGE = "f19d01e021efaa727bbba82672143005a96338b7"
PR = "https://github.com/TriplexCorp/XMesh-Nexus/pull/112"
E3A_RUN = "https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40862058873"
CRYPTO_RUN = "https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40862058598"
C2C_RUN = "https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40862058488"
BACKEND_RUN = "https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40862058513"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, body: str, label: str) -> str:
    if text.count(start) != 1 or text.count(end) != 1:
        raise SystemExit(f"{label}: marker count mismatch")
    i = text.index(start)
    j = text.index(end, i)
    return text[:i] + body + text[j:]


def replace_line_prefix(text: str, prefix: str, replacement: str, label: str) -> str:
    lines = text.splitlines(keepends=True)
    indexes = [i for i, line in enumerate(lines) if line.startswith(prefix)]
    if len(indexes) != 1:
        raise SystemExit(f"{label}: expected one line prefix, found {len(indexes)}")
    newline = "\n" if lines[indexes[0]].endswith("\n") else ""
    lines[indexes[0]] = replacement.rstrip("\n") + newline
    return "".join(lines)


# README files were already partially checkpointed by the first docs pass.
# Treat that state as authoritative and only add the exact full post-merge matrix.
for filename in ["README.md", "README.en.md"]:
    path = Path(filename)
    text = path.read_text()
    required = [
        f"[`{MERGE}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{MERGE})",
        "P0-E3a are COMPLETE within their explicitly bounded scopes; P0-E3b is the CURRENT sub-gate",
        "**PR #112 / P0-E3a owner/off-host monotonic recovery checkpoint:**",
        "### CURRENT sub-gate — P0-E3b coordinated backup/restore proof",
        "docs/XSP_V2_P0E_OFFHOST_RECOVERY_CHECKPOINT.md",
    ]
    for marker in required:
        if marker not in text:
            raise SystemExit(f"{filename}: expected checkpoint marker missing: {marker}")

    e3a_line = (
        f"- [XSP-v2 P0-E3a Off-host Recovery Checkpoint #9]({E3A_RUN}) — **success** on the exact merge SHA, "
        "including real Ed25519 + ML-DSA-65 receipt verification, coordinated-old-state rejection, "
        "tamper/wrong-node negatives, formatting and strict test-target Clippy."
    )
    matrix_line = (
        f"- [XSP-v2 Crypto PoC #213]({CRYPTO_RUN}), [C2-C #61]({C2C_RUN}) and "
        f"[Backend CI #3632]({BACKEND_RUN}) — **success** on the exact merge SHA, preserving the existing "
        "crypto/signer/DB boundary and full backend/disposable API regression matrix."
    )
    if matrix_line not in text:
        text = replace_once(text, e3a_line + "\n", e3a_line + "\n" + matrix_line + "\n", f"{filename} matrix evidence")
    path.write_text(text)

roadmap = Path("docs/ENTERPRISE_ROADMAP.md")
text = roadmap.read_text()

latest = (
    f"- **Latest completed Nexus P0-E recovery/security checkpoint:** [`{MERGE}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{MERGE}), merge of [PR #112]({PR}). P0-E3a proves a bounded independent owner/off-host monotonic rollback witness derived from the existing authoritative dual-signed commit receipt; P0-E3b coordinated backup/restore recovery is the current sub-gate.\n"
    f"- **P0-E3a / PR #112:** the experimental-only offline checkpoint binds Node identity, the dual-signed receipt `toEpoch` recovery floor, exact receipt digest/bytes and independently provisioned `panel_response` Ed25519 + ML-DSA-65 pins. A coordinated old local restore below that floor, same-epoch receipt divergence, wrong identity/pins or either invalid signature fail closed. No second recovery counter, automatic state reset/rekey, network route, DB mutation or production activation was introduced.\n"
    f"- On exact Nexus merge SHA `{MERGE}`, [P0-E3a Off-host Recovery Checkpoint #9]({E3A_RUN}), [Crypto #213]({CRYPTO_RUN}), [C2-C #61]({C2C_RUN}) and [Backend CI #3632]({BACKEND_RUN}) all completed **success**. The witness/pins must remain outside both local rollback domains; rollback of the off-host trust domain itself remains outside this proof."
)

if "- **P0-E3a / PR #112:**" not in text:
    text = replace_line_prefix(
        text,
        "- **Latest completed Nexus P0-E recovery/security checkpoint:**",
        latest,
        "roadmap latest checkpoint",
    )
else:
    if MERGE not in text:
        raise SystemExit("roadmap: E3a marker exists without exact merge SHA")

text = replace_line_prefix(
    text,
    "| **P0-E3a owner/off-host monotonic recovery checkpoint**",
    "| **P0-E3a owner/off-host monotonic recovery checkpoint** | **COMPLETE — bounded independent witness proof** | PR #112; existing dual-signed commit receipt becomes the owner-held off-host floor; coordinated old local restore and same-epoch receipt divergence fail closed |",
    "roadmap E3a table",
)

e3a_table = "| **P0-E3a owner/off-host monotonic recovery checkpoint** | **COMPLETE — bounded independent witness proof** | PR #112; existing dual-signed commit receipt becomes the owner-held off-host floor; coordinated old local restore and same-epoch receipt divergence fail closed |\n"
if "| **P0-E3b coordinated backup/restore recovery procedure**" not in text:
    text = replace_once(
        text,
        e3a_table,
        e3a_table + "| **P0-E3b coordinated backup/restore recovery procedure** | **CURRENT sub-gate** | Bind real PostgreSQL + persistent Agent/signing/encryption identity backups to the independent E3a witness and prove old coordinated restore rejects before mutation |\n",
        "roadmap E3b table insert",
    )

text = replace_line_prefix(
    text,
    "| **P0-E recovery/security release gates**",
    "| **P0-E recovery/security release gates** | **CURRENT P0** | E1a/E2a/E2b/E3a complete within bounded scopes; still requires E3b coordinated backup/restore, physical power-loss proof, owner-authorized recovery + old-key retirement, fuzz/KAT, independent review and observability |",
    "roadmap overall table",
)

roadmap_section = """#### P0-E3a — owner/off-host monotonic recovery checkpoint — COMPLETE

PR #112 adds the first independent recovery witness outside the Agent and Nexus/PostgreSQL rollback domains without creating a second security state machine. The experimental-only offline `xsp-v2-recovery-checkpoint` tool accepts an independently provisioned `panel_response` public pin plus the existing authoritative dual-signed commit receipt. It verifies Ed25519 **AND** ML-DSA-65, derives the recovery floor directly from the receipt's committed `toEpoch`, stores the exact signed receipt bytes and SHA-256 digest, and binds the checkpoint to the exact Node and signer identity.

Recovery verification rejects a local epoch below the off-host floor as coordinated rollback. At the same epoch it additionally requires the exact authoritative receipt digest, so a mutually consistent but different re-signed history cannot replace the witnessed commit. Wrong Node identity, altered checkpoint metadata, noncanonical receipt encoding, mismatched pins, or either invalid signature also fail closed. The tool has no HTTP route, DB mutation, remote action or automatic reset/rekey path; `strict-pq` remains OFF.

This is a bounded third-trust-domain proof. It assumes the newest owner-held checkpoint and public pins themselves remain outside the rollback event. It does **not** yet prove that a complete operational backup set contains every PostgreSQL/Agent/signing/encryption identity required for deterministic disaster recovery.

### CURRENT sub-gate — P0-E3b coordinated backup/restore recovery procedure

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
5. operational observability without secret/key leakage.

Completion of individual P0-E items does not authorize production rollout. `strict-pq` remains OFF unless a later explicit release/production gate separately authorizes activation.

"""

if "### CURRENT sub-gate — P0-E3a owner/off-host monotonic recovery checkpoint\n" in text:
    text = replace_between(
        text,
        "### CURRENT sub-gate — P0-E3a owner/off-host monotonic recovery checkpoint\n",
        "## Production rollout — NOT AUTHORIZED\n",
        roadmap_section,
        "roadmap detailed E3 section",
    )
elif "#### P0-E3a — owner/off-host monotonic recovery checkpoint — COMPLETE" not in text:
    raise SystemExit("roadmap: neither old nor completed E3a section found")

text = text.replace(
    "No production activation is authorized by C2-D, P0-D or the completed bounded P0-E1a/P0-E2a/P0-E2b proofs.",
    "No production activation is authorized by C2-D, P0-D or the completed bounded P0-E1a/P0-E2a/P0-E2b/P0-E3a proofs.",
)
text = text.replace(
    "Completed P0-D gates through Node PR #37 and Nexus PR #105, plus bounded P0-E1a/P0-E2a/P0-E2b evidence",
    "Completed P0-D gates through Node PR #37 and Nexus PR #105, plus bounded P0-E1a/P0-E2a/P0-E2b/P0-E3a evidence",
)
text = text.replace(
    "P0-E2a and P0-E2b do not detect coordinated rollback when all local witnesses are rolled back together; P0-E3a exists specifically to add an independent non-rolled-back recovery authority.",
    "P0-E3a detects coordinated local rollback only while the independent owner/off-host witness remains current; P0-E3b must now bind complete backup/restore procedures and persistent identities to that witness.",
)
roadmap.write_text(text)
