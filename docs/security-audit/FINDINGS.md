# Findings and hypotheses

## Verified continuation — 16 November 2026 (after original checkpoint)

This document originated before the independent fixes below. Statuses later in
the historical sections refer to that earlier checkpoint, not the current
GitHub main branches. The ecosystem audit **remains incomplete**.

| ID | Finding / classification | Current evidence |
|---|---|---|
| XMESH-AUD-001 / 002 | Login work admission / request-size hardening, not a demonstrated P1 | Nexus [#496](https://github.com/TriplexCorp/XMesh-Nexus/pull/496) **merged** as `5630293468922255bfbfcbc34f1727f71cb54e07`; complete CI passed |
| XMESH-AUD-003 | Mutable release-publisher action references | Sub [#18](https://github.com/TriplexCorp/XMesh-Sub/pull/18) **merged** as `17be0aab84ec04412ef490fcaa0953181b3e4262`; installer CI passed |
| XMESH-AUD-004 | Unsupported Go/Alpine Node router image | Node [#83](https://github.com/TriplexCorp/XMesh-Node/pull/83) **merged** as `647adcf7af326b205fce12545fb5d75a20bb8191`; Node CI and real rebuilt-image Trivy High/Critical scan passed. This does not establish absence of all advisories |
| H-08 | Authenticated official Xray ZIP updates read allowed entries without adequate decompression budgets | Nexus [#494](https://github.com/TriplexCorp/XMesh-Nexus/pull/494) **merged** as `22c1acca6a929e61bb4d834169f7074692738616`; full CI passed, enforcing actual + declared size budgets and duplicate-entry rejection |
| **XMESH-AUD-005** | **Confirmed object-level authorization failure in signed Node telemetry** | Audit disposable integration accepted signed traffic claiming an unrelated Squad user and changed that user's hold state. Valid Ed25519 signature proved Node identity, **not** authority to select arbitrary users. Nexus [#495](https://github.com/TriplexCorp/XMesh-Nexus/pull/495) implements atomic user/profile/Squad/inbound authorization and positive/negative signed regression tests. Targeted disposable PostgreSQL/API workflow passes; combined CI must pass before merge |

### XMESH-AUD-005 — cross-object signed telemetry attribution

- Priority: **high review priority**, confirmed cross-object integrity impact in a disposable API test; no public anonymous exploit or production fleet compromise has been demonstrated. Do not invent a CVSS or count as remote unauthenticated control.
- Prerequisite: a valid enrolled Node signing identity and accepted signed metric report.
- Scope: a compromised Node could claim other user IDs and cause unrelated first-connection subscription activation or potentially influence accounting/quotas. Exact blast radius beyond the confirmed hold-state change requires further fault/compromise testing.
- Fix under test: [#495](https://github.com/TriplexCorp/XMesh-Nexus/pull/495) checks all user/inbound identifiers against the current Node profile and Squad membership **before** persisting presence, hold, ledger or quota changes. Entire mixed batches are denied rather than partially applied. Signed legitimate counters remain supported.
- Proof: independent Actions run [43819300948](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/43819300948), plus newer scoped reruns. Source and integration result must be reconciled with current `main` after merge.
- Residual: whether profile tag reuse across different Node assignments, dynamic Squad edits, stale/offline counters or counter resets produce additional attribution holes remains open.

### Advisory applicability without scanner suppression

- `RUSTSEC-2026-0368` and `RUSTSEC-2026-0429` concern the zip crate's `ZipArchive::extract` symlink handling. Current Xray release extraction in `core.rs` iterates selected entries, rejects symlinks and writes bounded allowlisted file bytes itself; repository source search did not locate a call to the vulnerable generic `extract` function. This is **a limited call-path observation**, not a patched dependency or a reason to hide the scanner record.
- `RUSTSEC-2026-0459` involves local processing of an attacker-controlled SQLite database plus mismatched WAL. Determine whether any bundled SQLite crate is built/used in the production PostgreSQL-only runtime and whether untrusted SQLite databases can be opened. Keep the advisory until build features and affected artifacts are established.
- Historical Gitleaks fingerprint matches, Bandit subprocess/URL findings and other Rust/Go advisory records require individual review. Never place candidate secret values in this report.
- ProjectHimera is explicitly excluded from this audit.

## Original evidence checkpoint (historical)

Only limited confirmed behavior was recorded at the initial checkpoint. Scanner candidates are not findings until manually validated.

## XMESH-AUD-001 — password work lacked explicit admission

- Repository/component: XMesh-Nexus, public administrative login.
- Baseline location: `backend/src/auth.rs`, `login` and `verify_login_password`; candidate admission helper begins near line 23.
- Priority: P2 provisional, resource admission weakness; significant availability impact unconfirmed.
- Conditions: public login reachable; an attacker overlaps password attempts that pass existing rate checks. Argon2 was synchronous on the async request worker. Existing per-account/global failure budgets still apply.
- Confirmation: 64-account disposable comparison; baseline rejected none at work admission, fixed implementation rejected 59. Baseline liveness did not fail. No large-scale outage reproduction attempted.
- Impact: overlapping CPU/memory work before failure counters settle; exact production capacity/availability impact remains unmeasured.
- Fix: immediate four-slot process admission before settings/storage, blocking-worker verification, worker-owned cancellation-safe permit.
- Regression: `scripts/security-audit-login-resources.py` plus four Rust tests in `backend/src/auth.rs`; fixed integration and repeat passed.
- PR/status: draft #493; code prepared, complete latest CI pending.
- CVSS v4.0: not scored; actual vulnerable availability impact and attack conditions are not sufficiently established. Do not substitute an invented numeric score.

## XMESH-AUD-002 — login-specific request budget

- Repository/component: XMesh-Nexus login JSON, `backend/src/main.rs` login route near line 583.
- Priority: P3 hardening; this is not a claim of unbounded parsing.
- Baseline: unused padding above 9 KiB was accepted under the existing global 2 MiB body cap.
- Fix: 8 KiB login-only body budget; normal credentials and maximum legal 1024-byte JSON-escaped passwords remain accepted.
- Confirmation/regression: real API returned 401 before and 413 after; legal escaped password succeeded.
- PR/status: draft #493, implemented and dynamically verified.
- CVSS v4.0: not applicable to a standalone hardening improvement without demonstrated security impact.

## Open hypotheses — do not count as confirmed vulnerabilities

| ID | Repository | Observation | Required confirmation |
|---|---|---|---|
| H-01 | Nexus/Sub | Direct origin skips Sub IP limiter; Nexus budgets remain | Compare equivalent valid/invalid requests and DB cost on disposable origin/edge |
| H-02 | Nexus | Readiness probes perform DB/Redis work; machine authentication includes storage lookup | Invalid-header/health floods with bounded counters and backend outage tests |
| H-03 | Sub | Docker IPv6 forwarding can alter the direct peer identity used for /64 rate limits | Two isolated IPv6 /64 namespaces through actual rendered Caddy/limiter |
| H-04 | Node | Router and production Agent modules declare different Go generations | Scan actual production binaries, establish reachable advisory impact |
| H-05 | Node/Nexus | Authenticated traffic reports and shared assigned VPN credentials define compromise blast radius | Cross-node identity/assigned-user tests and replay/quota fault injection |
| H-06 | Nexus | Legacy integration tokens may omit sender proof under compatibility policy | Negative tests for stolen bearer alone, scopes, user grants and opt-in proof migration |
| H-07 | Nexus | Cargo.lock absent from baseline executable project | Resolve dependency evidence; assess deterministic build/update compatibility before committing a lock |

Revoked product-node authentication was checked in source: inactive product state is rejected without falling through to legacy identity. An initial suspicion of a revocation bypass was not supported and is not reported as a finding.

## XMESH-AUD-003 — mutable release publisher Actions

- Repository: XMesh-Sub; `.github/workflows/attested-release.yml` checkout/attest and `.github/workflows/ci.yml` checkout.
- Priority: P3 supply-chain hardening; no publisher compromise demonstrated.
- Confirmed: workflow references used mutable v4 tags. A later tag movement could change executable publisher code without a source edit.
- Fix: pin the currently resolved full action commits, disable persisted CI checkout credentials, retain read-only contents and main-only attestation publishing.
- Regression: `tests/test-workflow-security.py` rejects tags/branches and checks publisher trigger and source-verification constraints.
- PR: https://github.com/TriplexCorp/XMesh-Sub/pull/18 (draft, unmerged).
- Verification: Sub installer CI job 133079425263 passed, including the new tests and existing signed manager/limiter/release verifier/rendered Caddy checks.
- CVSS v4.0: not assigned; prevention of hypothetical action-tag compromise, not a confirmed exploitable product vulnerability.

## XMESH-AUD-004 — obsolete Node router build/runtime baseline

- Repository: XMesh-Node; `Dockerfile:2` and `Dockerfile:8`, root `go.mod:3`.
- Priority: P2 dependency/runtime maintenance finding; advisory exploit severity is not inherited from scanner labels.
- Confirmed: rebuilding the committed Dockerfile produced Go 1.23.12 and Alpine 3.21.10; Trivy identifies the latter as end-of-support and lists Go advisories in the compiled artifact.
- Verification: actual Docker build, exported binary govulncheck and image Trivy/Syft in evidence job 133078919121.
- Impact: outdated runtime embeds known affected library versions. Whether individual advisories are reachable under XMesh usage is still under manual review; static symbol traces are not a working exploit.
- Recommended fix: coordinated supported Go SDK/runtime update, full router race/build/config checks and repeated binary/image scans; preserve Node release/version policy.
- Regression/PR: not yet prepared. No Node runtime was modified.
- CVSS v4.0: not scored pending applicability/impact analysis.

### Advisory triage caution

govulncheck JSON mode returned zero even with advisory records. The collector now separately records a nonzero triage status whenever records exist. Broad derived-symbol call traces can overstate a specific vulnerable use (for example a MaxBytesReader concurrency condition); do not classify a production High merely because an HTTP helper appears in a trace. Confirmed module versions, actual API use and exploit prerequisites must be considered together.

### H-08 — core archive decompression budget

`backend/src/core.rs::unpack_release` rejects unknown names, paths and symlinks, but reads selected entries into memory before checking the Xray executable's size. Review streaming limits, resource files and duplicate entries in a disposable test. This is currently a source observation in an authenticated official-release update path, not a demonstrated anonymous ZIP-upload exploit. No unsafe generic extract() call was found in the reviewed path.
