# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages nodes, users, subscriptions, Xray configuration, telemetry and security state. The user VPN data-plane remains **Xray-core**; XMesh is the control plane and must not be described as an additional VPN encryption layer.

[English](README.en.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 engineering checkpoint — 28 October 2026

**Nexus `main`:** [`bd2f7d5aac556a5aee2ae78b047b43f4c65eef85`](https://github.com/TriplexCorp/XMesh-Nexus/commit/bd2f7d5aac556a5aee2ae78b047b43f4c65eef85), merge of [PR #61](https://github.com/TriplexCorp/XMesh-Nexus/pull/61).

The signer P0 repository gate is complete on the exact merge SHA: [Backend CI #40586429332](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40586429332) — **success**; [Rust/OpenSSL XSP-v2 Crypto #40586429301](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40586429301) — **success**, including the separate **Isolated signer image, ACL and Unix-socket E2E** job. The PR-level checks on `f6b888af783ee66ba1a5c5a84fc9d6e92d7afc49` also passed before merge.

**Node baseline:** [`d4572b406ac9a209cfbade84a4390569bd38ba92`](https://github.com/TriplexCorp/XMesh-Node/commit/d4572b406ac9a209cfbade84a4390569bd38ba92). The production Agent is still the legacy Go 1.23 control path; Go 1.27 XSP-v2 code remains isolated research/staging code.

### Signer P0 — completed in staging/process scope

PR #61 added and remotely exercised the real XSP-v2 signer boundary:

- real signer Docker image/process, separate UID and Unix-domain socket;
- Ed25519 **AND** ML-DSA-65 panel-response signing only after committed ACK readback;
- owner-approved signer key-ID pins;
- signer PEM files mounted only into the signer, never the API process;
- real `xmesh_signer_reader` provisioning and effective least-privilege ACL checks;
- rejection of writable/privileged/member DB roles, unrelated reads, DDL, `TEMP`, writes and dangerous grants;
- peer UID/GID, key ownership/mode, symlink/hardlink and socket-directory checks;
- bounded socket and PostgreSQL/signing deadlines;
- exact-byte immutable receipt recovery, concurrent retry and epoch-race tests;
- malformed/oversized input, wrong identity/request/ACK, unavailable signer, stale socket, DB stall and restart/failure cases;
- required `signer-process-e2e` CI job.

This proves the **experimental signer process boundary**, not production XSP-v2 deployment, HSM custody, exactly-once signing before durable outbox persistence, whole-system snapshot anti-rollback or a secure network path from a real Node.

### Next P0 — dedicated PQ-only Node ingress

The next isolated stage is a **node-only TLS ingress proof**. Before any XSP-v2 ACK HTTP route is exposed, CI/E2E must demonstrate:

1. TLS **1.3 only**;
2. the **actually negotiated** key-exchange group is `X25519MLKEM768`;
3. a trusted certificate chain and correct SNI/hostname;
4. fresh full handshakes for the proof path; no accepted resumed handshake as proof of hybrid key exchange;
5. TLS 1.2, X25519-only, wrong hostname, untrusted certificate and weaker/fallback paths fail closed;
6. the tested ingress has no redirect or compatibility path to legacy `XMESH1`;
7. every protected network hop is accounted for — terminating hybrid TLS and forwarding over an unreviewed plaintext/classical network hop is not acceptable;
8. this ingress stage remains inert at HTTP level: **do not mount `POST /api/v2/node/keys/rotation/ack` yet**.

The existing loopback Nginx/OpenSSL/Go tests are a useful laboratory foundation, but they are not yet a deployed Nexus↔Node ingress. See the [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md).

### Security guardrails

- `strict-pq` remains **OFF**.
- Current production control-plane behavior remains legacy `XMESH1` / Ed25519 until an explicitly approved replacement is ready.
- No user-selectable XSP-v2 fallback to `XMESH1`, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate verification is allowed in the target product.
- The ACK HTTP route remains intentionally unmounted until the PQ-only transport boundary is independently proven.
- A GitHub merge is **not** a VPS deployment. PR #61 did not change production VPS, DNS, firewall, Nginx, production DB, real Node keys or real user VPN credentials.
- Xray continues to carry user VPN traffic.

For exact security requirements, read [XSP_V2_PQ_ONLY_SECURITY_POLICY.md](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md).

## Architecture

```text
Administrator ─HTTPS─> Nexus public Nginx ─loopback─> XMesh Nexus (Rust/Axum)
                                                    │
                                      PostgreSQL / TimescaleDB
                                                    │
                                                   Redis
                                                    │ signed policy / commands
                                                    ▼
                                              XMesh Node
                                                    │
                                              Xray-core
                                                    │
                                               VPN clients
```

The future XSP-v2 node control path is deliberately developed as separate, auditable gates. Its transport security does not modify the encryption semantics of user VPN traffic handled by Xray.

## Installation

Supported automated host installation targets Ubuntu 22.04/24.04 LTS. You need a public domain whose DNS points to the Nexus VPS, TCP/80 and TCP/443 reachable for the managed HTTPS setup, and Git installed.

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/TriplexCorp/XMesh-Nexus.git
cd XMesh-Nexus
bash install.sh
```

The managed installer provisions Docker/Compose, PostgreSQL/TimescaleDB, Redis, the Rust API, Nginx and Certbot, creates persistent secrets, and keeps the panel API bound to loopback behind HTTPS. Back up PostgreSQL together with the persistent signing/encryption keys; do not publish `.env`, private keys, MFA material or subscription bearer URLs.

For upgrades, use the panel updater or `xmeshctl` and verify the resulting service health. A source-code merge does not update an already deployed host.

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

The default Nexus backend does **not** compile `xsp-v2-experimental`. Experimental PQ code has dedicated OpenSSL 3.5 workflows. Security-sensitive changes follow:

`focused branch → PR → required CI → review → merge → post-merge CI on exact SHA`.

Do not weaken strict Clippy/security contracts merely to make CI green. Tests and source review do not replace runtime/VPS verification or an independent security assessment.

## Documentation

- [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) — authoritative current engineering order and acceptance gates.
- [XSP-v2 PQ-only policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) — binding target security invariant.
- [XSP-v2 signed commit receipt](docs/XSP_V2_SIGNED_COMMIT_RECEIPT.md) — receipt/outbox/signer design.
- [XSP-v2 signer process E2E](docs/XSP_V2_SIGNER_E2E.md) — signer proof and limits.
- [XSP-v2 TLS probe](docs/XSP_V2_TLS_PROBE.md) — current hybrid-TLS laboratory proof.
- [Autonomous Nodes](docs/AUTONOMOUS_NODES.md) — current Node/control-plane model.
- [Subscription security](docs/SUBSCRIPTION_SECURITY.md) — bearer-token, credential rotation and logging boundaries.
- [Security audit](docs/SECURITY_AUDIT_2026-10-22.md) — historical source/static audit; not a penetration test and not automatically a list of current bugs.

### Documentation archive

The previous long-form Russian README, including the detailed engineering journal and historical checkpoints through 27 October 2026, is preserved byte-for-byte at [`docs/archive/README_RU_2026-10-27.md`](docs/archive/README_RU_2026-10-27.md). Historical statements such as “next P0” in that archive must not override the current Roadmap.

---

XMesh Nexus is under active development. Do not infer enterprise/HA readiness, production PQ protection, or successful deployment from the presence of code or a green isolated test alone.
