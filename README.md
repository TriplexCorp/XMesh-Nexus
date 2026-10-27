# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages nodes, users, subscriptions, Xray configuration, telemetry and security state. The user VPN data-plane remains **Xray-core**; XMesh is the control plane and must not be described as an additional VPN encryption layer.

[English](README.en.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 engineering checkpoint — 28 October 2026

**Nexus `main`:** [`d295ea7fd17dbcda6db6f946bb892277a55dd001`](https://github.com/TriplexCorp/XMesh-Nexus/commit/d295ea7fd17dbcda6db6f946bb892277a55dd001), merge of [PR #64](https://github.com/TriplexCorp/XMesh-Nexus/pull/64).

P0-C1 — dedicated PQ-only Node ingress — is complete in **isolated staging/process scope** on that exact merge SHA:

- [XSP-v2 Hybrid TLS Probe #40592253543](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40592253543) — **success**, including `Dedicated PQ-only ingress container and network E2E`;
- [Backend CI #40592253598](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40592253598) — **success**;
- pre-merge exact head `05bfdc16892632d0ac264542c2b3b9cf30e6acb0` also passed Hybrid TLS #40591238253 and Backend CI #40591238382.

The previous signer P0 remains complete in staging/process scope from PR #61. **Node baseline:** [`d4572b406ac9a209cfbade84a4390569bd38ba92`](https://github.com/TriplexCorp/XMesh-Node/commit/d4572b406ac9a209cfbade84a4390569bd38ba92). Production Node still uses the legacy Go 1.23 control path; Go 1.27 XSP-v2 code remains isolated research/staging code.

### P0-C1 — completed

PR #64 added and remotely exercised a dedicated disposable ingress boundary:

- separate non-root Nginx runtime on container port `8444`;
- TLS **1.3 only** and mandatory negotiated `X25519MLKEM768`;
- trusted certificate + exact hostname/SNI verification;
- fresh-handshake proof with session tickets/cache and early data disabled;
- independent agreement between the strict XMesh-Node Go 1.27 probe and OpenSSL 3.5+;
- fail-closed rejection of TLS 1.2, X25519-only, wrong hostname and untrusted CA;
- read-only root filesystem, dropped capabilities, `no-new-privileges`, internal/no-egress test network and no published host port;
- no `proxy_pass`, no backend/API container and no onward application hop;
- `/`, `/api/v2/node/keys/rotation/ack` and `/api/v1/node/heartbeat` remain inert 404;
- default `compose.yaml` and installer do not activate the ingress.

This proves **one Node → TLS terminator hop only**. It does not prove a future terminator → origin/API hop and does not authorize a production deployment.

### CURRENT P0 — P0-C2: authorized ACK route behind a reviewed origin boundary

The next gate is **not** “just proxy the ACK path to the existing API”. Before `POST /api/v2/node/keys/rotation/ack` can be accepted, the ingress→origin boundary and Node identity must be independently trustworthy.

P0-C2 must:

1. define and prove a narrow ingress→origin trust boundary; an unreviewed plaintext/classical network hop is not acceptable;
2. make the ACK route staging-only, feature/runtime gated and unreachable from the normal public/default API path;
3. derive trusted Node identity from an independently authenticated boundary — never from body `nodeId`, arbitrary headers or legacy `XMESH1` identity;
4. require Ed25519 **AND** ML-DSA-65 verification and bind identity to the exact ACK bytes, permit, request ID, nonce, candidate, epoch and historical keysets;
5. use the protected signer + immutable receipt outbox; an HTTP success code never substitutes for the signed receipt;
6. preserve idempotent retry and exact first durable receipt bytes;
7. fail closed on transport/auth/signature/state/replay/signer failures, with no fallback to a legacy authenticated session;
8. include process-level positive, negative, replay, concurrency and lost-response E2E before merge.

### Security guardrails

- `strict-pq` remains **OFF**.
- Current production control-plane behavior remains legacy `XMESH1` / Ed25519 until an explicitly approved replacement is ready.
- No user-selectable fallback to `XMESH1`, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate verification is allowed in the target XSP-v2 product.
- The dedicated ingress remains experimental and is not activated by the default installer/Compose stack.
- `POST /api/v2/node/keys/rotation/ack` is still intentionally unmounted at this checkpoint.
- A GitHub merge is **not** a VPS deployment. PR #64 did not change production VPS, DNS, firewall, public Nginx, production DB, real Node keys or live user VPN credentials.
- Xray continues to carry user VPN traffic.

For exact requirements and gate order, read [ENTERPRISE_ROADMAP.md](docs/ENTERPRISE_ROADMAP.md) and [XSP_V2_PQ_ONLY_SECURITY_POLICY.md](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md).

## Architecture

```text
Administrator ─HTTPS─> Nexus public Nginx ─loopback─> XMesh Nexus (Rust/Axum)
                                                    │
                                      PostgreSQL / TimescaleDB
                                                    │
                                                   Redis

Future XSP-v2 Node path (not production-activated):
Node ─TLS1.3/X25519MLKEM768─> dedicated Node ingress ─[P0-C2 boundary TBD/proven]─> staging ACK handler
```

## Installation

Supported automated host installation targets Ubuntu 22.04/24.04 LTS. You need a public domain whose DNS points to the Nexus VPS, TCP/80 and TCP/443 reachable for the managed HTTPS setup, and Git installed.

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

`focused branch → PR → required CI → review → merge fixed head SHA → post-merge CI on exact SHA → documentation checkpoint → next gate`.

The default Nexus backend does **not** compile `xsp-v2-experimental`. Do not weaken strict Clippy/security contracts merely to make CI green. Tests and source review do not replace runtime/VPS verification or an independent security assessment.

## Documentation

- [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) — authoritative current engineering order and acceptance gates.
- [XSP-v2 PQ-only policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) — binding target security invariant.
- [XSP-v2 signed commit receipt](docs/XSP_V2_SIGNED_COMMIT_RECEIPT.md) — receipt/outbox/signer design.
- [XSP-v2 signer process E2E](docs/XSP_V2_SIGNER_E2E.md) — signer proof and limits.
- [XSP-v2 TLS probe](docs/XSP_V2_TLS_PROBE.md) — hybrid-TLS and dedicated ingress proof.
- [Autonomous Nodes](docs/AUTONOMOUS_NODES.md) — current Node/control-plane model.

Historical long-form README content through 27 October 2026 is preserved under [`docs/archive/`](docs/archive/). Archived “current/next P0” statements do not override the current Roadmap.

---

XMesh Nexus is under active development. Do not infer enterprise/HA readiness, production PQ protection or successful deployment from code existence or a green isolated test alone.
