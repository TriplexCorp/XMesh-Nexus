# XMesh Nexus — Enterprise hardening roadmap

**Baseline:** 2026-10-24 · **Progress reviewed:** 2026-10-25 · **Target branch:** `main` · **Status:** active, not enterprise-production certified.

This roadmap tracks verified improvements, not feature claims. A stage is complete only after the listed acceptance criteria pass in CI and, where required, on a disposable real Xray node. A green source-level assertion alone does not count as production evidence.

## 2026-10-25 — Statistics and user-workspace UX delivery

### Implemented in source (not yet production-accepted)

- [x] Correct single-element `$()` versus collection `$$()` iteration mistakes affecting Statistics rendering and user-statistics controls.
- [x] Add a regression guard for these selector patterns; cache-bust updated frontend scripts and styles.
- [x] Redesign the user analytics dialog with a horizontal layout, full-app blurred backdrop, header actions, traffic-source/node insights, chart and measurements.
- [x] Keep analytics dimensions stable across History, Inbound/Nodes and Observations tabs; when launched from the user editor, measure that editor and match its dimensions within viewport constraints.
- [x] Provide one animated refresh action, a circular close control, and scroll handling intended to prevent stacked vertical scrollbars.
- [x] Add branded period selectors, body-level dropdown menus above tables, keyboard handling and theme scrollbar styling.
- [x] Show the numeric internal user ID in the user editor; link its **Detailed statistics** action to user-specific analytics and return to the originating route on close.
- [x] Rename user traffic reset to **Reset traffic** and route it through the built-in confirmation dialog before API mutation.
- [x] Move the XRAY STUDIO configuration constructor overlay above the app shell so blur covers the entire screen.
- [x] Update source-level regression checks (`scripts/check-statistics-feedback.js`, `scripts/check-xray-studio-selectors.js`).

### Subsequent UI refinements — delivered in source

- [x] Automatically refresh raw observations when node, inbound, user or time range changes; remove the redundant manual observations button.
- [x] Filter the Inbound/Nodes breakdown tables using the selected node and inbound, without adding independent counters together.
- [x] Replace the short fixed node palette with a session-stable, maximin OKLab candidate selection of **pastel** colours; use a consistent node colour across per-node rings, aggregate node distribution and analytics bars.
- [x] Distinguish semantic traffic-direction colours from node colours: Upload (teal) and Download (violet); correct the aggregate ring legend to identify nodes.
- [x] Introduce application-wide branded scrollbar styling in the main stylesheet and XRAY STUDIO stylesheet, including 8 px rails and attempted 7 px end insets on supported engines; preserve existing overflow containers.

### Chart scaling — implemented in stylesheet, pending acceptance

- [x] Size the infrastructure Statistics SVG chart to its parent card under the Appearance content-width setting (`--panel-content-max`), preserving the intrinsic `1000 × 340` plot proportions.
- [x] Apply the same card-filling, content-width-driven chart layout to the Dashboard RX/TX graphic (`.traffic-chart-wrap`, `.traffic-chart-svg`).
- [x] Keep user history charts bounded within their modal workspace without changing tab-dependent dialog geometry.
- [ ] Confirm graph sizing, SVG axis-label legibility, hover targets and alignment at UI scales 90–200%, across common laptop, desktop and ultrawide viewport sizes.
- [ ] Test switching global UI scale while Statistics and Dashboard are already mounted; ensure plots respond without stale measurements, clipping or overflow.

### Verification and follow-up (open)

- [ ] Execute browser-level smoke/e2e tests at multiple screen sizes and global UI scale settings: modal bounds, stable tabs, scrollbars, table overflow, dropdown positioning and accessibility/focus.
- [ ] Compare node colours across user editor and detailed analytics after repeated refreshes, node additions and full reloads; check pastel contrast and perceptual collisions as node counts increase.
- [ ] Verify scrollbar insets (including top/bottom corners), thumb styling and lack of duplicate scroll regions in Chromium and Firefox, as well as all major dialogs and XRAY STUDIO.
- [ ] Verify **User card → Detailed statistics → close** returns to Users reliably for close button, Escape and backdrop, without losing the original context.
- [ ] Validate confirmation cancellation, exactly one successful traffic reset, API failure reporting and current displayed counters on a disposable environment.
- [ ] Validate XRAY STUDIO constructor full-viewport backdrop, close/escape behaviors and cleanup when navigating away.
- [ ] Verify served frontend asset versions through the production reverse proxy after deployment; confirm no stale browser cache.
- [ ] Add runtime interaction tests beyond source-string assertions and record CI run, commit and deploy evidence.

**Status:** the checked items above indicate code changes saved in the repository, **not** browser-verified or production-certified behavior. They do not complete Statistics 2.0 or HA/security acceptance criteria.

## Working rules

- Prefer correctness and reproducibility over adding UI features.
- Keep `cargo test`, `cargo clippy -D warnings -D clippy::pedantic -D clippy::nursery -F unsafe-code`, and Rust formatting checks enforced, not silently disabled.
- Test committed sources; CI must never repair code via `cargo fmt` before evaluating it.
- Distinguish **saved desired state**, **signed policy delivered**, **node revision applied**, and **traffic actually enforced**.
- Record the commit, CI run, reproducible failure scenario and verification result for every milestone.
- Do not call a stage complete solely because README says it is implemented.

## Progress snapshot — 2026-10-25

**Evidence level:** PR-level CI, not production-node certification. [PR #8](https://github.com/TriplexCorp/XMesh-Nexus/pull/8) at commit `43c8693` passed [Backend CI run #2414](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40151051399) and [User Presence Integrity run #55](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40151051415). PR #8 was **open and unmerged** when this snapshot was prepared. These results do **not** establish a green `main` run or completed P0 exit criteria.

| Workstream | Implemented / verified so far | Still required for stage exit |
| --- | --- | --- |
| **P0 CI / releases** | Non-mutating rustfmt gate, all-target Rust tests, strict pedantic/nursery Clippy, Node.js checks, Docker build and disposable API integration pass in PR CI | Green baseline after merge on `main`, branch protection evidence, release / rollback drill |
| **P0 node enforcement** | Signed Ed25519 node policy/telemetry, signed command delivery, replay rejection and offline enforcement logic documented; API integration exercises signatures and command acknowledgement | Actual Xray traffic-denial tests, disconnect/reconnect and revision-conflict fault injection, independently verified applied revision |
| **P0 telemetry** | Per-user/per-inbound cumulative counters and signed ingestion implemented; CI includes replay, presence and accounting checks | Full delayed/out-of-order/reset/restart matrix and verified 45-second expiration under faults; stale-data alerts |
| **P1 compatibility** | Server/client JSON generation and endpoint selection logic with test coverage for supported paths | Real client/Xray compatibility matrix, transport/security fixtures and verified exports |
| **P1 security / operations** | Owner/admin/viewer isolation, MFA/session revocation and Ed25519 enrollment covered by API integration; active-host creation exercised with valid profile+node binding | Exhaustive endpoint × role matrix, threat model, scans, off-host restore of database and cryptographic keys |
| **P2 scale / HA** | Single-instance Compose architecture and existing operator UI | Benchmarks, failover tests, incremental UI modularization and UX measurements |

**Recent CI regression corrections (PR #8):** Clippy failures fixed without relaxing lint flags; oversized Rust functions refactored rather than suppressed; node integration fixtures updated to supply required `addr`, assert the complete restart-command schema, handle non-JSON extractor rejections, and expect the current fixed agent-update target `control-v4.3.2`. Authentication integration now checks both invalid active-host rejection and creation of a *valid, fully bound active host*, preserving positive authorization coverage (`43c8693`). These are CI test results, **not** real-node enforcement evidence.

**Verification gaps:** GitHub branch-protection settings could not be inspected via the available integration (403). Production-node outcomes, off-host restore and HA have not been demonstrated in this roadmap. Leave their acceptance checkboxes unchecked until evidence exists.

## 1 — P0: CI and release reliability

- [x] Replace mutating `cargo fmt` CI step with `cargo fmt --all -- --check`. Commit: `f2add5a`.
- [ ] Establish a passing baseline on `main` for Node.js checks, Rust formatting, all-target tests, strict Clippy, Docker build and API integration. **PR-level prerequisite passed** at `43c8693` (Backend CI #2414); a post-merge `main` run is still required.
- [ ] Replace brittle source-regex checks where possible with observable, behavior-based tests; retain security-contract checks that express real invariants.
  - [x] IP rotation UI validation: execute the real validation helpers against valid, duplicate, invalid, insufficient and oversized pools instead of requiring an exact source layout (`a676ac7`).
  - [x] Live-node status contract: execute the actual state function for healthy, stale, disabled, stopped Xray/router and unknown states (`db52057`).
  - [x] Xray version rendering contract: assert `textContent` sink and guard against directly inserting untrusted version via `innerHTML` (`f66bdd3`).
  - [ ] Extend this approach to other UI source-contract tests and integration behaviors.
- [ ] Ensure required branch protection prevents merging when those checks fail. **Not verified:** protection API returned 403; inspect settings with authorized access.
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

## 7 — P1: Statistics 2.0 — full observability and operator analytics (committed scope)

**User mandate (2026-10-25):** Deliver the **entire** statistics upgrade, not just a telemetry-freshness patch or a visual mockup. This is an end-to-end product requirement across Rust APIs, TimescaleDB/PostgreSQL, authenticated UI and real signed Xray node telemetry. **Overall status: IN PROGRESS — NOT COMPLETE.** A green CI run for one increment must never be described as completion of this section.

**Already merged into `main`:** [PR #10](https://github.com/TriplexCorp/XMesh-Nexus/pull/10), commit [`a9138eb`](https://github.com/TriplexCorp/XMesh-Nexus/commit/a9138ebcd6eb897e4cef28a8f20f9626da875b79). Existing Statistics UI now distinguishes fresh/delayed/stale/invalid/never-received telemetry, exposes Xray user-counter status, identifies nodes needing attention, separates node interface RX/TX from cumulative per-user usage, and offers 1h/24h/7d/30d network-traffic views. This is **partial delivery**, not Statistics 2.0 completion. It does not prove end-to-end accounting correctness or provide all historical analytics.

### Implementation update — 2026-10-25 (after PR #10)

**Delivered in `main` (code present; not a Statistics 2.0 stage-exit certification):**

- Network traffic selection supports **Live, 5m, 15m, 30m, 1h, 3h, 6h, 12h, 24h, 7d, 30d** via the authenticated Rust/TimescaleDB API.
- Statistics UI refresh is decoupled from expensive reads: 1-second visual heartbeat, 5-second Live traffic polling, 15-second overview/system cache, 30-second historical polling; refresh pauses for hidden tabs and user-initiated reload bypasses the cache. **These are configured cadences, not proven production throughput or true 1-second telemetry sampling.**
- Graph RX/TX uses a combined, accessible SVG with visible colored dots, selected-point ring, axes, grid, timestamps, units in **bits per second**, hover titles and no invented intermediate samples. Readouts distinguish interface speeds from accumulated Xray usage.
- Clicking a real point opens an interval drill-down using `GET /api/v1/metrics/traffic/bucket-detail`, backed by bounded per-node TimescaleDB sample aggregation. It reports participating nodes, RX/TX, sample counts, last sample and the leading RX contributor. Detail access is interactive (mouse/keyboard); missing samples remain unavailable rather than fabricated zeros. UI selection and click-target regressions have been corrected.
- Existing UI shows freshness categories, last actual TimescaleDB bucket age, signed user-counter status and affected nodes. UI source-contract tests cover the new interaction and presentation.

**Outstanding before acceptance:** CI/production runtime evidence for the latest direct-to-`main` changes, real browser keyboard/screen-reader test, complete timeout/error and large-node behavior for bucket detail, aggregate-versus-detail parity, correct SQL/query-plan performance under load, actual per-user/per-inbound time series, alerting, incident history, export and full Statistics 2.0 navigation. The drill-down is **per-node interface network traffic**, not external destination attribution or individual-user Xray usage. Do not infer destinations from RX/TX alone.

**Repository workflow:** Following the owner's instruction, update `main` directly; do not create extra branches without explicit authorization. Preserve security gates and strict CI.

### Phase A — P0: Data integrity and trustworthy measurements

- [ ] Define and test one documented freshness/quality contract across node, user, inbound and aggregate endpoints: timestamps, provenance, availability, expected coverage, clock skew, and `fresh`/`delayed`/`stale`/`unavailable`/`never_received` states.
- [ ] Never show missing counters, absent samples, failed StatsService polling, or disconnected nodes as **zero usage**. Genuine zero values require a verified observation; missing time buckets remain gaps (`null`).
- [ ] Display network-interface RX/TX, verified Xray per-user/per-inbound traffic, and panel-container performance **as separate metric families**; do not add unrelated or overlapping counters.
- [ ] Exercise duplicate, out-of-order, delayed and replayed signed telemetry, counter resets, agent/Xray restarts, partial coverage and disconnect/reconnect. Prove cumulative totals are monotonic without double-counting or fabricated consumption.
- [ ] Enforce owner/admin/viewer data-access restrictions, avoid disclosing secrets/internal host details, and test authorization for every new endpoint and export.
- [ ] Add behavior-based Rust/API/frontend regression tests for missing/stale/partial data, time-boundary behavior, realistic observations and incorrect client-side assumptions.

### Phase B — P1: Redesigned Statistics Overview (real implementation, not mockup)

- [ ] Deliver a coherent, responsive, accessible Statistics UI (desktop/mobile) with **Overview, Traffic, Nodes and Users** views, honoring existing theme and RU/EN localization.
- [ ] Display actionable KPI cards: online/total users, healthy/total nodes, data coverage/freshness and **verified** user traffic for a clearly labelled period; never substitute network-interface traffic for user traffic.
- [ ] Implement complete, readable historical visualizations with explicit units, date/time range, sampling resolution, gaps, legends, last verified sample time, loading/error/empty states and bounded refresh.
- [ ] Support 1h, 24h, 7d, 30d and appropriate bounded custom date ranges; allow period-over-period comparisons with matching windows.
- [ ] Add sortable/filterable node health diagnostics (CPU/steal, RAM, disk, RX/TX, sessions, signed heartbeat, agent/Xray version, policy desired/delivered/applied status where verifiable) with explanations for missing or degraded data.
- [ ] Keep UI refresh and API polling efficient, cancellable and non-duplicative; preserve security boundaries and regression tests.

**Deep Analytics implementation note (2026-10-25):** `GET /api/v1/statistics/leaders` and the Statistics Top-10 tables are now present in `main`, using `user_node_traffic_totals` and independently `user_inbound_traffic_totals`. They show **verified cumulative totals since the first accepted baseline**, not traffic over the selected graph period. Viewer access is denied; owner/admin can inspect ranks. **An accepted-delta TimescaleDB journal has since been added in source (see below); historical charts and period-specific Top-10 still require UI/API implementation, strict tests, and deployment verification.** Await strict CI and live API verification before claiming the slice accepted.

### Mandatory requirement — per-user × inbound forensic drill-down (2026-10-25)

**User requirement, verbatim:** «ты сможешь контрить буквально по инбаунду статистику конкретного юзера». This is **required product scope**, not an optional chart.

For **any selected user**, an authorized operator must be able to inspect **each inbound individually**, with further breakdown by **node and time bucket**:

- Verified **uplink, downlink and total bytes** for the exact `user_id × inbound_tag × node_id` combination, including the contributing sample count, latest valid observation time, collection freshness and source.
- Historic breakdown by selectable intervals (1h, 24h, 7d, 30d and bounded custom period), with correct time buckets and explicit missing-data gaps. Provide separate time-series lines for each inbound and the ability to expand **user → inbound → node → interval → supporting observations**.
- Inbound Top-10 can be filtered to the **selected user's traffic**, not just a global inbound ranking; filtering by node and direction must not change accounting semantics.
- A click-through UI from a user or inbound entry should show a clear ledger-like explanation of what was measured, when, which node reported it, whether the Xray StatsService counter was verified, and what is unknown.
- Ingestion must persist accepted monotonic **counter deltas** in a durable, idempotent, append-only historical ledger. Deduplicate signed retries; handle out-of-order samples, counter resets and agent/Xray restarts without double-counting. Existing cumulative tables are **not** sufficient to reconstruct past intervals.
- **Never add user-global and user-inbound counters together** (two independent views can overlap); never infer destination IP, domain, application, VPN protocol or actual routing solely from the inbound tag or host network-interface RX/TX. Show unavailable dimensions as unknown.
- Tests must cover two users sharing one inbound, one user across multiple inbounds and nodes, absent Xray StatsService data, resets/replays, conservation against accepted cumulative deltas, RBAC, time boundaries and high-cardinality query performance.

**Done means:** an operator can pick user U, inbound I and node N for a real interval and see reproducible, independently supported Uplink/Downlink values with evidence and freshness, not a mockup or totals backfilled into fake history. **Status: NOT YET IMPLEMENTED.** Present `user_inbound_traffic_totals` and the per-user traffic endpoint expose cumulative snapshots only.

**Historical ledger increment (2026-10-25, code pushed to `main`; deployment and CI not yet verified):** Migration `0028_verified_traffic_deltas.sql` adds a Timescale hypertable for independently sourced `user` and `inbound` positive deltas. Accepted signed telemetry writes those deltas **before** cumulative-counter UPSERTs in the same per-node advisory-locked transaction. Baselines, replayed/stale source timestamps and reset counters contribute no new historical usage. `GET /api/v1/users/{id}/traffic/history?range=24h&inboundTag=...&nodeId=...` provides filtered rows bucketed over 1h/24h/7d/30d, bounded at 5000 rows. It returns source type, provenance, samples and truncation; viewing detailed personal traffic is denied to `viewer`. Existing totals cannot be backfilled faithfully: history begins only after deploying this migration and ingestion code. **Remaining:** live migration/integration evidence, browser drill-down, period Top-10, missing-data quality display, and load tests. Do not tick the phase complete yet.

**Historical graph increment (2026-10-25):** The Statistics Xray history inspector now renders an Upload/Download SVG using observed rows from `/api/v1/users/{id}/traffic/history`, grouped by returned time bucket and respecting user/inbound/node filters. Units are cumulative bytes **within each observed time bucket**, not interface Mbps; no absent bucket is introduced as zero. Connecting lines are visual aids and do not imply interpolation of missing telemetry. Pending: real-browser, integration and CI verification, coverage/freshness markers, and period-specific Top-10.

**Current feature inventory (2026-10-25):** The source now includes the Timescale accepted-delta ledger (`0028_verified_traffic_deltas.sql`), transactional user/inbound ingestion, an authorized per-user history endpoint, a filterable history inspector, and an observed-bucket Upload/Download SVG graph. The UI offers 1h/24h/7d/30d periods and navigates from a user in the lifetime Top-10 to that user's history. Source-level checks were added. **Do not interpret this as verification of a production migration or end-to-end accuracy.** No per-period Top-10 exists yet; lifetime Top-10 remains separate. Next acceptance requires migration and strict CI, real signed-agent integration (replay/reset/dual-inbound/node cases), browser interaction tests, missing-data coverage, retention and query-plan validation.

**Delivery checklist for the next slice (status 2026-10-25):**
- [x] Source code: Timescale hypertable migration for accepted user/inbound deltas, transactional ingestion under the signed node's serialized lock, and authenticated user/node/inbound history API.
- [ ] Confirm the migration runs correctly on PostgreSQL 18 + TimescaleDB and strict CI passes on the committed source.
- [ ] Integration-test monotonic increases, baseline-only snapshots, reset/restart, duplicate/replayed signed samples, two inbounds on one user, and absence of independent-counter double counting.
- [ ] Verify the new user → inbound → node → bucket history UI in a real browser (filters and missing-data messaging are implemented in source; partial coverage and accessibility remain to be validated).
- [ ] Add time-bounded period Top-10 (not lifetime counts), paging/retention policy, representative-volume query plans and permission tests.

**Period rankings and raw drill-down increment (2026-10-25, implementation in `main`):** `GET /api/v1/statistics/period-leaders?range=1h|24h|7d|30d` ranks users, inbounds, and nodes by accepted Xray deltas from `verified_traffic_deltas`. User/node rankings use the `user` counter family; inbound rankings use independent `inbound` counters (never summed across families). The Statistics page can switch ranking periods and open a user's filtered history. `GET /api/v1/users/{id}/traffic/observations` returns the latest **up to 500** individually accepted delta entries under user/inbound/node/range filters, with truncation status; the UI exposes the evidence table. These are signed-ingest accepted increments, not packet captures, IP destinations, or route-level attribution. **Source changes are not accepted as complete** without green strict CI, live migration and signed-node integration tests, browser verification, and pagination/coverage work. A Top-10 derived from the new journal covers only telemetry ingested after its deployment.

**Statistics user-card UX increment (2026-10-25):** Selecting a user in the period Top-10, or entering any valid user ID, now opens a dedicated *Statistics-only* full-width intelligence dialog. It contains cumulative verified counters, history chart and filters, independent inbound/node breakdown and individual accepted observations in separate tabs; responsive styling and close/Escape controls are provided. The existing user editing card and its actions are unchanged. This is source-level delivery pending live browser and accessibility verification (including focus management), backend validation and strict CI. Future work: discover users by name, improve freshness/coverage evidence and make observation-level pagination dependable.

### Phase C — P1: Deep TimescaleDB, user and inbound analytics

- [ ] Build genuine **time-bucketed Xray user-traffic** history (not merely lifetime totals), with safe filters for user, node, inbound, squad, time range and source reliability; preserve accounting direction/units.
- [ ] Provide Top-10 users/nodes/inbounds by **verified consumption**, trends and historical comparisons, plus usage against limits, impending expiry and quota-risk indicators.
- [ ] Implement drill-down from overview to node → inbound → user, including clearly identified partial/stale data and count of contributing nodes/samples.
- [ ] Replace per-node N+1 statistics queries with bounded set-based queries; add safe SQL paging, indexes and query-plan/performance evidence.
- [ ] Evaluate continuous aggregates, retention/compression policy and backfill rules for TimescaleDB with production-safe migrations, realistic-volume tests, and a documented capacity envelope.
- [ ] Add secure, permission-aware **CSV and JSON export** of selected measurements with time bounds, provenance, sample quality and controlled result sizes.

### Phase D — P1: Monitoring, anomaly detection and incident response

- [ ] Detect and signal stale/offline nodes, missing Xray StatsService, collection failures, anomalous traffic changes, CPU steal/pressure, disk/memory saturation and impending limits using explicit, configurable thresholds.
- [ ] Provide an incident/alert history: onset, last observation, duration, impacted nodes/users where authorized, status, resolution, and traceable evidence; avoid duplicate notification storms.
- [ ] Add in-panel alerts and actionable diagnosis; document supported external notification channels rather than assuming unimplemented integrations.
- [ ] Test notification deduplication, recovery, noisy telemetry, missing-data failure modes, restricted access and operational runbooks.

**Acceptance / definition of done:** Every checkbox in Phases A–D is implemented with production code and behavioral tests, verified in strict CI on committed sources and, for traffic enforcement/accounting/failure behavior, on disposable real Xray nodes. Report verified data coverage and performance under representative node/user loads; document data retention, permissions, deployment/rollback, and known limitations. **Do not mark Statistics 2.0 complete merely because PR #10 passed or 7d/30d periods became available.**

**Delivery workflow:** Per user instruction, do **not create additional branches** unless explicitly authorized. Changes should target `main` while preserving formatting, all-target Rust tests, strict Clippy, security checks and integration gates. Record each delivered slice and its CI evidence here; check off only verified acceptance criteria.

## Current architecture and limitations

XMesh Nexus is a Rust/Axum control plane with PostgreSQL/TimescaleDB and Redis, using separate XMesh-Node runtime on VPN nodes. Signed Ed25519 node telemetry and policies are implemented. Native Xray JSON generation contains code paths for VLESS, VMess, Trojan, Shadowsocks/SS2022, Hysteria2 and MASQUE, but end-to-end client compatibility is not assumed. The default Compose topology is a single panel, database and Redis; HA is **not** verified. Offline quota enforcement is conservative, not a globally exact quota across disconnected nodes.

For current functionality and operating instructions see [README](../README.md), [autonomous node design](AUTONOMOUS_NODES.md) and [update/telemetry guide](PANEL_UPDATE_AND_TELEMETRY.md).
