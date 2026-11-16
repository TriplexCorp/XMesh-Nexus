# Findings and hypotheses

Only limited confirmed behavior is recorded below. No confirmed P0/P1 has been established at this checkpoint. Scanner candidates are not findings until manually validated.

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
