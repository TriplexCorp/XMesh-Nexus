# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 28 October 2026

This file defines the **current order of work**. Historical roadmaps/checkpoints under [`archive/`](archive/) do **not** override this document.

## Verified source checkpoints

- **Nexus C2-A implementation checkpoint:** [`5b8840051ca8562417c6b4f00d65753a165bb598`](https://github.com/TriplexCorp/XMesh-Nexus/commit/5b8840051ca8562417c6b4f00d65753a165bb598), merge of [PR #66](https://github.com/TriplexCorp/XMesh-Nexus/pull/66).
- PR #66 exact pre-merge head `fc8317a8849e7dbcd300e82eaf5804f6d4d17876` passed [XSP-v2 Hybrid TLS Probe #40599041487](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40599041487) and [Backend CI #40599041548](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40599041548).
- On the exact C2-A merge SHA, [XSP-v2 Hybrid TLS Probe #40600684179](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40600684179) — **success**, including `PQ client identity and Unix origin boundary E2E`.
- On the same C2-A merge SHA, [Backend CI #40600684106](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40600684106) — **success**, including strict Clippy, Docker build and disposable API/authentication integration.
- **XMesh-Node staging transport checkpoint:** [`79cee45174f7670707d22a269784fe117c44743c`](https://github.com/TriplexCorp/XMesh-Node/commit/79cee45174f7670707d22a269784fe117c44743c), merge of [Node PR #29](https://github.com/TriplexCorp/XMesh-Node/pull/29).
- On the Node merge SHA, [Node CI #40597143811](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143811) and [XSP-v2 Crypto PoC #40597143829](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143829) — **success**.
- Earlier signer P0 (PR #61) and dedicated PQ-only ingress P0-C1 (PR #64) remain complete in their stated staging/process scopes.

A green test proves only its stated boundary. Code existence ≠ E2E ≠ security review ≠ production deployment.

## Binding XSP-v2 target invariant

The finished XSP-v2 control plane has one policy: **fail closed**.

All are mandatory:

1. **Transport:** TLS 1.3 with actually negotiated `X25519MLKEM768`, trusted certificate chain, correct hostname/SNI and no unreviewed weaker hop.
2. **Messages:** Ed25519 **AND** ML-DSA-65 verification for security-critical XSP/2 messages.
3. **Binding/state:** exact sender/recipient, direction, method/path, payload/revision, request ID, nonce, key epoch and expiry; durable replay protection and monotonic security state.
4. **Key custody/enrollment:** verified owner authorization, proof of possession, pinned trust roots and protected private-key boundaries.
5. **Failure:** missing PQ support, invalid signature/certificate/state, stale epoch, replay or unavailable security component means reject — never automatic fallback to `XMESH1`, Ed25519-only, X25519-only, TLS 1.2 or insecure verification.

`strict-pq` remains **OFF** in production. Legacy `XMESH1` remains the deployed control-plane reality until a separately approved replacement is proven. Xray remains the user VPN data-plane.

## Gate status

| Gate | Status | Evidence / required next |
| --- | --- | --- |
| Dual-signed permit / applied ACK primitives | **STAGING PASS** | Ed25519 AND ML-DSA-65; canonical permit/nonce/epoch/candidate bindings |
| Atomic ACK → epoch commit/readback | **STAGING PASS** | PostgreSQL transaction/CAS and committed evidence; not yet a network route |
| Signed commit receipt + immutable outbox | **STAGING PASS** | Exact durable bytes, dedupe/recovery and mutation guards |
| Isolated `panel_response` signer | **P0 COMPLETE — staging/process** | PR #61; process/socket/key isolation/DB-role/failure/recovery evidence |
| P0-C1 dedicated PQ-only Node ingress | **P0 COMPLETE — isolated network/process** | PR #64; actual hybrid negotiation, fail-closed negatives, one-hop topology |
| Node ML-DSA-65 client identity primitive | **C2-A PREREQUISITE COMPLETE** | Node PR #29; mutual-TLS client identity and negative cases |
| P0-C2-A ingress→origin trust boundary | **P0 COMPLETE — isolated staging/process** | PR #66; verified client identity → stripped ingress → protected UDS → peer-credential/pinned-SPKI origin identity |
| **P0-C2-B narrow staging ACK route** | **CURRENT P0** | Mount exactly one gated ACK operation behind C2-A; no broad legacy API proxy |
| P0-C2-C ACK crypto/transaction/signer | **BLOCKED on C2-B** | Dual signature auth, replay/epoch bindings, atomic commit, immutable signed receipt |
| P0-C2-D retry/failure/full E2E | **BLOCKED on C2-C** | Node strict TLS → boundary → ACK → DB → signer → receipt → retry/recovery |
| P0-D production-capable Agent workflow | **BLOCKED on C2** | Integrate real Agent migration/control state and update path |
| P0-E recovery/security release gates | **BLOCKED** | Crash/snapshot/rollback/backup/rotation/fuzz/KAT/independent review |
| Production XSP-v2 rollout | **NOT AUTHORIZED** | Disposable canary + explicit production approval after all gates |

## Completed P0 — isolated signer process/socket E2E

PR #61 proved a separate signer/API process boundary, Unix-socket peer checks, private-key mount isolation, owner-approved Ed25519/ML-DSA-65 pins, least-privilege read-only signer DB role, committed ACK readback, API-side receipt reverification, immutable receipt recovery and concurrency/failure coverage.

Limits remain: host root/DB admin are trusted; this is not an HSM; whole-machine snapshot anti-rollback is not solved; signing before first durable outbox INSERT is not claimed exactly-once; production key retirement is not authorized.

## Completed P0-C1 — dedicated PQ-only Node ingress

Merged in PR #64. Proven:

- [x] Dedicated experimental runtime; default installer/Compose do not activate it.
- [x] TLS 1.3 only.
- [x] Actually negotiated group exactly `X25519MLKEM768`.
- [x] Trusted certificate and exact hostname/SNI.
- [x] Fresh handshake proof; tickets/cache/early data disabled for evidence.
- [x] TLS 1.2, X25519-only, wrong hostname and untrusted certificate fail closed.
- [x] Strict Node Go 1.27 probe and independent OpenSSL observation agree.
- [x] Non-root/read-only/cap-drop/no-new-privileges disposable runtime.
- [x] No Nexus/API/backend hop at C1.
- [x] ACK/heartbeat/default application paths remain inert 404.

C1 proved **Node → TLS terminator only**. It did not claim end-to-end protection through an application origin.

## Completed P0-C2-A prerequisite — Node ML-DSA-65 mutual TLS identity

Merged as Node PR #29. The isolated Go 1.27 staging probe proves:

- [x] TLS 1.3 + actually negotiated `X25519MLKEM768`.
- [x] Client certificate algorithm exactly ML-DSA-65 on the valid path.
- [x] Server-side client-certificate acceptance is proven, not inferred only from local client handshake completion.
- [x] Anonymous/no-cert, ML-DSA-44, classical ECDSA, untrusted ML-DSA-65 and classical X25519-only cases fail closed.
- [x] Pre/post-merge Node CI and Go 1.27 crypto CI pass.

This is a transport identity primitive only. Production Agent remains on the legacy Go 1.23 control path.

## Completed P0-C2-A — ingress→origin trust boundary

Merged as Nexus PR #66 and re-verified on exact merge SHA `5b8840051ca8562417c6b4f00d65753a165bb598`.

Tested path:

`Node test client → TLS1.3/X25519MLKEM768 + ML-DSA-65 client identity → ingress → protected UDS → disposable origin verifier`

### A. Edge identity

- [x] Ingress verifies the client certificate on the strict hybrid TLS connection.
- [x] C1 TLS/downgrade requirements remain enforced.
- [x] Anonymous, wrong/untrusted and classical client identities fail closed.

### B. Origin transition

- [x] Caller-controlled request headers/body are not forwarded as trusted identity.
- [x] The ingress has exactly one reviewed forwarding path for the C2-A identity probe.
- [x] Forwarding targets the Unix socket `/run/xmesh-origin/xsp-v2-origin.sock`, not a TCP/plaintext network backend.
- [x] The disposable origin has no network listener or published host port.
- [x] The origin validates Linux `SO_PEERCRED` against the expected ingress UID/GID.
- [x] The origin derives the trusted Node identity from a pinned mapping of the verified client certificate SPKI SHA-256.
- [x] Body `nodeId`, arbitrary trusted-node headers, source IP and legacy `XMESH1` identity are not trusted Node-ID sources.

### C. Negative/alternate path evidence

- [x] Forged caller identity/verification/certificate headers cannot select trusted Node identity.
- [x] Direct/alternate origin impersonation fails without the expected UDS peer credential.
- [x] Missing/wrong client identity fails before trusted origin identity is produced.
- [x] Existing ACK, heartbeat and general API routes remain unmounted/inert in this isolated boundary.

### D. CI/process evidence

- [x] PR #66 exact-head Hybrid/C2-A E2E passed.
- [x] PR #66 exact-head Backend CI passed.
- [x] Review surface had no submitted review or unresolved inline review thread at merge time.
- [x] Merge used fixed head `fc8317a8849e7dbcd300e82eaf5804f6d4d17876`.
- [x] Post-merge Hybrid/C2-A E2E passed on exact merge SHA `5b8840051ca8562417c6b4f00d65753a165bb598`.
- [x] Post-merge Backend CI passed on the same exact SHA.

### C2-A limits

C2-A does **not** connect the origin verifier to the Nexus API/database, authorize an ACK message, enable `strict-pq`, update production Agent behavior or change any production VPS/DNS/firewall/public Nginx/live key.

## CURRENT P0 — P0-C2-B: narrow staging ACK route

### Goal

Expose exactly one experimental Node-only ACK operation behind the proven C2-A boundary:

`POST /api/v2/node/keys/rotation/ack`

Do **not** expose a broad proxy to the existing API.

### Required acceptance criteria

- [ ] Mount only the ACK operation in the experimental staging path.
- [ ] Feature-gate and runtime-gate it; default production backend remains without active XSP-v2 network routes.
- [ ] The normal public/default API path cannot reach the staging ACK handler.
- [ ] Consume the trusted Node identity created by C2-A; never authorize from body `nodeId`, arbitrary headers, source IP or legacy `XMESH1` identity.
- [ ] Require exact XSP/2 message type, sender/recipient direction and `POST /api/v2/node/keys/rotation/ack` method/path binding.
- [ ] Enforce exact content type, strict request size/deadline bounds and secret-safe/no-body logging.
- [ ] Missing/invalid C2-A boundary identity fails closed.
- [ ] Keep unrelated routes inert and default deployment unchanged.
- [ ] Add process-level positive and alternate/public-path/spoofing negative tests.
- [ ] PR CI, review, fixed-head merge and post-merge exact-SHA CI required before C2-C begins.

C2-B does **not** by itself declare the ACK cryptographically authorized; that is C2-C.

## P0-C2-C — cryptographic ACK authorization and transaction

Only after C2-B:

- [ ] Verify **Ed25519 AND ML-DSA-65** against the owner-enrolled Node request keyset for the required epoch.
- [ ] Bind trusted Node identity to exact ACK bytes, request ID, nonce, candidate, permit, epoch and committed ledger state.
- [ ] Require recovery/authority assertion where the staged recovery flow requires it, bound to exact saved ACK bytes.
- [ ] Consume replay nonce exactly once; reject stale/revoked/wrong-epoch/wrong-node/wrong-path/wrong-request/wrong-candidate evidence.
- [ ] Preserve already-proven atomic ACK→epoch semantics.
- [ ] Call the isolated signer only after committed ACK evidence exists.
- [ ] Reverify signer output in the API and persist/recover immutable first durable receipt bytes.
- [ ] HTTP status alone never means policy success; Node requires a valid signed receipt.

## P0-C2-D — failure / retry / full E2E

- [ ] Exact retry returns the same durable receipt bytes and performs no second epoch transition.
- [ ] Racing duplicate ACKs/replays/mismatched payloads fail or converge only to the immutable committed record.
- [ ] Exercise lost response before/after durable commit.
- [ ] Signer unavailable, DB stall, boundary unavailable and process restart fail closed without legacy fallback.
- [ ] Failed PQ handshake cannot reach an authenticated legacy session for the same XSP-v2 operation.
- [ ] Process/container E2E covers Node strict TLS → trusted boundary → ACK auth/commit → signer → signed receipt → retry.
- [ ] PR CI/review/fixed-head merge/post-merge exact-SHA CI required before P0-D.

## P0-D — production-capable Agent workflow

After C2:

- integrate the Go 1.27 strict transport and XSP/2 message primitives into a production-capable Agent design;
- provision trusted panel pins and verified Node key custody;
- deliver signed desired configs/commands/responses;
- bind real applied state to ACK;
- persist permit/ACK/receipt state durably across restart;
- retain previous keys until separately proven retirement;
- exercise a real disposable Nexus↔Node E2E;
- design the operator flow so an Agent update can migrate safely without per-node manual SSH/key copying.

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
10. clean up merged/superseded working branches after verifying their unique changes are in `main`;
11. only then start the next gate.

Never rewrite already-applied SQL migrations for cleanup; use additive migrations. Never weaken strict Clippy/security checks merely for green CI. Never treat a GitHub merge as production deployment.

## Production-change authorization

Normal roadmap/code work does **not** authorize changes to production VPS/live containers, DNS/firewall/public Nginx, production PostgreSQL data/roles by manual action, real Node/private panel signing keys, live VPN credentials, `strict-pq` activation or legacy-key retirement. Those require an explicit deployment step after the relevant engineering/security gates.

## Parallel non-XSP hardening tracks

Backup/disaster recovery, deployment security, browser E2E/UI quality, supply-chain provenance, HA/scalability, observability and independent validation remain separate tracks and must not weaken the active XSP-v2 P0 gates.

## Historical archive

Previous long-form roadmaps and READMEs are preserved under [`archive/`](archive/). If an archived statement conflicts with this file, **this file is authoritative**.
