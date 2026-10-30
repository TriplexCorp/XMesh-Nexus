# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 30 October 2026

This file defines the **current order of work**. Historical roadmaps/checkpoints under [`archive/`](archive/) do **not** override this document.

A green test proves only its stated boundary. Code existence ≠ E2E ≠ security review ≠ production deployment.

## Verified source checkpoints

- **Latest verified Nexus P0-E recovery/security checkpoint:** [`a477c1f6067da2e8ecab0344433d1691c3c75b47`](https://github.com/TriplexCorp/XMesh-Nexus/commit/a477c1f6067da2e8ecab0344433d1691c3c75b47), merge of [PR #131](https://github.com/TriplexCorp/XMesh-Nexus/pull/131). Since P0-E4a6, Node PRs #46–#50 plus Nexus PRs #127–#131 close the bounded owner-authorized old-key retirement chain, add strict recovery/retirement parser fuzz smoke and pin an external official NIST ACVP ML-DSA-65 FIPS 204 signature-verification corpus. P0-E4a itself remains OPEN until five representative physical abrupt-power experiments are executed and independently reviewed. The current implementable repo-side P0-E software gate is operational observability without secret/key leakage.
- **Owner-authorized retirement authorization / Node PR #46 + Nexus PR #127:** Node merge [`e0f6bc01de98aad488fce73e1e605ba24f566bb1`](https://github.com/TriplexCorp/XMesh-Node/commit/e0f6bc01de98aad488fce73e1e605ba24f566bb1) introduces the canonical `XSP2-OWNER-RETIRE-PREVIOUS-V1` authorization, requires both Ed25519 and ML-DSA-65 owner signatures and binds the decision to the exact Node identity, authenticated server authority, previous→active epochs/key IDs and current signed off-host recovery checkpoint. Nexus PR #127 pins and independently re-verifies that read-only source contract.
- **Offline retirement issuance / Node PR #47 + Nexus PR #128:** Node merge [`cd1f187a06ea6f320023027e06e1a57d2be81af3`](https://github.com/TriplexCorp/XMesh-Node/commit/cd1f187a06ea6f320023027e06e1a57d2be81af3) exports a public-only request from the retained rotation and adds an offline owner signer that re-verifies the checkpoint and requires protected owner-owned mode-0600 unencrypted PKCS#8 keys. Owner private keys never enter Nexus or normal Agent state. Nexus merge [`a01fd9a57fda4fbf143a69195e1275d6a1ccb68e`](https://github.com/TriplexCorp/XMesh-Nexus/commit/a01fd9a57fda4fbf143a69195e1275d6a1ccb68e), PR #128, pins that exact flow; its dedicated post-merge contract and Backend CI completed success.
- **Crash-safe durable old-key erasure / Node PR #48 + Nexus PR #129:** Node merge [`3d2fc155ead11e86a2872ad12fbe28f157bb24db`](https://github.com/TriplexCorp/XMesh-Node/commit/3d2fc155ead11e86a2872ad12fbe28f157bb24db) persists an authenticated HMAC-SHA256 retirement intent under the existing Agent master key before deleting retained material. Only `.previous` and `.next` may be erased; active vault and monotonic epoch floor are preserved. Parent-directory fsync, crash checkpoints, exact idempotent resume, rollback/reintroduction floors and the single non-test high-level caller are tested. Nexus merge [`a85a0cc4a42da446f85e891d7b38ee52fd5b5e3d`](https://github.com/TriplexCorp/XMesh-Nexus/commit/a85a0cc4a42da446f85e891d7b38ee52fd5b5e3d), PR #129, pins the exact 13-file Node delta and re-runs the Agent/keyring/crash proofs.
- **Bounded strict security parser fuzzing / Node PR #49 + Nexus PR #130:** Node merge [`fc1548171aad331b8a7851a895a7f18a5440e858`](https://github.com/TriplexCorp/XMesh-Node/commit/fc1548171aad331b8a7851a895a7f18a5440e858) adds native Go fuzz targets for the strict off-host checkpoint, retirement request and retirement authorization decoders. Accepted inputs must survive canonical/schema validation and strict decode→marshal→decode semantic equality. Nexus merge [`6eb8198c25bfc64465407dceddb1f86de48b09b7`](https://github.com/TriplexCorp/XMesh-Nexus/commit/6eb8198c25bfc64465407dceddb1f86de48b09b7), PR #130, pins the exact two-file Node delta and independently re-runs all three bounded fuzz targets. This is CI smoke robustness evidence, not exhaustive fuzzing.
- **External ML-DSA-65 FIPS 204 sigVer vectors / Node PR #50 + Nexus PR #131:** Node merge [`ffebcc30424463dd0afcdb8226bcd4b48c019bff`](https://github.com/TriplexCorp/XMesh-Node/commit/ffebcc30424463dd0afcdb8226bcd4b48c019bff) verifies Go 1.27.3 `crypto/mldsa` against an exact official `usnistgov/ACVP-Server` corpus pinned at revision `a7f283cdc87d2d6dd93c1bac59e5622c5f9f8324` and exact vector Git blobs. The API-compatible scope is ML-DSA-65, external interface, pure ML-DSA, `externalMu=false`; it contains exactly **1 group / 15 cases / 3 expected-valid / 12 expected-invalid** and all results match NIST. Nexus merge [`a477c1f6067da2e8ecab0344433d1691c3c75b47`](https://github.com/TriplexCorp/XMesh-Nexus/commit/a477c1f6067da2e8ecab0344433d1691c3c75b47), PR #131, pins Node/NIST revisions and blobs and independently re-runs the vector proof. Exact post-merge [NIST contract run #40993523748](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40993523748) completed **success**. This is external verification-vector evidence, not ACVP certification or exhaustive assurance.
- **P0-E3b / PR #114:** a disposable coordinated recovery proof captures a real PostgreSQL custom-format dump, complete real-Agent XSP-v2 state root, protected `panel_response` Ed25519 + ML-DSA-65 signer identity and persistent mTLS identity while the newest E3a checkpoint/pins remain outside the backup rollback domain. Exact-current restore validates without reset/regeneration/receipt rewriting; an internally consistent old coordinated restore is rejected by the newer E3a floor without mutating restored Agent/DB security state; mixed, missing and tampered components fail closed; signer/C2-C ACL re-hardening preserves the XSP-v2 tuple.
- **P0-E4a1 / PR #116:** Nexus merge [`f7b746eb92c5e1bda7be67814233f09c60ee90b9`](https://github.com/TriplexCorp/XMesh-Nexus/commit/f7b746eb92c5e1bda7be67814233f09c60ee90b9) adds a read-only storage qualification preflight. It records filesystem/mount/block-device durability facts, verifies PostgreSQL durability settings, requires independent PLP/controller evidence for write-back cache, rejects unsafe/unknown inputs, and deliberately reports `physicalPowerLossQualified=false`. [Storage Preflight #5](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40961979406) and [Backend CI #3665](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40961979407) completed **success** on the exact merge SHA.
- **P0-E4a2 / Node PR #44 + Nexus PR #117:** Node merge [`50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e`](https://github.com/TriplexCorp/XMesh-Node/commit/50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e) adds the lab-only external power-cut arming hook at the five existing rotation durability boundaries. It signals only through an inherited FD, emits the exact arm marker and blocks security-state progress; normal Agent artifacts contain no lab/crash controls and the two evidence tags cannot coexist. Nexus PR #117 pins and re-verifies that exact source. Node [Power-cut Arm #2](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40962739169) and [Crash Durability #18](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40962739053), plus Nexus [Node Power-cut Contract #2](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40963109541) and [Backend CI #3667](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40963109551), are **success**. This is lab readiness only, not physical power-loss evidence.
- **P0-E4a3 / PR #121:** Nexus merge [`d57e74ef73f704b2229347c4f8712c5c1e527b0b`](https://github.com/TriplexCorp/XMesh-Nexus/commit/d57e74ef73f704b2229347c4f8712c5c1e527b0b) adds the strict physical-run evidence schema/verifier. A valid bundle binds the reviewed Node source, exact lab-binary digest, selected arm point/run ID, storage preflight, independent controller event, changed boot ID, post-boot Agent/PostgreSQL evidence and E3a witness. [Power-cut Evidence Contract #4](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40972825779) and [Backend CI #3680](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40972822127) are **success**. Synthetic CI does not count as a physical run.
- **P0-E4a4 / PR #122:** Nexus merge [`8ca408fd50169ef4311a30b6248c2a4743e6a3a5`](https://github.com/TriplexCorp/XMesh-Nexus/commit/8ca408fd50169ef4311a30b6248c2a4743e6a3a5) adds the deterministic five-point review matrix over exactly one valid E4a3 bundle for each critical checkpoint. It rejects duplicates and mixed source/storage generations and produces a stable review digest. [Power-cut Matrix Contract #4](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40973807849) and [Backend CI #3682](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40973807725) are **success**. This is review tooling, not hardware qualification.
- **P0-E4a5 / Node PR #45 + Nexus PR #123:** Node merge [`7bf8cc92950f396e33891c8744c1f6855414154b`](https://github.com/TriplexCorp/XMesh-Node/commit/7bf8cc92950f396e33891c8744c1f6855414154b) adds a test-only runner that reaches all five external arm markers through the real `ActivatePreparedRotation` / `RecoverRotation` operations. Nexus merge [`a34d0999ca519e2a81e68d92ec7136cd606518d4`](https://github.com/TriplexCorp/XMesh-Nexus/commit/a34d0999ca519e2a81e68d92ec7136cd606518d4) pins that runner while separately preserving reviewed core source `50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e` and proves the core keyring/hook files are byte-identical across the revisions. Node [Lab Operation #2](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40975150937), Nexus [Node Lab Operation Contract #2](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40976111704) and [Backend CI #3684](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40976111693) are **success**. P0-E4a remains OPEN.
- **P0-E4a6 / PR #125:** Nexus merge [`2889864d6ec7f89202d8d82f2feda87501f0f349`](https://github.com/TriplexCorp/XMesh-Nexus/commit/2889864d6ec7f89202d8d82f2feda87501f0f349) adds the final offline physical-run handoff. Before a real cut it freezes the exact run/checkpoint/rotation, pinned reviewed sources, lab-binary digest, E4a1 preflight digests, independently verified E3a witness, external controller identity and pre-cut boot ID. After reboot it reuses E4a3 and requires separately preserved arm/controller/Agent/PostgreSQL/review records to match the final evidence exactly. [Physical-run Handoff #2](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40981894822) and [Backend CI #3688](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40981894714) are **success**. No BMC/PDU API or production activation exists; P0-E4a remains OPEN.
- On exact Nexus merge SHA `0afffa3933991861607c27d8410115bc2054cd7c`, [P0-E3b Coordinated Backup Restore #24](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40953999674) and [Backend CI #3658](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40953999812) completed **success**, including the full real coordinated restore proof and the backend/disposable API regression matrix.
- **P0-E3a / PR #112:** the experimental-only offline checkpoint binds Node identity, the dual-signed receipt `toEpoch` recovery floor, exact receipt digest/bytes and independently provisioned `panel_response` Ed25519 + ML-DSA-65 pins. A coordinated old local restore below that floor, same-epoch receipt divergence, wrong identity/pins or either invalid signature fail closed. No second recovery counter, automatic state reset/rekey, network route, DB mutation or production activation was introduced.
- On exact Nexus merge SHA `f19d01e021efaa727bbba82672143005a96338b7`, [P0-E3a Off-host Recovery Checkpoint #9](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40862058873), [Crypto #213](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40862058598), [C2-C #61](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40862058488) and [Backend CI #3632](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40862058513) all completed **success**. The witness/pins must remain outside both local rollback domains; rollback of the off-host trust domain itself remains outside this proof.
- **P0-E2b / PR #109:** a disposable real `pg_dump` / drop+create / `pg_restore` boundary restores PostgreSQL to the exact pre-ACK tuple while the Agent journal remains current. The first restore exposed default database-level privilege drift; the recovery contract now re-applies the reviewed idempotent signer/C2-C least-privilege provisioning, requires CREATE/TEMP/public-schema CREATE removal and proves re-hardening does not mutate XSP-v2 security state. The current Agent keeps its first authoritative dual-signed receipt immutable and rejects silent replacement after server rollback.
- On exact Nexus merge SHA `f9a9c636f83a3a2ef7122fef7c3f3bc2bc76b7d4`, [XSP-v2 P0-E2b PostgreSQL Snapshot Rollback #6](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40846810762) completed **success**, including the real PostgreSQL restore boundary, restore-time ACL re-hardening and current-Agent receipt witness.
- **P0-E2a / Node PR #39 + Nexus PR #108:** current XMesh-Node checkpoint [`3fffa9fd74195114a7c4e573a8a11e075c84f403`](https://github.com/TriplexCorp/XMesh-Node/commit/3fffa9fd74195114a7c4e573a8a11e075c84f403), merge of Node PR #39, proves a complete locally self-consistent old Agent state-root snapshot fails closed before real network I/O when the unchanged current dual-signed Nexus permit is re-delivered. Nexus PR #108 pins that exact Node proof. Coordinated Node + Nexus/PostgreSQL rollback is explicitly unproven by this gate.
- **P0-E1a / Node PR #38 + Nexus PR #107:** Node checkpoint [`8a86227f369aed2e6e952f1e41af52c7414aa4e3`](https://github.com/TriplexCorp/XMesh-Node/commit/8a86227f369aed2e6e952f1e41af52c7414aa4e3) proves hard process termination at the critical keyring durability checkpoints around retained previous identity, monotonic epoch floor and active-vault replacement. Nexus PR #107 pins the exact source contract. This is process/filesystem fsync-order evidence only; physical power removal, controller-cache and storage-firmware behavior remain unproven.
- **Latest completed Nexus P0-D implementation checkpoint:** [`698d5e43d59c0c95532d513b39d95e42a2af4f20`](https://github.com/TriplexCorp/XMesh-Nexus/commit/698d5e43d59c0c95532d513b39d95e42a2af4f20), merge of [PR #105](https://github.com/TriplexCorp/XMesh-Nexus/pull/105).
- **P0-D1a / PR #90:** immutable append-only Agent release identity `{version, sourceRevision, artifactSha256}` in PostgreSQL. Version/source/artifact identity cannot be rebound; UPDATE/DELETE/TRUNCATE are rejected. No production execution path was activated.
- **P0-D1b / PR #91:** an approved immutable release identity can be atomically bound to the existing fixed-action `update_agent` single-flight command queue. Binding attach/remove/replace after row creation is rejected; normal lifecycle state transitions remain legal. No HTTP/API caller, poll payload or Agent/updater execution changed in this gate.
- **P0-D1c / PR #93:** the existing `POST /nodes/{id}/agent-update` control plane gained an owner-only release-selection mode behind exact non-default `XSP_V2_P0D_AGENT_MIGRATION=staging-only`. Callers select only an approved version; Nexus resolves immutable source revision/artifact digest server-side and stages the existing fixed `update_agent` action. Legacy `{}` behavior remains unchanged and caller digest/URL/script/command input is rejected.
- **Authenticated poll/apply/ACK release identity / PR #95:** already-bound `update_agent` commands carry exact immutable `{version, sourceRevision, artifactSha256}` through the existing signed poll/apply/ACK lifecycle. The installed shell Agent validates and preserves the exact identity across the existing fixed updater service and returns it in the signed ACK. Nexus row-locks the claimed command, compares ACK identity with the immutable manifest and atomically persists terminal state plus exact ACK evidence. Missing/mismatched identity fails closed; a matching-version heartbeat cannot synthesize success for a bound migration; legacy unbound commands remain identity-free and compatible.
- **Real Agent integration design / PR #97 + PR #98 + PR #99:** the production deployment split and Go 1.27 migration boundary are documented and machine-checked. The root XMesh-Node Go 1.23 module remains the edge router; the existing shell/systemd control Agent remains the fixed remote-action authority; XMesh-Node `agent/xspv2` is the production-capable side-by-side Agent integration/artifact boundary on Go 1.27.3 and reuses `security/xspv2/poc-go` rather than copying the security state machine.
- **Staged download / verify / apply / rollback / PR #101:** approved Go 1.27 Agent bytes are delivered only from the server-controlled content-addressed artifact source through the existing signed control plane. The staged helper verifies exact manifest SHA-256 and embedded `{version, sourceRevision}` before activation, retains last-known-good state, switches atomically and restores package/service state on failure without rewinding durable security state. Caller URL/path/script input remains impossible; production activation stays disabled by default.
- **Disposable real Nexus↔Node migration/update E2E + retry recovery / PR #103:** manifest-bound claimed commands may be redelivered after a lost signed poll response within the bounded migration window, while a completed bound ACK may be replayed idempotently only when success/failure, detail and release identity exactly match durable evidence. The disposable E2E builds real pinned Go 1.27.3 Node Agent artifacts, proves signed claim/download/apply/ACK, exact lost-response retry, restart/idempotent apply, deterministic last-known-good rollback, security-state-root preservation, non-exact replay rejection and restoration of the default-disabled production gate.
- **Durable real-Agent security state + authenticated authority / Node PR #37 + Nexus PR #105:** XMesh-Node `agent/xspv2` persists the proven key/cutover state under the private Agent root, uses exact applied-rotation attestation before network exchange, preserves monotonic epoch/replay floors and retained old/new key snapshots across restart, and rejects stale/corrupt/rolled-back state. Nexus pins the exact merged Node source and machine-checks the reused strict transport: direct connect `Address` remains separate from authenticated `ServerName`, while TLS SNI/certificate verification and HTTP Host remain bound to `ServerName`; proxy use and redirects are rejected.
- On exact Nexus merge SHA `698d5e43d59c0c95532d513b39d95e42a2af4f20`, [Backend CI #3605](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40835127285) completed **success**, including the pinned current-Node durable-state/authority contract, strict Clippy/pedantic/nursery, Docker build and disposable PostgreSQL/API authentication integration.
- **Current XMesh-Node security-test checkpoint:** [`ffebcc30424463dd0afcdb8226bcd4b48c019bff`](https://github.com/TriplexCorp/XMesh-Node/commit/ffebcc30424463dd0afcdb8226bcd4b48c019bff), merge of Node PR #50. It layers the test-only official NIST ACVP ML-DSA-65 verification gate on parser-fuzz checkpoint `fc1548171aad331b8a7851a895a7f18a5440e858` and durable retirement checkpoint `3d2fc155ead11e86a2872ad12fbe28f157bb24db`.
- **Completed C2-D implementation checkpoint:** [`7e0b42ea4847b273ba8cd55a0ff3e043a420c377`](https://github.com/TriplexCorp/XMesh-Nexus/commit/7e0b42ea4847b273ba8cd55a0ff3e043a420c377), merge of [PR #88](https://github.com/TriplexCorp/XMesh-Nexus/pull/88). PR #88 closed the final C2-D2 integrated transport-negative / no-legacy-fallback proof at the real ACK-operation boundary; its exact post-merge matrix remains valid within that stated isolated staging/process scope.

## Binding XSP-v2 target invariant

The finished XSP-v2 control plane has one policy: **fail closed**.

All are mandatory:

1. **Transport:** TLS 1.3 with actually negotiated `X25519MLKEM768`, trusted certificate chain, correct hostname/SNI, application authority bound to the authenticated server name, and no unreviewed weaker hop.
2. **Messages:** Ed25519 **AND** ML-DSA-65 verification for every security-critical XSP/2 message.
3. **Binding/state:** exact sender/recipient, direction, method/path, payload/revision, request ID, nonce, key epoch and expiry; durable replay protection and monotonic security state.
4. **Key custody/enrollment:** verified owner authorization, proof of possession, pinned trust roots and protected private-key boundaries.
5. **Failure:** missing PQ support, invalid signature/certificate/state, stale epoch, replay or unavailable security component means reject — never automatic fallback to `XMESH1`, Ed25519-only, X25519-only, TLS 1.2 or insecure verification.

`strict-pq` remains **OFF** in production. Legacy `XMESH1` remains the deployed control-plane reality until separately approved P0-E and rollout/release gates replace it. Xray remains the user VPN data-plane.

## Gate status

| Gate | Status | Evidence / required next |
| --- | --- | --- |
| Dual-signed permit / applied ACK primitives | **STAGING PASS** | Ed25519 AND ML-DSA-65; canonical permit/nonce/epoch/candidate bindings |
| Atomic ACK → epoch commit/readback | **STAGING PASS** | PostgreSQL transaction/CAS and committed evidence |
| Signed commit receipt + immutable outbox | **STAGING PASS** | Exact durable bytes, dedupe/recovery and mutation guards |
| Isolated `panel_response` signer | **P0 COMPLETE — staging/process** | PR #61 |
| P0-C1 dedicated PQ-only Node ingress | **P0 COMPLETE — isolated network/process** | PR #64 |
| P0-C2-A ingress→origin trust boundary | **P0 COMPLETE — isolated staging/process** | PR #66 |
| P0-C2-B narrow staging ACK route | **P0 COMPLETE — isolated staging/process** | PR #69 |
| P0-C2-C ACK crypto/transaction/signer | **P0 COMPLETE — isolated staging/process** | PR #71 |
| P0-C2-D1 real Node integrated E2E | **P0 COMPLETE — isolated staging/process** | PR #73 |
| P0-C2-D2 expired exact recovery | **COMPLETE — isolated staging/process** | PR #77 |
| P0-C2-D2 lost-response + duplicate-race convergence | **COMPLETE — isolated staging/process** | PR #82 |
| P0-C2-D2 current Node recovery transport alignment | **COMPLETE — isolated staging/process** | PR #84 |
| P0-C2-D2 integrated outage/restart convergence | **COMPLETE — isolated staging/process** | PR #86 |
| P0-C2-D2 transport-negative / no-legacy proof | **COMPLETE — isolated staging/process** | PR #88 + Node PR #33; exact post-merge matrix green |
| **P0-C2-D overall** | **COMPLETE — isolated staging/process** | Full real-Node success/failure/retry/recovery/downgrade matrix complete |
| P0-D1a immutable Agent release identity | **COMPLETE — staging/DB foundation** | PR #90; append-only exact version/revision/SHA-256 identity |
| P0-D1b immutable release→`update_agent` binding | **COMPLETE — staging/DB foundation** | PR #91; exact immutable binding into existing single-flight queue |
| P0-D1c owner-only staging orchestration API | **COMPLETE — staging/API foundation** | PR #93; exact non-default gate, owner-only version selection, server-side immutable manifest resolution, legacy `{}` unchanged |
| Authenticated poll/apply/ACK release identity | **COMPLETE — staging/signed command lifecycle** | PR #95; exact manifest identity on signed poll/apply/ACK, durable ACK evidence, heartbeat-only bound success blocked, legacy unbound compatibility preserved |
| Real Agent integration design / Go 1.27 migration | **COMPLETE — staging/architecture + source contract** | PR #97 + #98 + #99; `agent/xspv2` wrapper over reused XSP-v2 primitives, rollback/no-downgrade contract fixed |
| Staged download / verify / apply / rollback | **COMPLETE — staging/artifact lifecycle** | PR #101; content-addressed server-controlled source, exact digest + embedded revision verification, atomic activation, last-known-good rollback |
| Disposable real Nexus↔Node Agent migration/update E2E | **COMPLETE — staging/real Agent E2E** | PR #103; real Go 1.27 artifacts, signed lifecycle, lost-response retry, restart, rollback, durable ACK evidence, default production gate restored OFF |
| Durable real-Agent security state + authenticated authority binding | **COMPLETE — production-capable/default-disabled Agent boundary** | Node PR #37 + Nexus PR #105; durable exact rotation attestation, monotonic floors/retained keys across restart, fail-closed corruption/rollback, authenticated `Address`/`ServerName` separation with no proxy/redirect |
| **P0-D production-capable Agent workflow** | **COMPLETE — default-disabled, not production activated** | Acceptance boundary satisfied by PR #90/#91/#93/#95/#97/#98/#99/#101/#103/#105 + Node PR #37; `strict-pq` stays OFF |
| P0-E1a process-crash / fsync-order durability | **COMPLETE — bounded process/filesystem proof** | Node PR #38 + Nexus PR #107; hard process-crash checkpoints and restart/recovery. Physical power-loss/controller-cache behavior remains unproven |
| P0-E2a one-sided Agent snapshot anti-rollback | **COMPLETE — bounded one-sided rollback proof** | Node PR #39 + Nexus PR #108; restored old Agent state rejected against current unchanged Nexus permit before network I/O |
| P0-E2b one-sided PostgreSQL snapshot rollback | **COMPLETE — disposable real DB restore proof** | PR #109; real `pg_dump`/`pg_restore`, restore ACL re-hardening, current-Agent immutable receipt witness |
| P0-E3a owner/off-host monotonic recovery checkpoint | **COMPLETE — bounded independent witness proof** | PR #112; existing dual-signed commit receipt becomes the owner-held off-host floor; coordinated old local restore and same-epoch receipt divergence fail closed |
| P0-E3b coordinated backup/restore recovery procedure | **COMPLETE — disposable coordinated recovery proof** | PR #114; exact current Agent+DB+signer+mTLS restore validates against E3a, old/mixed/missing/tampered sets fail closed |
| P0-E4a1 storage durability preflight | **COMPLETE — bounded preflight** | PR #116; read-only storage/PostgreSQL durability inventory, fail-closed policy, `physicalPowerLossQualified=false` |
| P0-E4a2 external power-cut arm/source contract | **COMPLETE — bounded lab readiness** | Node PR #44 + Nexus PR #117; exact arm marker on inherited FD, mutually exclusive test tags, normal Agent has no qualification controls |
| P0-E4a3 physical power-cut evidence contract | **COMPLETE — bounded evidence tooling** | PR #121; strict one-run schema/verifier binds source, binary, arm/controller event, reboot, Agent/PostgreSQL state and E3a witness; synthetic CI is not physical evidence |
| P0-E4a4 five-point power-cut review matrix | **COMPLETE — bounded review tooling** | PR #122; deterministic matrix over exactly the five required checkpoints, rejects duplicates/mixed generations; does not qualify hardware |
| P0-E4a5 real-operation lab reachability/source contract | **COMPLETE — bounded lab readiness** | Node PR #45 + Nexus PR #123; all five inherited-FD arm points reached through real activation/recovery operations; normal Agent contains no lab controls |
| P0-E4a6 physical-run handoff | **COMPLETE — bounded lab preparation** | PR #125; freezes pre-cut identity/evidence inputs and binds post-boot E4a3 evidence to separately preserved physical-lab records; never controls power or claims qualification |
| Owner-authorized old-key retirement | **COMPLETE — bounded authorization/issuance/durable erasure** | Node PRs #46–#48 + Nexus PRs #127–#129; dual owner signatures, offline custody, authenticated intent, crash-safe retained-snapshot erasure, rollback/reintroduction floor |
| Strict recovery/retirement parser fuzz smoke | **COMPLETE — bounded robustness evidence** | Node PR #49 + Nexus PR #130; three native Go fuzz targets with canonical/strict round-trip invariants; not exhaustive fuzzing |
| ML-DSA-65 FIPS 204 external sigVer vectors | **COMPLETE — bounded API-compatible external-vector evidence** | Node PR #50 + Nexus PR #131; pinned official NIST ACVP source/blobs, 1 group / 15 cases / 3 valid / 12 invalid; not ACVP certification |
| **P0-E4a physical power-loss / storage durability** | **CURRENT external/hardware sub-gate** | Execute and independently review five representative abrupt-power runs on qualified storage/controller stacks; no torn/lowered security state after power loss |
| **P0-E operational observability without secret/key leakage** | **CURRENT repo-side software sub-gate** | Add bounded health/audit visibility for security operations and component availability without private keys, bearer/MFA material or replayable signed payloads |
| Independent security review | **OPEN — after final repo-side architecture is frozen** | Independent review of migration/production architecture, threat model, trust/custody/rollback/observability boundaries and deployment plan |
| **P0-E recovery/security release gates** | **CURRENT P0** | Remaining blockers: real E4a physical-power matrix + independent review, operational observability, then final independent security review |
| Production XSP-v2 rollout | **NOT AUTHORIZED** | P0-E + disposable canary + explicit production approval required |

## Completed P0-C2-D — integrated real-Node proof

### D1 — real Node happy-path integration

PR #73 proved:

`real XMesh-Node Go 1.27 staging client → strict TLS1.3/X25519MLKEM768 + ML-DSA-65 mTLS → dedicated ingress → protected origin UDS → C2-C ACK auth/commit → PostgreSQL → isolated signer → dual-signed commit receipt → Node receipt verification + durable journal`

The Node verifies/journals the signed permit and ACK, accepts success only after dual-signature receipt verification and durable local persistence, and cannot be impersonated by another valid ML-DSA client identity. D1 preserved freshness and did not authorize stale network commands.

### D2 — exact recovery, failure, race and downgrade matrix

The complete D2 proof consists of PR #77, #82, #84, #86, Node PR #33 and PR #88.

#### Exact historical recovery

- expired ACK remains rejected on the state-changing route;
- historical receipt recovery uses exact external `/api/v2/node/keys/rotation/ack/recover` and protected internal `XSP2C2H1` recovery domain;
- exact committed ACK/durable receipt evidence must match;
- no fresh CAS/epoch transition, re-signing or second epoch transition occurs;
- signer may be offline once the immutable receipt is durable.

#### Lost responses / races

- loss before C2-C commit leaves no transition/receipt;
- signer unavailable after durable ACK/epoch transition gives no false Node success;
- loss after durable receipt persistence preserves one authoritative receipt;
- signer-off exact retry recovers the same receipt;
- eight concurrent exact retries converge to one epoch/outbox/replay result;
- mismatched/tampered retry fails closed without durable mutation.

#### Outages / restarts

- origin, C2-C and PostgreSQL outages before commit fail closed;
- signer outage after ACK commit preserves `ack_verified` without synthesizing receipt success;
- C2-C/signer restart converges to the one durable receipt;
- origin/C2-C/PostgreSQL restart after receipt durability recovers the same authoritative state and bytes;
- exact recovery still works after the full restart history;
- replay nonce cardinality stays one;
- old and new public-key epochs remain present and unrevoked;
- no host-published ingress/C2-C/origin ports, origin remains network-none, C2-C has no TCP listener, signer keys never mount into C2-C/origin, and the process network remains internal/no-egress.

#### Final transport-negative / no-legacy proof

PR #88 proves every listed transport/identity failure occurs before policy success and leaves the durable `(epoch, ledger state, outbox count, replay count)` tuple unchanged:

- TLS 1.2;
- TLS1.3 classical `X25519`-only negotiation;
- wrong SNI/hostname and unknown/missing SNI;
- untrusted server CA;
- alternate valid ML-DSA client certificate not matching the pinned Node;
- XMESH1-style timestamp/nonce/signature headers on the exact ACK route without authenticated PQ client identity;
- legacy `/api/v1/node/heartbeat` on the dedicated XSP-v2 ingress.

The dedicated ingress includes a strict default TLS listener that rejects unknown/missing SNI. There is no authenticated XMESH1/legacy fallback route on the XSP-v2 ACK boundary.

During this gate, the stricter default vhost exposed a real cross-layer authority bug: Go connected to an internal alias while TLS authenticated the intended `serverName`, but HTTP initially derived `Host` from the connect address. Node PR #33 fixed the shared native ACK/recovery transport by setting HTTP `Host = serverName`; Nexus strict test helpers enforce the same invariant. This keeps TCP routing and authenticated application authority distinct without allowing virtual-host downgrade after TLS success.

A final positive strict-PQ control after the negative matrix commits exactly one authoritative epoch transition, immutable receipt and replay nonce.

## P0-D production-capable Agent workflow — COMPLETE

C2-D proved the security/state-machine behavior in isolated staging/process E2E. P0-D moved that proven behavior into the production-capable Agent architecture behind explicit non-default gates. P0-D completion is **not** permission to enable strict PQ in production.

### Completed P0-D foundations, signed lifecycle and real package/E2E gates

#### P0-D1a — immutable Agent release identity — COMPLETE

PR #90 introduced an inert append-only release manifest ledger in PostgreSQL:

`version + sourceRevision + artifactSha256`

The identity is canonical and immutable: one version cannot be rebound to different source/artifact bytes; source revision is a lowercase 40-hex Git commit identity; artifact digest is lowercase 64-hex SHA-256; UPDATE/DELETE/TRUNCATE are rejected. The ledger does not contain a caller-selected URL, script or command and does not authorize download/apply by itself.

#### P0-D1b — atomic binding to existing Agent queue — COMPLETE

PR #91 introduced the DB primitive that resolves one already-approved immutable release and atomically inserts the existing fixed action `update_agent` into the existing single-flight `node_restart_commands` queue with the exact manifest foreign key.

The binding cannot later be attached, removed or replaced via `UPDATE`; once bound, node/action/version/manifest/requester identity is frozen while ordinary lifecycle fields such as pending/claimed/success/failure timestamps/results remain mutable. CI explicitly caught and fixed an early trigger-order bug that had allowed manifest removal, and regression coverage now forbids removal plus post-hoc attachment.

This gate did **not** change the HTTP API, signed poll payload, production Agent or updater execution behavior. No new remote action or second control plane was introduced.

#### P0-D1c — owner-only staging orchestration API — COMPLETE

PR #93 extended the existing `POST /nodes/{id}/agent-update` endpoint rather than creating a parallel control plane. Legacy `{}` requests continue through the preserved pre-D1c implementation. Release selection accepts only a release version and exists only when `XSP_V2_P0D_AGENT_MIGRATION=staging-only` exactly; owner authorization is required before Nexus resolves the approved immutable manifest server-side and calls the existing atomic staging primitive.

The request schema rejects caller-provided digest, URL, URI, script, shell command and executable-location overrides. Unknown releases, disabled gating, unauthorized callers and active-command conflicts fail closed. Disposable API/DB integration proves ordinary admin legacy `{}` behavior remains intact, admin release selection receives 403, unknown release fails closed, digest override is rejected, owner selection is atomically bound to the server-resolved manifest, single-flight remains authoritative, and the migration API disappears again after the gate is restored OFF.

This gate did **not** change signed poll/apply/ACK payloads or Agent/updater execution and did not authorize production activation.

#### Authenticated poll/apply/ACK release identity — COMPLETE

PR #95 carries the exact D1b/D1c manifest identity through the existing authenticated/signed command lifecycle without adding another action or control plane.

For an already-bound staged migration, signed poll returns exact `version`, `sourceRevision` and `artifactSha256`. The installed `node-control-agent.sh` validates exactly those fields, rejects partial/extra/malformed identity, preserves the identity in a root-only local runtime file across the existing fixed `xmesh-node-agent-upgrade.service` apply step, and sends the same identity back in the signed ACK. Nexus authenticates the ACK, row-locks the claimed command, compares the returned identity against the immutable manifest and persists exact ACK identity evidence atomically with the terminal state.

The database trigger keeps ACK evidence immutable and prevents unbound legacy commands from acquiring fabricated release identity. A bound migration cannot be changed to `succeeded` by the historical version-only heartbeat fallback unless exact successful ACK evidence already exists. Disposable integration uses a real generated Ed25519 Node identity and proves legacy identity-free poll/ACK compatibility, exact bound poll identity, heartbeat-only no-success, missing/mismatched ACK rejection without mutation, exact durable ACK evidence, duplicate ACK rejection and restoration of the default-disabled migration gate.

#### Real Agent integration design / Go 1.27 migration — COMPLETE

PR #97 mapped the actual deployed architecture and fixed the migration invariants. The root XMesh-Node Go 1.23 module is the edge router/data-path front end, not the signed control Agent. The production control/update authority remains the installed shell/systemd path (`xmesh-node-control`, `xmesh-update-agent`, `xmesh-node-agent-upgrade.service`) until a later explicit cutover.

PR #98 introduced a machine-readable Go 1.27 integration contract and CI that checks the exact Node source rather than relying only on prose. PR #99 reconciled the concurrent design views against the real wrapper/primitives boundary: `agent/xspv2` is the Go 1.27.3 production-capable side-by-side Agent integration/artifact boundary and must reuse `security/xspv2/poc-go` plus the existing `cutover` implementation instead of copying the security state machine.

The contract requires one fixed remote action (`update_agent`), immutable release identity, private state root `/var/lib/xmesh-agent/xsp-v2`, no second command queue/listener, explicit mixed-version fail-closed behavior, authenticated `Address`/`ServerName` separation, and a complete last-known-good rollback boundary before apply. Rollback may restore package/service state but must not roll epoch/replay floors backwards, delete durable ACK/receipt evidence or regenerate enrollment identities automatically.

#### Staged download / verify / apply / rollback — COMPLETE

PR #101 implemented the first real package lifecycle for an approved Go 1.27 Agent artifact without broadening the remote command surface. Artifact bytes come only from the server-controlled content-addressed source bound to the immutable manifest and are fetched over the existing signed control plane. The request/command still cannot carry a caller-selected URL, URI, script, shell command or executable path.

The helper stages into a private inactive path, verifies the exact approved `artifactSha256`, executes the real binary identity self-check and requires embedded version/source revision to equal the immutable manifest before changing active state. It retains last-known-good package/service identity, performs an atomic current-pointer switch and rolls package/service state back on post-switch failure while leaving the durable security-state root untouched. Legacy unbound update behavior remains distinct and compatible. Default production activation is unchanged and `strict-pq` remains OFF.

#### Disposable real Nexus↔Node migration/update E2E + lost-response recovery — COMPLETE

PR #103 closed the disposable real-Agent lifecycle proof on top of PR #101. It also fixed two real lost-response gaps while keeping the staged runtime baseline reviewed separately: a manifest-bound command already in `claimed` may be redelivered for the bounded migration window after a lost poll response/Agent restart, and an already-completed manifest-bound ACK may return idempotent duplicate success only if the retry exactly matches durable success/failure, detail and release identity evidence. Legacy unbound claimed commands and legacy duplicate-ACK behavior remain unchanged.

The exact E2E checks out pinned XMesh-Node `5b810d9d0864e6c22fa0c0d176982ef4cbf04b20`, builds two real Go 1.27.3 Agent binaries with different release versions and embedded exact source identity, publishes them into the Nexus content-addressed source, starts a disposable Nexus with the staging-only migration gate, and proves real signed migration/update success, lost-poll redelivery, exact ACK replay, mismatch rejection, restart/idempotent apply and deterministic rollback to the exact previous Agent. The rollback proof also verifies that the durable security-state root is not replaced or rewound. The test then restores and proves the default production gate disabled.

#### Durable real-Agent security state + authenticated authority binding — COMPLETE

Node PR #37 moved the proven durable key/cutover semantics into the real `agent/xspv2` state layout without copying the security state machine. The Agent keeps keyring and cutover journals under the private state root, retains exact old/new key snapshots, and uses the existing applied-rotation attestation to prove the active vault, exact monotonic floor and `.next`/`.previous` evidence agree before `Exchange` or `Recover` may reach the network.

Restart tests prove repeated `Prepare()` leaves the persisted master/vault/floor/old/new material byte-for-byte stable. Rollback/corruption negatives prove an old vault, lowered/corrupt floor or missing retained old-key snapshot fails closed instead of resetting the security epoch/replay boundary. Release/package identity remains separate from this monotonic security state, so package rollback cannot reinterpret old state as current authorization.

Nexus PR #105 upgrades the machine-readable cross-repo Agent contract to pin exact merged Node `5e8ee562915a570eb49ed46d59d723f233f3cc68` and checks the real Node sources/tests in CI. It also checks the reused strict transport keeps direct TCP `Address` separate from authenticated `ServerName`, binds TLS SNI/certificate verification and HTTP Host to `ServerName`, disables environment proxy use and rejects redirects. No alternate host, proxy, redirect or legacy route can silently change authority after the migrated XSP-v2 path is entered.

### P0-D acceptance boundary — SATISFIED

P0-D is complete: the production-capable Agent workflow exists behind explicit non-default gates; exact signed release identity propagates through poll/apply/ACK; real package bytes are content-addressed and verified by digest plus embedded revision; last-known-good rollback is atomic and does not rewind durable security state; disposable real Nexus↔Node E2E proves migration/update success, retry, lost response, restart and rollback; durable real-Agent security state and authenticated transport authority are proven; fixed-head merges and exact post-merge CI are green.

`strict-pq` remains **OFF** after P0-D. P0-D completion does not authorize production activation or replacement of the deployed legacy control Agent.

## CURRENT P0 — P0-E recovery/security release gates

### Completed P0-E sub-gates

#### P0-E1a — process-crash / fsync-order durability — COMPLETE

Node PR #38 and Nexus PR #107 prove deterministic restart/recovery across hard process termination at the local rotation durability boundaries. The proof exercises crashes after durable retention of the old active identity, after the monotonic epoch floor advances and after the active vault replacement, plus recovery-path crash checkpoints. Durable writes require file fsync, atomic rename and parent-directory fsync before the next security transition can be treated as committed.

The crash injector is test-only and excluded from the normal Agent build. This gate is intentionally bounded: it does not claim physical power removal, controller/cache flush behavior, storage firmware guarantees, snapshot anti-rollback, complete backup/restore or production rollout.

#### P0-E2a — one-sided Agent snapshot anti-rollback — COMPLETE

Node PR #39 and Nexus PR #108 restore a complete old Agent state root that is locally self-consistent, while the current Nexus state and unchanged current dual-signed permit remain outside the rollback domain. The real `agent/xspv2` runtime must attest the exact applied rotation before `Exchange` or `Recover`; the old snapshot cannot satisfy the current permit and fails closed before TCP/network I/O.

This proves one-sided Agent rollback only. A coordinated rollback of both the Agent state and Nexus/PostgreSQL to mutually consistent old snapshots requires a separate non-rolled-back authority.

#### P0-E2b — one-sided PostgreSQL snapshot rollback — COMPLETE

PR #109 reverses the failure domain. It takes a real custom-format `pg_dump` while the durable server tuple is exactly pre-ACK, commits through the normal strict-PQ ACK path, persists the first verified dual-signed receipt in the Agent journal, then drops/recreates/restores PostgreSQL while leaving the Agent journal current.

The restore must re-establish the reviewed least-privilege signer/C2-C database roles before the security sidecars restart. The proof requires that ACL re-hardening itself not mutate the XSP-v2 epoch/ledger/outbox/replay tuple. After restore, exact ACK replay can only converge if the server reproduces the same authoritative receipt; a different otherwise-valid re-signed receipt is rejected by the current Agent without replacing its first journaled evidence.

This proves one-sided PostgreSQL rollback with an independent current-Agent witness. It does **not** prove coordinated rollback detection, complete backup-set correctness or owner-authorized disaster recovery.

#### P0-E3a — owner/off-host monotonic recovery checkpoint — COMPLETE

PR #112 adds the first independent recovery witness outside the Agent and Nexus/PostgreSQL rollback domains without creating a second security state machine. The experimental-only offline `xsp-v2-recovery-checkpoint` tool accepts an independently provisioned `panel_response` public pin plus the existing authoritative dual-signed commit receipt. It verifies Ed25519 **AND** ML-DSA-65, derives the recovery floor directly from the receipt's committed `toEpoch`, stores the exact signed receipt bytes and SHA-256 digest, and binds the checkpoint to the exact Node and signer identity.

Recovery verification rejects a local epoch below the off-host floor as coordinated rollback. At the same epoch it additionally requires the exact authoritative receipt digest, so a mutually consistent but different re-signed history cannot replace the witnessed commit. Wrong Node identity, altered checkpoint metadata, noncanonical receipt encoding, mismatched pins, or either invalid signature also fail closed. The tool has no HTTP route, DB mutation, remote action or automatic reset/rekey path; `strict-pq` remains OFF.

This is a bounded third-trust-domain proof. It assumes the newest owner-held checkpoint and public pins themselves remain outside the rollback event. It does **not** yet prove that a complete operational backup set contains every PostgreSQL/Agent/signing/encryption identity required for deterministic disaster recovery.

#### P0-E3b — coordinated backup/restore recovery procedure — COMPLETE

PR #114 closes the disposable coordinated-recovery boundary on top of E3a. The proof creates/restores a real custom-format PostgreSQL dump together with the complete real-Agent XSP-v2 state root, protected panel-response Ed25519 + ML-DSA-65 signer identity and persistent mTLS identity. The newest E3a checkpoint and independently retained panel public pins stay outside the backup/rollback set as the third trust domain.

An exact current backup restores and cross-checks Node identity, epoch, Agent journals, authoritative receipt, PostgreSQL tuple, signer identity/pins and mTLS SPKI without epoch/replay reset, key regeneration, enrollment replacement or receipt rewriting. A mutually consistent older coordinated set is locally restorable but the newer E3a floor rejects it before it can be accepted as current; the proof verifies that rejection leaves restored Agent and DB security state unchanged. Missing, mixed-generation and tampered components fail closed. Database recreation re-applies the reviewed signer/C2-C least-privilege ACLs and requires that re-hardening not mutate the XSP-v2 tuple.

Exact post-merge evidence on `0afffa3933991861607c27d8410115bc2054cd7c`: [P0-E3b #24](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40953999674) and [Backend CI #3658](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40953999812) are **success**. This remains a disposable recovery proof, not production activation.

#### P0-E4a1 — storage durability preflight — COMPLETE (bounded preflight)

PR #116 establishes the qualification-input boundary before any physical power experiment. The read-only probe records the filesystem/mount/block-device chain and PostgreSQL durability settings, rejects symlink traversal and unsupported/unreviewed filesystem classes, requires the reviewed PostgreSQL fsync/full-page-write/synchronous-commit/WAL-sync policy, and flags write-back cache as requiring independent controller/device PLP evidence. Its report cannot mutate the storage stack or security state and deliberately remains `physicalPowerLossQualified=false`.

#### P0-E4a2 — external power-cut arming/source contract — COMPLETE (bounded lab readiness)

Node PR #44 at `50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e` exposes the existing five rotation durability checkpoints only in the dedicated lab build. The selected boundary emits `XSP2-POWERCUT-ARMED-V1` through an inherited FD and then blocks security-state progress so an independent controller can remove power. Process-crash and physical-power tags cannot coexist, and normal Agent artifacts contain neither hook controls. Nexus PR #117 pins and independently tests that exact Node source. GitHub CI proves the arming/source boundary only; it is not physical power-loss evidence.

#### P0-E4a3 — physical power-cut evidence contract — COMPLETE (bounded evidence tooling)

PR #121 defines the strict single-run evidence bundle accepted after an independently triggered physical abrupt-power event. The verifier binds the reviewed Node source `50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e`, exact lab-binary SHA-256, arm run/checkpoint, storage preflight/controller profile, changed boot ID, controller event, post-boot Agent/PostgreSQL state and independent E3a witness. Malformed, mixed or self-asserted qualification evidence fails closed. Synthetic fixtures exercise the verifier only and do not count as physical runs.

#### P0-E4a4 — five-point power-cut review matrix — COMPLETE (bounded review tooling)

PR #122 requires exactly one valid E4a3 bundle for each of `after-previous`, `after-floor`, `after-active`, `after-recovery-abort` and `after-recovery-active`, rejects duplicate checkpoints and mixed source/storage generations, and emits a deterministic matrix digest as an independent review handle. CI proves aggregation/rejection behavior only; it does not qualify hardware.

#### P0-E4a5 — real-operation lab reachability/source contract — COMPLETE (bounded lab readiness)

Node PR #45 at `7bf8cc92950f396e33891c8744c1f6855414154b` drives the real keyring activation/recovery operations to all five existing inherited-FD arm points under the lab-only build tag. Nexus PR #123 at `a34d0999ca519e2a81e68d92ec7136cd606518d4` pins both the original reviewed power-cut/core source `50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e` and the runner revision, proves the core keyring/hook files are byte-identical, re-runs all five paths, preserves the process-crash matrix and proves normal Agent artifacts contain no lab controls. CI kills blocked child processes only to complete source-contract tests; that is not physical power-loss evidence.

#### P0-E4a6 — physical-run operator handoff — COMPLETE (bounded lab preparation)

PR #125 at `2889864d6ec7f89202d8d82f2feda87501f0f349` closes the remaining repo-side operator ambiguity before real power removal. The offline `prepare` command freezes the exact run ID/checkpoint, Node rotation identities, reviewed Node/Nexus source revisions, exact lab-binary SHA-256, E4a1 Agent/PostgreSQL preflight digests, external controller identity, pre-cut boot ID and the SHA-256 of an already successful E3a verification result for the exact pre-cut epoch. The offline `verify` command requires that same E3a result, calls the existing E4a3 verifier rather than introducing another evidence state machine, then binds the final bundle to separately preserved arm observation, raw controller event, post-boot Agent record, PostgreSQL recovery record and review notes. Synthetic CI proves handoff/tamper-rejection behavior only and always reports `physicalPowerLossQualified=false`.

This is the final repository-side preparation layer. It does **not** execute or simulate a power cut. Closing P0-E4a still requires all five real external BMC/PDU abrupt-power runs on the reviewed representative storage/controller/PLP stack, successful E4a6 verification for each run, the real E4a4 five-point matrix, and independent review of the raw physical/storage/WAL evidence.

#### Owner-authorized old-key retirement — COMPLETE (bounded authorization/issuance/durable erasure)

Node PRs #46–#48 and Nexus PRs #127–#129 close the bounded retirement chain. A retirement decision is dual-signed by the owner and bound to the exact retained rotation plus current signed off-host checkpoint; owner private keys remain off-host; the low-level mutation is reachable through exactly one non-test Agent caller after verification; an authenticated retirement intent is durable before any deletion; only retained `.previous`/`.next` snapshots are erased; active vault/floor are preserved; crash/retry/reintroduction/rollback behavior fails closed. No production/API retirement route is enabled and this local durable evidence does not claim physical power-loss behavior.

#### Strict recovery/retirement parser fuzz smoke — COMPLETE (bounded robustness evidence)

Node PR #49 and Nexus PR #130 add three native Go fuzz targets for the strict security JSON decoders. Seed classes include valid, malformed, empty, null, array, trailing-JSON, unknown-field and non-UTF8 inputs. Every accepted input must pass the existing canonical/schema validator and survive strict decode→marshal→decode semantic equality. CI runs the unit suite and bounded 15-second single-worker smoke per target. This is not an exhaustive fuzzing claim.

#### ML-DSA-65 FIPS 204 external signature-verification vectors — COMPLETE (bounded API-compatible scope)

Node PR #50 and Nexus PR #131 pin exact official NIST ACVP source revision `a7f283cdc87d2d6dd93c1bac59e5622c5f9f8324` plus exact vector blobs and verify the public Go 1.27.3 API-compatible subset: ML-DSA-65, external interface, pure ML-DSA, `externalMu=false`. The pinned slice is exactly one test group with 15 cases — 3 expected-valid and 12 expected-invalid — and all results match NIST. The gate explicitly does **not** claim ACVP certification, exhaustive implementation assurance, or coverage of preHash/externalMu/internal-interface groups outside the public Go API used by XMesh.

### CURRENT external/hardware sub-gate — P0-E4a physical power-loss / storage durability

P0-E4a1 through P0-E4a6 establish the bounded storage preflight, external arming, strict evidence bundle, five-point review matrix, real-operation lab reachability/source contract and physical-run handoff, but **P0-E4a remains open**. The remaining evidence must be produced by five real abrupt host/device power removals on representative reviewed storage/controller stacks and independently reviewed. A process kill, VM stop/snapshot, successful `fsync(2)` return, synthetic fixture, preflight PASS or GitHub CI run does **not** prove physical power-loss/controller-cache behavior.

Acceptance requires:

- exercise abrupt host/power-loss events at the critical Agent keyring/journal and PostgreSQL durability boundaries on representative supported storage stacks whose flush/barrier/cache semantics are explicitly recorded;
- prove recovery is always a previously complete or next complete security state — never a lowered epoch floor, torn active identity, fabricated ACK/receipt success, replay rewind or silently reconstructed state;
- verify the storage stack actually honors the durable-flush assumptions required by the existing fsync/rename protocol, including virtual-disk/controller/cache configuration where applicable;
- fail qualification for configurations that cannot provide the required durability semantics rather than weakening XSP-v2 state checks;
- keep the independent E3a off-host witness as the external rollback floor and preserve all E3b backup/restore invariants;
- keep `strict-pq` OFF and production topology unchanged.

### CURRENT repo-side software sub-gate — operational observability without secret/key leakage

With bounded owner-authorized retirement, parser fuzz smoke and the external ML-DSA-65 verification-vector gate complete, the next implementable repository-side P0-E gate is **operational observability without secret/key leakage**.

Acceptance must provide enough bounded health/audit state to diagnose security-critical operation classes and component availability — enrollment/migration, rotation/cutover, receipt recovery, backup/recovery checks and retirement — while preventing logging/export of private keys, raw bearer or MFA material, master keys, full signed permits/ACKs/receipts, raw signature blobs, or other replayable sensitive payloads. Stable non-secret identifiers/digests, operation class, bounded result/reason categories, component health and correlation IDs may be exposed only where they are already authorized and useful. The observability path must remain read-only with respect to XSP-v2 security state, must not weaken fail-closed behavior, and must not activate the production XSP-v2 path.

After observability, P0-E still requires an **independent security review of the final migration/production architecture**. The real five-run E4a physical-power matrix and its independent evidence review remain a parallel external/hardware blocker. Completion of these individual gates does not authorize rollout.

## Production rollout — NOT AUTHORIZED

No production activation is authorized by C2-D, P0-D or the completed bounded P0-E proofs.

Before production rollout:

1. P0-D must remain complete with its fail-closed invariants intact;
2. P0-E must be complete, including the external physical-power evidence and independent security review;
3. a disposable canary must prove install/upgrade/rollback/recovery/observability;
4. production topology/DNS/firewall/Nginx/DB/key changes require a separately reviewed rollout plan;
5. `strict-pq` activation and legacy XMESH1 retirement require explicit approval and must never occur as an automatic fallback/migration side effect.

## Security guardrails

- `strict-pq` remains **OFF**.
- Production Agent remains on the deployed legacy control path until P0-E and later rollout gates explicitly authorize replacement.
- Completed P0-D gates through Node PR #37 and Nexus PR #105, plus bounded P0-E1a/P0-E2a/P0-E2b/P0-E3a/P0-E3b, P0-E4a1–P0-E4a6, owner-retirement, parser-fuzz and external-vector evidence remain default-disabled proofs; none authorize production migration or substitute for the real E4a physical-power matrix.
- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate validation.
- P0-E3a supplies the independent rollback floor and P0-E3b proves the disposable coordinated backup/restore procedure consumes it correctly. P0-E4a1–P0-E4a6 prepare and machine-check the storage/lab/evidence boundary; only five representative external abrupt-power runs plus independent review can close P0-E4a.
- Owner-retirement authorization/issuance/erasure remains bounded and offline/default-disabled; it does not create a production retirement API.
- Bounded fuzz and NIST-vector gates do not replace independent security review.
- A GitHub merge is not a production deployment.
- Xray remains the user VPN data-plane.
- Historical/archive documents do not override this roadmap.

## Engineering process

For every security-sensitive gate:

`current verified main → focused branch → one bounded gate → positive/negative/failure tests → PR → exact-head CI/review → fixed-head merge → exact post-merge CI → README/Roadmap checkpoint → branch cleanup → next gate`

Do not weaken strict Clippy, freshness/TTL, trust binding, topology isolation or test assertions merely to obtain green CI.