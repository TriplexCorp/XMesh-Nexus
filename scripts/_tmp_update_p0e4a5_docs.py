#!/usr/bin/env python3
from pathlib import Path
import re

NEXUS_SHA = "a34d0999ca519e2a81e68d92ec7136cd606518d4"
NODE_SHA = "7bf8cc92950f396e33891c8744c1f6855414154b"
CORE_SHA = "50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e"


def sub_once(text: str, pattern: str, replacement: str, *, flags: int = 0, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one replacement, got {count}")
    return updated


def insert_after_line(text: str, prefix: str, addition: str, *, guard: str, label: str) -> str:
    if guard in text:
        return text
    lines = text.splitlines(keepends=True)
    hits = [i for i, line in enumerate(lines) if line.startswith(prefix)]
    if len(hits) != 1:
        raise RuntimeError(f"{label}: expected one anchor line, got {len(hits)}")
    i = hits[0]
    lines.insert(i + 1, addition.rstrip("\n") + "\n")
    return "".join(lines)


def patch_readme(path: Path, heading: str) -> None:
    text = path.read_text()
    text = sub_once(
        text,
        rf"^## {re.escape(heading)} — 29 October 2026$",
        f"## {heading} — 30 October 2026",
        flags=re.M,
        label=f"{path}: date",
    )
    latest = (
        f"**Latest verified Nexus recovery/security checkpoint:** [`{NEXUS_SHA}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{NEXUS_SHA}), "
        "merge of [PR #123](https://github.com/TriplexCorp/XMesh-Nexus/pull/123). Node PR #45 + Nexus PR #123 complete the bounded P0-E4a5 real-operation lab-runner/source-contract layer on top of E4a1–E4a4; "
        "**P0-E4a itself remains CURRENT/OPEN until five representative physical abrupt-power runs are executed and independently reviewed.**\n\n"
    )
    text = sub_once(
        text,
        r"\*\*Latest verified Nexus recovery/security checkpoint:\*\*.*?\n\n",
        latest,
        flags=re.S,
        label=f"{path}: latest checkpoint",
    )
    status = (
        "**P0-C2-D and P0-D are COMPLETE. P0-E remains the CURRENT P0. P0-E1a, P0-E2a, P0-E2b, P0-E3a and P0-E3b are COMPLETE within their explicitly bounded scopes. "
        "P0-E4a remains the CURRENT sub-gate; inside it, E4a1 storage preflight, E4a2 external arming, E4a3 evidence contract, E4a4 five-point review matrix and E4a5 real-operation lab reachability/source pin are COMPLETE within bounded software/lab-preparation scopes. "
        "Representative physical power-loss qualification is still outstanding.** The production-capable Agent path remains default-disabled and production rollout remains unauthorized.\n\n"
    )
    text = sub_once(
        text,
        r"\*\*P0-C2-D and P0-D are COMPLETE\..*?\*\* The production-capable Agent path remains default-disabled and production rollout remains unauthorized\.\n\n",
        status,
        flags=re.S,
        label=f"{path}: status paragraph",
    )
    new_bullets = (
        "- **PR #121 / P0-E4a3 physical power-cut evidence contract:** defines a strict single-run evidence bundle for an independently triggered abrupt-power experiment. It binds the reviewed Node source, exact lab-binary SHA-256, arm checkpoint/run ID, preflight/storage profile, changed boot ID, controller event, post-boot Agent/PostgreSQL state and independent E3a witness. Synthetic CI validates the schema/fail-closed verifier only; it is **not** physical power-loss evidence.\n"
        "- **PR #122 / P0-E4a4 five-point power-cut review matrix:** aggregates exactly one valid E4a3 bundle for each of `after-previous`, `after-floor`, `after-active`, `after-recovery-abort` and `after-recovery-active`, rejects duplicates/mixed source/storage generations and produces a deterministic matrix digest/review handle. Synthetic fixtures prove the review tooling only; hardware remains unqualified.\n"
        f"- **Node PR #45 + Nexus PR #123 / P0-E4a5 real-operation lab reachability:** Node merge `{NODE_SHA}` drives the real `ActivatePreparedRotation` / `RecoverRotation` operations to all five inherited-FD arm points while remaining test-only. Nexus merge `{NEXUS_SHA}` pins both the original reviewed power-cut/core source `{CORE_SHA}` and the runner source `{NODE_SHA}`, proves the core keyring/hook files are byte-identical across them, re-runs all five real-operation arm paths, preserves the crash matrix and proves normal Agent artifacts contain no lab controls. This is the last bounded software-preparation layer, **not** physical power-loss qualification.\n"
    )
    text = insert_after_line(
        text,
        "- **Node PR #44 + Nexus PR #117 / P0-E4a2",
        new_bullets,
        guard="PR #121 / P0-E4a3 physical power-cut evidence contract",
        label=f"{path}: E4a3-5 bullets",
    )
    evidence = (
        "- Nexus PR #121 merge [`d57e74ef73f704b2229347c4f8712c5c1e527b0b`](https://github.com/TriplexCorp/XMesh-Nexus/commit/d57e74ef73f704b2229347c4f8712c5c1e527b0b): [P0-E4a3 Power-cut Evidence Contract #4](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40972825779) and [Backend CI #3680](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40972822127) — **success**.\n"
        "- Nexus PR #122 merge [`8ca408fd50169ef4311a30b6248c2a4743e6a3a5`](https://github.com/TriplexCorp/XMesh-Nexus/commit/8ca408fd50169ef4311a30b6248c2a4743e6a3a5): [P0-E4a4 Power-cut Matrix Contract #4](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40973807849) and [Backend CI #3682](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40973807725) — **success**.\n"
        f"- Node PR #45 merge [`{NODE_SHA}`](https://github.com/TriplexCorp/XMesh-Node/commit/{NODE_SHA}): [P0-E4a5 Lab Operation #2](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40975150937) — **success** on the exact merge SHA. Nexus PR #123 merge [`{NEXUS_SHA}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{NEXUS_SHA}): [P0-E4a5 Node Lab Operation Contract #2](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40976111704) and [Backend CI #3684](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40976111693) — **success** on the exact merge SHA.\n"
    )
    text = insert_after_line(
        text,
        "- Nexus PR #117 merge",
        evidence,
        guard="Nexus PR #121 merge",
        label=f"{path}: E4a3-5 evidence",
    )
    text = sub_once(
        text,
        r"The current verified XMesh-Node P0-E4a2 lab-readiness checkpoint is \[`50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e`\]\(https://github\.com/TriplexCorp/XMesh-Node/commit/50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e\), merge of Node PR #44\.",
        f"The current verified XMesh-Node P0-E4a5 lab-runner checkpoint is [`{NODE_SHA}`](https://github.com/TriplexCorp/XMesh-Node/commit/{NODE_SHA}), merge of Node PR #45; the reviewed core power-cut/keyring source remains `{CORE_SHA}` from Node PR #44 and is separately pinned by the E4a3/E4a5 contracts.",
        label=f"{path}: Node checkpoint",
    )
    text = sub_once(
        text,
        r"P0-E4a1 and P0-E4a2 now provide the reviewed storage preflight and external lab arming primitives, but \*\*P0-E4a remains open\*\*\. The remaining acceptance evidence must come from real representative abrupt host/device power-loss runs; a normal process kill, VM stop/snapshot, successful `fsync\(2\)` return, preflight PASS or GitHub CI run is not sufficient\.",
        "P0-E4a1 through P0-E4a5 now provide the reviewed storage preflight, external arming, strict evidence schema, five-point review matrix and real-operation lab-runner/source contract, but **P0-E4a remains open**. The remaining acceptance evidence must come from five real representative abrupt host/device power-loss runs plus independent review; a normal process kill, VM stop/snapshot, successful `fsync(2)` return, synthetic evidence fixture, preflight PASS or GitHub CI run is not sufficient.",
        label=f"{path}: current E4a paragraph",
    )
    text = text.replace(
        "P0-E4a1/E4a2 prepare and machine-check the storage/lab boundary; only the representative external abrupt-power matrix can close P0-E4a.",
        "P0-E4a1–E4a5 prepare and machine-check the storage/lab/evidence boundary; only the five representative external abrupt-power runs plus independent review can close P0-E4a.",
    )
    path.write_text(text)


def patch_roadmap(path: Path) -> None:
    text = path.read_text()
    text = sub_once(text, r"^## Authoritative engineering status — 29 October 2026$", "## Authoritative engineering status — 30 October 2026", flags=re.M, label="roadmap date")
    latest = (
        f"- **Latest verified Nexus P0-E recovery/security checkpoint:** [`{NEXUS_SHA}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{NEXUS_SHA}), merge of [PR #123](https://github.com/TriplexCorp/XMesh-Nexus/pull/123). "
        "P0-E4a1 through P0-E4a5 are complete within bounded storage-preflight/lab-tooling/source-contract scopes; P0-E4a itself remains the current open sub-gate until five representative physical abrupt-power experiments are executed and independently reviewed.\n"
    )
    text = sub_once(text, r"^- \*\*Latest verified Nexus P0-E recovery/security checkpoint:\*\*.*$", latest.rstrip("\n"), flags=re.M, label="roadmap latest checkpoint")
    additions = (
        "- **P0-E4a3 / PR #121:** Nexus merge [`d57e74ef73f704b2229347c4f8712c5c1e527b0b`](https://github.com/TriplexCorp/XMesh-Nexus/commit/d57e74ef73f704b2229347c4f8712c5c1e527b0b) adds the strict physical-run evidence schema/verifier. A valid bundle binds the reviewed Node source, exact lab-binary digest, selected arm point/run ID, storage preflight, independent controller event, changed boot ID, post-boot Agent/PostgreSQL evidence and E3a witness. [Power-cut Evidence Contract #4](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40972825779) and [Backend CI #3680](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40972822127) are **success**. Synthetic CI does not count as a physical run.\n"
        "- **P0-E4a4 / PR #122:** Nexus merge [`8ca408fd50169ef4311a30b6248c2a4743e6a3a5`](https://github.com/TriplexCorp/XMesh-Nexus/commit/8ca408fd50169ef4311a30b6248c2a4743e6a3a5) adds the deterministic five-point review matrix over exactly one valid E4a3 bundle for each critical checkpoint. It rejects duplicates and mixed source/storage generations and produces a stable review digest. [Power-cut Matrix Contract #4](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40973807849) and [Backend CI #3682](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40973807725) are **success**. This is review tooling, not hardware qualification.\n"
        f"- **P0-E4a5 / Node PR #45 + Nexus PR #123:** Node merge [`{NODE_SHA}`](https://github.com/TriplexCorp/XMesh-Node/commit/{NODE_SHA}) adds a test-only runner that reaches all five external arm markers through the real `ActivatePreparedRotation` / `RecoverRotation` operations. Nexus merge [`{NEXUS_SHA}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{NEXUS_SHA}) pins that runner while separately preserving reviewed core source `{CORE_SHA}` and proves the core keyring/hook files are byte-identical across the revisions. Node [Lab Operation #2](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40975150937), Nexus [Node Lab Operation Contract #2](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40976111704) and [Backend CI #3684](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40976111693) are **success**. P0-E4a remains OPEN.\n"
    )
    text = insert_after_line(text, "- **P0-E4a2 / Node PR #44 + Nexus PR #117:", additions, guard="**P0-E4a3 / PR #121:**", label="roadmap E4a3-5 checkpoints")

    new_sections = f"""#### P0-E4a3 — physical power-cut evidence contract — COMPLETE (bounded evidence tooling)\n\nPR #121 defines the strict single-run evidence bundle accepted after an independently triggered physical abrupt-power event. The verifier binds the reviewed Node source `{CORE_SHA}`, exact lab-binary SHA-256, arm run/checkpoint, storage preflight/controller profile, changed boot ID, controller event, post-boot Agent/PostgreSQL state and independent E3a witness. Malformed, mixed or self-asserted qualification evidence fails closed. Synthetic fixtures exercise the verifier only and do not count as physical runs.\n\n#### P0-E4a4 — five-point power-cut review matrix — COMPLETE (bounded review tooling)\n\nPR #122 requires exactly one valid E4a3 bundle for each of `after-previous`, `after-floor`, `after-active`, `after-recovery-abort` and `after-recovery-active`, rejects duplicate checkpoints and mixed source/storage generations, and emits a deterministic matrix digest as an independent review handle. CI proves aggregation/rejection behavior only; it does not qualify hardware.\n\n#### P0-E4a5 — real-operation lab reachability/source contract — COMPLETE (bounded lab readiness)\n\nNode PR #45 at `{NODE_SHA}` drives the real keyring activation/recovery operations to all five existing inherited-FD arm points under the lab-only build tag. Nexus PR #123 at `{NEXUS_SHA}` pins both the original reviewed power-cut/core source `{CORE_SHA}` and the runner revision, proves the core keyring/hook files are byte-identical, re-runs all five paths, preserves the process-crash matrix and proves normal Agent artifacts contain no lab controls. CI kills blocked child processes only to complete source-contract tests; that is not physical power-loss evidence.\n\n"""
    text = sub_once(
        text,
        r"(#### P0-E4a2 — external power-cut arming/source contract — COMPLETE \(bounded lab readiness\)\n\n.*?GitHub CI proves the arming/source boundary only; it is not physical power-loss evidence\.\n\n)(### CURRENT sub-gate — P0-E4a physical power-loss / storage durability)",
        r"\1" + new_sections + r"\2",
        flags=re.S,
        label="roadmap E4a3-5 sections",
    )
    text = sub_once(
        text,
        r"P0-E4a1 and P0-E4a2 now establish the bounded storage-preflight and external lab-arming foundations, but \*\*P0-E4a remains open\*\*\. The remaining evidence must be produced by real abrupt host/device power removal on representative reviewed storage/controller stacks\. A process kill, VM stop/snapshot, successful `fsync\(2\)` return, preflight PASS or GitHub CI run does \*\*not\*\* prove physical power-loss/controller-cache behavior\.",
        "P0-E4a1 through P0-E4a5 now establish the bounded storage preflight, external arming, strict evidence bundle, five-point review matrix and real-operation lab reachability/source contract, but **P0-E4a remains open**. The remaining evidence must be produced by five real abrupt host/device power removals on representative reviewed storage/controller stacks and independently reviewed. A process kill, VM stop/snapshot, successful `fsync(2)` return, synthetic fixture, preflight PASS or GitHub CI run does **not** prove physical power-loss/controller-cache behavior.",
        label="roadmap current E4a paragraph",
    )
    text = text.replace(
        "plus bounded P0-E1a/P0-E2a/P0-E2b/P0-E3a/P0-E3b and P0-E4a1/P0-E4a2 foundation evidence",
        "plus bounded P0-E1a/P0-E2a/P0-E2b/P0-E3a/P0-E3b and P0-E4a1–P0-E4a5 foundation/tooling evidence",
    )
    text = text.replace(
        "P0-E4a1/E4a2 prepare and machine-check the storage/lab boundary; only the representative external abrupt-power matrix can close P0-E4a.",
        "P0-E4a1–E4a5 prepare and machine-check the storage/lab/evidence boundary; only five representative external abrupt-power runs plus independent review can close P0-E4a.",
    )
    path.write_text(text)


patch_readme(Path("README.md"), "Current XSP-v2 engineering checkpoint")
patch_readme(Path("README.en.md"), "Current XSP-v2 checkpoint")
patch_roadmap(Path("docs/ENTERPRISE_ROADMAP.md"))

for p in [Path("README.md"), Path("README.en.md"), Path("docs/ENTERPRISE_ROADMAP.md")]:
    data = p.read_text()
    assert NEXUS_SHA in data
    assert NODE_SHA in data
    assert "P0-E4a5" in data
    assert "P0-E4a remains open" in data or "P0-E4a remains OPEN" in data
    assert "strict-pq` remains **OFF**" in data

print("P0-E4a5 docs checkpoint patch prepared")
