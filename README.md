# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages nodes, users, subscriptions, Xray configuration, telemetry and security state. The user VPN data-plane remains **Xray-core**; XMesh is the control plane and must not be described as an extra encryption layer around user VPN traffic.

[English](README.en.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 engineering checkpoint — 28 October 2026

**Latest verified Nexus implementation checkpoint:** [`37b9e49da1a9fd43657dd167ebb9d5e9a4580091`](https://github.com/TriplexCorp/XMesh-Nexus/commit/37b9e49da1a9fd43657dd167ebb9d5e9a4580091), merge of [PR #71](https://github.com/TriplexCorp/XMesh-Nexus/pull/71).

P0-C2-C — cryptographic ACK authorization, atomic PostgreSQL state transition, protected signer invocation and immutable signed receipt recovery — is complete in **isolated staging/process scope**.

Exact post-merge evidence on `37b9e49da1a9fd43657dd167ebb9d5e9a4580091`:

- [XSP-v2 C2-C ACK Authorization #40700626539](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40700626539) — **success**;
- [Backend CI #40700626558](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40700626558) — **success**;
- [XSP-v2 Crypto PoC #40700626631](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40700626631) — **success**;
- [XSP-v2 Hybrid TLS Probe #40700626545](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40700626545) — **success**.

The earlier isolated signer P0 from PR #61, dedicated PQ-only ingress P0-C1 from PR #64, trusted ingress→origin identity boundary P0-C2-A from PR #66 and narrow staging ACK gate P0-C2-B from PR #69 remain complete in their stated staging/process scopes.

**Current XMesh-Node staging transport checkpoint:** [`79cee45174f7670707d22a269784fe117c44743c`](https://github.com/TriplexCorp/XMesh-Node/commit/79cee45174f7670707d22a269784fe117c44743c), merge of [Node PR #29](https://github.com/TriplexCorp/XMesh-Node/pull/29). [Node CI #40597143811](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143811) and [XSP-v2 Crypto PoC #40597143829](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143829) passed on that merge SHA.

Production Node still uses the legacy Go 1.23 control path. The Go 1.27 XSP-v2 transport/client-auth code remains staging/research code. `strict-pq` remains OFF and no production VPS, DNS, firewall, public Nginx, production PostgreSQL or real-key change has been made.

## Completed XSP-v2 gates

### P0 — isolated signer

PR #61 proved the separate signer process/socket boundary, protected key mounts, peer UID/GID checks, owner-approved Ed25519/ML-DSA-65 pins, least-privilege read-only signer DB role, committed ACK readback and immutable receipt recovery.

### P0-C1 — dedicated PQ-only ingress

PR #64 proved:

- TLS **1.3 only**;
- actually negotiated `X25519MLKEM768`;
- trusted certificate and exact hostname/SNI;
- fail-closed TLS 1.2, classical X25519-only, wrong-hostname and untrusted-CA negatives;
- no classical backend hop at the C1 boundary;
- default installer/Compose remain unchanged.

### P0-C2-A — trusted Node identity / protected origin

PR #66 proved:

`Node test client → TLS1.3/X25519MLKEM768 + ML-DSA-65 client identity → dedicated ingress → protected UDS → origin verifier`

Trusted Node identity comes from the verified ML-DSA-65 client-certificate SPKI plus protected Unix peer credentials, not caller headers/body/source IP or legacy `XMESH1` identity.

### P0-C2-B — narrow ACK route

PR #69 mounted only exact staging `POST /api/v2/node/keys/rotation/ack` behind the proven hybrid-mTLS→UDS identity boundary. It introduced no broad proxy, no generic API route and no classical/TCP backend hop. C2-B remained structural-only and deliberately returned `authorizationStatus: "not-verified"`.

### P0-C2-C — cryptographic ACK authorization and transaction — COMPLETE

PR #71 connects the trusted C2-B origin boundary to the existing XSP-v2 cryptographic and durable-state foundations without creating a second state machine.

The tested local path is:

`trusted C2-B origin → protected UDS C2-C service → dual-signature ACK verification → PostgreSQL ACK/epoch commit → isolated signer → immutable dual-signed receipt`

C2-C proves:

- ACK authorization requires **Ed25519 AND ML-DSA-65** against the owner-enrolled `node_request` keyset;
- trusted transport Node ID is bound to exact ACK bytes, request ID, nonce, permit, candidate and epoch state;
- stale/tampered/wrong-peer evidence fails closed;
- the existing atomic ACK→epoch PostgreSQL transition is reused;
- the dedicated `xmesh_c2c_writer` role is least-privilege and cannot perform DDL/TEMP/unrelated reads/deletes/truncates/key retirement;
- signer-down after ACK commit returns no policy success and no receipt;
- after signer recovery, concurrent exact retries converge to one durable dual-signed receipt;
- once that receipt exists, retry with signer offline returns the exact stored bytes without a second epoch transition;
- DB stall fails closed;
- old public keys remain unretired; key retirement is still a separate future gate;
- C2-C does not mount signer private keys and the C2-C process itself has no TCP listener;
- default production router/Compose/installer remain unchanged.

Known limit: C2-C does **not** claim exactly-once signing before the first durable outbox INSERT. The first durable receipt remains authoritative. Full Node→TLS→ACK→receipt retry/restart behavior is the next gate.

## CURRENT P0 — P0-C2-D: failure, retry and full end-to-end proof

C2-D must prove the entire staging chain as one system:

`Node strict PQ/hybrid TLS → trusted ingress/origin identity → ACK auth/commit → isolated signer → signed receipt → retry/recovery`

Required acceptance work:

1. exact retry returns the same durable receipt bytes and performs no second epoch transition;
2. racing duplicate ACKs, replay and mismatched payloads fail or converge only to the immutable committed record;
3. lost responses before and after durable commit are exercised explicitly;
4. signer unavailable, DB stall, boundary unavailable and process restart fail closed without fallback;
5. failed PQ handshake cannot reach an authenticated legacy session for the same XSP-v2 operation;
6. process/container E2E must include the real strict Node TLS client rather than starting only at the already-trusted origin boundary;
7. PR CI/review/fixed-head merge/post-merge exact-SHA CI must pass before production-capable Agent integration begins.

After C2-D, the next major gate is **P0-D**: integrate the proven XSP-v2 transport/state machine into a production-capable Agent workflow so the operator can eventually update an Agent from the Nexus UI and have migration, validation and recovery happen automatically.

## Security guardrails

- `strict-pq` remains **OFF**.
- Production control-plane behavior remains legacy `XMESH1` / Ed25519 until separately approved replacement gates are complete.
- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate verification is allowed.
- C2-C is staging/process proof, not production activation.
- A GitHub merge is **not** a VPS deployment.
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
```

## Installation

Supported automated host installation targets Ubuntu 22.04/24.04 LTS. You need a public domain whose DNS points to the Nexus VPS, TCP/80 and TCP/443 reachable for managed HTTPS, and Git installed.

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/TriplexCorp/XMesh-Nexus.git
cd XMesh-Nexus
bash install.sh
```

The managed installer provisions Docker/Compose, PostgreSQL/TimescaleDB, Redis, the Rust API, Nginx and Certbot. Back up PostgreSQL together with persistent signing/encryption identities; never publish `.env`, private keys, MFA material or subscription bearer URLs.

## Core capabilities

- Node enrollment, signed control requests, heartbeat, runtime state and managed updates.
- XRAY STUDIO configuration and validation workflows.
- Users, squads, quotas and per-protocol credentials.
- Native Xray JSON subscriptions and public subscription portal.
- PostgreSQL/TimescaleDB-backed telemetry and traffic accounting.
- Owner/admin/viewer RBAC, Argon2 authentication, sessions, TOTP MFA and audit controls.
- Managed Xray-core release validation and installation.
- Experimental, feature-gated XSP-v2 foundations for a future fail-closed post-quantum control plane.

## Development and CI

Security-sensitive changes follow:

`focused branch → PR → required CI → review → merge fixed head SHA → post-merge CI on exact SHA → documentation checkpoint → branch cleanup → next gate`.

The default Nexus backend does **not** compile `xsp-v2-experimental`. Do not weaken strict Clippy/security contracts merely to make CI green. Tests and source review do not replace runtime/VPS verification or an independent security assessment.

## Documentation

- [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) — authoritative current engineering order and acceptance gates.
- [XSP-v2 PQ-only policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) — binding target security invariant.
- [XSP-v2 signed commit receipt](docs/XSP_V2_SIGNED_COMMIT_RECEIPT.md) — receipt/outbox/signer design.
- [XSP-v2 signer process E2E](docs/XSP_V2_SIGNER_E2E.md) — signer proof and limits.
- [XSP-v2 TLS probe](docs/XSP_V2_TLS_PROBE.md) — hybrid TLS and dedicated ingress/origin-boundary proof.
- [Autonomous Nodes](docs/AUTONOMOUS_NODES.md) — current Node/control-plane model.

Historical long-form README content through 27 October 2026 is preserved under [`docs/archive/`](docs/archive/). Archived “current/next P0” statements do not override the current Roadmap.

---

XMesh Nexus is under active development. Do not infer enterprise/HA readiness, production PQ protection or successful deployment from code existence or a green isolated test alone.
