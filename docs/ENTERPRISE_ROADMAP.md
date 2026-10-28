# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 28 October 2026

This file defines the **current order of work**. Historical roadmaps/checkpoints under [`archive/`](archive/) do **not** override this document.

A green test proves only its stated boundary. Code existence ≠ E2E ≠ security review ≠ production deployment.

## Verified source checkpoints

- **Latest Nexus C2-D2 outage/restart implementation checkpoint:** [`a756f1ac705c5f2c013cee8f706ee8714f720d98`](https://github.com/TriplexCorp/XMesh-Nexus/commit/a756f1ac705c5f2c013cee8f706ee8714f720d98), merge of [PR #86](https://github.com/TriplexCorp/XMesh-Nexus/pull/86).
- PR #86 extends the existing real-Node D2 failure harness across actual disposable origin, C2-C, PostgreSQL and signer outages/restarts while preserving exact recovery, replay cardinality, old-key retention and the reviewed no-public-port/no-TCP/no-signer-key topology.
- PR #86 exact pre-merge head `bd82a93531e73bc420a4c8f8029c270eaec01450` passed the expanded D2 source contract, full real-Node outage/restart process E2E and Backend CI.
- On exact merge SHA `a756f1ac705c5f2c013cee8f706ee8714f720d98`, [C2-D2 Lost Response and Race E2E #40771123783](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40771123783) and [Backend CI #40771123762](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40771123762) completed **success**.
- **Nexus C2-D2 transport-alignment checkpoint:** [`86e01727443389c89b1b3d633206d3f4bc274838`](https://github.com/TriplexCorp/XMesh-Nexus/commit/86e01727443389c89b1b3d633206d3f4bc274838), merge of [PR #84](https://github.com/TriplexCorp/XMesh-Nexus/pull/84).
- PR #84 aligns the external historical recovery transport with current XMesh-Node: exact `POST /api/v2/node/keys/rotation/ack/recover`, native Node `RecoverSignedACKReceipt`, package-private historical permit/ACK verification, and current Node pin `2cbe3a82473fc199c2354497eaf009707603f3f2`.
- **Current XMesh-Node D2 staging transport checkpoint:** [`2cbe3a82473fc199c2354497eaf009707603f3f2`](https://github.com/TriplexCorp/XMesh-Node/commit/2cbe3a82473fc199c2354497eaf009707603f3f2), merge of Node PR #32. Current Nexus D2 workflows pin this exact SHA.
- **Nexus C2-D2 lost-response / duplicate-race implementation checkpoint:** [`39e1589c82c52fe0c4af6fd5fc4d64aa782a465e`](https://github.com/TriplexCorp/XMesh-Nexus/commit/39e1589c82c52fe0c4af6fd5fc4d64aa782a465e), merge of [PR #82](https://github.com/TriplexCorp/XMesh-Nexus/pull/82).
- **Nexus C2-D2 expired exact-recovery implementation checkpoint:** [`5acccfa1877016e464290b20ebba537c0b5bbad3`](https://github.com/TriplexCorp/XMesh-Nexus/commit/5acccfa1877016e464290b20ebba537c0b5bbad3), merge of [PR #77](https://github.com/TriplexCorp/XMesh-Nexus/pull/77).
- **Nexus C2-D1 implementation checkpoint:** [`037290bbb31dc6e5d155a14b8ddf58a31e21066f`](https://github.com/TriplexCorp/XMesh-Nexus/commit/037290bbb31dc6e5d155a14b8ddf58a31e21066f), merge of [PR #73](https://github.com/TriplexCorp/XMesh-Nexus/pull/73). Exact pre-merge and post-merge D1 E2E / Backend CI passed.
- **Historical XMesh-Node D1 staging transport checkpoint:** [`3c49fd9b81293f53f7bc599a4bfab5a4c2040164`](https://github.com/TriplexCorp/XMesh-Node/commit/3c49fd9b81293f53f7bc599a4bfab5a4c2040164), merge of Node PR #30; this remains the exact D1 evidence but is no longer the current D2 workflow pin.
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
| P0-C2-D2 lost-response + exact duplicate-race convergence | **SUB-GATE COMPLETE — isolated staging/process** | PR #82; pre-commit loss, post-commit signer loss, post-receipt loss, signer-off exact recovery, 8-way exact race and fresh mismatch negative |
| P0-C2-D2 current Node recovery transport alignment | **PREREQUISITE COMPLETE — isolated staging/process** | PR #84; external `/ack/recover`, native Node recovery primitives, Node `2cbe3a8…` |
| P0-C2-D2 integrated outage/restart convergence | **SUB-GATE COMPLETE — isolated staging/process** | PR #86; origin/C2-C/DB/signer outages/restarts, replay=1, old-key retention, topology invariants, post-expiry exact recovery |
| **P0-C2-D2 transport-negative / no-legacy proof** | **CURRENT P0** | Full ACK-operation failed-PQ/wrong-client/downgrade negatives with no durable mutation or legacy fallback |
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

This closes only the expired exact-recovery portion of C2-D2.

## P0-C2-D2 sub-gate complete — lost-response and exact duplicate/race convergence

Merged as Nexus PR #82 and re-verified on exact merge SHA `39e1589c82c52fe0c4af6fd5fc4d64aa782a465e`.

The integrated proof keeps the same real pinned Node and authenticated staging topology, while adding allowlisted test-only response-loss injection at the disposable origin boundary. The origin test server was made concurrent (`ThreadingMixIn`, bounded queue) so the eight-way network race actually reaches C2-C/PostgreSQL instead of being serialized by the harness itself.

### Acceptance evidence

- [x] Lost response before C2-C authorization/commit leaves the epoch unadvanced and creates no receipt.
- [x] Signer unavailable after durable ACK/epoch commit fails closed: no receipt or policy success is synthesized while the signer path is unavailable.
- [x] Lost response after successful C2-C receipt persistence leaves one authoritative immutable durable receipt.
- [x] Exact retry with the signer offline returns the exact durable receipt bytes without re-signing or a second epoch transition.
- [x] Eight concurrent exact fresh Node retries converge to one epoch transition, one outbox record and the exact same receipt bytes.
- [x] A fresh mismatched/tampered retry is rejected without changing the authoritative durable state.
- [x] ACK freshness/TTL is unchanged; PR #82 does not turn historical recovery into a generic stale-ACK path.
- [x] Test fault modes are staging-only, allowlisted and applied only to response/failure windows after the existing transport/structure/freshness checks.
- [x] No public port, broad proxy, production Agent/default Compose activation, live key material change or `strict-pq` activation was introduced.
- [x] Exact pre-merge head `6089cd2a041ef3ceb2681e41b45107f15c025453` passed all relevant workflows.
- [x] Fixed-head PR #82 merged as `39e1589c82c52fe0c4af6fd5fc4d64aa782a465e`.
- [x] Post-merge D2 lost-response/race, expired recovery, C2-C, Hybrid TLS and Backend CI workflows all passed on that exact merge SHA.

## P0-C2-D2 prerequisite complete — current Node recovery transport alignment

Merged as Nexus PR #84 and re-verified on exact merge SHA `86e01727443389c89b1b3d633206d3f4bc274838`.

This checkpoint does not add a new failure-semantics claim. It updates the already-proven recovery path to the current native Node staging contract before the remaining D2 matrix:

- [x] External historical recovery uses exact `POST /api/v2/node/keys/rotation/ack/recover`; obsolete external `/ack/recovery` is not mounted.
- [x] The protected origin retains the internal `/recovery` operation and `XSP2C2H1` domain; external spelling does not collapse the trust boundary.
- [x] Positive Node recovery uses native `reloadVerifiedPermitForReceiptRetry` plus `RecoverSignedACKReceipt` rather than a Nexus-owned historical transport helper.
- [x] D2 workflows pin exact Node SHA `2cbe3a82473fc199c2354497eaf009707603f3f2`.
- [x] Stale fresh-ACK rejection, mismatched recovery negatives, the explicit `XSP_V2_C2D_HISTORICAL_RECOVERY=staging-only` gate and no-production-activation constraints remain intact.
- [x] Exact-head PR #84 checks passed and fixed head merged.
- [x] Post-merge Lost Response/Race, Expired Recovery, Hybrid TLS and Backend CI all passed on the exact merge SHA.

## P0-C2-D2 sub-gate complete — integrated outage/restart convergence

Merged as Nexus PR #86 and re-verified on exact merge SHA `a756f1ac705c5f2c013cee8f706ee8714f720d98`.

This matrix reuses the pinned real XMesh-Node Go 1.27 strict transport and existing D2 failure harness. It introduces no production behavior or alternate state machine; outages are real disposable Docker process stops/restarts.

### Acceptance evidence

- [x] Origin unavailable before ACK commit fails closed and leaves the server permit state `issued` with no receipt.
- [x] C2-C unavailable before ACK commit fails closed and leaves the server permit state `issued` with no receipt.
- [x] PostgreSQL unavailable before ACK commit fails closed; after DB restart and C2-C reconnect the same uncommitted state remains authoritative.
- [x] Signer unavailable after ACK/epoch commit leaves durable `ack_verified` / advanced epoch state but no receipt and no false Node success.
- [x] C2-C restart while the signer is unavailable, followed by signer restart, converges the already-committed ACK to exactly one immutable receipt.
- [x] Origin and C2-C restart after receipt durability preserve exact ordinary fresh retry/recovery with the signer offline.
- [x] PostgreSQL outage after receipt durability fails closed; after DB/C2-C/origin restart the exact authoritative receipt/state is recovered.
- [x] After the original ACK expires, native Node `/ack/recover` historical recovery still returns only the same immutable receipt following the complete restart history.
- [x] Replay nonce cardinality remains exactly one across retries/restarts; no second authorization transition is created.
- [x] Both old and new public-key epochs remain present and unrevoked; no automatic retirement occurs during failures/recovery.
- [x] Ingress, C2-C and origin publish no host ports; origin remains network-none; the C2-C PID has no TCP listener; C2-C/origin do not mount signer private keys; the disposable process network remains internal/no-egress.
- [x] Exact pre-merge head `bd82a93531e73bc420a4c8f8029c270eaec01450` passed the expanded D2 matrix and Backend CI.
- [x] Fixed-head PR #86 merged as `a756f1ac705c5f2c013cee8f706ee8714f720d98`.
- [x] Post-merge D2 outage/restart matrix #40771123783 and Backend CI #40771123762 passed on that exact merge SHA.

This closes the integrated outage/restart, remaining replay-at-restart, old-key-retention and topology assertions for C2-D2. It does not by itself close the final transport-negative/no-legacy proof.

## CURRENT P0 — P0-C2-D2: transport-negative / no-legacy proof

Overall **P0-C2-D remains CURRENT P0**. The current verified Nexus implementation checkpoint is `a756f1ac705c5f2c013cee8f706ee8714f720d98`. Every next runtime/test change must start from current `main` after this documentation checkpoint and remain focused on the final D2 transport-negative boundary.

### Goal

Demonstrate on the full ACK-operation topology that transport or client-auth downgrade cannot be converted into policy success, durable state mutation or an authenticated legacy fallback:

`failed/wrong transport or identity → no trusted ACK operation → no DB transition → no fallback`

### Required acceptance criteria

- [x] Use the real strict Node Go 1.27 transport/client-auth/cutover path in the integrated E2E rather than injecting only at the trusted origin. **D1**
- [x] Node verifies the exact dual-signed receipt rather than inferring success from HTTP status. **D1 / D2 recovery / PR #82**
- [x] Alternate ML-DSA client identity cannot impersonate the pinned Node in the integrated route. **D1; recovery negative repeated in PR #77**
- [x] No host-published port is introduced by the integrated topology. **D1 / PR #77 / PR #82 / PR #86**
- [x] Define and prove exact network retry after the original ACK freshness window without authorizing a new stale transition. **PR #77**
- [x] Exact expired retry returns the same durable receipt bytes and performs no second epoch transition. **PR #77**
- [x] Exercise lost network response before durable ACK commit. **PR #82**
- [x] Exercise lost response after ACK commit while durable receipt issuance is unavailable; fail closed without false success. **PR #82**
- [x] Exercise lost response after durable receipt persistence; exact retry recovers the same bytes with the signer offline and no second epoch transition. **PR #82**
- [x] Prove eight-way exact fresh duplicate/race convergence and a fresh mismatched-payload negative without durable-state mutation. **PR #82**
- [x] Re-pin the integrated D2 proof to the current native Node recovery transport and exact external `/ack/recover` endpoint without weakening the internal recovery domain or freshness gate. **PR #84**
- [x] Complete remaining replay coverage across outage/restart transitions; replay nonce cardinality remains exactly one. **PR #86**
- [x] Signer, DB, origin and C2-C unavailable/restart paths fail closed or converge from durable evidence without legacy fallback. **PR #86**
- [x] Restart C2-C/origin/signer around security-state transitions and prove durable recovery semantics. **PR #86**
- [x] Verify no new public port, broad proxy, classical-only internal hop, TCP C2-C listener or signer-key exposure appears across the integrated outage/recovery topology. **PR #86**
- [x] Preserve old-key retention and no automatic retirement across the failure/retry/restart matrix. **PR #86**
- [ ] On the full ACK-operation topology, prove TLS 1.2 and X25519-only/classical-only negotiation cannot reach policy success or mutate ACK/epoch/receipt state.
- [ ] Prove wrong client certificate / wrong hostname-SNI / wrong trust root fail closed at the integrated ACK-operation boundary with no durable mutation.
- [ ] Prove failed PQ/client-auth/downgrade attempts do not trigger or reach an authenticated `XMESH1`/legacy fallback; unrelated legacy/heartbeat paths remain inert on the dedicated XSP-v2 ingress.
- [ ] Full final C2-D2 PR CI/review/fixed-head merge/post-merge exact-SHA lifecycle must be complete before P0-D begins.

### D2 architectural constraint — binding

Do **not** solve retry/recovery by increasing or ignoring `issuedAtMs`/`expiresAtMs`, accepting a generic stale ACK, adding a weak fallback route, or trusting caller-controlled recovery headers.

Historical recovery must remain independently distinguishable from a fresh state-changing ACK and bound to authenticated PQ transport Node identity plus exact durable committed evidence. If the durable record/receipt is missing or mismatched, reject. If any component is unavailable in a way that prevents proving the durable match, fail closed.

The final transport-negative gate must likewise prove failure by preserving the strict transport boundary, not by adding an application-level downgrade detector after a weaker session has already reached the ACK operation.

### Next focused D2 work

The next and final C2-D2 sub-gate is the **integrated transport-negative/no-legacy matrix**. Reuse the full real-Node ACK topology and an uncommitted durable fixture; exercise TLS 1.2, X25519-only/classical-only, wrong client identity, wrong SNI/hostname and wrong trust; assert no ACK/epoch/outbox mutation after every negative; and prove no legacy/heartbeat route becomes reachable as a fallback. Only after exact-head CI, fixed-head merge and post-merge exact-SHA success may C2-D be marked complete and P0-D begin.

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
