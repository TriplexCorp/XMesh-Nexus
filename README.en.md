# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages Nodes, users, subscriptions, Xray configuration, telemetry and security state. User VPN traffic remains the **Xray-core data-plane**; XMesh is the control plane.

[Русский](README.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 checkpoint — 28 October 2026

**Latest verified Nexus implementation checkpoint:** [`a3e18fae4cf9cd0d354e536ede285d952c54d1c8`](https://github.com/TriplexCorp/XMesh-Nexus/commit/a3e18fae4cf9cd0d354e536ede285d952c54d1c8), merge of [PR #69](https://github.com/TriplexCorp/XMesh-Nexus/pull/69).

P0-C2-B — the narrow staging ACK structural gate behind the proven hybrid-mTLS → protected-UDS identity boundary — is complete in **isolated staging/process scope**:

- exact pre-merge head `4e079378f6f43eedced167b5fdde7d1b37568ad4` passed [Hybrid TLS #40606304019](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40606304019) and [Backend CI #40606304071](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40606304071);
- post-merge [Hybrid TLS #40607355530](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40607355530) — **success**, including the hybrid transport, C2-A origin-boundary and new C2-B ACK-route E2Es;
- post-merge [Backend CI #40607355446](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40607355446) — **success**, including strict Clippy, Docker build and disposable API/authentication integration.

The signer P0 from PR #61, dedicated PQ-only ingress P0-C1 from PR #64 and trusted ingress→origin identity boundary P0-C2-A from PR #66 remain complete in their stated staging/process scopes.

**Current XMesh-Node staging transport checkpoint:** [`79cee45174f7670707d22a269784fe117c44743c`](https://github.com/TriplexCorp/XMesh-Node/commit/79cee45174f7670707d22a269784fe117c44743c), merge of [Node PR #29](https://github.com/TriplexCorp/XMesh-Node/pull/29). [Node CI #40597143811](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143811) and [XSP-v2 Crypto PoC #40597143829](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143829) passed on that merge SHA.

Production Node still uses the legacy Go 1.23 control path. The Go 1.27 XSP-v2 transport/client-auth code remains isolated staging/research code; C2-B does not activate production XSP-v2.

### P0-C1 — complete

PR #64 proves the dedicated Node→TLS-terminator boundary with TLS **1.3 only**, actually negotiated `X25519MLKEM768`, trusted certificate/hostname verification, fresh handshakes and fail-closed downgrade negatives. The C1 runtime remains isolated from the Nexus API and inactive in default installer/Compose deployment.

### P0-C2-A — complete

PR #66 proves this isolated staging boundary:

`Node test client → TLS1.3/X25519MLKEM768 + ML-DSA-65 client identity → dedicated ingress → protected Unix-domain socket → disposable origin verifier`

Trusted Node identity is derived from the verified ML-DSA-65 client-certificate SPKI and protected Unix peer credential, never caller `nodeId`, arbitrary headers, source IP or legacy `XMESH1` identity. Spoofing, anonymous/wrong/classical clients and direct-origin impersonation fail closed.

### P0-C2-B — complete

PR #69 adds a **separate opt-in staging runtime**, not a route in the default Rust API.

Tested path:

`Node test client → TLS1.3/X25519MLKEM768 + verified ML-DSA-65 client identity → dedicated C2-B ingress → protected UDS → structural ACK gate`

C2-B proves:

- only exact `POST /api/v2/node/keys/rotation/ack` is mounted as an application operation;
- no broad proxy to the existing API and no TCP/plaintext backend hop exists;
- caller headers are stripped and trusted Node identity is re-derived at the UDS origin from peer credentials and pinned client SPKI;
- `XSP_V2_C2B_ACK_ROUTE=staging-only` is required or the ACK operation stays 404;
- method/path/content type/Content-Length/body size/deadline and strict JSON shape are bounded;
- trusted transport Node ID is bound to the body Node identity/issuer;
- spoofed identity, wrong class/path/epoch/time/nonces/digests/key roles, duplicate keys, alternate/classical clients, direct UDS forgery and oversized requests fail closed;
- unrelated routes remain inert;
- default `compose.yaml`, `install.sh` and `backend/src/main.rs` do **not** activate or mount this route.

A C2-B `202 Accepted` explicitly returns `authorizationStatus: "not-verified"`. C2-B does **not** verify ACK signatures, mutate PostgreSQL, consume replay state, advance an epoch, call the signer or issue a signed receipt.

### CURRENT P0 — P0-C2-C: cryptographic ACK authorization and transaction

The next gate connects the proven transport/identity/route boundary to the existing cryptographic and durable-state foundations.

C2-C must:

1. verify **Ed25519 AND ML-DSA-65** against the owner-enrolled `node_request` keyset for the required pending/to epoch;
2. bind trusted transport Node identity to exact ACK bytes, request ID, nonce, candidate, permit, epoch and committed ledger state;
3. consume replay evidence exactly once and reject stale/revoked/wrong-node/wrong-epoch/wrong-path/wrong-request/wrong-candidate evidence;
4. preserve the proven atomic ACK→epoch PostgreSQL transition semantics;
5. invoke the isolated signer only after committed ACK evidence exists;
6. reverify signer output and persist/recover immutable first durable receipt bytes;
7. never treat HTTP status alone as policy success — the Node requires a valid signed receipt;
8. keep production deployment unchanged and `strict-pq` OFF.

C2-C must not create a spoofable trusted-ID header or a new classical/TCP hop between C2-B and the cryptographic verifier. The internal handoff requires explicit security review before implementation.

### Security guardrails

- `strict-pq` remains **OFF**.
- Production control-plane behavior remains legacy `XMESH1` / Ed25519 until separately approved replacement gates are complete.
- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate validation.
- The C2-B ACK operation exists only in a separate opt-in experimental staging runtime; default installer/Compose and the normal Rust router do not activate it.
- C2-B success is structural only; cryptographic authorization, DB transition, signer invocation and signed receipt remain C2-C.
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
Node ─TLS1.3/X25519MLKEM768 + ML-DSA-65 client identity─> dedicated C2-B ingress
                                                        │
                                                        └─protected UDS─> structural ACK gate
                                                                            │
                                                    [C2-C crypto/DB/signer/receipt not connected yet]
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
