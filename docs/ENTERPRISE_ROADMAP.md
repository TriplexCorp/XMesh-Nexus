# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 28 October 2026

This file defines the **current order of work**. Historical roadmaps/checkpoints are preserved at [`archive/ENTERPRISE_ROADMAP_2026-10-27.md`](archive/ENTERPRISE_ROADMAP_2026-10-27.md) and do **not** override this document.

### Verified source checkpoints

- **Nexus `main`:** [`bd2f7d5aac556a5aee2ae78b047b43f4c65eef85`](https://github.com/TriplexCorp/XMesh-Nexus/commit/bd2f7d5aac556a5aee2ae78b047b43f4c65eef85), merge of [PR #61](https://github.com/TriplexCorp/XMesh-Nexus/pull/61).
- **Node `main` baseline:** [`d4572b406ac9a209cfbade84a4390569bd38ba92`](https://github.com/TriplexCorp/XMesh-Node/commit/d4572b406ac9a209cfbade84a4390569bd38ba92).
- On the Nexus merge SHA, [Backend CI #40586429332](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40586429332) — **success**.
- On the same merge SHA, [Rust/OpenSSL XSP-v2 Crypto #40586429301](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40586429301) — **success**, including the separate **Isolated signer image, ACL and Unix-socket E2E** job.
- PR #61 pre-merge checks also passed on exact head `f6b888af783ee66ba1a5c5a84fc9d6e92d7afc49`.

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
| Atomic ACK → epoch commit/readback | **STAGING PASS** | PostgreSQL transaction/CAS and committed evidence; not a network endpoint |
| Signed commit receipt + immutable outbox | **STAGING PASS** | Exact durable bytes, dedupe/recovery, truncate guards; not arbitrary multi-epoch recovery |
| Isolated `panel_response` signer | **P0 COMPLETE in staging/process scope** | PR #61: real image/process/socket, key isolation, least-privilege DB role, failure/concurrency/recovery tests, pre-merge and post-merge CI |
| **P0-C1: dedicated PQ-only Node ingress** | **CURRENT P0** | Prove one real isolated network ingress and every protected hop; no ACK route yet |
| P0-C2: authorized ACK route | **BLOCKED on C1** | Only after transport proof: independent Node authentication/authorization + exact signed ACK/outbox binding |
| P0-D: production-capable Agent workflow | **BLOCKED** | Integrate trusted permit → applied state → ACK → signed receipt/retry; signed configs/commands/responses |
| P0-E: recovery/security release gates | **BLOCKED** | Crash/power-loss/snapshot rollback, anti-rollback, backup/rotation, fuzz/KAT, independent security review |
| Production XSP-v2 rollout | **NOT AUTHORIZED** | Disposable canary and explicit deployment approval only after all previous gates |

## Completed P0 — isolated signer process/socket E2E

Merged as PR #61 and verified again after merge on `main`.

Acceptance evidence:

- [x] Real signer Docker runtime is built with experimental PQ support; default Nexus production image still does not compile `xsp-v2-experimental`.
- [x] Signer and API use distinct UID identities with a shared protected Unix-socket group; no signer TCP listener.
- [x] Signer private PEMs are absent from the API process/container.
- [x] Owner-approved Ed25519 and ML-DSA-65 key-ID pins are checked.
- [x] Real migrations and signer provisioning SQL execute against disposable TimescaleDB/PostgreSQL.
- [x] `xmesh_signer_reader` is checked for role name, read-only default, privileged attributes, memberships and effective object privileges.
- [x] Tests reject writes, DDL, `TEMP`, unrelated reads, sequence privileges, dangerous grants and unexpected SECURITY DEFINER access.
- [x] Key ownership/mode, symlink/hardlink and socket-directory checks fail closed.
- [x] Real committed dual-signed ACK evidence is re-read by the signer before signing.
- [x] API-side code independently verifies receipt signatures/bindings before persistence.
- [x] Durable retry returns exact persisted bytes without a new epoch CAS and can recover while signer is unavailable.
- [x] Concurrent requests, epoch races, malformed/oversized input, wrong peer/identity/request, DB stalls, stale socket, signer termination/restart and relevant corruption paths are exercised.
- [x] Strict experimental Clippy/formatting, dedicated process E2E, Backend CI and Crypto CI passed after merge.

Limits that remain explicit:

- not an HSM; host root/DB administrator remain inside the trust boundary;
- no guarantee of exactly-once signing before the first durable receipt INSERT;
- no whole-machine snapshot anti-rollback guarantee;
- no production key lifecycle/retirement approval from this gate;
- no proof of Node↔Nexus PQ network transport from this gate.

## CURRENT P0 — P0-C1: dedicated PQ-only Node ingress

### Goal

Produce a reproducible, isolated **network-level** proof that a future Node can establish the required authenticated hybrid TLS connection to a dedicated Node ingress and that no weaker transport path is silently available.

This stage is intentionally **HTTP-inert**. It must not expose `/api/v2/node/keys/rotation/ack` or proxy traffic into legacy Nexus APIs.

### Existing foundation — not sufficient by itself

Current repository code already has:

- `deploy/xsp-v2-node-ingress.nginx.conf.example`: loopback Nginx lab, TLS 1.3 only, `X25519MLKEM768`, sessions/tickets disabled, HTTP 404, no `proxy_pass`;
- `scripts/check-xsp-nginx-isolated.py`: real Nginx/OpenSSL 3.5 handshake, negotiated-group assertion and negative TLS tests;
- `scripts/check-xsp-hybrid-tls.py`: independent OpenSSL server/client tests plus Go strict probe interoperability;
- `.github/workflows/xsp-hybrid-tls.yml`: isolated Go 1.27 + OpenSSL/Nginx CI;
- XMesh-Node `security/xspv2/poc-go/tlsprobe.DialStrict`: TLS1.3-only, curve preference `X25519MLKEM768`, hostname/root verification, `DidResume=false`, and direct check of `ConnectionState.CurveID`.

These prove a **laboratory handshake**, not a production Nexus ingress or a complete multi-hop architecture.

### Acceptance criteria

#### A. Dedicated runtime boundary

- [ ] Add a dedicated XSP-v2 ingress runtime/container or equivalently isolated reproducible service. It must not replace the existing public panel `:443` vhost.
- [ ] No default Compose/install path activates it. Any development profile remains explicit opt-in.
- [ ] No legacy API route is reachable through this stage; successful TLS followed by HTTP must fail inertly (for example 404).
- [ ] No redirects, compatibility listener, alternate classical port, `proxy_pass` to current `XMESH1`, or insecure mode.
- [ ] Runtime is least-privilege: non-root where practical, read-only filesystem where practical, no unnecessary capabilities, bounded logs and no secret request logging.

#### B. Cryptographic transport proof

- [ ] Positive handshake proves TLS **1.3**.
- [ ] Positive handshake proves the **actual** negotiated group is exactly `X25519MLKEM768`; configured/supported groups alone are insufficient.
- [ ] Certificate chain is verified against the intended trust root and hostname/SNI is exact.
- [ ] Proof path requires a fresh full handshake; resumed handshake cannot count as key-exchange evidence.
- [ ] TLS 1.2 fails.
- [ ] TLS 1.3 with X25519-only fails.
- [ ] Wrong hostname/SNI fails.
- [ ] Untrusted/incorrect certificate fails.
- [ ] A strict Go 1.27 Node probe and an independent OpenSSL 3.5+ observation agree on the valid path.
- [ ] If the required PQ group/provider is unavailable, startup/test/connectivity fails closed rather than enabling a weaker group.

#### C. Hop accounting

- [ ] Document the exact trust boundary and number of network hops for this gate.
- [ ] CI must prove the tested topology contains **one protected Node→terminator hop and no onward application hop**. This prevents a hybrid edge from being misrepresented as end-to-end PQ protection.
- [ ] Before a later proxy/API integration is accepted, any terminator→origin transition must receive its own security design and proof. A plaintext/classical network hop may not be hidden behind a PQ edge claim.

#### D. CI / regression contract

- [ ] Add a process/container-level ingress E2E gate to the hybrid TLS workflow, not only source-regex checks.
- [ ] The gate must fail if the test does not actually execute the required handshake.
- [ ] Retain static checks that the live installer does not enable the ingress and that the ACK route remains unmounted.
- [ ] PR CI, security review of the diff, merge and post-merge CI on the exact SHA are required before P0-C2 begins.

### Explicitly out of scope for C1

- `POST /api/v2/node/keys/rotation/ack`;
- Node application authentication/authorization for an HTTP request;
- forwarding to Nexus API;
- permit issuance;
- production Agent integration;
- production DNS/ACME/firewall/Nginx modification;
- `strict-pq` activation;
- live Node key rotation.

## Next gate — P0-C2: authorized ACK route

Only after C1 is green and merged:

- create a narrow Node-only route behind the proven transport boundary;
- independently authenticate/authorize Node identity — do not trust a body `nodeId` by itself;
- bind authenticated identity to exact dual-signed ACK, permit, request ID, nonce, candidate, epoch and historical keysets;
- use the protected signer/outbox path; a successful HTTP status never substitutes for the signed receipt;
- preserve idempotent retry and first durable exact-byte receipt;
- negative/replay/concurrency/lost-response tests are mandatory;
- no path from a failed PQ handshake to a legacy authenticated session.

## P0-D — Agent integration

After transport + route gates:

- integrate the Go 1.27 strict transport and XSP/2 message primitives into a production-capable Agent design;
- provision trusted panel pins and verified Node key custody;
- deliver signed desired configs/commands/responses;
- bind real applied state to ACK;
- persist permit/ACK/receipt state durably across restart;
- retain previous keys until separately proven retirement;
- exercise a real Nexus↔Node disposable E2E rather than a local fake HTTPS server.

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
3. **Browser E2E / UI quality:** real browser coverage for login/MFA/RBAC, CRUD, settings, modal lifecycle, responsive/mobile behavior and known standalone JS contract failures.
4. **Supply chain:** dependency advisories, immutable action/image pinning, release artifact provenance and signed release/tag policy.
5. **HA/scalability:** current Compose is single-panel/single-PostgreSQL/single-Redis; no claim of automatic failover.
6. **Observability:** security-safe diagnostics, alerting and operational evidence without leaking bearer URLs, private keys, signatures or DB credentials.
7. **Independent validation:** source review and CI are not a penetration test or production acceptance.

## Mandatory development process

For each security-sensitive gate:

1. re-check current Nexus/Node `main`, open PRs and exact CI state;
2. create one focused branch;
3. implement only the current gate;
4. add positive, negative, concurrency/failure tests appropriate to the boundary;
5. open PR with explicit threat model and out-of-scope list;
6. require relevant CI and review;
7. merge only a fixed reviewed head SHA;
8. re-check post-merge `main` and CI;
9. update this Roadmap/README with claims no stronger than the evidence;
10. only then start the next gate.

Never rewrite already-applied SQL migrations for cleanup; use additive migrations. Never weaken strict Clippy/security checks merely for green CI. Never treat a GitHub merge as production deployment.

## Production-change authorization

Normal roadmap/code work does **not** authorize changes to:

- production VPS or live containers;
- DNS, firewall or public Nginx;
- production PostgreSQL data/roles by manual action;
- real Node private keys or panel signing keys;
- live VPN user credentials;
- `strict-pq` activation or retirement of legacy control keys.

Those require an explicit deployment step after the relevant engineering/security gates.

## Historical archive

The previous 27 October 2026 Enterprise Roadmap — including all detailed historical checkpoints, UI/operations backlog and earlier P0 wording — is preserved byte-for-byte at [`archive/ENTERPRISE_ROADMAP_2026-10-27.md`](archive/ENTERPRISE_ROADMAP_2026-10-27.md). If an archived statement conflicts with this file, **this file is authoritative**.
