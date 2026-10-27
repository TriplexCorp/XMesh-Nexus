# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 28 October 2026

This file defines the **current order of work**. Historical roadmaps/checkpoints are preserved under [`archive/`](archive/) and do **not** override this document.

### Verified source checkpoints

- **Latest verified Nexus implementation checkpoint:** [`d295ea7fd17dbcda6db6f946bb892277a55dd001`](https://github.com/TriplexCorp/XMesh-Nexus/commit/d295ea7fd17dbcda6db6f946bb892277a55dd001), merge of [PR #64](https://github.com/TriplexCorp/XMesh-Nexus/pull/64).
- **Current XMesh-Node staging transport checkpoint:** [`79cee45174f7670707d22a269784fe117c44743c`](https://github.com/TriplexCorp/XMesh-Node/commit/79cee45174f7670707d22a269784fe117c44743c), merge of [Node PR #29](https://github.com/TriplexCorp/XMesh-Node/pull/29).
- On the Nexus implementation checkpoint, [XSP-v2 Hybrid TLS Probe #40592253543](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40592253543) — **success**, including **Dedicated PQ-only ingress container and network E2E**.
- On the same Nexus implementation checkpoint, [Backend CI #40592253598](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40592253598) — **success**.
- PR #64 pre-merge exact head `05bfdc16892632d0ac264542c2b3b9cf30e6acb0` passed [Hybrid TLS #40591238253](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40591238253) and [Backend CI #40591238382](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40591238382).
- On the Node merge SHA, [Node CI #40597143811](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143811) and [XSP-v2 Crypto PoC #40597143829](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143829) — **success**.
- Node PR #29 proves, in the isolated Go 1.27 staging probe, strict TLS 1.3 + `X25519MLKEM768` with an **ML-DSA-65 client certificate**, including fail-closed rejection of anonymous, classical, wrong-algorithm and untrusted client identities.
- The earlier isolated signer P0 remains completed from PR #61 with its own pre/post-merge process/crypto/backend evidence.

A green test proves only its stated boundary. Code existence ≠ E2E ≠ security review ≠ production deployment.

## Binding XSP-v2 target invariant

The finished XSP-v2 control plane has **one** policy: fail closed.

All of the following are mandatory, never alternatives:

1. **Transport:** TLS 1.3 with the actually negotiated group `X25519MLKEM768`, a trusted certificate chain, correct hostname/SNI and no unreviewed weaker intermediate hop.
2. **Messages:** Ed25519 **AND** ML-DSA-65 verification for security-critical XSP/2 messages.
3. **Binding/state:** exact sender/recipient, direction, method/path, payload/revision, request ID, nonce, key epoch and expiry; durable replay protection and monotonic security state.
4. **Key custody/enrollment:** verified owner authorization, proof of possession, pinned trust roots and protected signing/private-key boundaries.
5. **Failure:** missing PQ support, invalid signature/certificate/state, stale epoch, replay or unavailable security component means reject — never automatic fallback to `XMESH1`, Ed25519-only, X25519-only, TLS 1.2 or insecure verification.

`strict-pq` remains **OFF** in current production. Legacy `XMESH1` remains the deployed control-plane reality until a separately approved replacement is proven. Xray remains the user VPN data-plane.

## Gate status

| Gate | Status | What is proven / required next |
| --- | --- | --- |
| Dual-signed permit / applied ACK primitives | **STAGING PASS** | Ed25519 AND ML-DSA-65, canonical binding, permit/nonce/epoch/candidate checks |
| Atomic ACK → epoch commit/readback | **STAGING PASS** | PostgreSQL transaction/CAS and committed evidence; not yet a network route |
| Signed commit receipt + immutable outbox | **STAGING PASS** | Exact durable bytes, dedupe/recovery, truncate guards; not arbitrary multi-epoch recovery |
| Isolated `panel_response` signer | **P0 COMPLETE in staging/process scope** | Real image/process/socket, key isolation, least-privilege DB role, failure/concurrency/recovery tests |
| P0-C1: dedicated PQ-only Node ingress | **P0 COMPLETE in isolated network/process scope** | PR #64: real isolated ingress, actual hybrid negotiation, fail-closed negatives, one-hop topology, pre/post-merge CI |
| Node mutual-TLS identity prerequisite | **P0-C2-A PREREQUISITE COMPLETE in isolated probe scope** | Node PR #29: ML-DSA-65 client-auth primitive with strict hybrid transport and negative identity tests |
| **P0-C2: authorized ACK route + origin trust boundary** | **CURRENT P0** | Preserve the authenticated Node identity across the ingress→origin boundary before mounting a narrow staging ACK route |
| P0-D: production-capable Agent workflow | **BLOCKED on C2** | Integrate trusted permit → applied state → ACK → signed receipt/retry; signed configs/commands/responses |
| P0-E: recovery/security release gates | **BLOCKED** | Crash/power-loss/snapshot rollback, anti-rollback, backup/rotation, fuzz/KAT, independent security review |
| Production XSP-v2 rollout | **NOT AUTHORIZED** | Disposable canary and explicit deployment approval only after all previous gates |

## Completed P0 — isolated signer process/socket E2E

Merged as PR #61. The signer remains an experimental staging/process boundary, not an HSM or production deployment.

Proven properties include separate signer/API identities, Unix-socket peer checks, private-key mount isolation, owner-approved Ed25519/ML-DSA-65 key pins, read-only least-privilege `xmesh_signer_reader`, committed ACK readback, API-side receipt reverification, immutable exact-byte recovery, concurrency/race/failure coverage and remote CI.

Remaining signer limits include host-root/DB-admin trust, no whole-machine snapshot anti-rollback guarantee, no guarantee of exactly-once signing before the first durable outbox INSERT and no production key-retirement authorization.

## Completed P0-C1 — dedicated PQ-only Node ingress

Merged as PR #64 and re-verified after merge on exact implementation SHA `d295ea7fd17dbcda6db6f946bb892277a55dd001`.

### A. Dedicated runtime boundary

- [x] Dedicated runtime under `deploy/xsp-v2-ingress/`; it does not replace the existing public panel `:443` vhost.
- [x] Default `compose.yaml` and installer do not activate it.
- [x] Successful TLS remains HTTP-inert: `/`, `/api/v2/node/keys/rotation/ack` and `/api/v1/node/heartbeat` return 404.
- [x] No redirect, compatibility listener, alternate classical path, `proxy_pass` or legacy `XMESH1` forwarding exists in the tested runtime.
- [x] Runtime E2E uses non-root execution, read-only root filesystem, `cap_drop=ALL`, `no-new-privileges`, internal/no-egress Docker network and no published host port.
- [x] Access logging is disabled for the experimental ingress and no request secret is intentionally logged by the runtime.

### B. Cryptographic transport proof

- [x] Positive path proves TLS **1.3**.
- [x] Positive path proves the **actually negotiated** group is exactly `X25519MLKEM768`.
- [x] Certificate chain and exact hostname/SNI are verified.
- [x] Proof uses fresh handshakes; session tickets/cache and early data are disabled and resumed state cannot substitute for new key-exchange evidence.
- [x] TLS 1.2 fails closed.
- [x] TLS 1.3 X25519-only fails closed.
- [x] Wrong hostname fails closed.
- [x] Untrusted/incorrect certificate fails closed.
- [x] Strict XMesh-Node Go 1.27 probe and independent OpenSSL 3.5+ observation agree on the valid path.
- [x] Mandatory group configuration is validated so an unavailable/invalid group fails rather than silently weakening the configuration.

### C. Hop accounting

- [x] The tested trust boundary is explicitly one **Node → TLS terminator** hop.
- [x] CI proves the disposable network contains the ingress but no Nexus/API/backend application container.
- [x] Therefore C1 makes no end-to-end claim about a terminator→origin hop.
- [x] Any later ingress→origin transition requires a separate reviewed design and proof before the ACK route can be accepted.

### D. CI / regression contract

- [x] `.github/workflows/xsp-hybrid-tls.yml` contains a separate process/container/network E2E job.
- [x] The E2E executes real handshakes through the real ingress process rather than only source-regex checks.
- [x] Static checks preserve installer/default-Compose isolation and keep the ACK route unmounted at C1.
- [x] PR exact-head CI passed.
- [x] Review surface had no submitted review or unresolved inline thread at merge time.
- [x] Merge used fixed reviewed head `05bfdc16892632d0ac264542c2b3b9cf30e6acb0`.
- [x] Post-merge Hybrid TLS and Backend CI passed on exact merge SHA `d295ea7fd17dbcda6db6f946bb892277a55dd001`.

### C1 limits

C1 is **not** a production Nexus↔Node deployment. It does not mount the ACK route, authenticate an application request, forward to the Nexus API, modify production DNS/ACME/firewall/public Nginx, update the production Agent, enable `strict-pq` or rotate live keys.

## Completed P0-C2-A prerequisite — Node ML-DSA-65 mutual TLS identity probe

Merged as XMesh-Node PR #29 and re-verified after merge on Node SHA `79cee45174f7670707d22a269784fe117c44743c`.

The isolated Go 1.27 staging probe now proves:

- [x] TLS 1.3 with the actually negotiated group `X25519MLKEM768`.
- [x] A client certificate using exactly ML-DSA-65 on the valid mutual-TLS path.
- [x] The server really requested and accepted the client certificate; client-side handshake completion alone is not treated as proof of server acceptance.
- [x] Anonymous/no-client-certificate attempts fail closed.
- [x] ML-DSA-44 client identities fail closed where ML-DSA-65 is mandatory.
- [x] Classical ECDSA client identities fail closed.
- [x] Untrusted ML-DSA-65 client identities fail closed.
- [x] Classical X25519-only transport fails closed.
- [x] Node CI and XSP-v2 Crypto PoC passed pre-merge and post-merge.

This is a **transport identity primitive only**. It does not authorize an ACK application message and production Agent code remains on the legacy Go 1.23 control path.

## CURRENT P0 — P0-C2: authorized ACK route behind a reviewed origin boundary

### Goal

Expose exactly one experimental Node-only ACK operation **only after** the transport terminator can pass the request into a separately trusted origin boundary without turning the C1 hybrid edge into a misleading security claim.

A design that merely adds `proxy_pass http://...` and trusts an injected `X-Node-ID` header is **not acceptable**. A body `nodeId`, arbitrary header, source IP, or legacy `XMESH1` credential cannot become the trusted transport identity for XSP-v2.

### C2-A — ingress→origin trust boundary

Node PR #29 provides the tested mutual-TLS identity primitive at the edge. C2-A must preserve that authenticated identity across the ingress→origin transition without converting it into caller-controlled metadata.

Before mounting the route:

- [ ] Choose and document a narrow ingress→origin mechanism whose trust properties are independently enforceable and testable. Examples may include a protected local process/Unix-socket boundary or a separately authenticated origin transport; the implementation must be reviewed rather than assumed safe.
- [ ] Prevent arbitrary network clients or the normal public API path from impersonating the ingress/origin identity.
- [ ] Bind the authenticated transport/session context to one trusted Node identity in a form the ACK handler can consume without trusting caller-controlled headers/body fields.
- [ ] Prove the origin hop cannot downgrade to plaintext/classical unauthenticated network transport while still reporting success as “PQ protected”.
- [ ] Keep the boundary staging-only and disabled by default installer/Compose configuration.
- [ ] Add process-level positive and spoofing/alternate-path negative tests for the exact boundary.

### C2-B — narrow staging ACK route

Only after C2-A is proven:

- [ ] Mount only `POST /api/v2/node/keys/rotation/ack` in the experimental staging path; do not expose a broad legacy API proxy.
- [ ] Feature-gate and runtime-gate the route; default production backend remains without active XSP-v2 network routes.
- [ ] Enforce exact content type, size/time bounds and no secret request logging.
- [ ] Use the trusted Node identity from C2-A. Never authorize from body `nodeId`, arbitrary headers, source IP or legacy `XMESH1` identity.
- [ ] Require the exact XSP/2 message type/method/path/direction bindings.

### C2-C — cryptographic ACK authorization and transaction

- [ ] Verify **Ed25519 AND ML-DSA-65** against the owner-enrolled Node request keyset for the required historical/current epoch.
- [ ] Bind authenticated Node identity to the exact ACK bytes, request ID, nonce, candidate, permit, epoch and committed ledger state.
- [ ] Require the independently signed recovery/authority assertion where the staged recovery flow requires it; it must be bound to the exact saved ACK bytes.
- [ ] Consume replay nonce exactly once and reject stale/revoked/wrong-epoch/wrong-node/wrong-path/wrong-request/wrong-candidate evidence.
- [ ] Preserve atomic ACK→epoch semantics already proven by staging DB helpers.
- [ ] Call the isolated signer only after committed ACK evidence exists and preserve API-side receipt reverification.
- [ ] Persist/recover the immutable first durable signed receipt through the outbox.
- [ ] HTTP status alone must never be treated as policy success; the Node requires the valid signed receipt.

### C2-D — failure / retry / E2E gate

- [ ] Exact retry returns the same durable receipt bytes and performs no second epoch transition.
- [ ] Replayed nonce/request, duplicate racing ACKs and mismatched payloads fail or converge only according to the immutable committed record.
- [ ] Lost client response before/after durable commit is exercised.
- [ ] Signer unavailable, DB stall, boundary unavailable and process restart fail closed without legacy fallback.
- [ ] Failed PQ handshake cannot reach an authenticated legacy session for the same XSP-v2 operation.
- [ ] Process/container E2E covers Node strict TLS → trusted origin boundary → ACK verification/commit → signer → signed receipt → retry.
- [ ] PR CI, review, fixed-head merge and post-merge exact-SHA CI are required before P0-D begins.

### Explicitly out of scope for C2

- production Agent replacement;
- public/default panel API migration;
- production DNS/ACME/firewall/public Nginx edits;
- `strict-pq` activation;
- live Node key rotation;
- retirement of legacy keys;
- claim of whole-system snapshot anti-rollback;
- production rollout.

## P0-D — production-capable Agent workflow

After transport + authorized route gates:

- integrate the Go 1.27 strict transport and XSP/2 message primitives into a production-capable Agent design;
- provision trusted panel pins and verified Node key custody;
- deliver signed desired configs/commands/responses;
- bind real applied state to ACK;
- persist permit/ACK/receipt state durably across restart;
- retain previous keys until separately proven retirement;
- exercise a real disposable Nexus↔Node E2E rather than only local fake servers.

## P0-E — release/security gates

Before any production replacement:

- process crash and SIGKILL at every state transition;
- lost response before/after durable commit;
- DB restore and filesystem restore;
- full VM/disk snapshot rollback threat model and anti-rollback design;
- backup/restore of persistent identities and encryption keys;
- key rotation/retirement procedures;
- FIPS 204 / ML-DSA external KAT and fuzzing where applicable;
- independent security review / penetration testing of deployed topology;
- disposable canary with actual negotiated-group evidence on every protected hop.

Only then may an operator separately authorize production replacement. The final product must not expose a user-facing “use classical/fallback” mode.

## Non-XSP enterprise hardening tracks

These continue independently unless they conflict with the active P0 security work:

1. **Backup / disaster recovery:** restore PostgreSQL together with TOTP/subscription/policy-signing identities; cold-boot and full-host recovery exercises.
2. **Deployment security:** firewall, host permissions, Docker daemon, Nginx/TLS, `.env`, backup storage and real deployed SHA verification.
3. **Browser E2E / UI quality:** real browser coverage for login/MFA/RBAC, CRUD, settings, modal lifecycle and responsive/mobile behavior.
4. **Supply chain:** dependency advisories, immutable action/image pinning, release artifact provenance and signed release/tag policy.
5. **HA/scalability:** current Compose is single-panel/single-PostgreSQL/single-Redis; no claim of automatic failover.
6. **Observability:** security-safe diagnostics and alerting without leaking bearer URLs, private keys, signatures or DB credentials.
7. **Independent validation:** source review and CI are not a penetration test or production acceptance.

## Mandatory development process

For each security-sensitive gate:

1. re-check current Nexus/Node `main`, open PRs and exact CI state;
2. create one focused branch;
3. implement only the current gate/sub-gate;
4. add positive, negative, replay/concurrency/failure tests appropriate to the boundary;
5. open PR with explicit threat model and out-of-scope list;
6. require relevant CI and review;
7. merge only a fixed reviewed head SHA;
8. re-check post-merge `main` and CI;
9. update this Roadmap/README with claims no stronger than the evidence;
10. only then start the next gate.

Never rewrite already-applied SQL migrations for cleanup; use additive migrations. Never weaken strict Clippy/security checks merely for green CI. Never treat a GitHub merge as production deployment.

## Production-change authorization

Normal roadmap/code work does **not** authorize changes to production VPS/live containers, DNS/firewall/public Nginx, production PostgreSQL data/roles by manual action, real Node/private panel signing keys, live VPN credentials, `strict-pq` activation or legacy-key retirement. Those require an explicit deployment step after the relevant engineering/security gates.

## Historical archive

Previous long-form roadmaps and READMEs are preserved under [`archive/`](archive/). If an archived statement conflicts with this file, **this file is authoritative**.
