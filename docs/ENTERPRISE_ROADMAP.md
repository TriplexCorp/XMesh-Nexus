# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 28 October 2026

This file defines the **current order of work**. Historical roadmaps/checkpoints under [`archive/`](archive/) do **not** override this document.

A green test proves only its stated boundary. Code existence ≠ E2E ≠ security review ≠ production deployment.

## Verified source checkpoints

- **Latest Nexus C2-D implementation checkpoint:** [`7e0b42ea4847b273ba8cd55a0ff3e043a420c377`](https://github.com/TriplexCorp/XMesh-Nexus/commit/7e0b42ea4847b273ba8cd55a0ff3e043a420c377), merge of [PR #88](https://github.com/TriplexCorp/XMesh-Nexus/pull/88).
- PR #88 closes the final C2-D2 integrated transport-negative / no-legacy-fallback proof at the real ACK-operation boundary.
- On exact merge SHA `7e0b42ea4847b273ba8cd55a0ff3e043a420c377`, all expected post-merge workflows completed **success**:
  - [Transport Negative and No-Legacy E2E #40783444207](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40783444207)
  - [Lost Response and Race E2E #40783444213](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40783444213)
  - [Expired Recovery E2E #40783444177](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40783444177)
  - [Hybrid TLS Probe #40783444276](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40783444276)
  - [Backend CI #40783444179](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40783444179)
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
| **P0-D production-capable Agent workflow** | **CURRENT P0** | Port proven semantics into the real Agent/migration/update workflow; disposable real Nexus↔Node E2E |
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

### P0-D required work

1. **Real Agent integration design**
   - identify the current Go 1.23 production Agent/control paths that will be replaced or migrated;
   - port/reuse the proven Go 1.27 XSP-v2 transport, permit/ACK/receipt and recovery primitives instead of creating another state machine;
   - keep fixed-action Agent behavior: no remote arbitrary scripts/commands.

2. **Version/toolchain migration**
   - define the supported Go 1.27 Agent build/release path;
   - preserve rollback to the last known-good Agent package;
   - prevent mixed-version peers from silently negotiating weaker security.

3. **Nexus-driven migration/update orchestration**
   - define an owner-authorized migration/update request from Nexus UI/API;
   - bind exact desired Agent version/artifact digest/revision to signed state;
   - separate download/stage/verify/apply/ACK phases;
   - never interpret transport failure or missing receipt as success.

4. **Durable Agent state**
   - carry the proven permit/ACK/receipt journal into the real Agent filesystem/state layout;
   - preserve monotonic epoch/replay state across process/host restart;
   - preserve old-key retention until a separately authorized retirement workflow.

5. **Authenticated transport authority**
   - direct connect `address` may be an IP/internal alias;
   - TLS SNI, certificate hostname verification and HTTP authority must all bind to the authenticated `serverName`;
   - no proxy/redirect/legacy fallback may change that authority.

6. **Disposable real Nexus↔Node E2E**
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

No production activation is authorized by C2-D completion.

Before production rollout:

1. P0-D must be complete;
2. P0-E must be complete;
3. a disposable canary must prove install/upgrade/rollback/recovery/observability;
4. production topology/DNS/firewall/Nginx/DB/key changes require a separately reviewed rollout plan;
5. `strict-pq` activation and legacy XMESH1 retirement require explicit approval and must never occur as an automatic fallback/migration side effect.

## Security guardrails

- `strict-pq` remains **OFF**.
- Production Agent remains on the deployed legacy control path until P0-D/P0-E and later rollout gates explicitly authorize replacement.
- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate validation.
- A GitHub merge is not a production deployment.
- Xray remains the user VPN data-plane.
- Historical/archive documents do not override this roadmap.

## Engineering process

For every security-sensitive gate:

`current verified main → focused branch → one bounded gate → positive/negative/failure tests → PR → exact-head CI/review → fixed-head merge → exact post-merge CI → README/Roadmap checkpoint → branch cleanup → next gate`

Do not weaken strict Clippy, freshness/TTL, trust binding, topology isolation or test assertions merely to obtain green CI.
