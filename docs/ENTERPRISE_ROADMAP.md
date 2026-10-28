# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 28 October 2026

This file defines the **current order of work**. Historical roadmaps/checkpoints under [`archive/`](archive/) do **not** override this document.

A green test proves only its stated boundary. Code existence ≠ E2E ≠ security review ≠ production deployment.

## Verified source checkpoints

- **Nexus C2-B implementation checkpoint:** [`a3e18fae4cf9cd0d354e536ede285d952c54d1c8`](https://github.com/TriplexCorp/XMesh-Nexus/commit/a3e18fae4cf9cd0d354e536ede285d952c54d1c8), merge of [PR #69](https://github.com/TriplexCorp/XMesh-Nexus/pull/69).
- PR #69 exact pre-merge head `4e079378f6f43eedced167b5fdde7d1b37568ad4` passed [XSP-v2 Hybrid TLS Probe #40606304019](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40606304019) and [Backend CI #40606304071](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40606304071).
- On exact C2-B merge SHA, [XSP-v2 Hybrid TLS Probe #40607355530](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40607355530) — **success**, including `tls-hybrid`, `PQ client identity and Unix origin boundary E2E`, and `C2-B narrow staging ACK route E2E`.
- On the same C2-B merge SHA, [Backend CI #40607355446](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40607355446) — **success**, including strict Clippy, Docker build and disposable PostgreSQL/Redis/API authentication integration.
- **XMesh-Node staging transport checkpoint:** [`79cee45174f7670707d22a269784fe117c44743c`](https://github.com/TriplexCorp/XMesh-Node/commit/79cee45174f7670707d22a269784fe117c44743c), merge of [Node PR #29](https://github.com/TriplexCorp/XMesh-Node/pull/29); [Node CI #40597143811](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143811) and [XSP-v2 Crypto PoC #40597143829](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143829) passed.
- Earlier signer P0 (PR #61), dedicated PQ-only ingress P0-C1 (PR #64) and trusted ingress→origin identity boundary P0-C2-A (PR #66) remain complete in their stated staging/process scopes.

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
| Atomic ACK → epoch commit/readback | **STAGING PASS** | PostgreSQL transaction/CAS and committed evidence; integration into network path is C2-C |
| Signed commit receipt + immutable outbox | **STAGING PASS** | Exact durable bytes, dedupe/recovery and mutation guards |
| Isolated `panel_response` signer | **P0 COMPLETE — staging/process** | PR #61; process/socket/key isolation/DB-role/failure/recovery evidence |
| P0-C1 dedicated PQ-only Node ingress | **P0 COMPLETE — isolated network/process** | PR #64; actual hybrid negotiation, fail-closed negatives, one-hop topology |
| Node ML-DSA-65 client identity primitive | **C2-A PREREQUISITE COMPLETE** | Node PR #29; mutual-TLS client identity and negative cases |
| P0-C2-A ingress→origin trust boundary | **P0 COMPLETE — isolated staging/process** | PR #66; verified client identity → stripped ingress → protected UDS → peercred/pinned-SPKI Node identity |
| P0-C2-B narrow staging ACK route | **P0 COMPLETE — isolated staging/process** | PR #69; one exact gated ACK structural operation, no broad proxy, no crypto/DB authorization |
| **P0-C2-C ACK crypto/transaction/signer** | **CURRENT P0** | Connect trusted boundary to dual-signature auth, replay/epoch/permit binding, atomic commit and immutable signed receipt |
| P0-C2-D retry/failure/full E2E | **BLOCKED on C2-C** | Node strict TLS → boundary → ACK → DB → signer → receipt → retry/recovery |
| P0-D production-capable Agent workflow | **BLOCKED on C2** | Integrate real Agent migration/control state and update path |
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

`Node test client → TLS1.3/X25519MLKEM768 + ML-DSA-65 client identity → ingress → protected UDS → disposable origin verifier`

- [x] Ingress verifies the ML-DSA-65 client certificate on the strict hybrid TLS connection.
- [x] Caller headers/body/source IP/legacy identity are not trusted Node-ID sources.
- [x] Caller-controlled headers/body are stripped before the identity transition.
- [x] Origin has no network listener/published port and validates `SO_PEERCRED` UID/GID.
- [x] Trusted Node ID is derived from a pinned mapping of verified client-certificate SPKI SHA-256.
- [x] Anonymous/wrong/classical clients, forged headers and direct-origin impersonation fail closed.
- [x] C1 downgrade requirements remain enforced.

C2-A did not authorize an ACK or connect the origin identity proof to Nexus state transitions.

## Completed P0-C2-B — narrow staging ACK structural gate

Merged as Nexus PR #69 and re-verified on exact merge SHA `a3e18fae4cf9cd0d354e536ede285d952c54d1c8`.

Tested path:

`Node test client → strict hybrid mTLS → dedicated C2-B ingress → protected UDS → staging ACK structural gate`

### Acceptance evidence

- [x] Only exact `POST /api/v2/node/keys/rotation/ack` is mounted as an application operation.
- [x] Separate opt-in `runtime-c2b` and `origin-ack-gate` targets preserve the earlier C2-A runtime.
- [x] Runtime requires `XSP_V2_C2B_ACK_ROUTE=staging-only`; without it the ACK path is 404.
- [x] Default `compose.yaml`, `install.sh` and normal `backend/src/main.rs` do not activate or mount this ACK operation.
- [x] No broad proxy, generic upstream or TCP/plaintext backend hop was introduced.
- [x] ACK traffic crosses only the protected Unix socket.
- [x] Caller-controlled headers are stripped; origin re-checks `SO_PEERCRED`, verified client certificate and pinned SPKI→Node identity.
- [x] Body `nodeId`/issuer must match the trusted transport Node identity.
- [x] Exact method/path/content type/Content-Length/body-size/time bounds are enforced.
- [x] Strict envelope/message/signature-object key sets reject duplicate/unknown structures.
- [x] Epoch increment, issuer/key-role, nonce/digest and signed metadata structural bindings are checked.
- [x] Anonymous, alternate ML-DSA, classical client, body-identity spoof, wrong class/path, duplicate JSON key, direct UDS forgery and oversized-body cases fail closed.
- [x] Unrelated routes remain inert.
- [x] Exact-head pre-merge Hybrid and Backend CI passed.
- [x] Fixed-head PR #69 merged.
- [x] Post-merge Hybrid/C2-A/C2-B E2E passed on exact merge SHA.
- [x] Post-merge Backend CI including disposable DB/API integration passed on the same SHA.

### C2-B limit — binding

C2-B `202 Accepted` explicitly returns `authorizationStatus: "not-verified"`.

C2-B does **not** verify Ed25519/ML-DSA-65 ACK signatures, consume replay state, mutate PostgreSQL, advance a key epoch, call the signer, persist a receipt or establish policy success. Those are C2-C.

## CURRENT P0 — P0-C2-C: cryptographic ACK authorization and transaction

### Goal

Connect the proven C2-B transport/identity/route boundary to the existing dual-signature, durable ACK/epoch, isolated signer and immutable receipt foundations **without introducing a spoofable identity handoff or a weaker backend hop**.

### Mandatory architecture review before code

- [ ] Choose one reviewed internal handoff from C2-B trusted origin identity to the Rust cryptographic/DB boundary.
- [ ] The handoff must not trust an ordinary HTTP header, body field, source IP or legacy `XMESH1` identity as `trusted_transport_node_id`.
- [ ] Do not add a new TCP/classical-only hop. Prefer a protected local boundary with independently checkable peer identity (for example a dedicated Unix socket/process boundary).
- [ ] Keep the default production router and installer path unchanged until a later production gate.
- [ ] Reuse existing XSP-v2 ledger/signer/receipt primitives rather than create a second competing state machine.

### Required acceptance criteria

- [ ] Verify **Ed25519 AND ML-DSA-65** against the owner-enrolled `node_request` pending/to-epoch keyset.
- [ ] Bind trusted transport Node ID to exact ACK bytes, request ID, permit, candidate, from/to epoch, key IDs, nonce and expiry.
- [ ] Match ACK against the exact persisted permit/owner-approved proposal, not caller-supplied permit state.
- [ ] Consume durable replay evidence exactly once; reject stale/revoked/wrong-node/wrong-epoch/wrong-path/wrong-request/wrong-candidate evidence.
- [ ] Preserve the already-proven atomic ACK→epoch PostgreSQL CAS/commit semantics.
- [ ] Keep old public keys unretired; retirement remains a separate authorized workflow.
- [ ] Call the isolated signer only after committed ACK evidence exists.
- [ ] Signer independently re-reads committed evidence through its least-privilege DB role.
- [ ] Reverify signer result in the API-side trust boundary and persist/recover immutable first durable receipt bytes.
- [ ] Existing durable receipt returns exact stored bytes; ordinary retry must not request a new signature.
- [ ] Do not overclaim exactly-once signing before first durable outbox INSERT; test the known sign→insert concurrency/loss boundary explicitly.
- [ ] HTTP success alone never means policy success; Node requires a valid dual-signed commit receipt.
- [ ] Positive, tamper, replay, wrong-key/epoch/Node/path/request/candidate, concurrent duplicate, signer-down, DB-stall and rollback/failure tests appropriate to C2-C are required.
- [ ] PR CI, review, fixed-head merge and post-merge exact-SHA CI are required before C2-D.

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
10. verify all current changes are in `main` and clean up merged/superseded working branches;
11. only then start the next gate.

Never rewrite already-applied SQL migrations for cleanup; use additive migrations. Never weaken strict Clippy/security checks merely for green CI. Never treat a GitHub merge as production deployment.

## Production-change authorization

Normal roadmap/code work does **not** authorize changes to production VPS/live containers, DNS/firewall/public Nginx, production PostgreSQL data/roles by manual action, real Node/private panel signing keys, live VPN credentials, `strict-pq` activation or legacy-key retirement. Those require an explicit deployment step after the relevant engineering/security gates.

## Parallel non-XSP hardening tracks

Backup/disaster recovery, deployment security, browser E2E/UI quality, supply-chain provenance, HA/scalability, observability and independent validation remain separate tracks and must not weaken the active XSP-v2 P0 gates.

## Historical archive

Previous long-form roadmaps and READMEs are preserved under [`archive/`](archive/). If an archived statement conflicts with this file, **this file is authoritative**.
