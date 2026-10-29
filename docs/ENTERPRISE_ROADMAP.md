# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 29 October 2026

This file defines the **current order of work**. Historical roadmaps/checkpoints under [`archive/`](archive/) do **not** override this document.

A green test proves only its stated boundary. Code existence ≠ E2E ≠ security review ≠ production deployment.

## Verified source checkpoints

- **Latest completed Nexus P0-E recovery/security checkpoint:** [`f9a9c636f83a3a2ef7122fef7c3f3bc2bc76b7d4`](https://github.com/TriplexCorp/XMesh-Nexus/commit/f9a9c636f83a3a2ef7122fef7c3f3bc2bc76b7d4), merge of [PR #109](https://github.com/TriplexCorp/XMesh-Nexus/pull/109). P0-E2b proves one-sided PostgreSQL snapshot rollback against a current Agent receipt witness with restore-time database privilege re-hardening. Coordinated Agent + Nexus/PostgreSQL rollback remains outside this gate.
- **P0-E2b / PR #109:** a disposable real `pg_dump` / drop+create / `pg_restore` boundary restores PostgreSQL to the exact pre-ACK tuple while the Agent journal remains current. The first restore exposed default database-level privilege drift; the recovery contract now re-applies the reviewed idempotent signer/C2-C least-privilege provisioning, requires CREATE/TEMP/public-schema CREATE removal and proves re-hardening does not mutate XSP-v2 security state. The current Agent keeps its first authoritative dual-signed receipt immutable and rejects silent replacement after server rollback.
- On exact Nexus merge SHA `f9a9c636f83a3a2ef7122fef7c3f3bc2bc76b7d4`, [XSP-v2 P0-E2b PostgreSQL Snapshot Rollback #6](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40846810762) completed **success**, including the real PostgreSQL restore boundary, restore-time ACL re-hardening and current-Agent receipt witness.
- **P0-E2a / Node PR #39 + Nexus PR #108:** current XMesh-Node checkpoint [`3fffa9fd74195114a7c4e573a8a11e075c84f403`](https://github.com/TriplexCorp/XMesh-Node/commit/3fffa9fd74195114a7c4e573a8a11e075c84f403), merge of Node PR #39, proves a complete locally self-consistent old Agent state-root snapshot fails closed before real network I/O when the unchanged current dual-signed Nexus permit is re-delivered. Nexus PR #108 pins that exact Node proof. Coordinated Node + Nexus/PostgreSQL rollback is explicitly unproven by this gate.
- **P0-E1a / Node PR #38 + Nexus PR #107:** Node checkpoint [`8a86227f369aed2e6e952f1e41af52c7414aa4e3`](https://github.com/TriplexCorp/XMesh-Node/commit/8a86227f369aed2e6e952f1e41af52c7414aa4e3) proves hard process termination at the critical keyring durability checkpoints around retained previous identity, monotonic epoch floor and active-vault replacement. Nexus PR #107 pins the exact source contract. This is process/filesystem fsync-order evidence only; physical power removal, controller-cache and storage-firmware behavior remain unproven.
- **Latest completed Nexus P0-D implementation checkpoint:** [`698d5e43d59c0c95532d513b39d95e42a2af4f20`](https://github.com/TriplexCorp/XMesh-Nexus/commit/698d5e43d59c0c95532d513b39d95e42a2af4f20), merge of [PR #105](https://github.com/TriplexCorp/XMesh-Nexus/pull/105).
- **P0-D1a / PR #90:** immutable append-only Agent release identity `{version, sourceRevision, artifactSha256}` in PostgreSQL. Version/source/artifact identity cannot be rebound; UPDATE/DELETE/TRUNCATE are rejected. No production execution path was activated.
- **P0-D1b / PR #91:** an approved immutable release identity can be atomically bound to the existing fixed-action `update_agent` single-flight command queue. Binding attach/remove/replace after row creation is rejected; normal lifecycle state transitions remain legal. No HTTP/API caller, poll payload or Agent/updater execution changed in this gate.
- **P0-D1c / PR #93:** the existing `POST /nodes/{id}/agent-update` control plane gained an owner-only release-selection mode behind exact non-default `XSP_V2_P0D_AGENT_MIGRATION=staging-only`. Callers select only an approved version; Nexus resolves immutable source revision/artifact digest server-side and stages the existing fixed `update_agent` action. Legacy `{}` behavior remains unchanged and caller digest/URL/script/command input is rejected.
- **Authenticated poll/apply/ACK release identity / PR #95:** already-bound `update_agent` commands carry exact immutable `{version, sourceRevision, artifactSha256}` through the existing signed poll/apply/ACK lifecycle. The installed shell Agent validates and preserves the exact identity across the existing fixed updater service and returns it in the signed ACK. Nexus row-locks the claimed command, compares ACK identity with the immutable manifest and atomically persists terminal state plus exact ACK evidence. Missing/mismatched identity fails closed; a matching-version heartbeat cannot synthesize success for a bound migration; legacy unbound commands remain identity-free and compatible.
- **Real Agent integration design / PR #97 + PR #98 + PR #99:** the production deployment split and Go 1.27 migration boundary are documented and machine-checked. The root XMesh-Node Go 1.23 module remains the edge router; the existing shell/systemd control Agent remains the fixed remote-action authority; XMesh-Node `agent/xspv2` is the production-capable side-by-side Agent integration/artifact boundary on Go 1.27.3 and reuses `security/xspv2/poc-go` rather than copying the security state machine.
- **Staged download / verify / apply / rollback / PR #101:** approved Go 1.27 Agent bytes are delivered only from the server-controlled content-addressed artifact source through the existing signed control plane. The staged helper verifies exact manifest SHA-256 and embedded `{version, sourceRevision}` before activation, retains last-known-good state, switches atomically and restores package/service state on failure without rewinding durable security state. Caller URL/path/script input remains impossible; production activation stays disabled by default.
- **Disposable real Nexus↔Node migration/update E2E + retry recovery / PR #103:** manifest-bound claimed commands may be redelivered after a lost signed poll response within the bounded migration window, while a completed bound ACK may be replayed idempotently only when success/failure, detail and release identity exactly match durable evidence. The disposable E2E builds real pinned Go 1.27.3 Node Agent artifacts, proves signed claim/download/apply/ACK, exact lost-response retry, restart/idempotent apply, deterministic last-known-good rollback, security-state-root preservation, non-exact replay rejection and restoration of the default-disabled production gate.
- **Durable real-Agent security state + authenticated authority / Node PR #37 + Nexus PR #105:** XMesh-Node `agent/xspv2` persists the proven key/cutover state under the private Agent root, uses exact applied-rotation attestation before network exchange, preserves monotonic epoch/replay floors and retained old/new key snapshots across restart, and rejects stale/corrupt/rolled-back state. Nexus pins the exact merged Node source and machine-checks the reused strict transport: direct connect `Address` remains separate from authenticated `ServerName`, while TLS SNI/certificate verification and HTTP Host remain bound to `ServerName`; proxy use and redirects are rejected.
- On exact Nexus merge SHA `698d5e43d59c0c95532d513b39d95e42a2af4f20`, [Backend CI #3605](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40835127285) completed **success**, including the pinned current-Node durable-state/authority contract, strict Clippy/pedantic/nursery, Docker build and disposable PostgreSQL/API authentication integration.
- The prior disposable migration/update proof on `7df13962aae871f04677b47e0f05a7f6ab906e72` remains [real Agent E2E #10](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40827536439) — **success** for real Go 1.27.3 apply, lost-response retry, restart, deterministic rollback and restoration of the default-disabled production gate.
- **Current XMesh-Node durable Agent state / authority checkpoint:** [`5e8ee562915a570eb49ed46d59d723f233f3cc68`](https://github.com/TriplexCorp/XMesh-Node/commit/5e8ee562915a570eb49ed46d59d723f233f3cc68), merge of Node PR #37. Exact post-merge [Agent Artifact #11](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40832589401) and [Node CI #463](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40832589436) both completed **success**.
- **Completed C2-D implementation checkpoint:** [`7e0b42ea4847b273ba8cd55a0ff3e043a420c377`](https://github.com/TriplexCorp/XMesh-Nexus/commit/7e0b42ea4847b273ba8cd55a0ff3e043a420c377), merge of [PR #88](https://github.com/TriplexCorp/XMesh-Nexus/pull/88). PR #88 closed the final C2-D2 integrated transport-negative / no-legacy-fallback proof at the real ACK-operation boundary; its exact post-merge matrix remains valid within that stated isolated staging/process scope.
- **XMesh-Node original transport authority checkpoint:** [`0ae78244ef0ef763bea6ce198dde6e83eb11ff1f`](https://github.com/TriplexCorp/XMesh-Node/commit/0ae78244ef0ef763bea6ce198dde6e83eb11ff1f), merge of Node PR #33. Node PR #33 binds HTTP authority to the same authenticated `serverName` used for TLS SNI/certificate verification while retaining a separate direct TCP connect `address`.
- Prior Nexus checkpoints remain valid within their stated boundaries: C2-D2 outage/restart `a756f1ac…` (#86), transport alignment `86e01727…` (#84), lost-response/race `39e1589c…` (#82), expired recovery `5acccfa1…` (#77), D1 `037290bb…` (#73), C2-C `37b9e49d…` (#71), plus signer P0 (#61), C1 (#64), C2-A (#66) and C2-B (#69).

## Binding XSP-v2 target invariant

The finished XSP-v2 control plane has one policy: **fail closed**.

All are mandatory:

1. **Transport:** TLS 1.3 with actually negotiated `X25519MLKEM768`, trusted certificate chain, correct hostname/SNI, application authority bound to the authenticated server name, and no unreviewed weaker hop.
2. **Messages:** Ed25519 **AND** ML-DSA-65 verification for every security-critical XSP/2 message.
3. **Binding/state:** exact sender/recipient, direction, method/path, payload/revision, request ID, nonce, key epoch and expiry; durable replay protection and monotonic security state.
4. **Key custody/enrollment:** verified owner authorization, proof of possession, pinned trust roots and protected private-key boundaries.
5. **Failure:** missing PQ support, invalid signature/certificate/state, stale epoch, replay or unavailable security component means reject — never automatic fallback to `XMESH1`, Ed25519-only, X25519-only, TLS 1.2 or insecure verification.

`strict-pq` remains **OFF** in production. Legacy `XMESH1` remains the deployed control-plane reality until separately approved P0-E and rollout/release gates replace it. Xray remains the user VPN data-plane.

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
| Real Agent integration design / Go 1.27 migration | **COMPLETE — staging/architecture + source contract** | PR #97 + #98 + #99; `agent/xspv2` wrapper over reused XSP-v2 primitives, rollback/no-downgrade contract fixed |
| Staged download / verify / apply / rollback | **COMPLETE — staging/artifact lifecycle** | PR #101; content-addressed server-controlled source, exact digest + embedded revision verification, atomic activation, last-known-good rollback |
| Disposable real Nexus↔Node Agent migration/update E2E | **COMPLETE — staging/real Agent E2E** | PR #103; real Go 1.27 artifacts, signed lifecycle, lost-response retry, restart, rollback, durable ACK evidence, default production gate restored OFF |
| Durable real-Agent security state + authenticated authority binding | **COMPLETE — production-capable/default-disabled Agent boundary** | Node PR #37 + Nexus PR #105; durable exact rotation attestation, monotonic floors/retained keys across restart, fail-closed corruption/rollback, authenticated `Address`/`ServerName` separation with no proxy/redirect |
| **P0-D production-capable Agent workflow** | **COMPLETE — default-disabled, not production activated** | Acceptance boundary satisfied by PR #90/#91/#93/#95/#97/#98/#99/#101/#103/#105 + Node PR #37; `strict-pq` stays OFF |
| P0-E1a process-crash / fsync-order durability | **COMPLETE — bounded process/filesystem proof** | Node PR #38 + Nexus PR #107; hard process-crash checkpoints and restart/recovery. Physical power-loss/controller-cache behavior remains unproven |
| P0-E2a one-sided Agent snapshot anti-rollback | **COMPLETE — bounded one-sided rollback proof** | Node PR #39 + Nexus PR #108; restored old Agent state rejected against current unchanged Nexus permit before network I/O |
| P0-E2b one-sided PostgreSQL snapshot rollback | **COMPLETE — disposable real DB restore proof** | PR #109; real `pg_dump`/`pg_restore`, restore ACL re-hardening, current-Agent immutable receipt witness |
| **P0-E3a owner/off-host monotonic recovery checkpoint** | **CURRENT sub-gate** | Introduce an independent non-rolled-back owner/off-host trust domain that binds Agent identity and Nexus/PostgreSQL security state; prove coordinated rollback detection without automatic reset/bypass |
| **P0-E recovery/security release gates** | **CURRENT P0** | E1a/E2a/E2b complete within bounded scopes; still requires P0-E3a, physical power-loss proof, complete backup/restore, owner-authorized recovery + old-key retirement, fuzz/KAT, independent review and observability |
| Production XSP-v2 rollout | **NOT AUTHORIZED** | P0-E + disposable canary + explicit production approval required |

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

## P0-D production-capable Agent workflow — COMPLETE

C2-D proved the security/state-machine behavior in isolated staging/process E2E. P0-D moved that proven behavior into the production-capable Agent architecture behind explicit non-default gates. P0-D completion is **not** permission to enable strict PQ in production.

### Completed P0-D foundations, signed lifecycle and real package/E2E gates

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

#### Real Agent integration design / Go 1.27 migration — COMPLETE

PR #97 mapped the actual deployed architecture and fixed the migration invariants. The root XMesh-Node Go 1.23 module is the edge router/data-path front end, not the signed control Agent. The production control/update authority remains the installed shell/systemd path (`xmesh-node-control`, `xmesh-update-agent`, `xmesh-node-agent-upgrade.service`) until a later explicit cutover.

PR #98 introduced a machine-readable Go 1.27 integration contract and CI that checks the exact Node source rather than relying only on prose. PR #99 reconciled the concurrent design views against the real wrapper/primitives boundary: `agent/xspv2` is the Go 1.27.3 production-capable side-by-side Agent integration/artifact boundary and must reuse `security/xspv2/poc-go` plus the existing `cutover` implementation instead of copying the security state machine.

The contract requires one fixed remote action (`update_agent`), immutable release identity, private state root `/var/lib/xmesh-agent/xsp-v2`, no second command queue/listener, explicit mixed-version fail-closed behavior, authenticated `Address`/`ServerName` separation, and a complete last-known-good rollback boundary before apply. Rollback may restore package/service state but must not roll epoch/replay floors backwards, delete durable ACK/receipt evidence or regenerate enrollment identities automatically.

#### Staged download / verify / apply / rollback — COMPLETE

PR #101 implemented the first real package lifecycle for an approved Go 1.27 Agent artifact without broadening the remote command surface. Artifact bytes come only from the server-controlled content-addressed source bound to the immutable manifest and are fetched over the existing signed control plane. The request/command still cannot carry a caller-selected URL, URI, script, shell command or executable path.

The helper stages into a private inactive path, verifies the exact approved `artifactSha256`, executes the real binary identity self-check and requires embedded version/source revision to equal the immutable manifest before changing active state. It retains last-known-good package/service identity, performs an atomic current-pointer switch and rolls package/service state back on post-switch failure while leaving the durable security-state root untouched. Legacy unbound update behavior remains distinct and compatible. Default production activation is unchanged and `strict-pq` remains OFF.

#### Disposable real Nexus↔Node migration/update E2E + lost-response recovery — COMPLETE

PR #103 closed the disposable real-Agent lifecycle proof on top of PR #101. It also fixed two real lost-response gaps while keeping the staged runtime baseline reviewed separately: a manifest-bound command already in `claimed` may be redelivered for the bounded migration window after a lost poll response/Agent restart, and an already-completed manifest-bound ACK may return idempotent duplicate success only if the retry exactly matches durable success/failure, detail and release identity evidence. Legacy unbound claimed commands and legacy duplicate-ACK behavior remain unchanged.

The exact E2E checks out pinned XMesh-Node `5b810d9d0864e6c22fa0c0d176982ef4cbf04b20`, builds two real Go 1.27.3 Agent binaries with different release versions and embedded exact source identity, publishes them into the Nexus content-addressed source, starts a disposable Nexus with the staging-only migration gate, and proves real signed migration/update success, lost-poll redelivery, exact ACK replay, mismatch rejection, restart/idempotent apply and deterministic rollback to the exact previous Agent. The rollback proof also verifies that the durable security-state root is not replaced or rewound. The test then restores and proves the default production gate disabled.

#### Durable real-Agent security state + authenticated authority binding — COMPLETE

Node PR #37 moved the proven durable key/cutover semantics into the real `agent/xspv2` state layout without copying the security state machine. The Agent keeps keyring and cutover journals under the private state root, retains exact old/new key snapshots, and uses the existing applied-rotation attestation to prove the active vault, exact monotonic floor and `.next`/`.previous` evidence agree before `Exchange` or `Recover` may reach the network.

Restart tests prove repeated `Prepare()` leaves the persisted master/vault/floor/old/new material byte-for-byte stable. Rollback/corruption negatives prove an old vault, lowered/corrupt floor or missing retained old-key snapshot fails closed instead of resetting the security epoch/replay boundary. Release/package identity remains separate from this monotonic security state, so package rollback cannot reinterpret old state as current authorization.

Nexus PR #105 upgrades the machine-readable cross-repo Agent contract to pin exact merged Node `5e8ee562915a570eb49ed46d59d723f233f3cc68` and checks the real Node sources/tests in CI. It also checks the reused strict transport keeps direct TCP `Address` separate from authenticated `ServerName`, binds TLS SNI/certificate verification and HTTP Host to `ServerName`, disables environment proxy use and rejects redirects. No alternate host, proxy, redirect or legacy route can silently change authority after the migrated XSP-v2 path is entered.

### P0-D acceptance boundary — SATISFIED

P0-D is complete: the production-capable Agent workflow exists behind explicit non-default gates; exact signed release identity propagates through poll/apply/ACK; real package bytes are content-addressed and verified by digest plus embedded revision; last-known-good rollback is atomic and does not rewind durable security state; disposable real Nexus↔Node E2E proves migration/update success, retry, lost response, restart and rollback; durable real-Agent security state and authenticated transport authority are proven; fixed-head merges and exact post-merge CI are green.

`strict-pq` remains **OFF** after P0-D. P0-D completion does not authorize production activation or replacement of the deployed legacy control Agent.

## CURRENT P0 — P0-E recovery/security release gates

### Completed P0-E sub-gates

#### P0-E1a — process-crash / fsync-order durability — COMPLETE

Node PR #38 and Nexus PR #107 prove deterministic restart/recovery across hard process termination at the local rotation durability boundaries. The proof exercises crashes after durable retention of the old active identity, after the monotonic epoch floor advances and after the active vault replacement, plus recovery-path crash checkpoints. Durable writes require file fsync, atomic rename and parent-directory fsync before the next security transition can be treated as committed.

The crash injector is test-only and excluded from the normal Agent build. This gate is intentionally bounded: it does not claim physical power removal, controller/cache flush behavior, storage firmware guarantees, snapshot anti-rollback, complete backup/restore or production rollout.

#### P0-E2a — one-sided Agent snapshot anti-rollback — COMPLETE

Node PR #39 and Nexus PR #108 restore a complete old Agent state root that is locally self-consistent, while the current Nexus state and unchanged current dual-signed permit remain outside the rollback domain. The real `agent/xspv2` runtime must attest the exact applied rotation before `Exchange` or `Recover`; the old snapshot cannot satisfy the current permit and fails closed before TCP/network I/O.

This proves one-sided Agent rollback only. A coordinated rollback of both the Agent state and Nexus/PostgreSQL to mutually consistent old snapshots requires a separate non-rolled-back authority.

#### P0-E2b — one-sided PostgreSQL snapshot rollback — COMPLETE

PR #109 reverses the failure domain. It takes a real custom-format `pg_dump` while the durable server tuple is exactly pre-ACK, commits through the normal strict-PQ ACK path, persists the first verified dual-signed receipt in the Agent journal, then drops/recreates/restores PostgreSQL while leaving the Agent journal current.

The restore must re-establish the reviewed least-privilege signer/C2-C database roles before the security sidecars restart. The proof requires that ACL re-hardening itself not mutate the XSP-v2 epoch/ledger/outbox/replay tuple. After restore, exact ACK replay can only converge if the server reproduces the same authoritative receipt; a different otherwise-valid re-signed receipt is rejected by the current Agent without replacing its first journaled evidence.

This proves one-sided PostgreSQL rollback with an independent current-Agent witness. It does **not** prove coordinated rollback detection, complete backup-set correctness or owner-authorized disaster recovery.

### CURRENT sub-gate — P0-E3a owner/off-host monotonic recovery checkpoint

P0-E3a must add an **independent, non-rolled-back owner/off-host trust domain**. That domain must bind a monotonic recovery checkpoint to the Agent security identity and the Nexus/PostgreSQL security state closely enough to detect a coordinated rollback where both sides are restored to mutually consistent old snapshots.

P0-E3a must preserve all existing fail-closed rules:

- no automatic epoch/replay reset;
- no automatic key regeneration or enrollment replacement;
- no caller-selected weaker transport or legacy fallback;
- no second hidden security state machine that can disagree with the existing Agent/Nexus journals;
- recovery authorization must be explicit, auditable and cryptographically bound to the exact security identity/state being recovered;
- `strict-pq` stays OFF and no production topology is activated by this gate.

After P0-E3a, P0-E still must close:

1. physical power-loss / storage-controller-cache behavior beyond P0-E1a's bounded process-crash/fsync proof;
2. complete backup/restore of PostgreSQL together with persistent signing/encryption/Agent identities and coordinated restore/recovery procedures;
3. owner-authorized key rotation/recovery and explicit old-key retirement policy;
4. parser/protocol fuzzing plus FIPS 204 / algorithm known-answer validation where applicable;
5. independent security review of the final migration/production architecture;
6. operational observability without secret/key leakage.

Completion of individual P0-E items does not authorize production rollout. `strict-pq` remains OFF unless a later explicit release/production gate separately authorizes activation.

## Production rollout — NOT AUTHORIZED

No production activation is authorized by C2-D, P0-D or the completed bounded P0-E1a/P0-E2a/P0-E2b proofs.

Before production rollout:

1. P0-D must remain complete with its fail-closed invariants intact;
2. P0-E must be complete;
3. a disposable canary must prove install/upgrade/rollback/recovery/observability;
4. production topology/DNS/firewall/Nginx/DB/key changes require a separately reviewed rollout plan;
5. `strict-pq` activation and legacy XMESH1 retirement require explicit approval and must never occur as an automatic fallback/migration side effect.

## Security guardrails

- `strict-pq` remains **OFF**.
- Production Agent remains on the deployed legacy control path until P0-E and later rollout gates explicitly authorize replacement.
- Completed P0-D gates through Node PR #37 and Nexus PR #105, plus bounded P0-E1a/P0-E2a/P0-E2b evidence, remain default-disabled foundations/proofs; none authorize production migration.
- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate validation.
- P0-E2a and P0-E2b do not detect coordinated rollback when all local witnesses are rolled back together; P0-E3a exists specifically to add an independent non-rolled-back recovery authority.
- A GitHub merge is not a production deployment.
- Xray remains the user VPN data-plane.
- Historical/archive documents do not override this roadmap.

## Engineering process

For every security-sensitive gate:

`current verified main → focused branch → one bounded gate → positive/negative/failure tests → PR → exact-head CI/review → fixed-head merge → exact post-merge CI → README/Roadmap checkpoint → branch cleanup → next gate`

Do not weaken strict Clippy, freshness/TTL, trust binding, topology isolation or test assertions merely to obtain green CI.