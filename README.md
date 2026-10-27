# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages nodes, users, subscriptions, Xray configuration, telemetry and security state. The user VPN data-plane remains **Xray-core**; XMesh is the control plane and must not be described as an additional VPN encryption layer.

[English](README.en.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 engineering checkpoint — 28 October 2026

**Latest verified Nexus implementation checkpoint:** [`5b8840051ca8562417c6b4f00d65753a165bb598`](https://github.com/TriplexCorp/XMesh-Nexus/commit/5b8840051ca8562417c6b4f00d65753a165bb598), merge of [PR #66](https://github.com/TriplexCorp/XMesh-Nexus/pull/66).

P0-C2-A — authenticated Node identity plus the protected ingress→origin boundary — is complete in **isolated staging/process scope** on that exact merge SHA:

- pre-merge exact head `fc8317a8849e7dbcd300e82eaf5804f6d4d17876` passed [XSP-v2 Hybrid TLS Probe #40599041487](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40599041487) and [Backend CI #40599041548](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40599041548);
- post-merge [XSP-v2 Hybrid TLS Probe #40600684179](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40600684179) — **success**, including `PQ client identity and Unix origin boundary E2E`;
- post-merge [Backend CI #40600684106](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40600684106) — **success**, including strict Clippy, Docker build and disposable API/authentication integration.

The earlier isolated signer P0 from PR #61 and dedicated PQ-only ingress P0-C1 from PR #64 remain completed in their stated staging/process scopes.

**Current XMesh-Node staging transport checkpoint:** [`79cee45174f7670707d22a269784fe117c44743c`](https://github.com/TriplexCorp/XMesh-Node/commit/79cee45174f7670707d22a269784fe117c44743c), merge of [Node PR #29](https://github.com/TriplexCorp/XMesh-Node/pull/29). On that exact merge SHA, [Node CI #40597143811](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143811) and [XSP-v2 Crypto PoC #40597143829](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143829) passed.

Production Node still uses the legacy Go 1.23 control path. The Go 1.27 XSP-v2 transport/client-auth code remains isolated staging/research code; C2-A does not activate production XSP-v2.

### P0-C1 — completed

PR #64 proved the dedicated Node→TLS-terminator boundary:

- TLS **1.3 only** with actually negotiated `X25519MLKEM768`;
- trusted certificate and exact hostname/SNI verification;
- fresh full handshakes; no resumption/early-data substitute;
- fail-closed TLS 1.2, X25519-only, wrong-hostname and untrusted-CA negatives;
- non-root/read-only/cap-drop/no-new-privileges disposable ingress;
- no Nexus/API/backend hop at C1;
- ACK and legacy application paths remained inert 404;
- default installer/Compose did not activate the experimental ingress.

### P0-C2-A — completed

PR #66 extended the isolated boundary to:

`Node test client → TLS1.3/X25519MLKEM768 + ML-DSA-65 client identity → dedicated ingress → protected Unix-domain socket → disposable origin verifier`

The process/container E2E proves:

- the strict Node Go 1.27 staging client presents an **ML-DSA-65** client certificate on the mandatory hybrid TLS hop;
- the ingress verifies the client certificate and strips caller-controlled request headers/body before the origin transition;
- the ingress has exactly one reviewed forwarding path and it targets only the protected Unix socket `/run/xmesh-origin/xsp-v2-origin.sock`;
- the origin has no network listener or published port and checks Linux `SO_PEERCRED` for the expected ingress UID/GID;
- the origin derives the trusted Node identity from the verified client-certificate SPKI SHA-256 pinned mapping, not from body `nodeId`, arbitrary headers, source IP or legacy `XMESH1` identity;
- caller attempts to forge trusted identity/verification/certificate headers fail to control the derived identity;
- anonymous, wrong-client, classical-client and alternate/direct-origin impersonation paths fail closed;
- TLS downgrade negatives from C1 remain enforced;
- the existing ACK path, legacy heartbeat and ordinary application paths remain inert in this isolated boundary.

C2-A deliberately does **not** connect the origin verifier to the Nexus API or database and does **not** authorize an ACK application message.

### CURRENT P0 — P0-C2-B: narrow staging ACK route

The next code gate is to mount exactly one experimental operation behind the already-proven C2-A boundary:

`POST /api/v2/node/keys/rotation/ack`

C2-B must:

1. expose only that Node-only ACK operation in the experimental staging path — no broad proxy to the legacy/default API;
2. remain feature-gated and runtime-gated so the default production backend has no active XSP-v2 network route;
3. consume the trusted Node identity supplied by the C2-A boundary without trusting caller body/header/source-IP identity;
4. enforce the exact XSP/2 message type, direction, method/path, content type, request-size and timeout bounds;
5. preserve secret-safe logging and fail closed if the trusted boundary is absent or invalid;
6. keep `strict-pq` OFF and production deployment unchanged.

After C2-B, C2-C performs the full Ed25519 **AND** ML-DSA-65 ACK authorization/transaction/signing path, and C2-D proves retry/failure/end-to-end behavior before production-capable Agent integration begins.

### Security guardrails

- `strict-pq` remains **OFF**.
- Current production control-plane behavior remains legacy `XMESH1` / Ed25519 until an explicitly approved replacement is ready.
- No user-selectable fallback to `XMESH1`, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate verification is allowed in the target XSP-v2 product.
- The dedicated ingress/origin boundary remains experimental and is not activated by the default installer/Compose stack.
- `POST /api/v2/node/keys/rotation/ack` is still intentionally **unmounted** at this checkpoint; C2-B has not begun.
- A GitHub merge is **not** a VPS deployment. These gates did not change production VPS, DNS, firewall, public Nginx, production PostgreSQL, real Node keys or live user VPN credentials.
- Xray continues to carry user VPN traffic.

For exact requirements and gate order, read [ENTERPRISE_ROADMAP.md](docs/ENTERPRISE_ROADMAP.md) and [XSP_V2_PQ_ONLY_SECURITY_POLICY.md](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md).

## Architecture

```text
Administrator ─HTTPS─> Nexus public Nginx ─loopback─> XMesh Nexus (Rust/Axum)
                                                    │
                                      PostgreSQL / TimescaleDB
                                                    │
                                                   Redis

Experimental XSP-v2 staging boundary (not production-activated):
Node ─TLS1.3/X25519MLKEM768 + ML-DSA-65 client identity─> dedicated Node ingress
                                                        │
                                                        └─protected UDS─> origin verifier
                                                                            │
                                                              [C2-B ACK route not mounted]
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
- [XSP-v2 TLS probe](docs/XSP_V2_TLS_PROBE.md) — hybrid TLS and dedicated ingress/origin-boundary proof.
- [Autonomous Nodes](docs/AUTONOMOUS_NODES.md) — current Node/control-plane model.

Historical long-form README content through 27 October 2026 is preserved under [`docs/archive/`](docs/archive/). Archived “current/next P0” statements do not override the current Roadmap.

---

XMesh Nexus is under active development. Do not infer enterprise/HA readiness, production PQ protection or successful deployment from code existence or a green isolated test alone.
