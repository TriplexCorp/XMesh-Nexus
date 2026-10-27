# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages Nodes, users, subscriptions, Xray configuration, telemetry and security state. User VPN traffic remains the **Xray-core data-plane**; XMesh is the control plane.

[Русский](README.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 checkpoint — 28 October 2026

**Nexus `main`:** [`bd2f7d5aac556a5aee2ae78b047b43f4c65eef85`](https://github.com/TriplexCorp/XMesh-Nexus/commit/bd2f7d5aac556a5aee2ae78b047b43f4c65eef85), merge of [PR #61](https://github.com/TriplexCorp/XMesh-Nexus/pull/61).

The isolated signer P0 repository gate is complete on the exact merge SHA:

- [Backend CI #40586429332](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40586429332) — **success**;
- [Rust/OpenSSL XSP-v2 Crypto #40586429301](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40586429301) — **success**, including the separate **Isolated signer image, ACL and Unix-socket E2E** job.

**Node baseline:** [`d4572b406ac9a209cfbade84a4390569bd38ba92`](https://github.com/TriplexCorp/XMesh-Node/commit/d4572b406ac9a209cfbade84a4390569bd38ba92). Production Node remains on the legacy Go 1.23 control path; Go 1.27 XSP-v2 code remains isolated research/staging code.

### Signer P0 — complete in staging/process scope

PR #61 proves a real separate signer image/process, Unix-socket peer identity, private-key mount isolation, owner-approved Ed25519 and ML-DSA-65 key pins, real `xmesh_signer_reader` least-privilege PostgreSQL ACLs, committed ACK readback, dual-signed receipt verification, immutable exact-byte recovery, and negative/concurrency/failure cases.

It does **not** prove HSM custody, exactly-once signing before first durable receipt persistence, whole-system snapshot anti-rollback, production key retirement or a real PQ network path from Node to Nexus.

### Current P0 — dedicated PQ-only Node ingress

Before exposing any XSP-v2 ACK HTTP route, the next stage must prove a dedicated Node ingress with:

- TLS 1.3 only;
- actual negotiated `X25519MLKEM768`;
- trusted certificate chain and correct hostname/SNI;
- a fresh full handshake for the proof path;
- fail-closed rejection of TLS 1.2, X25519-only, wrong hostname and untrusted certificates;
- no redirects, compatibility/fallback listener or path to legacy `XMESH1`;
- explicit accounting for every protected network hop;
- HTTP remaining inert (404/no forwarding) during this gate.

The existing Nginx/OpenSSL/Go hybrid-TLS tests are a laboratory foundation, not yet a Nexus↔Node ingress. The detailed acceptance criteria are in the [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md).

### Security guardrails

- `strict-pq` remains **OFF**.
- The target XSP-v2 product has no user-selectable fallback to `XMESH1`, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate verification.
- Security-critical XSP/2 messages require Ed25519 **AND** ML-DSA-65.
- `POST /api/v2/node/keys/rotation/ack` remains intentionally unmounted until the PQ-only transport boundary is proven.
- A GitHub merge is not a production deployment.
- Xray continues to carry user VPN traffic.

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

`focused branch → PR → required CI → review → merge → post-merge CI on exact SHA`.

The default Nexus backend does not compile `xsp-v2-experimental`. Do not weaken strict Clippy or security contracts merely to obtain green CI.

## Documentation

- [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md)
- [XSP-v2 PQ-only security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md)
- [XSP-v2 signer E2E](docs/XSP_V2_SIGNER_E2E.md)
- [XSP-v2 TLS probe](docs/XSP_V2_TLS_PROBE.md)
- [Subscription security](docs/SUBSCRIPTION_SECURITY.md)

The previous long-form English README is preserved byte-for-byte at [`docs/archive/README_EN_2026-10-27.md`](docs/archive/README_EN_2026-10-27.md). Historical “next P0” statements in archived documents do not override the current Roadmap.

---

XMesh Nexus is under active development. Code or a green isolated test alone does not establish enterprise/HA readiness, production PQ protection or successful deployment.
