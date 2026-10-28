# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages Nodes, users, subscriptions, Xray configuration, telemetry and security state. User VPN traffic remains the **Xray-core data-plane**; XMesh is the control plane.

[Русский](README.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 checkpoint — 28 October 2026

**Latest verified Nexus implementation checkpoint:** [`037290bbb31dc6e5d155a14b8ddf58a31e21066f`](https://github.com/TriplexCorp/XMesh-Nexus/commit/037290bbb31dc6e5d155a14b8ddf58a31e21066f), merge of [PR #73](https://github.com/TriplexCorp/XMesh-Nexus/pull/73).

P0-C2-D1 — the integrated real-Node staging E2E — is complete in **isolated staging/process scope**:

`Node strict client → TLS1.3/X25519MLKEM768 + ML-DSA-65 mTLS → trusted ingress/origin → dual-signed ACK auth/DB commit → isolated signer → Node-verified durable dual-signed receipt`

Exact post-merge evidence on `037290bbb31dc6e5d155a14b8ddf58a31e21066f`:

- [XSP-v2 C2-D1 Integrated Process E2E #40720824028](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40720824028) — **success**;
- [Backend CI #40720823715](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40720823715) — **success**.

The C2-D1 workflow pins verified XMesh-Node merge [`3c49fd9b81293f53f7bc599a4bfab5a4c2040164`](https://github.com/TriplexCorp/XMesh-Node/commit/3c49fd9b81293f53f7bc599a4bfab5a4c2040164), merge of Node PR #30, so cross-repository evidence is reproducible.

Earlier signer P0, C1 PQ-only ingress, C2-A trusted origin, C2-B narrow ACK gate and C2-C cryptographic ACK/transaction/signer gates remain complete in their stated staging/process scopes.

Production Node still uses the legacy Go 1.23 control path. Go 1.27 XSP-v2 code remains staging/research code. `strict-pq` remains OFF and no production VPS, DNS, firewall, public Nginx, production PostgreSQL or real-key change has been made.

## Completed XSP-v2 gates

### P0 — isolated signer

PR #61 proved a separate signer process/socket boundary, protected key mounts, peer UID/GID checks, owner-approved Ed25519/ML-DSA-65 pins, least-privilege read-only signer DB role, committed ACK readback and immutable receipt recovery.

### P0-C1 — dedicated PQ-only ingress

PR #64 proved TLS **1.3 only**, actually negotiated `X25519MLKEM768`, trusted certificate/hostname verification, fresh handshakes and fail-closed downgrade negatives. The C1 runtime remains isolated from the normal Nexus API and inactive in the default installer/Compose deployment.

### P0-C2-A — trusted Node identity / protected origin

PR #66 proved:

`Node test client → TLS1.3/X25519MLKEM768 + ML-DSA-65 client identity → dedicated ingress → protected Unix-domain socket → origin verifier`

Trusted Node identity comes from verified ML-DSA-65 client-certificate SPKI plus protected Unix peer credentials, never caller `nodeId`, arbitrary headers, source IP or legacy `XMESH1` identity.

### P0-C2-B — narrow ACK route

PR #69 mounted only exact staging `POST /api/v2/node/keys/rotation/ack` behind the proven hybrid-mTLS→UDS identity boundary. It introduced no broad proxy, generic API route or classical/TCP backend hop. C2-B remained structural-only and deliberately returned `authorizationStatus: "not-verified"`.

### P0-C2-C — cryptographic ACK authorization and transaction — COMPLETE

PR #71 connects the trusted C2-B origin boundary to existing XSP-v2 crypto and durable-state foundations without creating a competing state machine.

Tested local path:

`trusted C2-B origin → protected UDS C2-C service → dual-signature ACK verification → PostgreSQL ACK/epoch commit → isolated signer → immutable dual-signed receipt`

C2-C proves:

- ACK authorization requires **Ed25519 AND ML-DSA-65** against the owner-enrolled `node_request` keyset;
- trusted transport Node identity is bound to exact ACK bytes, request ID, nonce, permit, candidate and epoch state;
- stale/tampered/wrong-peer evidence fails closed;
- the existing atomic ACK→epoch PostgreSQL transition is reused;
- the dedicated `xmesh_c2c_writer` role remains least-privilege;
- signer-down after ACK commit returns no false policy success;
- signer recovery/concurrent retry converges to one durable dual-signed receipt;
- durable receipt recovery works without a second epoch transition;
- DB stall fails closed;
- old public keys remain unretired;
- C2-C has no signer private-key mount or TCP listener;
- default production router/Compose/installer remain unchanged.

Known limit: C2-C does **not** claim exactly-once signing before the first durable outbox INSERT. The first durable receipt remains authoritative.

### P0-C2-D1 — real Node integrated E2E — COMPLETE

PR #73 proves the first integrated half of C2-D using the real staging Node cutover code instead of starting only at the trusted origin boundary.

D1 proves:

- the Node verifies and journals the exact signed permit and ACK;
- the exchange uses TLS 1.3 + actually negotiated `X25519MLKEM768` + ML-DSA-65 mutual TLS;
- another otherwise-valid ML-DSA client cannot impersonate the pinned Node;
- one request crosses ingress → protected origin UDS → C2-C → PostgreSQL → isolated signer;
- the Node treats success as valid only after verifying **Ed25519 AND ML-DSA-65** on the commit receipt and durably journaling it;
- a restarted Node test process can re-authenticate an already-durable local permit/ACK/receipt witness after permit expiry without treating that expired permit as a new command;
- no host-published port is introduced and the production Agent remains untouched.

D1 intentionally does **not** weaken ACK freshness. Network retransmission of an expired ACK is still rejected and belongs to D2.

## CURRENT P0 — P0-C2-D2: failure, retry and recovery matrix

Overall P0-C2-D remains **CURRENT P0** until D2 passes. D2 must preserve the D1 chain while closing every remaining failure/recovery requirement:

1. exact network retry after the ACK freshness window returns the same durable receipt bytes **only** for an exact already-committed ACK, with no stale new transition, re-signing or second epoch transition;
2. racing duplicate ACKs, replay and mismatched payloads fail or converge only to the immutable committed record;
3. lost response before durable ACK commit;
4. lost response after ACK commit but before durable receipt persistence/reply;
5. lost response after durable receipt persistence, with exact-byte recovery and no re-signing;
6. signer, DB, origin and C2-C outage/restart fail closed without legacy fallback;
7. restarts around security-state transitions preserve durable recovery semantics;
8. failed PQ handshake, wrong client certificate or downgrade attempt cannot reach the ACK operation through a legacy authenticated session;
9. no new public port, broad proxy, classical-only internal hop or signer-key exposure appears;
10. old keys remain retained until a separate retirement workflow;
11. HTTP status alone is never success; the Node must validate the exact dual-signed receipt;
12. fixed-head PR CI/review/merge and post-merge exact-SHA CI are mandatory before P0-D.

After all of C2-D, the next major gate is **P0-D**: integrate the proven XSP-v2 transport/state machine into a production-capable Agent workflow so an operator can eventually update an Agent from the Nexus UI and have migration, validation and recovery happen automatically.

## Security guardrails

- `strict-pq` remains **OFF**.
- Production control-plane behavior remains legacy `XMESH1` / Ed25519 until separately approved replacement gates are complete.
- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate validation.
- C2-D1 is staging/process proof, not production activation.
- A GitHub merge is not a production deployment.
- Xray continues to carry user VPN traffic.

## Architecture

```text
Administrator ─HTTPS─> Nexus public Nginx ─loopback─> XMesh Nexus (Rust/Axum)
                                                    │
                                      PostgreSQL / TimescaleDB
                                                    │
                                                   Redis

Experimental XSP-v2 staging path (not production-activated):
Node strict client
  └─ TLS1.3 / X25519MLKEM768 + ML-DSA-65 client identity
      └─ dedicated ingress
          └─ protected UDS origin
              └─ protected UDS C2-C authorization service
                  ├─ PostgreSQL ACK/epoch state
                  └─ protected UDS isolated signer
                      └─ immutable dual-signed receipt
                          └─ Node verifies + durable local journal
```

## Install

On supported Ubuntu 22.04/24.04 hosts, point the panel domain DNS to the VPS, allow TCP/80 and TCP/443, install Git, then run:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/TriplexCorp/XMesh-Nexus.git
cd XMesh-Nexus
bash install.sh
```

The managed installer provisions Docker/Compose, PostgreSQL/TimescaleDB, Redis, the Rust API, Nginx and Certbot. Back up PostgreSQL together with persistent signing/encryption identities. Never publish `.env`, private keys, MFA material or subscription bearer URLs.

## Core capabilities

- Node enrollment, signed control requests, heartbeat, runtime state and managed updates.
- XRAY STUDIO configuration and validation workflows.
- Users, squads, quotas and per-protocol credentials.
- Native Xray JSON subscriptions and public subscription portal.
- PostgreSQL/TimescaleDB telemetry and traffic accounting.
- Owner/admin/viewer RBAC, Argon2 authentication, sessions, TOTP MFA and audit controls.
- Managed Xray-core release validation and installation.
- Feature-gated XSP-v2 foundations for a future fail-closed post-quantum control plane.

## Development process

Security-sensitive changes follow:

`focused branch → PR → required CI → review → merge fixed head SHA → post-merge CI on exact SHA → documentation checkpoint → branch cleanup → next gate`.

The default Nexus backend does not compile `xsp-v2-experimental`. Do not weaken strict Clippy or security contracts merely to obtain green CI.

## Documentation

- [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md)
- [XSP-v2 PQ-only security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md)
- [XSP-v2 signer E2E](docs/XSP_V2_SIGNER_E2E.md)
- [XSP-v2 TLS / ingress-origin proof](docs/XSP_V2_TLS_PROBE.md)
- [Subscription security](docs/SUBSCRIPTION_SECURITY.md)

Historical long-form README content through 27 October 2026 is preserved under [`docs/archive/`](docs/archive/). Archived “current/next P0” statements do not override the current Roadmap.

---

XMesh Nexus is under active development. Code or a green isolated test alone does not establish enterprise/HA readiness, production PQ protection or successful deployment.
