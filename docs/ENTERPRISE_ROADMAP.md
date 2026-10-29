# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 29 October 2026

This file defines the **current order of work**. Historical roadmaps/checkpoints under [`archive/`](archive/) do **not** override this document.

A green test proves only its stated boundary. Code existence ≠ E2E ≠ security review ≠ production deployment.

## Verified source checkpoints

- **Latest Nexus P0-D implementation checkpoint:** [`8b1cc46cfae5b018cf55cc02ad31e48e37d39741`](https://github.com/TriplexCorp/XMesh-Nexus/commit/8b1cc46cfae5b018cf55cc02ad31e48e37d39741), merge of [PR #95](https://github.com/TriplexCorp/XMesh-Nexus/pull/95).
- **P0-D1a / PR #90:** immutable append-only Agent release identity `{version, sourceRevision, artifactSha256}` in PostgreSQL. Version/source/artifact identity cannot be rebound; UPDATE/DELETE/TRUNCATE are rejected. No production execution path was activated.
- **P0-D1b / PR #91:** an approved immutable release identity can be atomically bound to the existing fixed-action `update_agent` single-flight command queue. Binding attach/remove/replace after row creation is rejected; normal lifecycle state transitions remain legal. No HTTP/API caller, poll payload or Agent/updater execution changed in this gate.
- **P0-D1c / PR #93:** the existing `POST /nodes/{id}/agent-update` control plane gained an owner-only release-selection mode behind exact non-default `XSP_V2_P0D_AGENT_MIGRATION=staging-only`. Callers select only an approved version; Nexus resolves immutable source revision/artifact digest server-side and stages the existing fixed `update_agent` action. Legacy `{}` behavior remains unchanged and caller digest/URL/script/command input is rejected.
- **Authenticated poll/apply/ACK release identity / PR #95:** already-bound `update_agent` commands now carry exact immutable `{version, sourceRevision, artifactSha256}` through the existing signed poll/apply/ACK lifecycle. The installed shell Agent validates and preserves the exact identity across the existing fixed updater service and returns it in the signed ACK. Nexus row-locks the claimed command, compares ACK identity with the immutable manifest and atomically persists terminal state plus exact ACK evidence. Missing/mismatched identity fails closed; a matching-version heartbeat cannot synthesize success for a bound migration; legacy unbound commands remain identity-free and compatible.
- On exact merge SHA `8b1cc46cfae5b018cf55cc02ad31e48e37d39741`, [Backend CI #3553](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40810560951), [Node GeoData and Routing checks #784](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40810560944) and [Managed dual inbound regression #140](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40810560971) all completed **success**. Backend includes strict Clippy/pedantic/nursery, Docker build, migration `0109`, and disposable PostgreSQL/API integration with real signed poll/heartbeat/ACK identity checks; GeoData includes installed-Agent shell validation.
- **Completed C2-D implementation checkpoint:** [`7e0b42ea4847b273ba8cd55a0ff3e043a420c377`](https://github.com/TriplexCorp/XMesh-Nexus/commit/7e0b42ea4847b273ba8cd55a0ff3e043a420c377), merge of [PR #88](https://github.com/TriplexCorp/XMesh-Nexus/pull/88). PR #88 closed the final C2-D2 integrated transport-negative / no-legacy-fallback proof at the real ACK-operation boundary; its exact post-merge matrix remains valid within that stated isolated staging/process scope.
- **Current XMesh-Node staging transport checkpoint:** [`0ae78244ef0ef763bea6ce198dde6e83eb11ff1f`](https://github.com/TriplexCorp/XMesh-Node/commit/0ae78244ef0ef763bea6ce198dde6e83eb11ff1f), merge of Node PR #33.
- Node PR #33 binds HTTP authority to the same authenticated `serverName` used for TLS SNI/certificate verification while retaining a separate direct TCP connect `address`; exact-head and post-merge Node CI/Crypto passed.
- Prior Nexus checkpoints remain valid within their stated boundaries: C2-D2 outage/restart `a756f1ac…` (#86), transport alignment `86e01727…` (#84), lost-response/race `39e1589c…` (#82), expired recovery `5acccfa1…` (#77), D1 `037290bb…` (#73), C2-C `37b9e49d…` (#71), plus signer P0 (#61), C1 (#64), C2-A (#66) and C2-B (#69).

## Binding XSP-v2 target invariant

The finished XSP-v2 control plane has one policy: **fail closed**.

All are mandatory:

1. **Transport:** TLS 1.3 with actually negotiated `X25519MLKEM768`, trusted certificate chain, correct hostname/SNI, application authority bound to the authenticated server name, and no unreviewed weaker hop.
2. **Messages:** Ed25519 **AND** ML-DSA-65 verification for every security-critical XSP/2 message.
3. **Binding/state:** exact sender/recipient, direction, method/path, payload/revision, request ID, nonce, key epoch and expiry; durable replay protection and monotonic security state.
4. **Key custody/enrollment:** verified owner authorization, proof of possession, pinned trust roots and protected private-key boundaries.
5. **Failure:** missing PQ support, invalid signature/certificate/state, stale epoch, replay or unavailable security component means reject — never automatic fallback to `XMESH1`, Ed25519-only, X25519-only, TLS 1.2 or insecure verification.

`strict-pq` remains **OFF** in production. Legacy `XMESH1` remains the deployed control-plane reality until a separately approved migration/release gate replaces it. Xray remains the user VPN data-plane.

## Gate status

| Gate | Status | Evidence / required next |
| --- | --- | --- |
| Dual-signed permit / applied ACK primitives | **STAGING PASS** | Ed25519 AND ML-DSA-65; canonical permit/nonce/epoch/candidate bindings |
| Atomic ACK → epoch commit/readback | **STAGING PASS** | PostgreSQL transaction/CAS and committed evidence |
| Signed commit receipt + immutable outbox | **STAGING PASS** | Exact durable bytes, dedupe/recovery and mutation guards |
| Isolated `panel_response` signer | **P0 COMPLETE — staging/process** | PR #61 |
| P0-C1 dedicated PQ-only Node ingress | **P0 COMPLETE — isolated network/process** | PR #64 |
| P0-C2-A ingress→origin trust boundary | **P0 COMPLETE — isolated staging/process** | PR #66 |
| P0-C2-B narrow staging ACK route | **P0 COMPLETE — isolated staging/process** | PR #69 |
| P0-C2-C ACK crypto/transaction/signer | **P0 COMPLETE — isolated staging/process** | PR #71 |
| P0-C2-D1 real Node integrated E2E | **P0 COMPLETE — isolated staging/process** | PR #73 |
| P0-C2-D2 expired exact recovery | **COMPLETE — isolated staging/process** | PR #77 |
| P0-C2-D2 lost-response + duplicate-race convergence | **COMPLETE — isolated staging/process** | PR #82 |
| P0-C2-D2 current Node recovery transport alignment | **COMPLETE — isolated staging/process** | PR #84 |
| P0-C2-D2 integrated outage/restart convergence | **COMPLETE — isolated staging/process** | PR #86 |
| P0-C2-D2 transport-negative / no-legacy proof | **COMPLETE — isolated staging/process** | PR #88 + Node PR #33; exact post-merge matrix green |
| **P0-C2-D overall** | **COMPLETE — isolated staging/process** | Full real-Node success/failure/retry/recovery/downgrade matrix complete |
| P0-D1a immutable Agent release identity | **COMPLETE — staging/DB foundation** | PR #90; append-only exact version/revision/SHA-256 identity |
| P0-D1b immutable release→`update_agent` binding | **COMPLETE — staging/DB foundation** | PR #91; exact immutable binding into existing single-flight queue |
| P0-D1c owner-only staging orchestration API | **COMPLETE — staging/API foundation** | PR #93; exact non-default gate, owner-only version selection, server-side immutable manifest resolution, legacy `{}` unchanged |
| Authenticated poll/apply/ACK release identity | **COMPLETE — staging/signed command lifecycle** | PR #95; exact manifest identity on signed poll/apply/ACK, durable ACK evidence, heartbeat-only bound success blocked, legacy unbound compatibility preserved |
| **Real Agent integration design / Go 1.27 migration** | **CURRENT P0 sub-gate** | Define the deployed Go 1.23→Go 1.27 migration architecture and reuse proven XSP-v2 transport/permit/ACK/receipt/recovery primitives without a parallel state machine or silent downgrade |
| **P0-D production-capable Agent workflow** | **CURRENT P0** | Complete real Agent integration, staged verify/apply/rollback, durable state and disposable Nexus↔Node E2E |
| P0-E recovery/security release gates | **BLOCKED on P0-D** | Crash/power loss, snapshot/rollback, backup/restore, rotation, fuzz/KAT, independent review |
| Production XSP-v2 rollout | **NOT AUTHORIZED** | Disposable canary + explicit production approval after all gates |

## Completed P0-C2-D — integrated real-Node proof

### D1 — real Node happy-path integration

PR #73 proved:

`real XMesh-Node Go 1.27 staging client → strict TLS1.3/X25519MLKEM768 + ML-DSA-65 mTLS → dedicated ingress → protected origin UDS → C2-C ACK auth/commit → PostgreSQL → isolated signer → dual-signed commit receipt → Node receipt verification + durable journal`

The Node verifies/journals the signed permit and ACK, accepts success only after dual-signature receipt verification and durable local persistence, and cannot be impersonated by another valid ML-DSA client identity. D1 preserved freshness and did not authorize stale network commands.

### D2 — exact recovery, failure, race and downgrade matrix

The complete D2 proof consists of PR #77, #82, #84, #86, Node PR #33 and PR #88.

#### Exact historical recovery

- expired ACK remains rejected on the state-changing route;
- historical receipt recovery uses exact external `/api/v2/node/keys/rotation/ack/recover` and protected internal `XSP2C2H1` recovery domain;
- exact committed ACK/durable receipt evidence must match;
- no fresh CAS/epoch transition, re-signing or second epoch transition occurs;
- signer may be offline once the immutable receipt is durable.

#### Lost responses / races

- loss before C2-C commit leaves no transition/receipt;
- signer unavailable after durable ACK/epoch transition gives no false Node success;
- loss after durable receipt persistence preserves one authoritative receipt;
- signer-off exact retry recovers the same receipt;
- eight concurrent exact retries converge to one epoch/outbox/replay result;
- mismatched/tampered retry fails closed without durable mutation.

#### Outages / restarts

- origin, C2-C and PostgreSQL outages before commit fail closed;
- signer outage after ACK commit preserves `ack_verified` without synthesizing receipt success;
- C2-C/signer restart converges to the one durable receipt;
- origin/C2-C/PostgreSQL restart after receipt durability recovers the same authoritative state and bytes;
- exact recovery still works after the full restart history;
- replay nonce cardinality stays one;
- old and new public-key epochs remain present and unrevoked;
- no host-published ingress/C2-C/origin ports, origin remains network-none, C2-C has no TCP listener, signer keys never mount into C2-C/origin, and the process network remains internal/no-egress.

#### Final transport-negative / no-legacy proof

PR #88 proves every listed transport/identity failure occurs before policy success and leaves the durable `(epoch, ledger state, outbox count, replay count)` tuple unchanged:

- TLS 1.2;
- TLS1.3 classical `X25519`-only negotiation;
- wrong SNI/hostname and unknown/missing SNI;
- untrusted server CA;
- alternate valid ML-DSA client certificate not matching the pinned Node;
- XMESH1-style timestamp/nonce/signature headers on the exact ACK route without authenticated PQ client identity;
- legacy `/api/v1/node/heartbeat` on the dedicated XSP-v2 ingress.

The dedicated ingress includes a strict default TLS listener that rejects unknown/missing SNI. There is no authenticated XMESH1/legacy fallback route on the XSP-v2 ACK boundary.

During this gate, the stricter default vhost exposed a real cross-layer authority bug: Go connected to an internal alias while TLS authenticated the intended `serverName`, but HTTP initially derived `Host` from the connect address. Node PR #33 fixed the shared native ACK/recovery transport by setting HTTP `Host = serverName`; Nexus strict test helpers enforce the same invariant. This keeps TCP routing and authenticated application authority distinct without allowing virtual-host downgrade after TLS success.

A final positive strict-PQ control after the negative matrix commits exactly one authoritative epoch transition, immutable receipt and replay nonce.

## CURRENT P0 — P0-D production-capable Agent workflow

C2-D proved the security/state-machine behavior in isolated staging/process E2E. P0-D is the first gate that may move this behavior toward the actual Agent architecture. It is **not** permission to enable strict PQ in production.

### Completed P0-D foundations and signed lifecycle

#### P0-D1a — immutable Agent release identity — COMPLETE

PR #90 introduced an inert append-only release manifest ledger in PostgreSQL:

`version + sourceRevision + artifactSha256`

The identity is canonical and immutable: one version cannot be rebound to different source/artifact bytes; source revision is a lowercase 40-hex Git commit identity; artifact digest is lowercase 64-hex SHA-256; UPDATE/DELETE/TRUNCATE are rejected. The ledger does not contain a caller-selected URL, script or command and does not authorize download/apply by itself.

#### P0-D1b — atomic binding to existing Agent queue — COMPLETE

PR #91 introduced the DB primitive that resolves one already-approved immutable release and atomically inserts the existing fixed action `update_agent` into the existing single-flight `node_restart_commands` queue with the exact manifest foreign key.

The binding cannot later be attached, removed or replaced via `UPDATE`; once bound, node/action/version/manifest/requester identity is frozen while ordinary lifecycle fields such as pending/claimed/success/failure timestamps/results remain mutable. CI explicitly caught and fixed an early trigger-order bug that had allowed manifest removal, and regression coverage now forbids removal plus post-hoc attachment.

This gate did **not** change the HTTP API, signed poll payload, production Agent or updater execution behavior. No new remote action or second control plane was introduced.

#### P0-D1c — owner-only staging orchestration API — COMPLETE

PR #93 extended the existing `POST /nodes/{id}/agent-update` endpoint rather than creating a parallel control plane. Legacy `{}` requests continue through the preserved pre-D1c implementation. Release selection accepts only a release version and exists only when `XSP_V2_P0D_AGENT_MIGRATION=staging-only` exactly; owner authorization is required before Nexus resolves the approved immutable manifest server-side and calls the existing atomic staging primitive.

The request schema rejects caller-provided digest, URL, URI, script, shell command and executable-location overrides. Unknown releases, disabled gating, unauthorized callers and active-command conflicts fail closed. Disposable API/DB integration proves ordinary admin legacy `{}` behavior remains intact, admin release selection receives 403, unknown release fails closed, digest override is rejected, owner selection is atomically bound to the server-resolved manifest, single-flight remains authoritative, and the migration API disappears again after the gate is restored OFF.

This gate did **not** change signed poll/apply/ACK payloads or Agent/updater execution and did not authorize production activation.

#### Authenticated poll/apply/ACK release identity — COMPLETE

PR #95 carries the exact D1b/D1c manifest identity through the existing authenticated/signed command lifecycle without adding another action or control plane.

For an already-bound staged migration, signed poll returns exact `version`, `sourceRevision` and `artifactSha256`. The installed `node-control-agent.sh` validates exactly those fields, rejects partial/extra/malformed identity, preserves the identity in a root-only local runtime file across the existing fixed `xmesh-node-agent-upgrade.service` apply step, and sends the same identity back in the signed ACK. Nexus authenticates the ACK, row-locks the claimed command, compares the returned identity against the immutable manifest and persists exact ACK identity evidence atomically with the terminal state.

The database trigger keeps ACK evidence immutable and prevents unbound legacy commands from acquiring fabricated release identity. A bound migration cannot be changed to `succeeded` by the historical version-only heartbeat fallback unless exact successful ACK evidence already exists. Disposable integration uses a real generated Ed25519 Node identity and proves legacy identity-free poll/ACK compatibility, exact bound poll identity, heartbeat-only no-success, missing/mismatched ACK rejection without mutation, exact durable ACK evidence, duplicate ACK rejection and restoration of the default-disabled migration gate.

This gate does **not** claim artifact download/digest verification, Go 1.27 production-Agent cutover, strict-PQ transport migration or production activation.

### CURRENT sub-gate — Real Agent integration design / Go 1.27 migration

Define the production-capable Agent architecture before changing the currently deployed Go 1.23 control path.

Required boundary:

- identify exactly which current Go 1.23 Node/Agent/control components are production-deployed and which shell/systemd updater responsibilities must remain, move or disappear;
- reuse the already-proven Go 1.27 XSP-v2 strict transport, permit/ACK/receipt and recovery primitives instead of creating a second protocol/state machine;
- define the supported Go 1.27 build/package/release path and the last-known-good rollback boundary before any apply implementation;
- define explicit mixed-version compatibility rules: an old/new peer mismatch must never silently negotiate XMESH1, Ed25519-only, X25519-only, TLS 1.2 or another weaker path for a migrated operation;
- keep the fixed `update_agent` action and immutable release identity contract established by PR #90/#91/#93/#95;
- keep default production behavior unchanged and `strict-pq` OFF while this design/integration gate is incomplete.

### Remaining P0-D required work after real Agent integration design

1. **Staged download / verify / apply / rollback**
   - separate download/stage/verify/apply/ACK phases;
   - verify exact approved artifact digest/revision before apply;
   - preserve a last-known-good rollback path;
   - never accept caller-selected executable locations or scripts.

2. **Durable Agent state**
   - carry the proven permit/ACK/receipt journal into the real Agent filesystem/state layout;
   - preserve monotonic epoch/replay state across process/host restart;
   - preserve old-key retention until a separately authorized retirement workflow.

3. **Authenticated transport authority**
   - direct connect `address` may be an IP/internal alias;
   - TLS SNI, certificate hostname verification and HTTP authority must all bind to the authenticated `serverName`;
   - no proxy/redirect/legacy fallback may change that authority.

4. **Disposable real Nexus↔Node E2E**
   - start from the actual Agent/update mechanism, not a PoC-only test package;
   - prove migration/update success, retry, lost response, restart and rollback behavior;
   - prove failed PQ/wrong identity/downgrade cannot fall back to XMESH1 for the migrated operation;
   - prove default production deployment remains unchanged until explicit activation approval.

### P0-D acceptance boundary

P0-D is complete only when the production-capable Agent workflow is implemented behind explicit non-default gates, exact-head CI is green, a disposable real Nexus↔Node E2E proves the migration/update lifecycle, fixed-head merge succeeds, and exact post-merge CI is green.

`strict-pq` must still remain **OFF** after P0-D unless a later release/production gate explicitly authorizes it.

## P0-E — recovery/security release gates — BLOCKED

After P0-D, prove the deployment/recovery properties needed before canary/production consideration:

- crash and power-loss during security-state transitions;
- filesystem/database snapshot and anti-rollback behavior;
- backup/restore of DB plus persistent security identities;
- owner-authorized key rotation and recovery, including retirement policy;
- parser/protocol fuzzing and FIPS 204 / algorithm known-answer validation where applicable;
- independent security review of the final migration/production architecture;
- operational observability without secret/key leakage.

## Production rollout — NOT AUTHORIZED

No production activation is authorized by C2-D completion or by the P0-D foundations and signed identity lifecycle, including the default-disabled D1c staging API.

Before production rollout:

1. P0-D must be complete;
2. P0-E must be complete;
3. a disposable canary must prove install/upgrade/rollback/recovery/observability;
4. production topology/DNS/firewall/Nginx/DB/key changes require a separately reviewed rollout plan;
5. `strict-pq` activation and legacy XMESH1 retirement require explicit approval and must never occur as an automatic fallback/migration side effect.

## Security guardrails

- `strict-pq` remains **OFF**.
- Production Agent remains on the deployed legacy control path until P0-D/P0-E and later rollout gates explicitly authorize replacement.
- P0-D1a/P0-D1b/P0-D1c plus PR #95's signed release-identity lifecycle are bounded staging foundations; release selection remains disabled by default and none authorize production migration.
- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate validation.
- A GitHub merge is not a production deployment.
- Xray remains the user VPN data-plane.
- Historical/archive documents do not override this roadmap.

## Engineering process

For every security-sensitive gate:

`current verified main → focused branch → one bounded gate → positive/negative/failure tests → PR → exact-head CI/review → fixed-head merge → exact post-merge CI → README/Roadmap checkpoint → branch cleanup → next gate`

Do not weaken strict Clippy, freshness/TTL, trust binding, topology isolation or test assertions merely to obtain green CI.