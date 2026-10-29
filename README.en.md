# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages Nodes, users, subscriptions, Xray configuration, telemetry and security state. User VPN traffic remains the **Xray-core data-plane**; XMesh is the control plane.

[Русский](README.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 checkpoint — 29 October 2026

**Latest verified Nexus implementation checkpoint:** [`8b1cc46cfae5b018cf55cc02ad31e48e37d39741`](https://github.com/TriplexCorp/XMesh-Nexus/commit/8b1cc46cfae5b018cf55cc02ad31e48e37d39741), merge of [PR #95](https://github.com/TriplexCorp/XMesh-Nexus/pull/95).

**P0-C2-D remains COMPLETE and P0-D is the CURRENT P0.** The three bounded P0-D foundations plus authenticated release-identity propagation are now complete:

- **PR #90 / P0-D1a:** append-only exact Agent release identity `{version, sourceRevision, artifactSha256}` in PostgreSQL. A version cannot be silently rebound; UPDATE/DELETE/TRUNCATE are rejected; no URL/script/command input and no production activation were introduced.
- **PR #91 / P0-D1b:** the immutable release identity can be atomically bound to the existing fixed-action `update_agent` single-flight queue. The binding cannot be attached, removed or replaced later with `UPDATE`; normal command lifecycle state transitions remain legal. No HTTP/API caller, poll payload or Agent/updater execution path changed in this gate.
- **PR #93 / P0-D1c:** the existing `POST /nodes/{id}/agent-update` control plane gained an owner-only release-selection mode behind exact non-default `XSP_V2_P0D_AGENT_MIGRATION=staging-only`. The caller selects only an approved release version; Nexus resolves immutable revision/digest server-side and atomically stages the existing fixed `update_agent` action. Legacy `{}` behavior remains unchanged and caller digest/URL/script/command overrides are rejected.
- **PR #95 / authenticated poll/apply/ACK release identity:** bound `update_agent` commands now carry exact immutable `{version, sourceRevision, artifactSha256}` through the existing signed poll/apply/ACK lifecycle. The installed shell Agent validates and preserves that identity across the existing fixed updater service and echoes it in the signed ACK; Nexus locks the claimed command, compares the ACK with the immutable manifest and persists exact ACK evidence atomically. Missing/mismatched identity fails closed, a version-only heartbeat cannot synthesize bound success, and legacy unbound commands remain identity-free and compatible.

Exact post-merge evidence on `8b1cc46cfae5b018cf55cc02ad31e48e37d39741`:

- [Backend CI #3553](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40810560951) — **success**, including strict Clippy/pedantic/nursery, Docker build, migration `0109`, and disposable PostgreSQL/API integration with real signed poll/heartbeat/ACK identity checks.
- [Node GeoData and Routing checks #784](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40810560944) — **success**, including installed-Agent shell validation.
- [Managed dual inbound regression #140](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40810560971) — **success**.

The previous complete C2-D implementation checkpoint remains [`7e0b42ea4847b273ba8cd55a0ff3e043a420c377`](https://github.com/TriplexCorp/XMesh-Nexus/commit/7e0b42ea4847b273ba8cd55a0ff3e043a420c377), merge of [PR #88](https://github.com/TriplexCorp/XMesh-Nexus/pull/88). Its exact post-merge C2-D transport-negative, lost-response/race, expired-recovery, Hybrid TLS and Backend CI matrix remains valid within that stated isolated staging/process boundary.

The current verified XMesh-Node staging transport checkpoint is [`0ae78244ef0ef763bea6ce198dde6e83eb11ff1f`](https://github.com/TriplexCorp/XMesh-Node/commit/0ae78244ef0ef763bea6ce198dde6e83eb11ff1f), merge of Node PR #33. It keeps the direct TCP dial target separate from the authenticated application authority while explicitly binding HTTP `Host` to the same `serverName` used for TLS SNI and certificate verification. A connect-only Docker alias/IP therefore cannot select a weaker virtual host after a valid strict-PQ handshake.

Production Node still uses the legacy Go 1.23 control path. The Go 1.27 XSP-v2 transport/cutover code remains staging/research code. `strict-pq` remains **OFF**. PR #95 extends the existing signed Agent poll/ACK and installed shell-Agent path only for already-bound staged migration commands; because release selection remains behind the exact default-disabled `staging-only` gate, it does not activate XSP-v2 migration or authorize production rollout, and it introduces no new remote action, URL, script or executable-location input.

## Completed XSP-v2 gates

### P0 — isolated signer — COMPLETE

PR #61 proved a separate signer process/socket boundary, protected private-key mounts, peer UID/GID checks, owner-approved Ed25519/ML-DSA-65 pins, least-privilege signer DB access, committed ACK readback and immutable receipt recovery.

### P0-C1 — dedicated PQ-only ingress — COMPLETE

PR #64 proved TLS **1.3 only**, actually negotiated `X25519MLKEM768`, trusted certificate/hostname verification, fresh handshakes and fail-closed downgrade negatives. The ingress remains isolated from the normal Nexus API and inactive in the default installer/Compose deployment.

### P0-C2-A — trusted Node identity / protected origin — COMPLETE

PR #66 proved:

`Node test client → TLS1.3/X25519MLKEM768 + ML-DSA-65 client identity → dedicated ingress → protected Unix-domain socket → origin verifier`

Trusted Node identity comes from verified ML-DSA-65 client-certificate SPKI plus protected Unix peer credentials, never caller `nodeId`, arbitrary headers, source IP or legacy `XMESH1` identity.

### P0-C2-B — narrow ACK route — COMPLETE

PR #69 mounted only exact staging `POST /api/v2/node/keys/rotation/ack` behind the proven hybrid-mTLS→UDS identity boundary. It introduced no broad proxy, generic API route or classical/TCP backend hop.

### P0-C2-C — cryptographic ACK authorization and transaction — COMPLETE

PR #71 proved the protected local path:

`trusted origin → protected UDS C2-C → Ed25519 AND ML-DSA-65 ACK verification → PostgreSQL ACK/epoch commit → isolated signer → immutable dual-signed receipt`

Key properties include exact request/nonce/permit/candidate/epoch binding, replay rejection, atomic ACK→epoch transition, least-privilege DB roles, signer isolation, fail-closed signer/DB failures, durable receipt recovery, old-key retention and no C2-C TCP listener or signer-key mount.

Known limit retained by design: C2-C does **not** claim exactly-once signing before the first durable outbox INSERT. The first durable immutable receipt is authoritative.

### P0-C2-D1 — real Node integrated E2E — COMPLETE

PR #73 proved the real staging Node cutover path end to end:

`XMesh-Node Go 1.27 staging client → strict hybrid mTLS → ingress → protected origin UDS → C2-C → PostgreSQL → isolated signer → dual-signed receipt → Node verification + durable journal`

D1 deliberately preserved ACK freshness and exposed the need for a separate historical-recovery domain instead of allowing stale commands.

### P0-C2-D2 — failure / retry / recovery / downgrade matrix — COMPLETE

C2-D2 was closed incrementally and then re-verified together on PR #88:

- **PR #77:** expired exact network recovery over the distinct `/ack/recover` / internal `XSP2C2H1` domain; fresh expired ACK remains rejected; no re-signing or second epoch transition.
- **PR #82:** lost-response windows, signer-off exact retry, eight-way exact duplicate-race convergence and fresh mismatch rejection.
- **PR #84:** current XMesh-Node native recovery transport alignment and exact external `/api/v2/node/keys/rotation/ack/recover` contract.
- **PR #86:** real origin/C2-C/PostgreSQL/signer outages and restarts around uncommitted, committed-without-receipt and durable-receipt states; replay cardinality, old-key retention and topology invariants remain intact.
- **Node PR #33:** authenticated application-authority binding — HTTP `Host` equals verified TLS `serverName`, while the direct TCP connect address may remain an internal alias/IP.
- **PR #88:** final full ACK-boundary transport-negative/no-legacy proof.

The final PR #88 matrix proves all of the following fail closed **without durable ACK/epoch/receipt/replay mutation**:

1. TLS 1.2 downgrade attempt;
2. TLS 1.3 classical `X25519`-only negotiation instead of `X25519MLKEM768`;
3. wrong hostname/SNI and unknown-SNI handshake;
4. untrusted server trust root;
5. alternate otherwise-valid ML-DSA client certificate that is not the pinned Node identity;
6. XMESH1-style timestamp/nonce/signature headers sent to the exact XSP-v2 ACK endpoint without authenticated PQ client identity;
7. attempts to reach a legacy `/api/v1/node/heartbeat` path through the dedicated XSP-v2 ingress.

A positive strict-PQ control after the negative matrix still commits exactly one authoritative transition, one receipt and one replay nonce. The dedicated ingress has a strict default TLS listener that rejects unknown/missing SNI, and no authenticated legacy/XMESH1 fallback exists on the XSP-v2 ACK boundary.

## CURRENT P0 — P0-D production-capable Agent workflow

C2-D established the required transport, identity, cryptographic authorization, durable state, recovery, concurrency, outage/restart and downgrade/no-fallback behavior in isolated staging/process E2E. P0-D integrates those proven semantics into a **production-capable Agent design** without enabling them in production by default.

### P0-D progress

- **P0-D1a COMPLETE — immutable release identity:** PR #90 created the append-only exact release-manifest ledger.
- **P0-D1b COMPLETE — atomic queue binding:** PR #91 bound an approved immutable manifest to the existing fixed-action `update_agent` single-flight queue without broadening the remote command surface.
- **P0-D1c COMPLETE — owner-only staging orchestration API:** PR #93 reused the existing Agent-update endpoint behind exact default-disabled `staging-only` gating; only owners may select an approved release version, Nexus resolves immutable revision/digest server-side, and legacy `{}` remains unchanged.
- **Authenticated poll/apply/ACK release identity COMPLETE — staging/signed lifecycle:** PR #95 carries the exact immutable release identity through signed poll, the existing fixed updater apply path and signed ACK; exact ACK evidence is durable, identity mismatch/omission fails closed, and heartbeat-only success is forbidden for bound migration commands.
- **CURRENT sub-gate — Real Agent integration design / Go 1.27 migration:** identify the deployed Go 1.23 Agent/control paths that must be migrated and define how the proven Go 1.27 XSP-v2 transport, permit/ACK/receipt and recovery primitives replace them without a parallel state machine or silent security downgrade.

P0-D still must:

1. define and implement the real Agent integration / Go 1.27 migration path, including supported build/release packaging and last-known-good rollback while preventing mixed-version downgrade;
2. separate staged download / verify / apply / rollback and verify exact approved artifact digest/revision before apply without caller-selected executable locations;
3. preserve exact permit/ACK/receipt journaling, monotonic epoch/replay state and old-key-retention semantics in durable real-Agent state;
4. keep the verified TLS authority binding (`address` for direct connect; authenticated `serverName` for SNI, certificate verification and HTTP authority);
5. prove disposable real Nexus↔Node migration/update success, retry, lost response, restart and rollback before any production activation;
6. keep `strict-pq` OFF unless a later explicit release/production gate authorizes activation.

P0-E remains after P0-D: crash/power-loss, snapshot/rollback, backup/restore, key rotation/recovery, fuzz/KAT and independent security-review release gates. Production rollout remains separately gated and unauthorized.

## Security guardrails

- `strict-pq` remains **OFF**.
- Production control-plane behavior remains legacy `XMESH1` / Ed25519 until separately approved migration and release gates are complete.
- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate validation.
- Completed C2-D evidence is isolated staging/process evidence, not production activation.
- P0-D1a/P0-D1b/P0-D1c plus PR #95's signed release-identity lifecycle are bounded staging foundations; the migration-selection gate is disabled by default and none authorize production rollout.
- A GitHub merge is not a production deployment.
- Xray continues to carry user VPN traffic.

## Architecture

```text
Administrator ─HTTPS─> Nexus public Nginx ─loopback─> XMesh Nexus (Rust/Axum)
                                                    │
                                      PostgreSQL / TimescaleDB
                                                    │
                                                   Redis

Verified XSP-v2 staging path (not production-activated):
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
