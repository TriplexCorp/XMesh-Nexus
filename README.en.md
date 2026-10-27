# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages Nodes, users, subscriptions, Xray configuration, telemetry and security state. User VPN traffic remains the **Xray-core data-plane**; XMesh is the control plane.

[Русский](README.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 checkpoint — 28 October 2026

**Latest verified Nexus implementation checkpoint:** [`5b8840051ca8562417c6b4f00d65753a165bb598`](https://github.com/TriplexCorp/XMesh-Nexus/commit/5b8840051ca8562417c6b4f00d65753a165bb598), merge of [PR #66](https://github.com/TriplexCorp/XMesh-Nexus/pull/66).

P0-C2-A — authenticated Node identity plus the protected ingress→origin boundary — is complete in **isolated staging/process scope**:

- exact pre-merge head `fc8317a8849e7dbcd300e82eaf5804f6d4d17876` passed [Hybrid TLS #40599041487](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40599041487) and [Backend CI #40599041548](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40599041548);
- post-merge [Hybrid TLS #40600684179](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40600684179) — **success**, including `PQ client identity and Unix origin boundary E2E`;
- post-merge [Backend CI #40600684106](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40600684106) — **success**.

The signer P0 from PR #61 and dedicated PQ-only ingress P0-C1 from PR #64 remain complete in their stated staging/process scopes.

**Current XMesh-Node staging transport checkpoint:** [`79cee45174f7670707d22a269784fe117c44743c`](https://github.com/TriplexCorp/XMesh-Node/commit/79cee45174f7670707d22a269784fe117c44743c), merge of [Node PR #29](https://github.com/TriplexCorp/XMesh-Node/pull/29). [Node CI #40597143811](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143811) and [XSP-v2 Crypto PoC #40597143829](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143829) passed on that merge SHA.

Production Node still uses the legacy Go 1.23 control path. The Go 1.27 XSP-v2 transport/client-auth code remains isolated staging/research code; C2-A does not activate production XSP-v2.

### P0-C1 — complete

PR #64 proves the dedicated Node→TLS-terminator boundary with TLS **1.3 only**, actually negotiated `X25519MLKEM768`, trusted certificate/hostname verification, fresh handshakes and fail-closed downgrade negatives. The C1 runtime remains isolated from the Nexus API and inactive in default installer/Compose deployment.

### P0-C2-A — complete

PR #66 proves this isolated staging boundary:

`Node test client → TLS1.3/X25519MLKEM768 + ML-DSA-65 client identity → dedicated ingress → protected Unix-domain socket → disposable origin verifier`

The process/container E2E proves that:

- the Node staging client uses an **ML-DSA-65** client certificate on the mandatory hybrid TLS hop;
- ingress verifies the client certificate and strips caller-controlled headers/body before the origin transition;
- exactly one reviewed forwarding path targets `/run/xmesh-origin/xsp-v2-origin.sock`;
- the origin has no network listener/published port and validates ingress `SO_PEERCRED` UID/GID;
- trusted Node identity is derived from the verified client-certificate SPKI SHA-256 pinned mapping, never from caller `nodeId`, arbitrary headers, source IP or legacy `XMESH1` identity;
- forged identity/verification/certificate headers, anonymous/wrong/classical clients and direct-origin impersonation fail closed;
- C1 transport downgrade negatives remain enforced;
- ACK, heartbeat and ordinary application paths remain inert in this boundary.

C2-A does **not** connect the origin verifier to the Nexus API/database and does not authorize an ACK application message.

### CURRENT P0 — P0-C2-B: narrow staging ACK route

The next code gate is to expose exactly one experimental Node-only operation behind the proven C2-A identity boundary:

`POST /api/v2/node/keys/rotation/ack`

C2-B must:

1. expose only that ACK operation — never a broad proxy to the existing API;
2. remain feature/runtime gated so default production has no active XSP-v2 route;
3. consume trusted Node identity from C2-A without trusting caller-controlled identity metadata;
4. enforce exact XSP/2 message type/direction/method/path plus strict content-type, size and timeout bounds;
5. preserve secret-safe logging and fail closed if the C2-A boundary is unavailable or invalid;
6. keep `strict-pq` OFF and production deployment unchanged.

C2-C then connects dual Ed25519 **AND** ML-DSA-65 ACK authorization, atomic state transition, signer and immutable receipt. C2-D proves retry/failure/full E2E before production-capable Agent integration.

### Security guardrails

- `strict-pq` remains **OFF**.
- Production control-plane behavior remains legacy `XMESH1` / Ed25519 until separately approved replacement gates are complete.
- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate validation.
- Experimental ingress/origin is not activated by default installer/Compose.
- `POST /api/v2/node/keys/rotation/ack` remains intentionally **unmounted** at this checkpoint; C2-B has not begun.
- GitHub merge is not production deployment. No production VPS/DNS/firewall/public Nginx/DB/live-key/VPN-credential changes are implied.
- Xray continues to carry user VPN traffic.

For exact gate requirements, read [ENTERPRISE_ROADMAP.md](docs/ENTERPRISE_ROADMAP.md) and [XSP_V2_PQ_ONLY_SECURITY_POLICY.md](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md).

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

`focused branch → PR → required CI → review → merge fixed head SHA → post-merge CI on exact SHA → documentation checkpoint → next gate`.

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
