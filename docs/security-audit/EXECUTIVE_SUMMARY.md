# XMesh ecosystem security audit — checkpoint, 2026-11-16

**INCOMPLETE AUDIT. This checkpoint is not security approval.**

Only TriplexCorp/XMesh-Nexus, XMesh-Node and XMesh-Sub were accessed, at the exact commits in REPOSITORY_INVENTORY.md. No other project or production server, DNS, customer database or real subscription was tested or changed. Audit PRs remain draft and unmerged.

## Changes and actual proof

Nexus draft [#493](https://github.com/TriplexCorp/XMesh-Nexus/pull/493) bounds login work to four concurrent operations per process before storage, offloads Argon2 from asynchronous request workers and retains capacity when HTTP observers cancel. An 8 KiB login JSON budget preserves maximum legal escaped passwords; the previous global cap was 2 MiB, not unlimited.

Disposable real-API comparison: 64 baseline attempts produced 64 × 401 and zero work-admission rejection. The fixed run produced 5 × 401 and 59 × 429, rejected padded JSON with 413 and accepted the legal maximum-length password. Liveness did not fail in either run. A significant baseline DoS was therefore **not demonstrated** and is not classified as a confirmed High/Critical exploit.

Runtime code at `ea184737` passed default Rust tests/strict Clippy/Docker build, experimental crypto tests/Clippy, isolated signer image/ACL/Unix-socket E2E, repeated authentication resource checks, browser/VLESS/CLI/update/source checks. The dependent API job later failed a Host dialog overflow assertion before its security steps ran. Those security scripts are now independently scheduled on a fresh disposable target; no browser assertion was disabled. See TEST_RESULTS.md for exact evidence and limits.

Sub draft [#18](https://github.com/TriplexCorp/XMesh-Sub/pull/18) pins release publisher/CI Actions to full commits and adds regression checks retaining main-only publication and provenance verification. Its full installer CI passed. No runtime/API/Agent change or manual key provisioning is required for either prepared patch.

## Scanner results

Semgrep, Bandit, redacted Gitleaks, Go/npm/Rust dependency and selected image scans ran. Syft generated three source and three runtime image CycloneDX SBOMs. Reports contain candidates requiring manual adjudication; no scanner was suppressed to force a pass. Rust audit now ran successfully and reported five advisories, superseding earlier collection failures. Go JSON exit zero is explicitly not accepted as absence of findings.

Old Go/Alpine versions in the actual Node router artifact were confirmed. Advisory applicability, secret candidate triage and full image coverage remain open; dependency CVSS/severity is not automatically assigned to XMesh without checking conditions. See SUPPLY_CHAIN.md.

| Repository | Critical observed | High observed | Medium | Low | Fix prepared | Remaining work |
|---|---:|---:|---:|---:|---|---|
| XMesh-Nexus | 0* | 0* | 1 provisional resource finding | 1 hardening | 2 related changes in draft #493 | API/triage/quotas/install/cross-component tests |
| XMesh-Node | 0* | 0* | 1 runtime maintenance finding | not established | none yet | SDK/runtime, agent/update/identity and quota tests |
| XMesh-Sub | 0* | 0* | not established | 1 publisher hardening | draft #18, CI passed | origin/IPv6/manager/update/install tests |

*Observed counts do not establish absence of undiscovered vulnerabilities. See FINDINGS.md for assessment and CVSS limits.

## Limits and continuation

The local executor failed, so source/API inventory used GitHub and real execution used disposable hosted Actions. Clean VPS/systemd/firewall/ACME/recovery qualification remains unavailable. Complete object/function authorization, adverse subscription states with real clients, IPv6 peer identity, Node/Sub compromise dynamics, quota/storage fault injection and adversarial browser/fuzz campaigns remain incomplete.

All 14 requested documents are present, including 135 router/method entries, a trust map and explicit remaining tests. Continue using REMEDIATION_PLAN.md; do not treat this checkpoint or passing existing CI as a completed ecosystem audit.
