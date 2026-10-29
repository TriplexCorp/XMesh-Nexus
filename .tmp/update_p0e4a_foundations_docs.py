from pathlib import Path

FILES = [Path('README.md'), Path('README.en.md')]
ROADMAP = Path('docs/ENTERPRISE_ROADMAP.md')

NEXUS_E4A1 = 'f7b746eb92c5e1bda7be67814233f09c60ee90b9'
NEXUS_E4A2 = '0eecd0a1b4f8439b934bf5182f59531b21b7aebe'
NODE_E4A2 = '50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    return text.replace(old, new, 1)


def insert_before(text: str, marker: str, block: str, label: str) -> str:
    count = text.count(marker)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one marker, got {count}')
    return text.replace(marker, block + marker, 1)


def insert_after_prefix(text: str, prefix: str, block: str, label: str) -> str:
    lines = text.splitlines(keepends=True)
    matches = [i for i, line in enumerate(lines) if line.startswith(prefix)]
    if len(matches) != 1:
        raise SystemExit(f'{label}: expected exactly one line prefix, got {len(matches)}')
    i = matches[0]
    lines.insert(i + 1, block)
    return ''.join(lines)


for path in FILES:
    text = path.read_text()
    text = replace_once(
        text,
        '**Latest verified Nexus recovery/security checkpoint:** [`0afffa3933991861607c27d8410115bc2054cd7c`](https://github.com/TriplexCorp/XMesh-Nexus/commit/0afffa3933991861607c27d8410115bc2054cd7c), merge of [PR #114](https://github.com/TriplexCorp/XMesh-Nexus/pull/114).',
        f'**Latest verified Nexus recovery/security checkpoint:** [`{NEXUS_E4A2}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{NEXUS_E4A2}), merge of [PR #117](https://github.com/TriplexCorp/XMesh-Nexus/pull/117). PR #116 and Node PR #44 + Nexus PR #117 complete the bounded P0-E4a storage-preflight and external power-cut arming foundations; **P0-E4a itself remains CURRENT until the representative physical abrupt-power matrix is executed and reviewed.**',
        f'{path}: latest checkpoint',
    )
    text = replace_once(
        text,
        '**P0-C2-D and P0-D are COMPLETE. P0-E remains the CURRENT P0. P0-E1a, P0-E2a, P0-E2b, P0-E3a and P0-E3b are COMPLETE within their explicitly bounded scopes; P0-E4a is the CURRENT sub-gate.** The production-capable Agent path remains default-disabled and production rollout remains unauthorized.',
        '**P0-C2-D and P0-D are COMPLETE. P0-E remains the CURRENT P0. P0-E1a, P0-E2a, P0-E2b, P0-E3a and P0-E3b are COMPLETE within their explicitly bounded scopes. P0-E4a remains the CURRENT sub-gate; inside it, E4a1 storage preflight and E4a2 external power-cut arming/source-contract readiness are COMPLETE within bounded scopes, while representative physical power-loss qualification remains outstanding.** The production-capable Agent path remains default-disabled and production rollout remains unauthorized.',
        f'{path}: status',
    )
    foundation_bullets = (
        '- **PR #116 / P0-E4a1 storage durability preflight:** a read-only qualification probe records filesystem/mount and block-device durability facts, rejects symlink traversal and unreviewed filesystem classes, verifies PostgreSQL `fsync`, `full_page_writes`, `synchronous_commit` and `wal_sync_method`, and requires independent PLP/controller evidence when write-back cache is present. Its report is deliberately fixed at `physicalPowerLossQualified=false`; it cannot mutate mounts/cache policy/PostgreSQL/security state or claim that a real power cut occurred.\n'
        '- **Node PR #44 + Nexus PR #117 / P0-E4a2 external power-cut arming readiness:** the real Node source exposes the existing rotation durability checkpoints to a dedicated lab-only `xspv2_powercut_qualification` build. At an approved checkpoint it emits the exact `XSP2-POWERCUT-ARMED-V1` marker only through an inherited FD and then stops security-state progress so an independent BMC/PDU/controller can cut power. Normal Agent artifacts contain neither the lab hook nor its controls; the older process-crash injector remains a separate mutually exclusive build tag. Nexus pins exact Node merge SHA `' + NODE_E4A2 + '` and independently re-runs the lab/normal-artifact boundary. This is lab readiness, **not** physical power-loss evidence.\n'
    )
    text = insert_after_prefix(text, '- **PR #114 / P0-E3b coordinated backup/restore recovery:**', foundation_bullets, f'{path}: E4a bullets')

    evidence = (
        f'Exact bounded P0-E4a foundation evidence:\n\n'
        f'- Nexus PR #116 merge [`{NEXUS_E4A1}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{NEXUS_E4A1}): [P0-E4a Storage Preflight #5](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40961979406) and [Backend CI #3665](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40961979407) — **success**.\n'
        f'- Node PR #44 merge [`{NODE_E4A2}`](https://github.com/TriplexCorp/XMesh-Node/commit/{NODE_E4A2}): [P0-E4a Power-cut Arm #2](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40962739169) and [P0-E Crash Durability #18](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40962739053) — **success**; the full six-workflow post-merge Node matrix completed without failures.\n'
        f'- Nexus PR #117 merge [`{NEXUS_E4A2}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{NEXUS_E4A2}): [P0-E4a Node Power-cut Contract #2](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40963109541) and [Backend CI #3667](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40963109551) — **success**.\n\n'
        'None of these CI runs is counted as an actual physical power-loss experiment. P0-E4a remains open until the reviewed representative external abrupt-power matrix is complete.\n\n'
    )
    text = insert_before(text, 'Exact post-merge P0-E3b evidence on `0afffa3933991861607c27d8410115bc2054cd7c`:', evidence, f'{path}: evidence')

    old_node = 'The current verified XMesh-Node P0-E2a checkpoint is [`3fffa9fd74195114a7c4e573a8a11e075c84f403`](https://github.com/TriplexCorp/XMesh-Node/commit/3fffa9fd74195114a7c4e573a8a11e075c84f403), merge of Node PR #39.'
    new_node = f'The current verified XMesh-Node P0-E4a2 lab-readiness checkpoint is [`{NODE_E4A2}`](https://github.com/TriplexCorp/XMesh-Node/commit/{NODE_E4A2}), merge of Node PR #44. The earlier P0-E2a snapshot anti-rollback checkpoint remains [`3fffa9fd74195114a7c4e573a8a11e075c84f403`](https://github.com/TriplexCorp/XMesh-Node/commit/3fffa9fd74195114a7c4e573a8a11e075c84f403), merge of Node PR #39.'
    text = replace_once(text, old_node, new_node, f'{path}: Node checkpoint')

    subsections = (
        '#### P0-E4a1 — storage durability preflight — COMPLETE (bounded preflight)\n\n'
        'PR #116 adds a read-only host/storage preflight that records the filesystem/mount/block-device chain and PostgreSQL durability settings before any physical qualification run. It rejects symlink traversal and unsupported/unreviewed filesystem classes, requires `fsync=on`, `full_page_writes=on`, an accepted `synchronous_commit` mode and a visible `wal_sync_method`, and flags write-back cache as requiring independent controller/device PLP evidence. The report is intentionally non-authoritative for physical durability and always carries `physicalPowerLossQualified=false`.\n\n'
        'This gate proves qualification-input policy and fail-closed reporting only. It cannot prove controller/drive cache persistence, PLP correctness or an abrupt host/device power event.\n\n'
        '#### P0-E4a2 — external power-cut arming/source contract — COMPLETE (bounded lab readiness)\n\n'
        f'Node PR #44 at `{NODE_E4A2}` adds a lab-only build tag on the already-proven Agent rotation durability checkpoints. The lab build may emit the exact `XSP2-POWERCUT-ARMED-V1` marker through an inherited FD and then block until a physically independent controller removes power. Normal Agent artifacts keep the checkpoint hook as a no-op; the process-crash and physical-power tags are mutually exclusive. Nexus PR #117 pins that exact Node source, independently runs the lab tests and proves the normal Agent artifact contains no qualification controls.\n\n'
        'This gate proves only that a representative lab can synchronize an external abrupt-power event to the intended durability boundary without introducing a production remote-control path. It does **not** prove that the cut happened or that any storage stack survived it correctly.\n\n'
    )
    text = insert_before(text, '### CURRENT sub-gate — P0-E4a physical power-loss / storage durability\n', subsections, f'{path}: detailed E4a foundations')
    text = replace_once(
        text,
        "P0-E4a must move beyond P0-E1a's process-crash/fsync-order proof and establish an explicit **host/storage power-loss qualification boundary**. A normal process kill or successful `fsync(2)` call alone is not sufficient evidence for this gate.",
        "P0-E4a1 and P0-E4a2 now provide the reviewed storage preflight and external lab arming primitives, but **P0-E4a remains open**. The remaining acceptance evidence must come from real representative abrupt host/device power-loss runs; a normal process kill, VM stop/snapshot, successful `fsync(2)` return, preflight PASS or GitHub CI run is not sufficient.",
        f'{path}: E4a current intro',
    )
    path.write_text(text)

text = ROADMAP.read_text()
text = replace_once(
    text,
    '- **Latest completed Nexus P0-E recovery/security checkpoint:** [`0afffa3933991861607c27d8410115bc2054cd7c`](https://github.com/TriplexCorp/XMesh-Nexus/commit/0afffa3933991861607c27d8410115bc2054cd7c), merge of [PR #114](https://github.com/TriplexCorp/XMesh-Nexus/pull/114). P0-E3b proves the bounded disposable coordinated PostgreSQL + Agent + signer + mTLS backup/restore procedure against the independent E3a owner/off-host witness; P0-E4a physical power-loss/storage durability is the current sub-gate.',
    f'- **Latest verified Nexus P0-E recovery/security checkpoint:** [`{NEXUS_E4A2}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{NEXUS_E4A2}), merge of [PR #117](https://github.com/TriplexCorp/XMesh-Nexus/pull/117). P0-E4a1 storage preflight and P0-E4a2 external power-cut arming/source-contract readiness are complete within bounded scopes; P0-E4a remains the current sub-gate until the representative physical abrupt-power matrix is executed and reviewed.',
    'roadmap: latest checkpoint',
)
roadmap_bullets = (
    f'- **P0-E4a1 / PR #116:** Nexus merge [`{NEXUS_E4A1}`](https://github.com/TriplexCorp/XMesh-Nexus/commit/{NEXUS_E4A1}) adds a read-only storage qualification preflight. It records filesystem/mount/block-device durability facts, verifies PostgreSQL durability settings, requires independent PLP/controller evidence for write-back cache, rejects unsafe/unknown inputs, and deliberately reports `physicalPowerLossQualified=false`. [Storage Preflight #5](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40961979406) and [Backend CI #3665](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40961979407) completed **success** on the exact merge SHA.\n'
    f'- **P0-E4a2 / Node PR #44 + Nexus PR #117:** Node merge [`{NODE_E4A2}`](https://github.com/TriplexCorp/XMesh-Node/commit/{NODE_E4A2}) adds the lab-only external power-cut arming hook at the five existing rotation durability boundaries. It signals only through an inherited FD, emits the exact arm marker and blocks security-state progress; normal Agent artifacts contain no lab/crash controls and the two evidence tags cannot coexist. Nexus PR #117 pins and re-verifies that exact source. Node [Power-cut Arm #2](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40962739169) and [Crash Durability #18](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40962739053), plus Nexus [Node Power-cut Contract #2](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40963109541) and [Backend CI #3667](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40963109551), are **success**. This is lab readiness only, not physical power-loss evidence.\n'
)
text = insert_after_prefix(text, '- **P0-E3b / PR #114:**', roadmap_bullets, 'roadmap: E4a source bullets')

old_row = '| **P0-E4a physical power-loss / storage durability** | **CURRENT sub-gate** | Qualify real host/storage durable-flush behavior beyond process-kill/fsync-order evidence; no torn/lowered security state after abrupt power loss |'
new_rows = (
    '| P0-E4a1 storage durability preflight | **COMPLETE — bounded preflight** | PR #116; read-only storage/PostgreSQL durability inventory, fail-closed policy, `physicalPowerLossQualified=false` |\n'
    '| P0-E4a2 external power-cut arm/source contract | **COMPLETE — bounded lab readiness** | Node PR #44 + Nexus PR #117; exact arm marker on inherited FD, mutually exclusive test tags, normal Agent has no qualification controls |\n'
    '| **P0-E4a physical power-loss / storage durability** | **CURRENT sub-gate** | Execute and review the representative external abrupt-power matrix on qualified storage/controller stacks; no torn/lowered security state after power loss |'
)
text = replace_once(text, old_row, new_rows, 'roadmap: gate table E4a')
text = replace_once(
    text,
    '| **P0-E recovery/security release gates** | **CURRENT P0** | E1a/E2a/E2b/E3a/E3b complete within bounded scopes; still requires E4a power-loss qualification, owner-authorized recovery + old-key retirement, fuzz/KAT, independent review and observability |',
    '| **P0-E recovery/security release gates** | **CURRENT P0** | E1a/E2a/E2b/E3a/E3b plus bounded E4a1/E4a2 foundations complete; still requires the real E4a physical-power matrix, owner-authorized recovery + old-key retirement, fuzz/KAT, independent review and observability |',
    'roadmap: overall row',
)
roadmap_subsections = (
    '#### P0-E4a1 — storage durability preflight — COMPLETE (bounded preflight)\n\n'
    'PR #116 establishes the qualification-input boundary before any physical power experiment. The read-only probe records the filesystem/mount/block-device chain and PostgreSQL durability settings, rejects symlink traversal and unsupported/unreviewed filesystem classes, requires the reviewed PostgreSQL fsync/full-page-write/synchronous-commit/WAL-sync policy, and flags write-back cache as requiring independent controller/device PLP evidence. Its report cannot mutate the storage stack or security state and deliberately remains `physicalPowerLossQualified=false`.\n\n'
    '#### P0-E4a2 — external power-cut arming/source contract — COMPLETE (bounded lab readiness)\n\n'
    f'Node PR #44 at `{NODE_E4A2}` exposes the existing five rotation durability checkpoints only in the dedicated lab build. The selected boundary emits `XSP2-POWERCUT-ARMED-V1` through an inherited FD and then blocks security-state progress so an independent controller can remove power. Process-crash and physical-power tags cannot coexist, and normal Agent artifacts contain neither hook controls. Nexus PR #117 pins and independently tests that exact Node source. GitHub CI proves the arming/source boundary only; it is not physical power-loss evidence.\n\n'
)
text = insert_before(text, '### CURRENT sub-gate — P0-E4a physical power-loss / storage durability\n', roadmap_subsections, 'roadmap: detailed foundations')
text = replace_once(
    text,
    "P0-E4a must extend beyond P0-E1a's process-crash/fsync-order evidence and establish a reviewed host/storage durability qualification boundary. A process kill, VM snapshot test, or successful `fsync(2)` return by itself does **not** prove physical power-loss/controller-cache behavior.",
    "P0-E4a1 and P0-E4a2 now establish the bounded storage-preflight and external lab-arming foundations, but **P0-E4a remains open**. The remaining evidence must be produced by real abrupt host/device power removal on representative reviewed storage/controller stacks. A process kill, VM stop/snapshot, successful `fsync(2)` return, preflight PASS or GitHub CI run does **not** prove physical power-loss/controller-cache behavior.",
    'roadmap: current E4a intro',
)
text = replace_once(
    text,
    '- Completed P0-D gates through Node PR #37 and Nexus PR #105, plus bounded P0-E1a/P0-E2a/P0-E2b/P0-E3a/P0-E3b evidence, remain default-disabled foundations/proofs; none authorize production migration.',
    '- Completed P0-D gates through Node PR #37 and Nexus PR #105, plus bounded P0-E1a/P0-E2a/P0-E2b/P0-E3a/P0-E3b and P0-E4a1/P0-E4a2 foundation evidence, remain default-disabled proofs; none authorize production migration or substitute for the real E4a physical-power matrix.',
    'roadmap: guardrail foundations',
)
text = replace_once(
    text,
    '- P0-E3a supplies the independent rollback floor and P0-E3b proves the disposable coordinated backup/restore procedure consumes it correctly; P0-E4a now owns the real host/storage power-loss durability qualification boundary.',
    '- P0-E3a supplies the independent rollback floor and P0-E3b proves the disposable coordinated backup/restore procedure consumes it correctly. P0-E4a1/E4a2 prepare and machine-check the storage/lab boundary; only the representative external abrupt-power matrix can close P0-E4a.',
    'roadmap: guardrail E4a',
)
ROADMAP.write_text(text)

for path in FILES + [ROADMAP]:
    data = path.read_text()
    if 'strict-pq` remains **OFF**' not in data and path == ROADMAP:
        raise SystemExit(f'{path}: strict-pq OFF guardrail missing')
    if 'P0-E4a remains' not in data:
        raise SystemExit(f'{path}: open E4a boundary missing')

print('P0-E4a docs checkpoint updated')
