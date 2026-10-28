# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 28 October 2026

This file defines the **current order of work**. Historical roadmaps/checkpoints under [`archive/`](archive/) do **not** override this document.

A green test proves only its stated boundary. Code existence ≠ E2E ≠ security review ≠ production deployment.

## Verified source checkpoints

- **Nexus C2-D2 expired exact-recovery implementation checkpoint:** [`5acccfa1877016e464290b20ebba537c0b5bbad3`](https://github.com/TriplexCorp/XMesh-Nexus/commit/5acccfa1877016e464290b20ebba537c0b5bbad3), merge of [PR #77](https://github.com/TriplexCorp/XMesh-Nexus/pull/77).
- PR #77 exact pre-merge head `14df03be6b29dddcbf9506b663ac4a365873aea8` passed the relevant D2, C2-C, Hybrid TLS and Backend CI checks.
- On exact merge SHA `5acccfa1877016e464290b20ebba537c0b5bbad3`, [C2-D2 Expired Recovery E2E #40735842801](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40735842801), [C2-C ACK Authorization #40735843175](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40735843175), [Hybrid TLS #40735843132](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40735843132) and [Backend CI #40735843093](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40735843093) completed **success**.
- **Nexus C2-D1 implementation checkpoint:** [`037290bbb31dc6e5d155a14b8ddf58a31e21066f`](https://github.com/TriplexCorp/XMesh-Nexus/commit/037290bbb31dc6e5d155a14b8ddf58a31e21066f), merge of [PR #73](https://github.com/TriplexCorp/XMesh-Nexus/pull/73). Exact pre-merge and post-merge D1 E2E / Backend CI passed.
- **Clean documentation/main checkpoint before D2 runtime work:** [`9900f8c99efc59f86699a6c0ab35c3b39b211d37`](https://github.com/TriplexCorp/XMesh-Nexus/commit/9900f8c99efc59f86699a6c0ab35c3b39b211d37), merge of docs-only [PR #74](https://github.com/TriplexCorp/XMesh-Nexus/pull/74), with post-merge Backend CI #40724165330 **success**.
- **XMesh-Node D1 staging transport checkpoint pinned by the current Nexus D2 E2E:** [`3c49fd9b81293f53f7bc599a4bfab5a4c2040164`](https://github.com/TriplexCorp/XMesh-Node/commit/3c49fd9b81293f53f7bc599a4bfab5a4c2040164), merge of Node PR #30.
- **Nexus C2-C implementation checkpoint:** [`37b9e49da1a9fd43657dd167ebb9d5e9a4580091`](https://github.com/TriplexCorp/XMesh-Nexus/commit/37b9e49da1a9fd43657dd167ebb9d5e9a4580091), merge of [PR #71](https://github.com/TriplexCorp/XMesh-Nexus/pull/71).
- Earlier signer P0 (PR #61), dedicated PQ-only ingress P0-C1 (PR #64), trusted ingress→origin identity boundary P0-C2-A (PR #66), narrow staging ACK gate P0-C2-B (PR #69), C2-C ACK crypto/transaction/signer (PR #71) and C2-D1 real-Node integration (PR #73) remain complete in their stated staging/process scopes.

## Binding XSP-v2 target invariant

The finished XSP-v2 control plane has one policy: **fail closed**.

All are mandatory:

1. **Transport:** TLS 1.3 with actually negotiated `X25519MLKEM768`, trusted certificate chain, correct hostname/SNI and no unreviewed weaker hop.
2. **Messages:** Ed25519 **AND** ML-DSA-65 verification for every security-critical XSP/2 message.
3. **Binding/state:** exact sender/recipient, direction, method/path, payload/revision, request ID, nonce, key epoch and expiry; durable replay protection and monotonic security state.
4. **Key custody/enrollment:** verified owner authorization, proof of possession, pinned trust roots and protected private-key boundaries.
5. **Failure:** missing PQ support, invalid signature/certificate/state, stale epoch, replay or unavailable security component means reject — never automatic fallback to `XMESH1`, Ed25519-only, X25519-only, TLS 1.2 or insecure verification.

`strict-pq` remains **OFF** in production. Legacy `XMESH1` remains the deployed control-plane reality until a separately approved replacement is proven. Xray remains the user VPN data-plane.

## Gate status

| Gate | Status | Evidence / required next |
| --- | --- | --- |
| Dual-signed permit / applied ACK primitives | **STAGING PASS** | Ed25519 AND ML-DSA-65; canonical permit/nonce/epoch/candidate bindings |
| Atomic ACK → epoch commit/readback | **STAGING PASS** | PostgreSQL transaction/CAS and committed evidence |
| Signed commit receipt + immutable outbox | **STAGING PASS** | Exact durable bytes, dedupe/recovery and mutation guards |
| Isolated `panel_response` signer | **P0 COMPLETE — staging/process** | PR #61; process/socket/key isolation/DB-role/failure/recovery evidence |
| P0-C1 dedicated PQ-only Node ingress | **P0 COMPLETE — isolated network/process** | PR #64; actual hybrid negotiation, fail-closed negatives, one-hop topology |
| Node ML-DSA-65 client identity primitive | **C2-A PREREQUISITE COMPLETE** | Node PR #29; mutual-TLS client identity and negative cases |
| P0-C2-A ingress→origin trust boundary | **P0 COMPLETE — isolated staging/process** | PR #66; verified client identity → protected UDS → peercred/pinned-SPKI Node identity |
| P0-C2-B narrow staging ACK route | **P0 COMPLETE — isolated staging/process** | PR #69; exact gated ACK structural operation, no broad proxy |
| P0-C2-C ACK crypto/transaction/signer | **P0 COMPLETE — isolated staging/process** | PR #71; dual-signature ACK auth, atomic commit, protected signer, immutable receipt/recovery |
| P0-C2-D1 real Node integrated E2E | **P0 COMPLETE — isolated staging/process** | PR #73; pinned Node SHA → strict PQ mTLS → ACK commit → signer → Node-verified durable receipt |
| P0-C2-D2 expired exact network recovery | **SUB-GATE COMPLETE — isolated staging/process** | PR #77; expired fresh ACK rejected, exact historical recovery returns immutable receipt without re-sign/second epoch transition |
| **P0-C2-D2 remaining failure/retry/recovery matrix** | **CURRENT P0** | Lost-response windows, duplicate/race/replay convergence, outages/restarts, downgrade/no-legacy and integrated topology/old-key assertions |
| P0-D production-capable Agent workflow | **BLOCKED on full C2-D** | Integrate real Agent migration/control state and update path |
| P0-E recovery/security release gates | **BLOCKED** | Crash/snapshot/rollback/backup/rotation/fuzz/KAT/independent review |
| Production XSP-v2 rollout | **NOT AUTHORIZED** | Disposable canary + explicit production approval after all gates |

## Completed P0 — isolated signer process/socket E2E

PR #61 proved a separate signer/API process boundary, Unix-socket peer checks, private-key mount isolation, owner-approved Ed25519/ML-DSA-65 pins, least-privilege read-only signer DB role, committed ACK readback, API-side receipt reverification, immutable receipt recovery and concurrency/failure coverage.

Limits remain: host root/DB admin are trusted; this is not an HSM; whole-machine snapshot anti-rollback is not solved; signing before first durable outbox INSERT is not claimed exactly-once; production key retirement is not authorized.

## Completed P0-C1 — dedicated PQ-only Node ingress

PR #64 proved:

- [x] TLS 1.3 only with actually negotiated `X25519MLKEM768`.
- [x] Trusted certificate and exact hostname/SNI.
- [x] Fresh handshakes; tickets/cache/early data disabled for evidence.
- [x] TLS 1.2, X25519-only, wrong-hostname and untrusted-certificate negatives fail closed.
- [x] Strict Node Go 1.27 probe and independent OpenSSL observation agree.
- [x] Non-root/read-only/cap-drop/no-new-privileges disposable ingress.
- [x] No Nexus/API/backend hop at C1.
- [x] Default installer/Compose do not activate the experimental ingress.

## Completed P0-C2-A — trusted Node identity and protected origin boundary

Node PR #29 plus Nexus PR #66 prove:

`Node test client → TLS1.3/X25519MLKEM768 + ML-DSA-65 client identity → ingress → protected UDS → origin verifier`

- [x] Ingress verifies the ML-DSA-65 client certificate on the strict hybrid TLS connection.
- [x] Caller headers/body/source IP/legacy identity are not trusted Node-ID sources.
- [x] Origin has no network listener/published port and validates `SO_PEERCRED` UID/GID.
- [x] Trusted Node ID is derived from pinned verified client-certificate SPKI SHA-256.
- [x] Anonymous/wrong/classical clients, forged headers and direct-origin impersonation fail closed.

## Completed P0-C2-B — narrow staging ACK structural gate

Merged as Nexus PR #69.

Tested path:

`Node test client → strict hybrid mTLS → dedicated C2-B ingress → protected UDS → staging ACK structural gate`

- [x] Only exact `POST /api/v2/node/keys/rotation/ack` was mounted as the state-changing application operation at this gate.
- [x] Separate opt-in staging runtime preserves default production behavior.
- [x] No broad proxy, generic upstream or TCP/plaintext backend hop was introduced.
- [x] Caller-controlled headers are stripped and trusted Node identity is re-derived at the protected origin.
- [x] Body Node identity/issuer must match trusted transport identity.
- [x] Strict method/path/content type/body-size/time/JSON-structure bounds are enforced.
- [x] Wrong identity/class/path/epoch/time/nonce/digest/key-role structures, duplicate JSON keys, anonymous/alternate/classical clients and direct UDS forgery fail closed.
- [x] Default `compose.yaml`, `install.sh` and normal `backend/src/main.rs` do not activate the route.

C2-B success was structural only; it deliberately returned `authorizationStatus: "not-verified"`.

## Completed P0-C2-C — cryptographic ACK authorization and transaction

Merged as Nexus PR #71 and re-verified on exact merge SHA `37b9e49da1a9fd43657dd167ebb9d5e9a4580091`.

Tested local path:

`trusted C2-B origin → protected UDS C2-C service → dual-signature ACK verification → PostgreSQL ACK/epoch commit → isolated signer → immutable signed receipt`

### Acceptance evidence

- [x] Reviewed internal handoff is a protected Unix socket; trusted Node identity is never taken from an ordinary HTTP header/body/source IP/legacy identity.
- [x] C2-C verifies **Ed25519 AND ML-DSA-65** against the owner-enrolled `node_request` keyset.
- [x] Exact trusted Node ID / ACK bytes / request ID / nonce / permit / candidate / from-to epoch bindings are verified through the existing state machine.
- [x] Replay and stale/tampered/wrong-peer evidence fail closed.
- [x] Existing atomic ACK→epoch PostgreSQL transition semantics are reused; no competing state machine was added.
- [x] Dedicated `xmesh_c2c_writer` is distinct from both the normal API role and SELECT-only signer role.
- [x] C2-C DB role rejects DDL, TEMP, unrelated reads, DELETE/TRUNCATE and key retirement.
- [x] Old public keys remain unretired; retirement remains a separate authorized workflow.
- [x] Isolated signer is called only after committed ACK evidence exists.
- [x] Signer independently re-reads committed evidence through its SELECT-only DB role before signing.
- [x] C2-C re-verifies signed receipt against durable evidence before immutable outbox persistence/recovery.
- [x] Signer-down after ACK commit yields no policy success and no receipt.
- [x] After signer recovery, concurrent exact retry converges to one first durable dual-signed receipt.
- [x] Once the receipt is durable, retry with signer offline returns the exact stored bytes and performs no second epoch transition.
- [x] Tampered ACK, wrong ingress peer and direct C2-C impersonation fail closed.
- [x] PostgreSQL stall fails closed.
- [x] C2-C has no signer-private-key mount and the C2-C process itself has no TCP listener.
- [x] Exact-head PR CI passed.
- [x] Fixed head PR #71 merged.
- [x] Post-merge C2-C, Backend, Crypto and Hybrid workflows passed on exact merge SHA.

### C2-C limits — binding

C2-C starts from the already-proven trusted C2-B origin boundary. It does **not** by itself prove the full real Node→TLS→ACK→receipt/retry process chain.

C2-C also does **not** claim exactly-once signing before the first durable outbox INSERT. A concurrent/lost pre-persistence signature may exist; the first durable immutable receipt remains authoritative. No production key retirement or production activation is authorized.

## Completed P0-C2-D1 — real Node integrated E2E

Merged as Nexus PR #73 and re-verified on exact merge SHA `037290bbb31dc6e5d155a14b8ddf58a31e21066f`.

Tested integrated path:

`real XMesh-Node Go 1.27 staging client → strict TLS1.3/X25519MLKEM768 + ML-DSA-65 mTLS → dedicated ingress → protected origin UDS → C2-C ACK auth/commit → PostgreSQL → isolated signer → dual-signed commit receipt → Node receipt verification + durable journal`

### D1 acceptance evidence

- [x] The cross-repository workflow pins exact Node merge SHA `3c49fd9b81293f53f7bc599a4bfab5a4c2040164`; no floating Node `main` is used as security evidence.
- [x] The real Node staging cutover package verifies and journals the exact signed permit and ACK before the network exchange.
- [x] The same Node path uses mandatory TLS 1.3 + actually negotiated `X25519MLKEM768` + ML-DSA-65 mutual TLS.
- [x] Another otherwise-valid ML-DSA client certificate cannot impersonate the pinned Node identity and cannot change the epoch.
- [x] The request crosses the already-reviewed ingress→origin→C2-C boundaries rather than being injected only at the trusted origin.
- [x] C2-C performs the existing Ed25519 AND ML-DSA-65 ACK authorization and atomic ACK→epoch commit.
- [x] The isolated signer issues the commit receipt only after committed evidence exists.
- [x] The Node does not infer policy success from HTTP status: it verifies both receipt signatures and exact permit/ACK/epoch/request bindings, then durably journals the receipt.
- [x] A restarted Node test process can re-authenticate an already-durable local permit/ACK/receipt witness after permit expiry without treating that expired permit as a new command.
- [x] No host-published port is introduced; the integrated Docker network remains internal/test-only.
- [x] Production Agent code, default installer/Compose, `strict-pq`, live DB/keys and production infrastructure remain untouched.
- [x] Exact-head D1 E2E and Backend CI passed on PR head `298fba8b17f08bd306ab3f68c998354da3c643b5`.
- [x] PR #73 merged as `037290bbb31dc6e5d155a14b8ddf58a31e21066f`.
- [x] Post-merge D1 E2E #40720824028 and Backend CI #40720823715 passed on that exact merge SHA.

### D1 limit discovered and preserved

D1 intentionally did **not** weaken ACK freshness. A second network submission of an ACK after its freshness window was rejected by the origin structural gate. That was correct for a new operation and exposed the need for a distinct historical-recovery protocol.

The first C2-D2 sub-gate below closes that specific network-recovery gap without changing the D1 freshness invariant.

## P0-C2-D2 sub-gate complete — expired exact network receipt recovery

Merged as Nexus PR #77 and re-verified on exact merge SHA `5acccfa1877016e464290b20ebba537c0b5bbad3`.

The integrated proof preserves the state-changing fresh ACK domain while adding a separately distinguishable historical-recovery operation:

`real strict Node → PQ mTLS → exact /rotation/ack/recovery → trusted origin → XSP2C2H1 protected UDS domain → committed ACK + immutable receipt lookup → exact stored receipt → Node re-verification`

### Acceptance evidence

- [x] A fresh expired ACK is still rejected by the ordinary `/api/v2/node/keys/rotation/ack` freshness gate; no TTL/freshness relaxation was introduced.
- [x] Historical recovery is an exact staging-only route, not a caller-controlled header or broad proxy.
- [x] The recovery request still crosses strict TLS 1.3 + actually negotiated `X25519MLKEM768` + ML-DSA-65 client authentication and the protected ingress→origin boundary.
- [x] The signed ACK remains bound to the original state-changing ACK command; recovery does not reinterpret it as a fresh command.
- [x] Origin domain-separates recovery as `XSP2C2H1`; C2-C recovery reads only exact committed ACK evidence plus an already-durable immutable receipt.
- [x] Recovery does not run the fresh ACK commit/CAS path and does not invoke the signer.
- [x] The integrated recovery succeeds with the signer stopped, returns the exact durable receipt bytes, leaves the epoch unchanged and keeps one immutable outbox record.
- [x] A mismatched ACK cannot recover another committed receipt.
- [x] An alternate otherwise-valid ML-DSA client identity cannot recover the pinned Node's receipt.
- [x] The Node continues to verify the exact dual-signed receipt rather than treating HTTP 200 as success.
- [x] No production Agent/default installer/Compose/`strict-pq`/live infrastructure/key-retirement change was introduced.
- [x] Fixed-head PR #77 merged; post-merge D2 E2E, C2-C, Hybrid TLS and Backend CI passed on exact merge SHA.

This closes only the expired exact-recovery portion of C2-D2. It does **not** complete the broader duplicate/race/lost-response/outage/restart/downgrade matrix.

## CURRENT P0 — P0-C2-D2: remaining failure / retry / recovery matrix

Overall **P0-C2-D remains CURRENT P0**. The current verified Nexus implementation checkpoint is `5acccfa1877016e464290b20ebba537c0b5bbad3`. Every next runtime/test change must start from current `main` after the documentation checkpoint and remain focused on the still-open D2 criteria.

### Goal

Preserve the proven D1 chain plus the new historical-recovery domain and demonstrate that every remaining ambiguous network/process failure converges safely:

`real strict Node → PQ mTLS → trusted boundary → ACK durable state → receipt durable state → exact recovery or fail-closed`

### Required acceptance criteria

- [x] Use the real strict Node Go 1.27 transport/client-auth/cutover path in the integrated E2E rather than injecting only at the trusted origin. **D1**
- [x] Node verifies the exact dual-signed receipt rather than inferring success from HTTP status. **D1 / D2 recovery**
- [x] Alternate ML-DSA client identity cannot impersonate the pinned Node in the integrated route. **D1; recovery negative repeated in PR #77**
- [x] No host-published port is introduced by the integrated topology. **D1 / PR #77**
- [x] Define and prove exact **network** retry after the original ACK freshness window. Recovery succeeds only when trusted transport Node identity plus exact request/epoch/ACK evidence matches an already-committed durable record and immutable durable receipt; it never authorizes a fresh stale transition, re-signs, or advances the epoch again. **PR #77**
- [x] Exact expired retry returns the same durable receipt bytes and performs no second epoch transition. **PR #77**
- [ ] Complete the racing duplicate ACK / replay / mismatched-payload convergence matrix. PR #77 proves a mismatched historical ACK negative, but does not close the full race/replay criterion.
- [ ] Exercise lost network response before durable ACK commit.
- [ ] Exercise lost response after ACK commit but before durable receipt persistence/reply.
- [ ] Exercise lost response after durable receipt persistence; retry must recover exact bytes without re-signing under an injected lost-response condition.
- [ ] Signer unavailable, DB stall, origin boundary unavailable and C2-C unavailable all fail closed without legacy fallback across the integrated Node path.
- [ ] Restart C2-C/origin/signer around security-state transitions and prove durable recovery semantics.
- [ ] Failed PQ handshake, wrong client certificate or downgrade attempt cannot reach the ACK operation through an authenticated legacy session.
- [ ] Verify no new public port, broad proxy, classical-only internal hop or signer-key exposure appears across the complete integrated failure/recovery topology.
- [ ] Preserve old-key retention and no automatic retirement across every remaining failure/retry path.
- [ ] Full C2-D2 PR CI/review/fixed-head merge/post-merge exact-SHA lifecycle must be complete before P0-D begins.

### D2 architectural constraint — binding

Do **not** solve retry/recovery by increasing or ignoring `issuedAtMs`/`expiresAtMs`, accepting a generic stale ACK, adding a weak fallback route, or trusting caller-controlled recovery headers.

Historical recovery must remain independently distinguishable from a fresh state-changing ACK and bound to authenticated PQ transport Node identity plus exact durable committed evidence. If the durable record/receipt is missing or mismatched, reject. If any component is unavailable in a way that prevents proving the durable match, fail closed.

### Next focused D2 work

The next sub-gate is the **lost-response and duplicate/race convergence matrix**: lost response before ACK commit, after ACK commit but before durable receipt/reply, and after durable receipt persistence; exact duplicate/race/replay/mismatch behavior must converge only to the authoritative durable state or fail closed. Outage/restart and downgrade/no-legacy evidence remain subsequent focused work unless required to prove the same failure window safely.

## P0-D — production-capable Agent workflow

After full C2-D:

- integrate the proven Go 1.27 strict transport and XSP/2 primitives into a production-capable Agent design;
- provision trusted panel pins and verified Node key custody;
- deliver signed desired configs/commands/responses;
- bind real applied state to ACK;
- persist permit/ACK/receipt state durably across restart;
- retain previous keys until separately proven retirement;
- exercise a real disposable Nexus↔Node E2E;
- integrate safe Agent update/migration orchestration so the operator can eventually update an Agent from the Nexus UI without per-node manual SSH/key copying;
- preserve recovery if migration does not complete.

## P0-E — release/security gates

Before any production replacement:

- crash/SIGKILL at every security state transition;
- lost response before/after durable commit;
- DB/filesystem restore tests;
- full VM/disk snapshot rollback threat model and anti-rollback design;
- backup/restore of persistent identities and encryption keys;
- key rotation/retirement procedures;
- FIPS 204 / ML-DSA external KAT and fuzzing where applicable;
- independent security review / penetration test of deployed topology;
- disposable canary with actual negotiated-group evidence on every protected hop.

Only then may an operator separately authorize production replacement. The final product must not expose a user-facing classical/fallback mode.

## Mandatory development process

For each security-sensitive gate:

1. re-check current Nexus/Node `main`, open PRs and exact CI state;
2. create one focused branch;
3. implement only the current gate/sub-gate;
4. add positive/negative/replay/concurrency/failure tests appropriate to that boundary;
5. open a PR with explicit threat model and out-of-scope list;
6. require relevant CI and review;
7. merge only a fixed reviewed head SHA;
8. re-check post-merge `main` and CI on the exact SHA;
9. update this Roadmap/README with claims no stronger than the evidence;
10. verify all current changes are in `main` and clean up merged/superseded working branches;
11. only then start the next gate.

Never rewrite already-applied SQL migrations for cleanup; use additive migrations. Never weaken strict Clippy/security checks merely for green CI. Never treat a GitHub merge as production deployment.

## Production-change authorization

Normal roadmap/code work does **not** authorize changes to production VPS/live containers, DNS/firewall/public Nginx, production PostgreSQL data/roles by manual action, real Node/private panel signing keys, live VPN credentials, `strict-pq` activation or legacy-key retirement. Those require an explicit deployment step after the relevant engineering/security gates.

## Parallel non-XSP hardening tracks

Backup/disaster recovery, deployment security, browser E2E/UI quality, supply-chain provenance, HA/scalability, observability and independent validation remain separate tracks and must not weaken the active XSP-v2 P0 gates.

## Historical archive

Previous long-form roadmaps and READMEs are preserved under [`archive/`](archive/). If an archived statement conflicts with this file, **this file is authoritative**.
