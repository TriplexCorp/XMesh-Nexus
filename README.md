# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages nodes, users, subscriptions, Xray configuration, telemetry and security state. The user VPN data-plane remains **Xray-core**; XMesh is the control plane and must not be described as an extra encryption layer around user VPN traffic.

[English](README.en.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 engineering checkpoint — 28 October 2026

**Latest verified Nexus implementation checkpoint:** [`a756f1ac705c5f2c013cee8f706ee8714f720d98`](https://github.com/TriplexCorp/XMesh-Nexus/commit/a756f1ac705c5f2c013cee8f706ee8714f720d98), merge of [PR #86](https://github.com/TriplexCorp/XMesh-Nexus/pull/86).

PR #86 closes the focused **P0-C2-D2 integrated outage/restart sub-gate** on top of the already-complete expired-recovery, lost-response/race and transport-alignment work. It does **not** yet complete C2-D2 as a whole: the final integrated failed-PQ / wrong-client / downgrade / no-legacy-fallback proof at the ACK-operation boundary remains open.

Exact post-merge evidence on `a756f1ac705c5f2c013cee8f706ee8714f720d98`:

- [XSP-v2 C2-D2 Lost Response and Race E2E #40771123783](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40771123783) — **success**, including the integrated outage/restart matrix;
- [Backend CI #40771123762](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40771123762) — **success**.

The current D2 workflows pin XMesh-Node [`2cbe3a82473fc199c2354497eaf009707603f3f2`](https://github.com/TriplexCorp/XMesh-Node/commit/2cbe3a82473fc199c2354497eaf009707603f3f2), which provides the native `RecoverSignedACKReceipt` transport and package-private historical permit/ACK verifier. The prior transport-alignment checkpoint is [`86e01727443389c89b1b3d633206d3f4bc274838`](https://github.com/TriplexCorp/XMesh-Nexus/commit/86e01727443389c89b1b3d633206d3f4bc274838), merge of PR #84; the prior lost-response/race checkpoint is [`39e1589c82c52fe0c4af6fd5fc4d64aa782a465e`](https://github.com/TriplexCorp/XMesh-Nexus/commit/39e1589c82c52fe0c4af6fd5fc4d64aa782a465e), merge of PR #82; and the expired-recovery checkpoint is [`5acccfa1877016e464290b20ebba537c0b5bbad3`](https://github.com/TriplexCorp/XMesh-Nexus/commit/5acccfa1877016e464290b20ebba537c0b5bbad3), merge of PR #77. The D1 implementation checkpoint remains [`037290bbb31dc6e5d155a14b8ddf58a31e21066f`](https://github.com/TriplexCorp/XMesh-Nexus/commit/037290bbb31dc6e5d155a14b8ddf58a31e21066f), merge of PR #73.

Production Node still uses the legacy Go 1.23 control path. Go 1.27 XSP-v2 transport/cutover code remains staging/research code. `strict-pq` remains OFF and no production VPS, DNS, firewall, public Nginx, production PostgreSQL or real-key change has been made.

## Completed XSP-v2 gates

### P0 — isolated signer

PR #61 proved the separate signer process/socket boundary, protected key mounts, peer UID/GID checks, owner-approved Ed25519/ML-DSA-65 pins, least-privilege read-only signer DB role, committed ACK readback and immutable receipt recovery.

### P0-C1 — dedicated PQ-only ingress

PR #64 proved TLS **1.3 only**, actually negotiated `X25519MLKEM768`, trusted certificate/hostname verification, fresh handshakes and fail-closed downgrade negatives. The C1 runtime remains isolated from the normal Nexus API and inactive in the default installer/Compose deployment.

### P0-C2-A — trusted Node identity / protected origin

PR #66 proved:

`Node test client → TLS1.3/X25519MLKEM768 + ML-DSA-65 client identity → dedicated ingress → protected Unix-domain socket → origin verifier`

Trusted Node identity comes from verified ML-DSA-65 client-certificate SPKI plus protected Unix peer credentials, never caller `nodeId`, arbitrary headers, source IP or legacy `XMESH1` identity.

### P0-C2-B — narrow ACK route

PR #69 mounted only exact staging `POST /api/v2/node/keys/rotation/ack` behind the proven hybrid-mTLS→UDS identity boundary. It introduced no broad proxy, generic API route or classical/TCP backend hop. C2-B remained structural-only and deliberately returned `authorizationStatus: "not-verified"`.

### P0-C2-C — cryptographic ACK authorization and transaction — COMPLETE

PR #71 connects the trusted C2-B origin boundary to existing XSP-v2 crypto and durable-state foundations without creating a competing state machine.

Tested local path:

`trusted C2-B origin → protected UDS C2-C service → dual-signature ACK verification → PostgreSQL ACK/epoch commit → isolated signer → immutable dual-signed receipt`

C2-C proves:

- ACK authorization requires **Ed25519 AND ML-DSA-65** against the owner-enrolled `node_request` keyset;
- trusted transport Node identity is bound to exact ACK bytes, request ID, nonce, permit, candidate and epoch state;
- stale/tampered/wrong-peer evidence fails closed;
- the existing atomic ACK→epoch PostgreSQL transition is reused;
- the dedicated `xmesh_c2c_writer` role remains least-privilege;
- signer-down after ACK commit returns no false policy success;
- signer recovery/concurrent retry converges to one durable dual-signed receipt;
- durable receipt recovery works without a second epoch transition;
- DB stall fails closed;
- old public keys remain unretired;
- C2-C has no signer private-key mount or TCP listener;
- default production router/Compose/installer remain unchanged.

Known limit: C2-C does **not** claim exactly-once signing before the first durable outbox INSERT. The first durable receipt remains authoritative.

### P0-C2-D1 — real Node integrated E2E — COMPLETE

PR #73 proves the first integrated half of C2-D using the real staging Node cutover code instead of starting only at the trusted origin boundary.

D1 proves:

- the Node verifies and journals the exact signed permit and ACK;
- the exchange uses TLS 1.3 + actually negotiated `X25519MLKEM768` + ML-DSA-65 mutual TLS;
- another otherwise-valid ML-DSA client cannot impersonate the pinned Node;
- one request crosses ingress → protected origin UDS → C2-C → PostgreSQL → isolated signer;
- the Node treats success as valid only after verifying **Ed25519 AND ML-DSA-65** on the commit receipt and durably journaling it;
- a restarted Node test process can re-authenticate an already-durable local permit/ACK/receipt witness after permit expiry without treating that expired permit as a new command;
- no host-published port is introduced and the production Agent remains untouched.

D1 intentionally did not weaken ACK freshness. A second stale network ACK stayed rejected, which exposed the historical-recovery requirement now closed by PR #77.

### First P0-C2-D2 sub-gate — expired exact network recovery — COMPLETE

PR #77 proves a distinct historical-recovery domain without weakening the state-changing ACK route:

`real strict Node → TLS1.3/X25519MLKEM768 + ML-DSA-65 mTLS → exact historical recovery operation → trusted origin → XSP2C2H1 UDS domain → committed ACK + immutable receipt lookup → exact stored receipt → Node verification`

It proves:

- the ordinary fresh ACK route still rejects the expired ACK;
- historical recovery is separately distinguishable and remains behind the same authenticated PQ transport identity;
- the recovery ACK must match exact already-committed durable evidence;
- C2-C recovery reads only an already-durable immutable receipt and does not run fresh ACK commit/CAS;
- the signer can be stopped during recovery; no re-signing is required;
- the exact stored receipt is returned, epoch does not advance again, and outbox cardinality stays one;
- a mismatched ACK cannot recover another receipt;
- an alternate valid ML-DSA client identity cannot recover the pinned Node's receipt;
- HTTP status alone is still not success: the Node verifies the dual-signed receipt and bindings.

### Second P0-C2-D2 sub-gate — lost-response and duplicate/race convergence — COMPLETE

PR #82 uses the same pinned real XMesh-Node Go 1.27 staging client and proven PQ-mTLS→UDS→C2-C→PostgreSQL→signer topology. Test-only fault injection exists only at the disposable origin response boundary and does not relax identity, freshness, cryptographic authorization or durable-state checks.

It proves:

- a lost response before C2-C authorization/commit leaves the epoch unadvanced and creates no receipt;
- signer unavailability after the ACK/epoch transition fails closed: the durable ACK transition can exist while no receipt/policy success is synthesized;
- a lost HTTP response after successful C2-C receipt persistence leaves one authoritative immutable durable receipt;
- an exact retry with the signer offline recovers the exact durable receipt bytes without re-signing or a second epoch transition;
- eight concurrent exact fresh Node retries converge to the same durable receipt, one outbox record and one epoch transition;
- a fresh mismatched/tampered retry is rejected without changing the authoritative durable state;
- the disposable origin UDS server is concurrent so the race reaches the existing C2-C/PostgreSQL serialization path instead of being hidden by a single-threaded test backlog;
- no TTL/freshness weakening, generic stale authorization, public port, production Agent/default Compose activation or `strict-pq` change was introduced.

### D2 transport-alignment prerequisite — COMPLETE

PR #84 aligns the already-proven D2 recovery behavior with the current XMesh-Node native transport contract:

- the external exact historical endpoint is `POST /api/v2/node/keys/rotation/ack/recover`;
- the protected origin keeps its internal `/recovery` operation and `XSP2C2H1` domain;
- the Node positive recovery path uses native `reloadVerifiedPermitForReceiptRetry` + `RecoverSignedACKReceipt`;
- obsolete Nexus-owned recovery helper usage is removed from the cross-repo D2 proof;
- D2 workflows pin Node `2cbe3a82473fc199c2354497eaf009707603f3f2`;
- the ordinary stale ACK route, mismatched recovery negatives, explicit staging-only historical-recovery gate and no-production-activation constraints remain unchanged.

### Third P0-C2-D2 sub-gate — integrated outage/restart convergence — COMPLETE

PR #86 extends the real-Node failure matrix with actual disposable process outages and restarts rather than introducing another state machine or a caller-controlled bypass.

It proves:

- origin outage before commit fails closed and leaves the permit `issued`;
- C2-C outage before commit fails closed and leaves the permit `issued`;
- PostgreSQL outage before commit fails closed; DB restart plus C2-C reconnect preserve the uncommitted state;
- signer outage after durable ACK/epoch commit leaves `ack_verified` state but no receipt and no false Node success;
- C2-C restart while signer is unavailable, followed by signer restart, converges the already-committed ACK to one durable receipt;
- origin + C2-C restart after durable receipt preserves exact ordinary fresh retry/recovery with the signer offline;
- PostgreSQL outage after durable receipt fails closed, then DB/C2-C/origin restart returns the same authoritative receipt/state;
- after the original ACK expires, native `/ack/recover` historical recovery still returns only the same immutable receipt after the complete restart history;
- replay nonce cardinality remains exactly one;
- both old and new public-key epochs remain present and unrevoked, with no automatic retirement;
- ingress/C2-C/origin expose no host-published ports, origin remains `network=none`, C2-C/origin do not mount signer private keys, C2-C PID 1 has no TCP listener, and the process network remains internal/no-egress.

The three D2 behavior sub-gates plus transport alignment are still a **partial C2-D2 completion only** until the final integrated transport-negative/no-legacy proof passes.

## CURRENT P0 — final P0-C2-D2 transport-negative / no-legacy gate

Overall P0-C2-D remains **CURRENT P0**. The current verified implementation checkpoint is `a756f1ac705c5f2c013cee8f706ee8714f720d98`.

Completed in PR #77, PR #82, PR #84 and PR #86:

1. exact historical network recovery after the original ACK freshness window, with no stale new transition, re-signing or second epoch transition;
2. lost response before durable ACK commit;
3. lost response after durable ACK/epoch commit while the signer/receipt path is unavailable;
4. lost response after durable receipt persistence plus exact signer-off retry/recovery;
5. eight-way exact fresh duplicate race convergence to one authoritative receipt/epoch;
6. fresh mismatched/tampered retry rejection without durable-state mutation;
7. native current-Node `/ack/recover` transport alignment without weakening freshness or recovery gating;
8. real origin/C2-C/PostgreSQL/signer outages and restarts around uncommitted, committed-without-receipt and durable-receipt states;
9. replay nonce cardinality, old-key retention and complete topology invariants across those outage/restart transitions.

Still required before C2-D2 is complete:

1. integrated failed-PQ / wrong-client / downgrade negatives at the real ACK-operation boundary: TLS 1.2, X25519-only/classical-only negotiation, wrong client certificate, wrong hostname/SNI or trust root must fail before policy success and leave durable ACK/epoch/receipt state unchanged;
2. prove those transport failures do not trigger or reach an authenticated legacy/XMESH1 fallback path; unrelated/legacy paths on the dedicated XSP-v2 ingress must remain inert;
3. full final C2-D2 fixed-head PR CI/review/merge and post-merge exact-SHA lifecycle;
4. only after that final proof may documentation mark C2-D complete and open P0-D.

The next focused sub-gate is therefore the **integrated transport-negative/no-legacy matrix**. It must reuse the proven real Node/PQ ingress/ACK topology, assert no durable-state mutation for every failed transport/identity attempt, and must not add a fallback route or a weaker authenticated session.

After all of C2-D, the next major gate is **P0-D**: integrate the proven XSP-v2 transport/state machine into a production-capable Agent workflow so an operator can eventually update an Agent from the Nexus UI and have migration, validation and recovery happen automatically.

## Security guardrails

- `strict-pq` remains **OFF**.
- Production control-plane behavior remains legacy `XMESH1` / Ed25519 until separately approved replacement gates are complete.
- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate validation.
- D1 and the completed D2 sub-gates are isolated staging/process proofs, not production activation.
- A GitHub merge is not a production deployment.
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
