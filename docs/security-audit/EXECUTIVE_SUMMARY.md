# XMesh ecosystem security audit — checkpoint, 2026-11-16

**Status: IN PROGRESS. This is not a completed audit or deployment approval.**

Scope is exclusively TriplexCorp/XMesh-Nexus, XMesh-Node and XMesh-Sub at the exact commits in REPOSITORY_INVENTORY.md. No other repository, production server, customer token, real database, DNS or secret was tested or changed. Audit PRs must remain unmerged until reviewed.

## Verified improvement

Nexus password verification previously ran Argon2 on the asynchronous request worker without explicit CPU admission. A disposable real-API comparison with 64 simultaneous attempts confirmed zero work-admission rejections before the change, and 59 immediate rejections after it. Both runs retained healthy liveness; therefore a significant denial of service was **not** demonstrated and this must not be reported as a confirmed High/Critical exploit.

The fix admits at most four login operations per process before settings/Redis/PostgreSQL, moves password checks to blocking workers and retains the permit inside the worker when the HTTP future is cancelled. Login JSON is limited to 8 KiB; the existing global limit was 2 MiB, not unlimited. A 9 KiB padded request now receives 413; a legal maximum-length password using JSON escapes remains accepted. Existing authentication/session/MFA contracts are preserved.

Draft PR: https://github.com/TriplexCorp/XMesh-Nexus/pull/493

## Evidence and limits

The managed local executor failed to start. Source review and GitHub API inventory remain available; disposable GitHub-hosted Actions provide actual execution. No production traffic/load was generated. Baseline observation, negative regression and fixed regression are recorded in TEST_RESULTS.md. Clippy found new-code issues after the first successful behavioral run; these are being corrected, not suppressed.

SAST, dependency and source/container SBOM collection is implemented with redacted outputs. Collection is not yet equivalent to reviewed results; scanner completion and manual triage remain pending. Fresh VPS provisioning, complete API/object authorization, IPv6 peer identity through Docker, full cross-repository compromise scenarios and quota fault injection remain incomplete.

| Repository | Confirmed Critical | Confirmed High | Medium | Low | Fix prepared | Remaining assurance work |
|---|---:|---:|---:|---:|---|---|
| XMesh-Nexus | 0 observed* | 0 observed* | 1 provisional resource finding | 1 hardening | 2 related changes in draft #493 | API/scans/quotas/installation/cross-component tests |
| XMesh-Node | 0 observed* | 0 observed* | 1 runtime maintenance | not established | none yet | agent/update/identity/runtime dependency review |
| XMesh-Sub | 0 observed* | 0 observed* | not established | 1 publisher hardening | draft #18, CI passed | origin/IPv6/manager/update/installation tests |

*Counts mean findings observed so far, not absence of undiscovered vulnerabilities. Medium/Low entries describe limited confirmed behavior; denial-of-service impact remains unproven. See FINDINGS.md for assessment and CVSS limits.

Updated checkpoint: source/container SBOM generation and SAST/Go/npm/image scans have executed; advisory and secret-candidate triage is incomplete and Rust dependency scanning failed. See SUPPLY_CHAIN.md for exact counts and caveats. Sub publisher pinning is separately prepared in draft #18 with passing CI. Old Node router SDK/runtime is a confirmed maintenance gap, not a demonstrated Critical exploit.
