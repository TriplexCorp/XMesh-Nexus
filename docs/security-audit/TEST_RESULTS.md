# Test results — execution ledger

## Scope and safeguards

All new dynamic requests targeted loopback in disposable GitHub Actions Compose projects with generated test credentials. The harness rejects non-loopback targets, proxy inheritance and redirects. At most 64 concurrent attempts were sent; project containers and volumes are removed even after failure. Raw secrets and scanner matching text are excluded from retained reports.

## Authentication resource comparison

| Revision / evidence | Attempt statuses | Admission rejected | Liveness failures / worst latency | Padded login / escaped legal password |
|---|---|---:|---|---|
| Baseline `4aa1833`, job 133065378324 | 64 × 401 | 0 | 0 / 95.3 ms | 401 / accepted |
| Initial test-only candidate, job 133065377802 | 64 × 401 | 0 | no outage observed | expected regression failed |
| Fixed `dc89d14`, job 133069484769 | 5 × 401, 59 × 429 | 59 | 0 / 31.5 ms | 413 / accepted |
| Follow-up `3feb6d9`, job 133074810571 | regression passed | asserted nonzero | latency/health assertions passed | both compatibility assertions passed |

Baseline run: https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/43796173300
Fixed run: https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/43797482027
Follow-up: https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/43799148088

This comparison demonstrates admission behavior, not proof that the baseline could be taken offline. Timing differences are observational and not a benchmark.

New Rust tests cover four-slot admission, valid/invalid password behavior, malformed hash capacity release and cancellation retaining a running worker permit. At `3feb6d9`, all 268 default-feature Rust tests passed; CI subsequently failed Clippy for a 101-line handler and two permit-lifetime warnings. The flow was refactored in `dab138a`; latest full CI results must be recorded before approval. No lint was disabled.

## Existing CI exercised by the audit branch

At `3feb6d9`: CLI, public subscription browser, subscription build, real VLESS TLS client tunnel, managed Xray update, strict bootstrap path regression and source/presence behavioral tests passed. Crypto selected tests passed before the same new-code Clippy errors; full crypto job did not pass. Dependent API authentication and isolated signer E2E jobs were skipped and must not be counted as passed. These existing checks cover their own scenarios, not the entire requested security test matrix.

## Scanner execution

Evidence workflow initially failed workflow validation before any scanner ran: runner temporary-directory selection was moved into a job step in `239f62e`. Do not count prepared commands as completed scans. The collector preserves tool exit codes and fails on findings/tool failures; raw output stays private, retained reports remove secrets and matched code. Record final run IDs/statuses and triage in SUPPLY_CHAIN.md.

## Not yet performed

Fresh VPS installs/rollback, complete role/object authorization negatives, browser XSS adversarial inputs, all subscription states with a real VPN client, database/Redis outage injection, quota races/offline synchronization, sustained bounded fuzz campaigns, origin and IPv6 Docker behavior. See REMEDIATION_PLAN.md for reproducible next work.

## Executed scanner / Sub update

SAST and dependency jobs 133078918822/133078919121 completed with nonzero aggregate status: findings and an unsuccessful Rust audit remain unresolved. Three source SBOMs and three runtime image SBOMs were generated and retained. govulncheck JSON exit zero was found insufficient to clear findings; manual triage is required. See SUPPLY_CHAIN.md.

Sub draft #18: installer CI 133079425263 passed the pinned-workflow regression, shell tests, manager/limiter tests, release-verifier negative tests and rendered Caddy validation. No main publication or production update was performed.

At candidate `630d841`, committed rustfmt and strict default-feature Clippy passed; experimental crypto formatting/Clippy and cross-language selected tests passed. The Rust job was still building its Docker image when observed; dependent integration jobs must still finish. Sub CI remains green. The failed Rust scan may be caused by running a capability-dropped root against runner-owned mounted directories; the collector now uses the runner UID/GID with a writable private Cargo home and the current CI Rust generation. Verify the next result rather than treating this diagnosis as proof.

Default Rust job 133079691042 subsequently completed successfully including Docker build. Crypto job 133079690363 completed successfully. The next audit-only evidence/report commit does not change runtime code, but its own PR checks remain required.
