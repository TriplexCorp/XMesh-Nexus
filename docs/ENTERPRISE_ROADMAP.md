# XMesh Nexus — Enterprise hardening roadmap

**Baseline:** 2026-10-24 · **Target branch:** `main` · **Status:** active, not enterprise-production certified.

This roadmap tracks verified improvements, not feature claims. A stage is complete only after the listed acceptance criteria pass in CI and, where required, on a disposable real Xray node. A green source-level assertion alone does not count as production evidence.

## Working rules

- Prefer correctness and reproducibility over adding UI features.
- Keep `cargo test`, `cargo clippy -D warnings -D clippy::pedantic -D clippy::nursery -F unsafe-code`, and Rust formatting checks enforced, not silently disabled.
- Test committed sources; CI must never repair code via `cargo fmt` before evaluating it.
- Distinguish **saved desired state**, **signed policy delivered**, **node revision applied**, and **traffic actually enforced**.
- Record the commit, CI run, reproducible failure scenario and verification result for every milestone.
- Do not call a stage complete solely because README says it is implemented.

## 1 — P0: CI and release reliability

- [x] Replace mutating `cargo fmt` CI step with `cargo fmt --all -- --check`. Commit: `f2add5a`.
- [ ] Establish a passing baseline on `main` for Node.js checks, Rust formatting, all-target tests, strict Clippy, Docker build and API integration.
- [ ] Replace brittle source-regex checks where possible with observable, behavior-based tests; retain security-contract checks that express real invariants.
  - [x] IP rotation UI validation: execute the real validation helpers against valid, duplicate, invalid, insufficient and oversized pools instead of requiring an exact source layout (`a676ac7`).
  - [x] Live-node status contract: execute the actual state function for healthy, stale, disabled, stopped Xray/router and unknown states (`db52057`).
  - [x] Xray version rendering contract: assert `textContent` sink and guard against directly inserting untrusted version via `innerHTML` (`f66bdd3`).
  - [ ] Extend this approach to other UI source-contract tests and integration behaviors.
- [ ] Ensure required branch protection prevents merging when those checks fail.
- [ ] Document reproducible release / rollback and evidence from a clean checkout.

**Exit:** a documented green main-branch CI run, reproducible local checks, no test stage mutating tracked source files, and enforced required checks.

## 2 — P0: Verified enforcement on nodes

- [ ] Test disabling an active user end-to-end: panel write → desired policy → node apply → Xray rejects further traffic.
- [ ] Verify expiry and exhausted quotas on real node(s), not just UI or generated JSON.
- [ ] Simulate control-plane disconnection, node reconnect, revision conflicts, retries and replay attempts.
- [ ] Capture and report desired vs actually applied revision; do not claim success from an accepted command.

**Exit:** repeatable integration evidence of enforcement, including disconnected node cases and documented offline budget limits.

## 3 — P0: Trustworthy telemetry and accounting

- [ ] Test delayed/out-of-order/duplicate signed telemetry, counter resets and Xray restarts.
- [ ] Verify cumulative accounting never double-counts and unavailable counters are not represented as zero usage.
- [ ] Confirm 45-second presence expiry under delayed and missing heartbeats.
- [ ] Add freshness/error indicators and alerts for stale node and user metrics.

**Exit:** a test matrix with failure injection plus trustworthy usage and presence under expected faults.

## 4 — P1: Subscription/client compatibility

- [ ] Build a matrix for VLESS, VMess, Trojan, Shadowsocks/SS2022, Hysteria2 and MASQUE across supported transports and security.
- [ ] Validate outbound JSON against real Xray-core and supported client versions; reject unsafe server-only fields.
- [ ] Test host, node, direct IP, CDN and ambiguous endpoint handling plus IP rotation.
- [ ] Decide on URI/base64/Clash/Sing-box formats based on verified user need; do not advertise formats not implemented.

**Exit:** published compatibility matrix with fixtures and documented pass/fail results on actual clients.

## 5 — P1: Security and operations

- [ ] Complete a denial-by-default endpoint × role matrix for owner/admin/viewer and test all disallowed operations.
- [ ] Audit secrets, sessions, MFA, enrollment, signing-key rotation and recovery, including threat-model review.
- [ ] Add dependency and container vulnerability scanning; document actionable findings and exceptions.
- [ ] Prove off-host restore of PostgreSQL *and* TOTP/subscription encryption and node-policy signing keys.
- [ ] Document alerts and troubleshooting for failures of DB, Redis, nodes and panel.

**Exit:** security test evidence, restored disposable deployment, recovery runbook, documented residual risks.

## 6 — P2: Scale, HA and operator UX

- [ ] Load-test node count, user count, subscription refresh and metrics ingestion.
- [ ] Design and test panel/database/Redis failover and recovery before claiming HA support.
- [ ] Modularize high-risk regions of `app.js` incrementally with behavioral regression tests.
- [ ] Measure and reduce steps to accomplish core administration tasks.

**Exit:** reproducible capacity limits, verified failure handling and measurable UX improvements.

## Current architecture and limitations

XMesh Nexus is a Rust/Axum control plane with PostgreSQL/TimescaleDB and Redis, using separate XMesh-Node runtime on VPN nodes. Signed Ed25519 node telemetry and policies are implemented. Native Xray JSON generation contains code paths for VLESS, VMess, Trojan, Shadowsocks/SS2022, Hysteria2 and MASQUE, but end-to-end client compatibility is not assumed. The default Compose topology is a single panel, database and Redis; HA is **not** verified. Offline quota enforcement is conservative, not a globally exact quota across disconnected nodes.

For current functionality and operating instructions see [README](../README.md), [autonomous node design](AUTONOMOUS_NODES.md) and [update/telemetry guide](PANEL_UPDATE_AND_TELEMETRY.md).
