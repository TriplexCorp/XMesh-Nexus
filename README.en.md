# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages Nodes, users, subscriptions, Xray configuration, telemetry and security state. User VPN traffic remains the **Xray-core data-plane**; XMesh is the control plane.

[Русский](README.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 checkpoint — 29 October 2026

**Latest verified Nexus recovery/security checkpoint:** [`f9a9c636f83a3a2ef7122fef7c3f3bc2bc76b7d4`](https://github.com/TriplexCorp/XMesh-Nexus/commit/f9a9c636f83a3a2ef7122fef7c3f3bc2bc76b7d4), merge of [PR #109](https://github.com/TriplexCorp/XMesh-Nexus/pull/109).

**P0-C2-D and P0-D are COMPLETE. P0-E remains the CURRENT P0. P0-E1a, P0-E2a and P0-E2b are COMPLETE within their explicitly bounded scopes; P0-E3a is the CURRENT sub-gate.** The production-capable Agent path remains default-disabled and production rollout remains unauthorized.

Completed foundations and recovery/security checkpoints now include:

- **PR #90 / P0-D1a:** append-only exact Agent release identity `{version, sourceRevision, artifactSha256}` in PostgreSQL. A version cannot be silently rebound; UPDATE/DELETE/TRUNCATE are rejected; no URL/script/command input and no production activation were introduced.
- **PR #91 / P0-D1b:** the immutable release identity can be atomically bound to the existing fixed-action `update_agent` single-flight queue. The binding cannot be attached, removed or replaced later with `UPDATE`; normal command lifecycle state transitions remain legal. No HTTP/API caller, poll payload or Agent/updater execution path changed in this gate.
- **PR #93 / P0-D1c:** the existing `POST /nodes/{id}/agent-update` control plane gained an owner-only release-selection mode behind exact non-default `XSP_V2_P0D_AGENT_MIGRATION=staging-only`. The caller selects only an approved release version; Nexus resolves immutable revision/digest server-side and atomically stages the existing fixed `update_agent` action. Legacy `{}` behavior remains unchanged and caller digest/URL/script/command overrides are rejected.
- **PR #95 / authenticated poll/apply/ACK release identity:** bound `update_agent` commands carry exact immutable `{version, sourceRevision, artifactSha256}` through the existing signed poll/apply/ACK lifecycle. The installed shell Agent validates and preserves that identity across the existing fixed updater service and echoes it in the signed ACK; Nexus locks the claimed command, compares the ACK with the immutable manifest and persists exact ACK evidence atomically. Missing/mismatched identity fails closed, a version-only heartbeat cannot synthesize bound success, and legacy unbound commands remain identity-free and compatible.
- **PR #97 + PR #98 + PR #99 / real Agent integration design:** the deployed component split and Go 1.27 migration boundary are documented and machine-checked. The root XMesh-Node Go 1.23 module is the edge router, not the signed control Agent. The existing shell/systemd Agent remains the fixed `update_agent` command authority during migration. XMesh-Node `agent/xspv2` is the production-capable side-by-side Agent integration/artifact boundary on Go 1.27.3 and reuses `security/xspv2/poc-go` primitives instead of copying the security state machine.
- **PR #101 / staged download, verify, apply and rollback:** approved Go 1.27 Agent bytes are delivered only from the server-controlled content-addressed artifact source over the existing signed control plane. The staged helper verifies exact manifest SHA-256 plus the binary's embedded `version`/`sourceRevision` before activation, retains last-known-good state, switches atomically and rolls package/service state back on failure without rewinding durable security state. Caller URL/path/script input remains impossible and the production gate remains disabled by default.
- **PR #103 / disposable real Nexus↔Node migration/update E2E + lost-response recovery:** manifest-bound claimed commands can be redelivered after a lost poll response within the bounded migration window, and a completed bound ACK may be replayed idempotently only when every durable result/detail/release-identity field matches exactly. A real disposable Nexus builds two pinned Go 1.27.3 Node Agent artifacts, proves signed claim/download/apply/ACK, exact lost-response retry, restart/idempotent apply, deterministic rollback to the last-known-good Agent, preserved security-state root, non-exact replay rejection and restoration of the default-disabled production gate.
- **Node PR #37 + Nexus PR #105 / durable real-Agent security state + authenticated authority binding:** the real `agent/xspv2` layout persists the proven key/cutover journals under the private Agent state root, attests exact applied rotation before network operations, preserves monotonic epoch/replay floors and retained old/new key material across restart, and fails closed on stale/corrupt/rolled-back state. Nexus pins the merged Node source and machine-checks that the reused strict transport keeps direct connect `address` separate from authenticated `serverName`, binds TLS SNI/certificate verification/HTTP Host to that authority, disables proxy use and rejects redirects.
- **Node PR #38 + Nexus PR #107 / P0-E1a process-crash durability:** the keyring transition is exercised with hard process termination after each durability checkpoint around retained previous identity, monotonic epoch floor and active-vault replacement. The proof requires temp-file fsync, atomic rename and parent-directory fsync ordering and demonstrates deterministic restart/recovery. This is bounded process/filesystem evidence; it does **not** claim physical power removal, controller-cache or storage-firmware behavior.
- **Node PR #39 + Nexus PR #108 / P0-E2a one-sided Agent snapshot anti-rollback:** a complete locally self-consistent old Agent security-state snapshot is restored while Nexus remains current. Re-delivery of the unchanged current dual-signed permit fails closed before real `Exchange` or `Recover` performs network I/O. Coordinated rollback of both Agent and Nexus/PostgreSQL is deliberately outside this gate.
- **PR #109 / P0-E2b one-sided PostgreSQL snapshot rollback:** a disposable real `pg_dump` → drop/recreate database → `pg_restore` rollback restores PostgreSQL to the exact pre-ACK tuple while the Agent journal remains current. Restore-time database ACL drift is detected and the reviewed signer/C2-C least-privilege provisioning is re-applied without mutating XSP-v2 security state. The current Agent accepts only the same authoritative dual-signed receipt bytes and rejects silent receipt replacement. Coordinated rollback remains outside this gate.

Exact post-merge P0-E2b evidence on `f9a9c636f83a3a2ef7122fef7c3f3bc2bc76b7d4`:

- [XSP-v2 P0-E2b PostgreSQL Snapshot Rollback #6](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40846810762) — **success** on the exact merge SHA, including the real PostgreSQL restore boundary, restore-time ACL re-hardening and current-Agent receipt witness.

The previous P0-D implementation checkpoint remains [`698d5e43d59c0c95532d513b39d95e42a2af4f20`](https://github.com/TriplexCorp/XMesh-Nexus/commit/698d5e43d59c0c95532d513b39d95e42a2af4f20), merge of [PR #105](https://github.com/TriplexCorp/XMesh-Nexus/pull/105). Its [Backend CI #3605](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40835127285) completed **success**. The disposable real-Agent migration/update proof remains [XSP-v2 P0-D real Agent E2E #10](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40827536439) on PR #103 merge SHA `7df13962aae871f04677b47e0f05a7f6ab906e72` — **success**.

The current verified XMesh-Node P0-E2a checkpoint is [`3fffa9fd74195114a7c4e573a8a11e075c84f403`](https://github.com/TriplexCorp/XMesh-Node/commit/3fffa9fd74195114a7c4e573a8a11e075c84f403), merge of Node PR #39. The earlier durable Agent state / authority checkpoint remains [`5e8ee562915a570eb49ed46d59d723f233f3cc68`](https://github.com/TriplexCorp/XMesh-Node/commit/5e8ee562915a570eb49ed46d59d723f233f3cc68), merge of Node PR #37.

The previous complete C2-D implementation checkpoint remains [`7e0b42ea4847b273ba8cd55a0ff3e043a420c377`](https://github.com/TriplexCorp/XMesh-Nexus/commit/7e0b42ea4847b273ba8cd55a0ff3e043a420c377), merge of [PR #88](https://github.com/TriplexCorp/XMesh-Nexus/pull/88). Its exact post-merge C2-D transport-negative, lost-response/race, expired-recovery, Hybrid TLS and Backend CI matrix remains valid within that stated isolated staging/process boundary.

Production behavior remains unchanged. The root XMesh-Node edge router remains on its Go 1.23 production path; the signed shell/systemd control Agent remains the deployed command authority; the Go 1.27 migration/package path remains behind explicit non-default staging gates. `strict-pq` remains **OFF**. P0-D completion and P0-E1a/P0-E2a/P0-E2b evidence do **not** authorize production VPS/DNS/firewall/public-Nginx/key-material changes, Agent cutover or rollout.

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
6. XMESH1-style timestamp/nonce/signature headers sent to the exact ACK endpoint without authenticated PQ client identity;
7. attempts to reach a legacy `/api/v1/node/heartbeat` path through the dedicated XSP-v2 ingress.

A positive strict-PQ control after the negative matrix still commits exactly one authoritative transition, one receipt and one replay nonce. The dedicated ingress has a strict default TLS listener that rejects unknown/missing SNI, and no authenticated XMESH1/legacy fallback exists on the XSP-v2 ACK boundary.

## P0-D production-capable Agent workflow — COMPLETE

C2-D established the required transport, identity, cryptographic authorization, durable state, recovery, concurrency, outage/restart and downgrade/no-fallback behavior in isolated staging/process E2E. P0-D integrated those proven semantics into a **production-capable but default-disabled Agent design** without enabling them in production.

### P0-D completed work

- **P0-D1a COMPLETE — immutable release identity:** PR #90 created the append-only exact release-manifest ledger.
- **P0-D1b COMPLETE — atomic queue binding:** PR #91 bound an approved immutable manifest to the existing fixed-action `update_agent` single-flight queue without broadening the remote command surface.
- **P0-D1c COMPLETE — owner-only staging orchestration API:** PR #93 reused the existing Agent-update endpoint behind exact default-disabled `staging-only` gating; only owners may select an approved release version, Nexus resolves immutable revision/digest server-side, and legacy `{}` remains unchanged.
- **Authenticated poll/apply/ACK release identity COMPLETE — staging/signed lifecycle:** PR #95 carries the exact immutable release identity through signed poll, the existing fixed updater apply path and signed ACK; exact ACK evidence is durable, identity mismatch/omission fails closed, and heartbeat-only success is forbidden for bound migration commands.
- **Real Agent integration design / Go 1.27 migration COMPLETE — architecture/source contract:** PR #97 defines the deployed split and migration/rollback/no-downgrade invariants; PR #98 adds the machine-readable Go 1.27 integration contract; PR #99 reconciles both against the current Node wrapper/primitives boundary.
- **Staged download / verify / apply / rollback COMPLETE — staging/artifact lifecycle:** PR #101 implements server-controlled content-addressed artifact delivery, exact SHA-256 + embedded source-identity verification, private staging, atomic activation, last-known-good rollback and security-state preservation without changing default production behavior.
- **Disposable real Nexus↔Node migration/update E2E COMPLETE — staging/real Agent E2E:** PR #103 proves real pinned Go 1.27.3 Agent claim/download/apply/ACK, exact lost-response recovery, restart/idempotent retry, deterministic rollback, durable ACK evidence and unchanged default-disabled production gating.
- **Durable real-Agent security state + authenticated authority binding COMPLETE:** Node PR #37 persists/attests the real Agent's monotonic key/cutover state and rejects stale/corrupt rollback before network exchange; Nexus PR #105 pins that merged Node source and machine-checks exact epoch-floor/old-key/restart invariants plus the authenticated `address`/`serverName` split, HTTP Host binding, no proxy and no redirect.

P0-D acceptance is satisfied by the default-disabled production-capable Agent workflow, exact signed release lifecycle, real package verification/rollback, disposable real Nexus↔Node migration/update proof, durable real-Agent security state, authenticated transport authority, fixed-head merges and exact post-merge CI. **This is not production activation.**

## CURRENT P0 — P0-E recovery/security release gates

### Completed P0-E work

- **P0-E1a COMPLETE — process-crash/fsync-order durability:** Node PR #38 + Nexus PR #107 prove deterministic fail-closed restart/recovery across hard process termination at the critical local keyring durability boundaries. This does not prove physical power-loss/controller-cache behavior.
- **P0-E2a COMPLETE — one-sided Agent snapshot anti-rollback:** Node PR #39 + Nexus PR #108 prove a fully self-consistent old Agent snapshot cannot use a current unchanged Nexus permit; applied-state attestation rejects it before network I/O.
- **P0-E2b COMPLETE — one-sided PostgreSQL snapshot rollback:** PR #109 proves a real database dump/restore rollback cannot silently rewrite state already witnessed by a current Agent, and that restore-time least-privilege database ACL re-hardening is part of the recovery contract.

### CURRENT sub-gate — P0-E3a owner/off-host monotonic recovery checkpoint

P0-E3a must introduce an **independent, non-rolled-back owner/off-host trust domain** that can bind a monotonic recovery checkpoint to the Agent security identity and the Nexus/PostgreSQL security state. This is required to detect a coordinated rollback in which both the Agent state root and Nexus/PostgreSQL are restored to mutually consistent old snapshots. P0-E3a must not create an automatic recovery bypass, silently reset epochs/replay state, or weaken the existing dual-signature/strict-transport invariants.

After P0-E3a, P0-E still must close:

1. physical power-loss / storage-controller-cache behavior beyond the bounded process-crash proof;
2. complete backup/restore of PostgreSQL plus persistent security identities, including coordinated restore/recovery procedures;
3. owner-authorized key rotation/recovery and explicit old-key retirement policy;
4. parser/protocol fuzzing plus FIPS 204 / algorithm known-answer validation where applicable;
5. independent security review of the final migration/production architecture and operational observability without secret/key leakage.

`strict-pq` remains **OFF** throughout P0-E unless a later explicit production/release gate separately authorizes activation. Production rollout remains separately gated and unauthorized.

## Security guardrails

- `strict-pq` remains **OFF**.
- Production control-plane behavior remains legacy `XMESH1` / Ed25519 until separately approved P0-E and rollout gates authorize migration.
- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate validation.
- Completed C2-D evidence is isolated staging/process evidence, not production activation.
- Completed P0-D capabilities/evidence and bounded P0-E1a/P0-E2a/P0-E2b proofs remain default-disabled staging/production-capable foundations; none authorize production rollout.
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

## Installation

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
- [XSP-v2 P0-E crash durability](docs/XSP_V2_P0E_CRASH_DURABILITY.md)
- [XSP-v2 P0-E snapshot anti-rollback](docs/XSP_V2_P0E_SNAPSHOT_ANTIROLLBACK.md)
- [XSP-v2 P0-E PostgreSQL snapshot rollback](docs/XSP_V2_P0E_POSTGRES_SNAPSHOT_ROLLBACK.md)
- [XSP-v2 signer E2E](docs/XSP_V2_SIGNER_E2E.md)
- [XSP-v2 TLS / ingress-origin proof](docs/XSP_V2_TLS_PROBE.md)
- [Subscription security](docs/SUBSCRIPTION_SECURITY.md)

Historical long-form README content through 27 October 2026 is preserved under [`docs/archive/`](docs/archive/). Archived “current/next P0” statements do not override the current Roadmap.

---

XMesh Nexus is under active development. Code or a green isolated test alone does not establish enterprise/HA readiness, production PQ protection or successful deployment.