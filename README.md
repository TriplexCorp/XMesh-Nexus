# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages nodes, users, subscriptions, Xray configuration, telemetry and security state. The user VPN data-plane remains **Xray-core**; XMesh is the control plane and must not be described as an extra encryption layer around user VPN traffic.

[English](README.en.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 engineering checkpoint — 28 October 2026

**Latest verified Nexus implementation checkpoint:** [`5acccfa1877016e464290b20ebba537c0b5bbad3`](https://github.com/TriplexCorp/XMesh-Nexus/commit/5acccfa1877016e464290b20ebba537c0b5bbad3), merge of [PR #77](https://github.com/TriplexCorp/XMesh-Nexus/pull/77).

This closes the first focused **P0-C2-D2** sub-gate: exact historical network recovery after the original ACK freshness window. It does **not** complete C2-D2 as a whole.

Exact post-merge evidence on `5acccfa1877016e464290b20ebba537c0b5bbad3`:

- [XSP-v2 C2-D2 Expired Recovery E2E #40735842801](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40735842801) — **success**;
- [XSP-v2 C2-C ACK Authorization #40735843175](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40735843175) — **success**;
- [XSP-v2 Hybrid TLS Probe #40735843132](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40735843132) — **success**;
- [Backend CI #40735843093](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40735843093) — **success**.

The previous D1 implementation checkpoint remains [`037290bbb31dc6e5d155a14b8ddf58a31e21066f`](https://github.com/TriplexCorp/XMesh-Nexus/commit/037290bbb31dc6e5d155a14b8ddf58a31e21066f), merge of PR #73. D1 proved the integrated real-Node chain; PR #77 closes only the expired exact-recovery gap discovered at the D1 boundary.

Production Node still uses the legacy Go 1.23 control path. Go 1.27 XSP-v2 transport/cutover code remains staging/research code. `strict-pq` remains OFF and no production VPS, DNS, firewall, public Nginx, production PostgreSQL or real-key change has been made.

## Completed XSP-v2 gates

### P0 — isolated signer

PR #61 proved the separate signer process/socket boundary, protected key mounts, peer UID/GID checks, owner-approved Ed25519/ML-DSA-65 pins, least-privilege read-only signer DB role, committed ACK readback and immutable receipt recovery.

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

D1 intentionally did not weaken ACK freshness. A second stale network ACK stayed rejected, which exposed the historical-recovery requirement now closed by PR #77.

### First P0-C2-D2 sub-gate — expired exact network recovery — COMPLETE

PR #77 proves a distinct historical-recovery domain without weakening the state-changing ACK route:

`real strict Node → TLS1.3/X25519MLKEM768 + ML-DSA-65 mTLS → exact historical recovery operation → trusted origin → XSP2C2H1 UDS domain → committed ACK + immutable receipt lookup → exact stored receipt → Node verification`

It proves:

- the ordinary fresh ACK route still rejects the expired ACK;
- historical recovery is separately distinguishable and remains behind the same authenticated PQ transport identity;
- the recovery ACK must match exact already-committed durable evidence;
- C2-C recovery reads only an already-durable immutable receipt and does not run fresh ACK commit/CAS;
- the signer can be stopped during recovery; no re-signing is required;
- the exact stored receipt is returned, epoch does not advance again, and outbox cardinality stays one;
- a mismatched ACK cannot recover another receipt;
- an alternate valid ML-DSA client identity cannot recover the pinned Node's receipt;
- HTTP status alone is still not success: the Node verifies the dual-signed receipt and bindings.

This is a **partial C2-D2 completion only**.

## CURRENT P0 — remaining P0-C2-D2 failure / retry / recovery matrix

Overall P0-C2-D remains **CURRENT P0**. The current verified implementation checkpoint is `5acccfa1877016e464290b20ebba537c0b5bbad3`.

Completed in PR #77:

1. exact network retry after the original ACK freshness window for an exact already-committed ACK;
2. exact immutable receipt recovery with no stale new transition, no re-signing and no second epoch transition;
3. targeted mismatched-ACK and alternate-client recovery negatives.

Still required before C2-D2 is complete:

1. complete racing duplicate ACK, replay and mismatched-payload convergence coverage;
2. lost response before durable ACK commit;
3. lost response after ACK commit but before durable receipt persistence/reply;
4. lost response after durable receipt persistence under an injected lost-response condition;
5. signer, DB, origin and C2-C outage/restart behavior across the integrated Node path;
6. restart around security-state transitions with durable recovery semantics;
7. failed PQ handshake, wrong client certificate and downgrade/no-legacy-fallback proof;
8. integrated topology assertions: no new public port, broad proxy, classical-only internal hop or signer-key exposure;
9. old-key retention/no automatic retirement across the remaining failure matrix;
10. final fixed-head PR CI/review/merge and post-merge exact-SHA CI before P0-D.

The next focused sub-gate is the **lost-response and duplicate/race convergence matrix**. It must preserve PR #77's recovery design and fail closed rather than broadening stale authorization.

After all of C2-D, the next major gate is **P0-D**: integrate the proven XSP-v2 transport/state machine into a production-capable Agent workflow so an operator can eventually update an Agent from the Nexus UI and have migration, validation and recovery happen automatically.

## Security guardrails

- `strict-pq` remains **OFF**.
- Production control-plane behavior remains legacy `XMESH1` / Ed25519 until separately approved replacement gates are complete.
- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate validation.
- D1 and the completed first D2 recovery sub-gate are isolated staging/process proofs, not production activation.
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

## Installation

Supported automated host installation targets Ubuntu 22.04/24.04 LTS. You need a public domain whose DNS points to the Nexus VPS, TCP/80 and TCP/443 reachable for managed HTTPS, and Git installed.

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
