#!/usr/bin/env python3
from pathlib import Path
import re

MERGE = "2889864d6ec7f89202d8d82f2feda87501f0f349"
PR = "125"
E4A6_RUN = "40981894822"
BACKEND_RUN = "40981894714"

README_FILES = [Path("README.md"), Path("README.en.md")]
ROADMAP = Path("docs/ENTERPRISE_ROADMAP.md")

LATEST = (
    f"**Latest verified Nexus recovery/security checkpoint:** "
    f"[`{MERGE}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{MERGE}), merge of "
    f"[PR #{PR}](https://github.com/TriplexCorp/XMesh-Nexus/pull/{PR}). PR #125 completes the bounded "
    "P0-E4a6 physical-run handoff on top of E4a1–E4a5: the exact run/checkpoint/rotation, pinned "
    "source revisions, lab-binary SHA-256, E4a1 preflight digests, independently verified E3a witness, "
    "controller identity and pre-cut boot ID are frozen before a real cut; post-boot verification reuses "
    "E4a3 and binds separately preserved arm/controller/Agent/PostgreSQL/review records. "
    "**P0-E4a itself remains CURRENT/OPEN until five representative physical abrupt-power runs are actually "
    "executed and independently reviewed.**"
)

README_BULLET = (
    "- **PR #125 / P0-E4a6 physical-run handoff:** adds the final repo-side operator handoff before real "
    "power-cut execution. `prepare` freezes exact run/checkpoint/Node rotation, reviewed source revisions, "
    "exact lab-binary SHA-256, Agent/PostgreSQL preflight digests, controller identity, pre-cut boot ID and "
    "the SHA-256 of an existing E3a verifier result bound to the exact pre-cut epoch. `verify` first requires "
    "that same preserved E3a verification result, then reuses the existing E4a3 verifier and additionally "
    "binds the final bundle to separately preserved arm observation, raw external controller event, post-boot "
    "Agent record, PostgreSQL recovery record and review notes. The tool contains no network/power-control "
    "path and always leaves `physicalPowerLossQualified=false`; real BMC/PDU cuts and independent review remain required."
)

EVIDENCE_BULLET = (
    f"- Nexus PR #125 merge [`{MERGE}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{MERGE}): "
    f"[P0-E4a6 Physical-run Handoff #2](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/{E4A6_RUN}) "
    f"and [Backend CI #3688](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/{BACKEND_RUN}) — "
    "**success** on the exact merge SHA. This proves the offline pre-cut/post-boot handoff contract and "
    "fail-closed raw-record/E3a-result binding only; it is **not** a physical power-loss experiment."
)

ROADMAP_VERIFIED = (
    f"- **P0-E4a6 / PR #125:** Nexus merge [`{MERGE}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{MERGE}) "
    "adds the final offline physical-run handoff. Before a real cut it freezes the exact run/checkpoint/rotation, "
    "pinned reviewed sources, lab-binary digest, E4a1 preflight digests, independently verified E3a witness, "
    "external controller identity and pre-cut boot ID. After reboot it reuses E4a3 and requires separately "
    "preserved arm/controller/Agent/PostgreSQL/review records to match the final evidence exactly. "
    f"[Physical-run Handoff #2](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/{E4A6_RUN}) and "
    f"[Backend CI #3688](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/{BACKEND_RUN}) are **success**. "
    "No BMC/PDU API or production activation exists; P0-E4a remains OPEN."
)

ROADMAP_SECTION = f"""#### P0-E4a6 — physical-run operator handoff — COMPLETE (bounded lab preparation)

PR #125 at `{MERGE}` closes the remaining repo-side operator ambiguity before real power removal. The offline `prepare` command freezes the exact run ID/checkpoint, Node rotation identities, reviewed Node/Nexus source revisions, exact lab-binary SHA-256, E4a1 Agent/PostgreSQL preflight digests, external controller identity, pre-cut boot ID and the SHA-256 of an already successful E3a verification result for the exact pre-cut epoch. The offline `verify` command requires that same E3a result, calls the existing E4a3 verifier rather than introducing another evidence state machine, then binds the final bundle to separately preserved arm observation, raw controller event, post-boot Agent record, PostgreSQL recovery record and review notes. Synthetic CI proves handoff/tamper-rejection behavior only and always reports `physicalPowerLossQualified=false`.

This is the final repository-side preparation layer. It does **not** execute or simulate a power cut. Closing P0-E4a still requires all five real external BMC/PDU abrupt-power runs on the reviewed representative storage/controller/PLP stack, successful E4a6 verification for each run, the real E4a4 five-point matrix, and independent review of the raw physical/storage/WAL evidence.
"""


def replace_latest(text: str) -> str:
    lines = text.splitlines()
    hits = [i for i, line in enumerate(lines) if line.startswith("**Latest verified Nexus recovery/security checkpoint:**")]
    if len(hits) != 1:
        raise RuntimeError(f"expected exactly one latest checkpoint line, got {len(hits)}")
    lines[hits[0]] = LATEST
    return "\n".join(lines) + ("\n" if text.endswith("\n") else "")


def insert_after_line(text: str, needle: str, addition: str) -> str:
    lines = text.splitlines()
    hits = [i for i, line in enumerate(lines) if needle in line]
    if len(hits) != 1:
        raise RuntimeError(f"expected exactly one anchor {needle!r}, got {len(hits)}")
    lines.insert(hits[0] + 1, addition)
    return "\n".join(lines) + ("\n" if text.endswith("\n") else "")


def update_readme(path: Path) -> None:
    text = path.read_text()
    text = replace_latest(text)
    old_status = (
        "E4a1 storage preflight, E4a2 external arming, E4a3 evidence contract, E4a4 five-point review matrix "
        "and E4a5 real-operation lab reachability/source pin are COMPLETE within bounded software/lab-preparation scopes."
    )
    new_status = (
        "E4a1 storage preflight, E4a2 external arming, E4a3 evidence contract, E4a4 five-point review matrix, "
        "E4a5 real-operation lab reachability/source pin and E4a6 physical-run handoff are COMPLETE within bounded "
        "software/lab-preparation scopes."
    )
    if old_status not in text:
        raise RuntimeError(f"{path}: status anchor missing")
    text = text.replace(old_status, new_status, 1)

    if "**PR #125 / P0-E4a6 physical-run handoff:**" not in text:
        text = insert_after_line(text, "Node PR #45 + Nexus PR #123 / P0-E4a5 real-operation lab reachability", README_BULLET)
    if "Nexus PR #125 merge" not in text:
        text = insert_after_line(text, "Nexus PR #123 merge", EVIDENCE_BULLET)

    text = text.replace("P0-E4a1 through P0-E4a5 now establish", "P0-E4a1 through P0-E4a6 now establish")
    text = text.replace(
        "strict evidence bundle, five-point review matrix and real-operation lab reachability/source contract, but",
        "strict evidence bundle, five-point review matrix, real-operation lab reachability/source contract and physical-run handoff, but",
    )
    path.write_text(text)


def update_roadmap() -> None:
    path = ROADMAP
    text = path.read_text()
    lines = text.splitlines()
    latest_hits = [i for i, line in enumerate(lines) if line.startswith("- **Latest verified Nexus P0-E recovery/security checkpoint:**")]
    if len(latest_hits) != 1:
        raise RuntimeError(f"roadmap latest checkpoint line count={len(latest_hits)}")
    lines[latest_hits[0]] = (
        f"- **Latest verified Nexus P0-E recovery/security checkpoint:** [`{MERGE}`]"
        f"(https://github.com/TriplexCorp/XMesh-Nexus/commit/{MERGE}), merge of "
        f"[PR #125](https://github.com/TriplexCorp/XMesh-Nexus/pull/125). P0-E4a1 through P0-E4a6 are complete "
        "within bounded storage-preflight/lab-tooling/source-contract/handoff scopes; P0-E4a itself remains the current "
        "open sub-gate until five representative physical abrupt-power experiments are executed and independently reviewed."
    )
    text = "\n".join(lines) + ("\n" if text.endswith("\n") else "")

    if "- **P0-E4a6 / PR #125:**" not in text:
        text = insert_after_line(text, "**P0-E4a5 / Node PR #45 + Nexus PR #123:**", ROADMAP_VERIFIED)

    if "| P0-E4a6 physical-run handoff |" not in text:
        table_row = (
            "| P0-E4a6 physical-run handoff | **COMPLETE — bounded lab preparation** | PR #125; freezes pre-cut "
            "identity/evidence inputs and binds post-boot E4a3 evidence to separately preserved physical-lab records; "
            "never controls power or claims qualification |"
        )
        text = insert_after_line(text, "| P0-E4a5", table_row)

    text = text.replace(
        "plus bounded E4a1/E4a2 foundations complete; still requires the real E4a physical-power matrix",
        "plus bounded E4a1–E4a6 lab-preparation gates complete; still requires the real E4a physical-power matrix",
    )
    text = text.replace("P0-E4a1 through P0-E4a5 now establish", "P0-E4a1 through P0-E4a6 now establish")
    text = text.replace(
        "strict evidence bundle, five-point review matrix and real-operation lab reachability/source contract, but",
        "strict evidence bundle, five-point review matrix, real-operation lab reachability/source contract and physical-run handoff, but",
    )

    if "#### P0-E4a6 — physical-run operator handoff" not in text:
        start = text.find("#### P0-E4a5 — real-operation lab reachability/source contract")
        if start < 0:
            raise RuntimeError("P0-E4a5 detailed section missing")
        match = re.search(r"\n(?=###(?:#)? )", text[start + 1:])
        if match is None:
            raise RuntimeError("next heading after P0-E4a5 missing")
        pos = start + 1 + match.start()
        text = text[:pos].rstrip() + "\n\n" + ROADMAP_SECTION.rstrip() + "\n\n" + text[pos:].lstrip("\n")

    path.write_text(text)


for readme in README_FILES:
    update_readme(readme)
update_roadmap()

for path in [*README_FILES, ROADMAP]:
    text = path.read_text()
    assert "PR #125" in text, path
    assert MERGE in text, path
    assert "P0-E4a remains" in text or "P0-E4a itself remains" in text, path
    assert "physicalPowerLossQualified=false" in text, path

print("P0-E4a6 docs update: PASS")
