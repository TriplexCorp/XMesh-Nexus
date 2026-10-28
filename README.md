# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages nodes, users, subscriptions, Xray configuration, telemetry and security state. The user VPN data-plane remains **Xray-core**; XMesh is the control plane and must not be described as an additional VPN encryption layer.

[English](README.en.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 engineering checkpoint — 28 October 2026

**Latest verified Nexus implementation checkpoint:** [`a3e18fae4cf9cd0d354e536ede285d952c54d1c8`](https://github.com/TriplexCorp/XMesh-Nexus/commit/a3e18fae4cf9cd0d354e536ede285d952c54d1c8), merge of [PR #69](https://github.com/TriplexCorp/XMesh-Nexus/pull/69).

P0-C2-B — the narrow staging ACK structural gate behind the proven hybrid-mTLS → protected-UDS identity boundary — is complete in **isolated staging/process scope**:

- exact pre-merge head `4e079378f6f43eedced167b5fdde7d1b37568ad4` passed [XSP-v2 Hybrid TLS Probe #40606304019](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40606304019) and [Backend CI #40606304071](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40606304071);
- post-merge [XSP-v2 Hybrid TLS Probe #40607355530](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40607355530) — **success**, including `tls-hybrid`, `PQ client identity and Unix origin boundary E2E`, and `C2-B narrow staging ACK route E2E`;
- post-merge [Backend CI #40607355446](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40607355446) — **success**, including strict Clippy, Docker build and disposable API/authentication integration.

The earlier isolated signer P0 from PR #61, dedicated PQ-only ingress P0-C1 from PR #64 and trusted ingress→origin identity boundary P0-C2-A from PR #66 remain completed in their stated staging/process scopes.

**Current XMesh-Node staging transport checkpoint:** [`79cee45174f7670707d22a269784fe117c44743c`](https://github.com/TriplexCorp/XMesh-Node/commit/79cee45174f7670707d22a269784fe117c44743c), merge of [Node PR #29](https://github.com/TriplexCorp/XMesh-Node/pull/29). On that exact merge SHA, [Node CI #40597143811](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143811) and [XSP-v2 Crypto PoC #40597143829](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40597143829) passed.

Production Node still uses the legacy Go 1.23 control path. The Go 1.27 XSP-v2 transport/client-auth code remains isolated staging/research code; C2-B does not activate production XSP-v2.

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

The process/container E2E proves that trusted Node identity comes from the verified ML-DSA-65 client-certificate SPKI plus the protected Unix peer credential, not from caller headers/body/source IP or legacy `XMESH1` identity. Spoofed headers, anonymous/wrong/classical clients and direct-origin impersonation fail closed.

### P0-C2-B — completed

PR #69 adds a **separate opt-in staging runtime**; it does not modify the default production API path.

The isolated path is:

`Node test client → TLS1.3/X25519MLKEM768 + verified ML-DSA-65 client identity → dedicated C2-B ingress → protected UDS → structural ACK gate`

C2-B proves:

- only exact `POST /api/v2/node/keys/rotation/ack` is mounted as an application operation;
- there is no broad proxy to the existing Nexus API and no TCP/plaintext backend hop;
- caller-controlled headers are stripped before the UDS transition;
- the origin re-checks `SO_PEERCRED`, verified client-certificate evidence and pinned SPKI→Node mapping;
- the route is runtime-gated by `XSP_V2_C2B_ACK_ROUTE=staging-only`; otherwise it returns 404;
- method/path/content type/Content-Length/body size/deadline and strict JSON structure are bounded;
- trusted transport Node ID is bound to the ACK body Node identity and issuer;
- wrong Node/class/path/epoch/time/nonce/digest/key-role structures, duplicate JSON keys, anonymous/alternate/classical clients, direct UDS forgery and oversized bodies fail closed;
- unrelated routes remain inert;
- default `compose.yaml`, `install.sh` and `backend/src/main.rs` do **not** activate or mount this ACK route.

A C2-B `202 Accepted` deliberately returns `authorizationStatus: "not-verified"`. It is **not** proof of an authorized key transition, does not verify ACK signatures, does not mutate PostgreSQL, does not consume replay state, does not advance an epoch, does not call the signer and does not issue a receipt.

### CURRENT P0 — P0-C2-C: cryptographic ACK authorization and transaction

The next gate connects the already-proven transport/identity/route boundary to the existing XSP-v2 cryptographic and durable-state foundations.

C2-C must:

1. verify **Ed25519 AND ML-DSA-65** against the owner-enrolled `node_request` keyset for the required pending/to epoch;
2. bind the trusted transport Node ID to the exact ACK bytes, request ID, nonce, candidate, permit, epoch and committed ledger state;
3. consume replay evidence exactly once and reject stale/revoked/wrong-node/wrong-epoch/wrong-path/wrong-request/wrong-candidate evidence;
4. preserve the already-proven atomic ACK→epoch PostgreSQL transition semantics;
5. call the isolated signer only after committed ACK evidence exists;
6. reverify signer output in the API-side trust boundary and persist/recover immutable first durable receipt bytes;
7. never treat HTTP status alone as policy success — the Node requires a valid signed receipt;
8. keep production deployment unchanged and `strict-pq` OFF.

C2-C must not create a spoofable trusted-ID header or a new classical/TCP hop between the C2-B boundary and the cryptographic verifier. The exact internal handoff is security-review scope before implementation.

After C2-C, C2-D proves retry/failure/full end-to-end behavior before production-capable Agent integration begins.

### Security guardrails

- `strict-pq` remains **OFF**.
- Current production control-plane behavior remains legacy `XMESH1` / Ed25519 until an explicitly approved replacement is ready.
- No target-product fallback to `XMESH1`, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate verification is allowed.
- The dedicated C2-B ACK route exists only in the separate opt-in experimental staging runtime and is not activated by default installer/Compose or the normal Rust API router.
- C2-B success is structural only; cryptographic authorization, DB transition, signer invocation and signed receipt remain C2-C.
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
Node ─TLS1.3/X25519MLKEM768 + ML-DSA-65 client identity─> dedicated C2-B ingress
                                                        │
                                                        └─protected UDS─> structural ACK gate
                                                                            │
                                                    [C2-C crypto/DB/signer/receipt not connected yet]
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
