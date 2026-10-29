# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 29 October 2026

This file defines the **current order of work**. Historical roadmaps/checkpoints under [`archive/`](archive/) do **not** override this document.

A green test proves only its stated boundary. Code existence ≠ E2E ≠ security review ≠ production deployment.

## Verified source checkpoints

- **Latest Nexus P0-D implementation checkpoint:** [`e63161a0cf3bfeba7eac7e0cd8f801ba4f07dbd9`](https://github.com/TriplexCorp/XMesh-Nexus/commit/e63161a0cf3bfeba7eac7e0cd8f801ba4f07dbd9), merge of [PR #101](https://github.com/TriplexCorp/XMesh-Nexus/pull/101).
- **P0-D1a / PR #90:** immutable append-only Agent release identity `{version, sourceRevision, artifactSha256}` in PostgreSQL. Version/source/artifact identity cannot be rebound; UPDATE/DELETE/TRUNCATE are rejected. No production execution path was activated.
- **P0-D1b / PR #91:** an approved immutable release identity can be atomically bound to the existing fixed-action `update_agent` single-flight command queue. Binding attach/remove/replace after row creation is rejected; normal lifecycle state transitions remain legal.
- **P0-D1c / PR #93:** the existing `POST /nodes/{id}/agent-update` control plane gained an owner-only release-selection mode behind exact non-default `XSP_V2_P0D_AGENT_MIGRATION=staging-only`. Callers select only an approved version; Nexus resolves immutable source revision/artifact digest server-side and stages the existing fixed `update_agent` action. Legacy `{}` behavior remains unchanged and caller digest/URL/script/command input is rejected.
- **Authenticated poll/apply/ACK release identity / PR #95:** already-bound `update_agent` commands carry exact immutable `{version, sourceRevision, artifactSha256}` through the existing signed poll/apply/ACK lifecycle. Nexus row-locks the claimed command, compares ACK identity with the immutable manifest and atomically persists terminal state plus exact ACK evidence. Missing/mismatched identity fails closed; a matching-version heartbeat cannot synthesize success for a bound migration; legacy unbound commands remain identity-free and compatible.
- **Real Agent integration design / PR #97 + PR #98 + PR #99:** the production deployment split and Go 1.27 migration boundary are documented and machine-checked. The root XMesh-Node Go 1.23 module remains the edge router; the existing shell/systemd control Agent remains the fixed remote-action authority; XMesh-Node `agent/xspv2` is the production-capable side-by-side Agent integration/artifact boundary on Go 1.27.3; `security/xspv2/poc-go` is its reused strict-XSP-v2 primitive/state-machine dependency.
- **Exact staged Agent build identity / Node PR #36:** XMesh-Node checkpoint [`5b810d9d0864e6c22fa0c0d176982ef4cbf04b20`](https://github.com/TriplexCorp/XMesh-Node/commit/5b810d9d0864e6c22fa0c0d176982ef4cbf04b20) embeds machine-readable `{version, sourceRevision}` into the Go 1.27 Agent artifact so Nexus/Node can verify the actual bytes rather than trust only sidecar metadata.
- **Staged download / verify / apply / rollback / PR #101:** the existing signed restart-poll boundary now serves content-addressed Agent bytes only for an already-claimed manifest-bound `update_agent`. Nexus re-hashes server-controlled bytes before delivery. The Node verifies exact SHA-256, embedded `{version, sourceRevision}` and Agent self-check before switching; stores packages side-by-side under `/var/lib/xmesh-agent/releases/<sha256>`; keeps durable security state under `/var/lib/xmesh-agent/xsp-v2`; re-verifies the rollback target; atomically changes `current`; and restores the prior pointer on post-switch failure. Bound updates still use the existing `xmesh-node-agent-upgrade.service`, which dispatches locally to a pre-installed hardened stage unit before the legacy moving-main path. The shell `xmesh-node-control.service` remains production control authority.
- On exact merge SHA `e63161a0cf3bfeba7eac7e0cd8f801ba4f07dbd9`, [Backend CI #3585](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40821457533) completed **success**, including staged positive apply, digest mismatch rejection, embedded identity mismatch rejection, rollback-on-post-switch-failure, strict Clippy/pedantic/nursery, installer/Compose validation, Docker build and disposable PostgreSQL/API authentication integration.
- On the same exact SHA, [XSP-v2 Crypto PoC #204](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40821457856), [Node GeoData and Routing #806](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40821457485) and [Managed dual inbound regression #162](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40821457439) all completed **success**; Crypto includes the isolated signer Unix-socket process-boundary E2E.
- **Completed C2-D implementation checkpoint:** [`7e0b42ea4847b273ba8cd55a0ff3e043a420c377`](https://github.com/TriplexCorp/XMesh-Nexus/commit/7e0b42ea4847b273ba8cd55a0ff3e043a420c377), merge of [PR #88](https://github.com/TriplexCorp/XMesh-Nexus/pull/88). PR #88 closed the final C2-D2 integrated transport-negative / no-legacy-fallback proof at the real ACK-operation boundary; its exact post-merge matrix remains valid within that stated isolated staging/process scope.
- **XMesh-Node transport authority checkpoint:** [`0ae78244ef0ef763bea6ce198dde6e83eb11ff1f`](https://github.com/TriplexCorp/XMesh-Node/commit/0ae78244ef0ef763bea6ce198dde6e83eb11ff1f), merge of Node PR #33. Node PR #33 binds HTTP authority to the same authenticated `serverName` used for TLS SNI/certificate verification while retaining a separate direct TCP connect `address`.
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
| Real Agent integration design / Go 1.27 migration | **COMPLETE — staging/architecture + source contract** | PR #97 + #98 + #99 + Node PR #36; side-by-side Go 1.27 Agent boundary and exact build identity machine-checked |
| Staged download / verify / apply / rollback | **COMPLETE — staging/package lifecycle** | PR #101; signed manifest-bound content-addressed delivery, exact digest/build identity, pre-verified last-known-good, atomic package pointer, rollback and exact post-merge matrix green |
| **Durable Agent state** | **CURRENT P0 sub-gate** | Carry proven permit/ACK/receipt journals into real Agent state; preserve monotonic epoch/replay floors across process/host restart; retain old keys until separately authorized retirement |
| **P0-D production-capable Agent workflow** | **CURRENT P0** | Complete durable state, authenticated authority and disposable Nexus↔Node E2E |
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

### Completed P0-D foundations and package lifecycle

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

The database trigger keeps ACK evidence immutable and prevents unbound legacy commands from acquiring fabricated release identity. A bound migration cannot be changed to `succeeded` by the historical version-only heartbeat fallback unless exact successful ACK evidence already exists.

#### Real Agent integration design / Go 1.27 migration — COMPLETE

PR #97 mapped the actual deployed architecture and fixed the migration invariants. The root XMesh-Node Go 1.23 module is the edge router/data-path front end, not the signed control Agent. The production control/update authority remains the installed shell/systemd path (`xmesh-node-control`, `xmesh-update-agent`, `xmesh-node-agent-upgrade.service`) until a later explicit cutover.

PR #98 introduced a machine-readable Go 1.27 integration contract and CI that checks the exact Node source rather than relying only on prose. PR #99 reconciled the concurrent design views: `agent/xspv2` is the Go 1.27.3 production-capable side-by-side Agent integration/artifact boundary, and its `go.mod` plus runtime bridge must reuse `security/xspv2/poc-go` and the existing `cutover` implementation instead of copying the security state machine. Node PR #36 then embedded exact build identity in that artifact.

The contract requires one fixed remote action (`update_agent`), immutable release identity, private state root `/var/lib/xmesh-agent/xsp-v2`, no second command queue/listener, explicit mixed-version fail-closed behavior, authenticated `Address`/`ServerName` separation, and a complete last-known-good rollback boundary before apply. Rollback may restore package/service state but must not roll epoch/replay floors backwards, delete durable ACK/receipt evidence or regenerate enrollment identities automatically.

#### Staged download / verify / apply / rollback — COMPLETE

PR #101 implemented the first real package lifecycle for an approved Go 1.27 Agent artifact without broadening the remote command surface or changing default production control authority.

The completed boundary is:

- the existing signed `/api/v1/node/restart/poll` request gained only `artifactVersion`; no new remote action or second Agent artifact/control endpoint was created;
- artifact bytes are available only after the existing `update_agent` command is already `claimed` and bound to the same immutable manifest version;
- the API reads from a server-controlled content-addressed artifact store and re-computes SHA-256 before returning bytes; caller URL, URI, script, shell command and executable path remain impossible inputs;
- standard Compose exposes the staging store to Nexus read-only while `XSP_V2_P0D_AGENT_MIGRATION` remains default-off;
- XMesh-Node PR #36's embedded `{version, sourceRevision}` identity plus the manifest `artifactSha256` are verified before activation, together with the Go Agent state self-check;
- packages are immutable side-by-side slots under `/var/lib/xmesh-agent/releases/<sha256>` and durable security state is kept separately under `/var/lib/xmesh-agent/xsp-v2`;
- the previous Go package, when present, is re-hashed, identity-checked and self-checked before it may become the rollback target; the first Go package records the deployed shell control Agent as the last-known-good control authority;
- activation changes only an atomic `current` symlink after pre-verification, and a failed post-switch self-check restores the prior package pointer;
- bound remote updates still enter through the existing fixed `xmesh-node-agent-upgrade.service`; its updater sees the root-only release identity and dispatches to a pre-installed hardened staged unit **before** any legacy moving-main fetch;
- signed ACK success for a bound migration requires re-verification of exact active package digest/build identity; legacy identity-free `{}` updates retain their previous shell-Agent version verification and path;
- the shell `xmesh-node-control.service` remains production control authority, so this gate is package staging/selection rather than production Go-Agent cutover;
- `strict-pq` remains OFF.

The exact-head and exact post-merge CI both exercise positive first/second apply, wrong digest rejection, embedded build-identity mismatch rejection and rollback after a post-switch self-check failure. Package rollback never replaces or rewinds the durable `/var/lib/xmesh-agent/xsp-v2` state root.

### CURRENT sub-gate — Durable Agent state

Carry the already-proven C2-D permit/ACK/receipt durability semantics into the real production-capable Agent filesystem/state boundary before any control-authority cutover.

Required boundary:

- reuse the existing Go 1.27 `agent/xspv2` → `security/xspv2/poc-go` state implementation rather than creating a second journal or security state machine;
- define the authoritative real-Agent filesystem layout under `/var/lib/xmesh-agent/xsp-v2` for permit journal, applied ACK evidence, immutable receipt bytes, replay state, key epochs and candidate/current/retained keys;
- every security-critical state write must be atomic/durable enough to survive process restart and host restart without accepting a replay or rolling a monotonic epoch/replay floor backwards;
- exact committed permit/ACK/receipt evidence must survive package upgrades and package-pointer rollback because versioned package slots are not authoritative security state;
- stale/missing/corrupt local security state must fail closed; it must never trigger XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure-certificate fallback for a migrated operation;
- preserve old-key retention after successful epoch change until a separately owner-authorized retirement workflow exists; package rollback or restart must not implicitly delete or reactivate key epochs;
- preserve exact receipt recovery semantics: a durable receipt is authoritative, exact retries recover the same bytes, and restart must not cause re-signing or a second epoch transition;
- define and test crash/restart points around local permit journal, ACK send, receipt persistence and state promotion, while keeping this P0-D gate bounded to normal process/host restart rather than P0-E power-loss/snapshot claims;
- state permissions/ownership must remain private to the Agent boundary and must not expose enrollment/signing keys or durable protocol evidence to unrelated services;
- default production deployment/control authority remains the shell Agent and `strict-pq` remains OFF until later gates authorize cutover.

### Remaining P0-D required work after Durable Agent state

1. **Authenticated transport authority**
   - direct connect `address` may be an IP/internal alias;
   - TLS SNI, certificate hostname verification and HTTP authority must all bind to the authenticated `serverName`;
   - no proxy/redirect/legacy fallback may change that authority.

2. **Disposable real Nexus↔Node E2E**
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

No production activation is authorized by C2-D completion or by the P0-D foundations, signed identity lifecycle, integration design or staged package lifecycle.

Before production rollout:

1. P0-D must be complete;
2. P0-E must be complete;
3. a disposable canary must prove install/upgrade/rollback/recovery/observability;
4. production topology/DNS/firewall/Nginx/DB/key changes require a separately reviewed rollout plan;
5. `strict-pq` activation and legacy XMESH1 retirement require explicit approval and must never occur as an automatic fallback/migration side effect.

## Security guardrails

- `strict-pq` remains **OFF**.
- Production Agent remains on the deployed legacy control path until P0-D/P0-E and later rollout gates explicitly authorize replacement.
- P0-D1a/P0-D1b/P0-D1c, PR #95's signed release-identity lifecycle, PR #97/#98/#99's integration-design contracts and PR #101's staged package lifecycle are bounded staging foundations; release selection remains disabled by default and none authorize production migration.
- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate validation.
- A GitHub merge is not a production deployment.
- Xray remains the user VPN data-plane.
- Historical/archive documents do not override this roadmap.

## Engineering process

For every security-sensitive gate:

`current verified main → focused branch → one bounded gate → positive/negative/failure tests → PR → exact-head CI/review → fixed-head merge → exact post-merge CI → README/Roadmap checkpoint → branch cleanup → next gate`

Do not weaken strict Clippy, freshness/TTL, trust binding, topology isolation or test assertions merely to obtain green CI.