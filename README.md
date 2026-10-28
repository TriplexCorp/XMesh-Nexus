# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages nodes, users, subscriptions, Xray configuration, telemetry and security state. The user VPN data-plane remains **Xray-core**; XMesh is the control plane and must not be described as an extra encryption layer around user VPN traffic.

[English](README.en.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 engineering checkpoint — 28 October 2026

**Latest verified Nexus implementation checkpoint:** [`037290bbb31dc6e5d155a14b8ddf58a31e21066f`](https://github.com/TriplexCorp/XMesh-Nexus/commit/037290bbb31dc6e5d155a14b8ddf58a31e21066f), merge of [PR #73](https://github.com/TriplexCorp/XMesh-Nexus/pull/73).

P0-C2-D1 — integrated real-Node staging E2E — is complete in **isolated staging/process scope**. It connects the real Go 1.27 Node staging cutover client to the already-proven C2-A/B/C path:

`Node strict client → TLS1.3/X25519MLKEM768 + ML-DSA-65 mTLS → trusted ingress/origin → dual-signed ACK auth/DB commit → isolated signer → Node-verified durable dual-signed receipt`

Exact post-merge evidence on `037290bbb31dc6e5d155a14b8ddf58a31e21066f`:

- [XSP-v2 C2-D1 Integrated Process E2E #40720824028](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40720824028) — **success**;
- [Backend CI #40720823715](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40720823715) — **success**.

The C2-D1 workflow pins the verified XMesh-Node prerequisite merge [`3c49fd9b81293f53f7bc599a4bfab5a4c2040164`](https://github.com/TriplexCorp/XMesh-Node/commit/3c49fd9b81293f53f7bc599a4bfab5a4c2040164), merge of Node PR #30, so the cross-repository evidence is reproducible.

The earlier isolated signer P0 from PR #61, dedicated PQ-only ingress P0-C1 from PR #64, trusted ingress→origin identity boundary P0-C2-A from PR #66, narrow staging ACK gate P0-C2-B from PR #69 and cryptographic ACK/transaction/signer gate P0-C2-C from PR #71 remain complete in their stated staging/process scopes.

Production Node still uses the legacy Go 1.23 control path. The Go 1.27 XSP-v2 transport/cutover code remains staging/research code. `strict-pq` remains OFF and no production VPS, DNS, firewall, public Nginx, production PostgreSQL or real-key change has been made.

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

Known limit: C2-C does **not** claim exactly-once signing before the first durable outbox INSERT. The first durable receipt remains authoritative.

### P0-C2-D1 — real Node integrated E2E — COMPLETE

PR #73 proves the first integrated half of C2-D using the real staging Node cutover code rather than injecting only at the trusted origin boundary.

D1 proves:

- the Node validates and journals the exact signed permit and ACK;
- the ACK exchange uses strict TLS 1.3 + actually negotiated `X25519MLKEM768` + ML-DSA-65 mutual TLS;
- another otherwise-valid ML-DSA client identity cannot impersonate the pinned Node;
- the same request crosses ingress → protected UDS origin → C2-C → PostgreSQL → isolated signer;
- the Node accepts success only after verifying the **Ed25519 AND ML-DSA-65** commit receipt and durably journaling it;
- a restarted Node test process can re-authenticate the already-durable local permit/ACK/receipt witness after permit expiry without treating that expired permit as a new command;
- no host-published port is introduced and the production Agent remains untouched.

D1 deliberately does **not** weaken ACK freshness. Network retransmission of an expired ACK is still rejected by the origin freshness gate and belongs to C2-D2.

## CURRENT P0 — P0-C2-D2: failure, retry and recovery matrix

Overall P0-C2-D remains **CURRENT P0** until D2 passes. D2 must preserve the already-proven D1 chain while closing every remaining failure/recovery requirement.

Required acceptance work remains:

1. define and prove exact network retry after the original ACK freshness window, returning the same durable receipt bytes **only** for an exact already-committed ACK; it must never authorize a new stale state transition, re-sign, or perform a second epoch transition;
2. racing duplicate ACKs, replay and mismatched payloads fail or converge only to the immutable committed record;
3. exercise lost response before durable ACK commit;
4. exercise lost response after ACK commit but before durable receipt persistence/reply;
5. exercise lost response after durable receipt persistence; retry must recover exact bytes without re-signing;
6. signer unavailable, DB stall, origin unavailable, C2-C unavailable and their process restarts fail closed without legacy fallback;
7. restart C2-C/origin/signer around security-state transitions and prove durable recovery semantics;
8. failed PQ handshake, wrong client certificate or downgrade attempt cannot reach the ACK operation through an authenticated legacy session;
9. verify no new public port, broad proxy, classical-only internal hop or signer-key exposure appears in the integrated topology;
10. preserve old-key retention and no automatic retirement;
11. no success is inferred from HTTP status alone; the Node must validate the exact dual-signed receipt;
12. PR CI/review/fixed-head merge/post-merge exact-SHA CI must pass before production-capable Agent integration begins.

After all of C2-D, the next major gate is **P0-D**: integrate the proven XSP-v2 transport/state machine into a production-capable Agent workflow so the operator can eventually update an Agent from the Nexus UI and have migration, validation and recovery happen automatically.

## Security guardrails

- `strict-pq` remains **OFF**.
- Production control-plane behavior remains legacy `XMESH1` / Ed25519 until separately approved replacement gates are complete.
- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate verification is allowed.
- C2-D1 is staging/process proof, not production activation.
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
