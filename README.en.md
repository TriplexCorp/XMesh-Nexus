# XMesh Nexus

**Self-hosted control plane for Xray-powered VPN infrastructure.**

XMesh Nexus manages Nodes, users, subscriptions, Xray configuration, telemetry and security state. User VPN traffic remains the **Xray-core data-plane**; XMesh is the control plane.

[Русский](README.md) · [Enterprise Roadmap](docs/ENTERPRISE_ROADMAP.md) · [XSP-v2 security policy](docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md) · [XMesh Node](https://github.com/TriplexCorp/XMesh-Node)

## Current XSP-v2 checkpoint — 30 October 2026

**Latest verified Nexus P0-E review-preparation checkpoint:** [`553bbfa70d993a5c53b054ea1105fc8feb0c1827`](https://github.com/TriplexCorp/XMesh-Nexus/commit/553bbfa70d993a5c53b054ea1105fc8feb0c1827), merge of [PR #142](https://github.com/TriplexCorp/XMesh-Nexus/pull/142). PR #142 refreshes the bounded independent-review package and freezes exact targets Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`, explicitly including the post-#135 Rust staging-ingress hardening from PRs #139/#140. Its exact-head and post-merge handoff workflow completed **success**. **Freeze preparation is COMPLETE; the independent security review/findings/sign-off itself is still OPEN, and P0-E4a remains CURRENT/OPEN until five representative physical abrupt-power runs are actually executed and independently reviewed.**

**Latest verified reviewer-packaging checkpoint:** [`f72250f93f89a5b2717a379370b8029150dadb97`](https://github.com/TriplexCorp/XMesh-Nexus/commit/f72250f93f89a5b2717a379370b8029150dadb97), merge of [PR #144](https://github.com/TriplexCorp/XMesh-Nexus/pull/144). PR #144 adds reproducible content-addressed reviewer convenience packaging for the already-frozen target without changing it. Post-merge bundle run `41013465969` completed **success**, built the package twice byte-for-byte, independently revalidated the manifest, and produced deterministic tar SHA-256 `f095f19217a072ef7919663744fcdfbc847783eb23be5a64b0f8df37b8952ced` with bundle payload digest `fb3a9bb9c3de2a462a8b338357b0a068dfdbe70a05f0dca81735006786b25b38`. **This is packaging only: it completes no independent-review domain and does not alter the frozen Nexus/Node revisions.**

**Latest verified independent-review result-acceptance checkpoint:** [`1e7c87daab4f9b1d1c3fd3ebd967b6ddd7cd7604`](https://github.com/TriplexCorp/XMesh-Nexus/commit/1e7c87daab4f9b1d1c3fd3ebd967b6ddd7cd7604), merge of [PR #146](https://github.com/TriplexCorp/XMesh-Nexus/pull/146). PR #146 defines a strict machine-readable external-review result schema and verifier bound to the exact PR #142 frozen target. Exact-head run `41014068893` and post-merge run `41014179369` completed **success**: wrong target, missing/duplicate domains, non-independent reviewer claims and unsafe release claims fail closed; a valid rejection remains evidence but cannot close the gate; unresolved release blockers or security-relevant remediation make closure ineligible, with changed security code requiring re-freeze/re-review. **This is acceptance tooling only, not an independent review.**

**Latest verified P0-E4a returned-review acceptance checkpoint:** [`b94bd4d8115c58fe79338a8bb0800200d3187704`](https://github.com/TriplexCorp/XMesh-Nexus/commit/b94bd4d8115c58fe79338a8bb0800200d3187704), merge of [PR #148](https://github.com/TriplexCorp/XMesh-Nexus/pull/148). PR #148 binds an independent post-lab conclusion to the exact real E4a4 five-run matrix plus exactly five preserved E4a6 verification results and fails closed on wrong scope, missing/extra/mismatched run bindings, false evidence attestations, unresolved release blockers, non-independent review, or qualification-scope changes. Exact-head run `41015177033` and post-merge run `41015250087` completed **success**. **Even a recommendation-eligible result still reports `physicalPowerLossQualified=false` and `requiresExplicitReviewedCheckpoint=true`; this tooling does not execute or simulate power removal and does not close P0-E4a.**

**Latest verified disposable release-canary rehearsal checkpoint:** [`497def9b950d57152f2e0ca2abb7eb0657a8d22f`](https://github.com/TriplexCorp/XMesh-Nexus/commit/497def9b950d57152f2e0ca2abb7eb0657a8d22f), merge of [PR #150](https://github.com/TriplexCorp/XMesh-Nexus/pull/150). PR #150 composes the existing real Agent install/upgrade/lost-response/restart/LKG rollback proof, the real E3b coordinated backup/restore proof against current reviewed Node `083dc181c5e175f89007f4b93111cd5c45a69d97`, and both default-off redacted observability surfaces into one disposable pre-release rehearsal. Exact-head run `41017508108` and post-merge run `41018421184` completed **success**; post-merge artifact `12961000620` has transport digest `sha256:cea8da4de7eb579d6bd190b7a646c0ed22e7bed3d17a99608553e7ca94a7d1c5`. **This proves canary-harness readiness only: `finalReleaseCanarySatisfied=false`, P0-E issues #137/#138 remain OPEN, and the exact post-P0-E release candidate must rerun the complete canary.**

**Latest verified production rollout-plan acceptance checkpoint:** [`b71c0d0c641b5e0f6a60785586486b18dbb45db3`](https://github.com/TriplexCorp/XMesh-Nexus/commit/b71c0d0c641b5e0f6a60785586486b18dbb45db3), merge of [PR #152](https://github.com/TriplexCorp/XMesh-Nexus/pull/152). Exact-head rollout-plan contract run `41026817409` and post-merge run `41028000453` completed **success**; post-merge Backend CI `41028000376` also completed **success**. The verifier requires an exact release candidate plus accepted P0-E security-review/physical-qualification evidence, a post-P0-E final canary, explicit topology/DNS/firewall/Nginx/PostgreSQL/key/observability/rollback dispositions and independent plan review. It never executes deployment changes. **This is rollout-plan acceptance tooling only: `productionActivation=false`, `strictPQEnabled=false`, legacy XMESH1 remains retained, and a real exact-candidate reviewed rollout plan cannot become eligible until P0-E and the final canary are complete.**

**Latest verified strict-PQ activation-approval checkpoint:** [`0bab1a48cff570b3abe405bcda4dc242b23b8a4b`](https://github.com/TriplexCorp/XMesh-Nexus/commit/0bab1a48cff570b3abe405bcda4dc242b23b8a4b), merge of [PR #155](https://github.com/TriplexCorp/XMesh-Nexus/pull/155). Post-merge activation-contract run `41035081951` and Backend CI `41035081996` completed **success**. The gate binds one exact release candidate to externally expected independent-security-review, physical-qualification and rollout-plan verifier digests, the final post-P0-E canary, an explicit named-Node scope of at most 50 Nodes and a maximum 24-hour approval window. Contract policy itself cannot be weakened through an alternate contract. It keeps `automaticFallback=false`, forbids classical-only downgrade, separates `strictPqAction=enable` from `legacyXMESH1Action=retain`, and even an eligible approval reports `strictPQEnabled=false`, `productionActivation=false`, `legacyXMESH1Retired=false` and `requiresSeparateExecution=true`. **This is non-executing authorization tooling only; it does not activate production.**

**Latest verified staging ingress hardening checkpoint:** [`03679120726ff06005eff903909b262fb1271960`](https://github.com/TriplexCorp/XMesh-Nexus/commit/03679120726ff06005eff903909b262fb1271960), merge of [PR #140](https://github.com/TriplexCorp/XMesh-Nexus/pull/140), on top of [PR #139](https://github.com/TriplexCorp/XMesh-Nexus/pull/139) merge [`36ee6f7a5b1686f9c0d51beda5d24e84830982c7`](https://github.com/TriplexCorp/XMesh-Nexus/commit/36ee6f7a5b1686f9c0d51beda5d24e84830982c7). PR #139 replaces the C2-A Python origin probe with a dependency-free Rust implementation; PR #140 replaces the C2-B/C/D Python ACK/recovery origin state machine with an isolated Rust 2024 crate while preserving the reviewed UDS peer-credential/SPKI identity boundary, strict ACK/freshness/recovery semantics, exact C2-C framing, response-loss fault domains, thread-per-connection behavior and Unix listen backlog of 32. Exact-head PR #140 Backend CI, Hybrid TLS, C2-C authorization, expired recovery, lost-response/race, transport-negative/no-legacy and PostgreSQL rollback workflows all completed **success**. **This is implementation hardening only, not production activation or independent review sign-off.**

**P0-C2-D and P0-D are COMPLETE. P0-E remains the CURRENT P0. P0-E1a, P0-E2a, P0-E2b, P0-E3a and P0-E3b are COMPLETE within their explicitly bounded scopes. P0-E4a1–P0-E4a6 software/lab-preparation gates and the post-run returned-review acceptance tooling are COMPLETE, but representative physical power-loss qualification remains outstanding. Bounded owner-authorized retirement, parser-fuzz, external ML-DSA-65 verification vectors and default-off redacted observability are COMPLETE. The refreshed independent security-review handoff/evidence freeze, reproducible reviewer packaging, and fail-closed review-result acceptance tooling are COMPLETE as preparation only; independent review findings/sign-off and representative P0-E4a physical power-loss qualification remain OPEN. The disposable release-canary rehearsal harness and production rollout-plan acceptance tooling are COMPLETE as preparation only; the exact post-P0-E release candidate must rerun the canary and then supply a separately reviewed real rollout/rollback plan before activation can be considered. The explicit strict-PQ activation-approval gate is also COMPLETE as non-executing release tooling; even an eligible approval still requires a separate execution step, does not enable production itself and does not retire XMESH1. Neither a handoff, an individual gate nor green CI authorizes production rollout.** The production-capable Agent path remains default-disabled and `strict-pq` remains OFF.

PR #142 supersedes the stale PR #135 Nexus review target for current-review applicability. The active frozen review target is Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`; it includes the PR #139/#140 Rust origin/ACK/recovery hardening. The remaining repo-side P0-E review blocker is now externally attributable independent findings, remediation disposition and sign-off for that frozen target. Any later security-relevant code change invalidates the freeze and requires re-freeze/re-review.

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
- **PR #112 / P0-E3a owner/off-host monotonic recovery checkpoint:** an experimental-only offline verifier introduces the independent third trust domain needed for coordinated-rollback detection without adding a second mutable security state machine. The monotonic recovery floor is derived from the existing immutable dual-signed commit receipt `toEpoch`; the exact receipt bytes are verified against independently provisioned `panel_response` Ed25519 and ML-DSA-65 public pins. Local state below the off-host floor and same-epoch receipt divergence fail closed. There is no HTTP route, database mutation, automatic reset/rekey, weaker fallback or production activation. The bounded proof assumes the owner presents the newest trusted checkpoint and that the off-host checkpoint/pins are outside the Agent and Nexus/PostgreSQL rollback domains.
- **PR #114 / P0-E3b coordinated backup/restore recovery:** a disposable recovery proof snapshots/restores a real PostgreSQL custom-format dump together with the complete real-Agent XSP-v2 private state root, protected `panel_response` Ed25519 + ML-DSA-65 signer identity and persistent mTLS identity. The newest P0-E3a checkpoint/pins remain outside that rollback domain. An exact current set restores and validates without epoch/replay reset, key regeneration, enrollment replacement or receipt rewriting; a mutually consistent old coordinated set is rejected by the newer off-host floor without mutating restored Agent/DB security state. Missing, mixed-generation and tampered components fail closed, and restore-time signer/C2-C least-privilege ACL re-hardening must leave the XSP-v2 tuple unchanged.
- **PR #116 / P0-E4a1 storage durability preflight:** a read-only qualification probe records filesystem/mount and block-device durability facts, rejects symlink traversal and unreviewed filesystem classes, verifies PostgreSQL `fsync`, `full_page_writes`, `synchronous_commit` and `wal_sync_method`, and requires independent PLP/controller evidence when write-back cache is present. Its report is deliberately fixed at `physicalPowerLossQualified=false`; it cannot mutate mounts/cache policy/PostgreSQL/security state or claim that a real power cut occurred.
- **Node PR #44 + Nexus PR #117 / P0-E4a2 external power-cut arming readiness:** the real Node source exposes the existing rotation durability checkpoints to a dedicated lab-only `xspv2_powercut_qualification` build. At an approved checkpoint it emits the exact `XSP2-POWERCUT-ARMED-V1` marker only through an inherited FD and then stops security-state progress so an independent BMC/PDU/controller can cut power. Normal Agent artifacts contain neither the lab hook nor its controls; the older process-crash injector remains a separate mutually exclusive build tag. Nexus pins exact Node merge SHA `50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e` and independently re-runs the lab/normal-artifact boundary. This is lab readiness, **not** physical power-loss evidence.
- **PR #121 / P0-E4a3 physical power-cut evidence contract:** defines a strict single-run evidence bundle for an independently triggered abrupt-power experiment. It binds the reviewed Node source, exact lab-binary SHA-256, arm checkpoint/run ID, preflight/storage profile, changed boot ID, controller event, post-boot Agent/PostgreSQL state and independent E3a witness. Synthetic CI validates the schema/fail-closed verifier only; it is **not** physical power-loss evidence.
- **PR #122 / P0-E4a4 five-point power-cut review matrix:** aggregates exactly one valid E4a3 bundle for each of `after-previous`, `after-floor`, `after-active`, `after-recovery-abort` and `after-recovery-active`, rejects duplicates/mixed source/storage generations and produces a deterministic matrix digest/review handle. Synthetic fixtures prove the review tooling only; hardware remains unqualified.
- **Node PR #45 + Nexus PR #123 / P0-E4a5 real-operation lab reachability:** Node merge `7bf8cc92950f396e33891c8744c1f6855414154b` drives the real `ActivatePreparedRotation` / `RecoverRotation` operations to all five inherited-FD arm points while remaining test-only. Nexus merge `a34d0999ca519e2a81e68d92ec7136cd606518d4` pins both the original reviewed power-cut/core source `50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e` and the runner source `7bf8cc92950f396e33891c8744c1f6855414154b`, proves the core keyring/hook files are byte-identical across them, re-runs all five real-operation arm paths, preserves the crash matrix and proves normal Agent artifacts contain no lab controls. This is the final bounded real-operation reachability/source-contract layer before the E4a6 physical-run handoff, **not** physical power-loss qualification.
- **PR #125 / P0-E4a6 physical-run handoff:** adds the final repo-side operator handoff before real power-cut execution. `prepare` freezes exact run/checkpoint/Node rotation, reviewed source revisions, exact lab-binary SHA-256, Agent/PostgreSQL preflight digests, controller identity, pre-cut boot ID and the SHA-256 of an existing E3a verifier result bound to the exact pre-cut epoch. `verify` first requires that same preserved E3a verification result, then reuses the existing E4a3 verifier and additionally binds the final bundle to separately preserved arm observation, raw external controller event, post-boot Agent record, PostgreSQL recovery record and review notes. The tool contains no network/power-control path and always leaves `physicalPowerLossQualified=false`; real BMC/PDU cuts and independent review remain required.
- **PR #148 / P0-E4a returned independent qualification-review acceptance:** Nexus merge `b94bd4d8115c58fe79338a8bb0800200d3187704` defines the post-run reviewer-result contract over the existing E4a4 matrix and exactly five E4a6 verification outputs. The verifier requires attributable independence, exact matrix/run/storage/binary binding, mandatory physical/storage/WAL/E3a attestations, findings/dispositions and explicit qualify/qualify-with-findings/reject sign-off. Wrong scope, missing/extra/mismatched run bindings, unresolved release blockers and qualification-scope changes fail closed. It always emits `physicalPowerLossQualified=false` and requires a later explicit reviewed checkpoint; synthetic CI is parser/policy evidence only, not physical evidence.
- **Node PR #46 + Nexus PR #127 / owner-authorized old-key retirement authorization:** the retained previous→active rotation can be authorized only by a canonical `XSP2-OWNER-RETIRE-PREVIOUS-V1` artifact carrying both Ed25519 and ML-DSA-65 owner signatures and bound to the exact Node, authenticated server authority, epochs/key IDs and signed off-host recovery checkpoint. This first layer is read-only and cannot erase keys.
- **Node PR #47 + Nexus PR #128 / offline retirement issuance:** the Agent exports a public-only request from the exact retained rotation; an offline owner signer re-verifies the signed off-host checkpoint and signs the request with both owner keys. Owner private keys remain off-host and are accepted only from canonical non-symlink owner-owned mode-0600 unencrypted PKCS#8 files. No network/API issuance route is added.
- **Node PR #48 + Nexus PR #129 / crash-safe durable old-key erasure:** after exact owner authorization, the keyring persists an authenticated HMAC-SHA256 retirement intent before deleting retained snapshots. Only `.previous` and `.next` may be erased; the active vault and monotonic epoch floor are never erased. Parent-directory fsync, crash checkpoints, exact idempotent resume, retirement rollback/reintroduction floors and a single non-test high-level caller are independently checked. This is local durable retirement evidence, not physical power-loss qualification.
- **Node PR #49 + Nexus PR #130 / bounded strict security parser fuzzing:** native Go fuzz targets exercise the off-host checkpoint, retirement request and retirement authorization decoders with malformed/trailing/unknown/non-UTF8 input classes. Every accepted input must survive canonical/schema validation and strict decode→marshal→decode semantic equality. The dedicated CI is intentionally bounded smoke coverage, not an exhaustive fuzzing claim.
- **Node PR #50 + Nexus PR #131 / external ML-DSA-65 FIPS 204 sigVer vectors:** the exact Node test-only delta is verified against `usnistgov/ACVP-Server` revision `a7f283cdc87d2d6dd93c1bac59e5622c5f9f8324` and pinned vector blobs. The Go 1.27.3-compatible scope is ML-DSA-65 / external interface / pure / `externalMu=false`; the pinned slice is exactly **1 group / 15 cases / 3 expected-valid / 12 expected-invalid**, all matching NIST expected results. This is external verification-vector evidence, **not** ACVP certification or exhaustive implementation assurance.
- **Node PR #51 + Nexus PRs #133–#134 / bounded default-off redacted observability:** Node merge `083dc181c5e175f89007f4b93111cd5c45a69d97` adds a local read-only snapshot; Nexus PR #133 adds a feature-gated per-node read-only DB view; PR #134 pins and re-verifies both exact merges. Both sides require exact `XSP_V2_OBSERVABILITY=staging-only`, exclude sensitive/replayable payloads and leave production activation/`strict-pq` false; no observability network route or security-state mutation is introduced.
- **Nexus PR #135 / independent security-review handoff freeze:** Nexus merge `7b84a9e45f9e9cf815b95a06d1560f84d8d3f0a2` freezes exact review targets Nexus `5cdb7825fcc51f8a7d296b992a7da4492ed2ce8e` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`, 11 mandatory review domains and the evidence index while explicitly keeping independent review, physical qualification, production activation and `strict-pq` OPEN/OFF. This is preparation, not external sign-off.
- **Nexus PR #142 / refreshed independent security-review freeze:** Nexus merge `553bbfa70d993a5c53b054ea1105fc8feb0c1827` supersedes the PR #135 Nexus target for current-review applicability and freezes Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + unchanged Node `083dc181c5e175f89007f4b93111cd5c45a69d97`. Contract v2 explicitly indexes PRs #139/#140 Rust implementation evidence, re-runs the frozen C2-A/C2-B/C2-C source contracts, proves the handoff delta contains no runtime source, and keeps `independentSecurityReviewComplete=false`, `physicalPowerLossQualified=false`, `productionActivation=false` and `strictPQEnabled=false`.
- **Nexus PR #144 / reproducible reviewer convenience bundle:** Nexus merge `f72250f93f89a5b2717a379370b8029150dadb97` adds a standard-library Python builder and dedicated CI that package the exact PR #142 frozen Nexus/Node sources plus indexed evidence without modifying those sources. The workflow builds twice and requires byte-for-byte equality, independently verifies per-file SHA-256/size records, emits `MANIFEST.json` + `SHA256SUMS`, and creates a deterministic transport tar. Post-merge run `41013465969` is success; deterministic tar SHA-256 is `f095f19217a072ef7919663744fcdfbc847783eb23be5a64b0f8df37b8952ced`. This packaging is not security-review sign-off.
- **Nexus PR #146 / independent-review result acceptance contract:** Nexus merge `1e7c87daab4f9b1d1c3fd3ebd967b6ddd7cd7604` adds a strict external-result contract/verifier bound to frozen Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`. A result must carry attributable independent reviewer identity, all 11 domains exactly once, findings/evidence/dispositions and explicit approve/approve-with-findings/reject sign-off. Closure additionally rejects failed domains, unresolved release blockers and security-relevant remediation against the old freeze. Synthetic CI proves contract semantics only; it is not an external review and never auto-closes #137.
- **Nexus PR #139 / C2-A Rust origin hardening:** Nexus merge `36ee6f7a5b1686f9c0d51beda5d24e84830982c7` removes the Python C2-A origin runtime and replaces it with a dependency-free Rust verifier preserving Linux `SO_PEERCRED`, pinned ingress UID/GID, exact client SPKI SHA-256, fixed trusted Node identity and UDS-only handling. The runtime image contains neither Python nor a Rust toolchain; default Compose/install remain unchanged.
- **Nexus PR #140 / C2-B/C/D Rust ACK/recovery hardening:** Nexus merge `03679120726ff06005eff903909b262fb1271960` removes the Python ACK/recovery runtime and replaces it with an isolated Rust 2024/`serde` implementation. Strict schema/duplicate-field rejection, ACK metadata/freshness binding, historical recovery-after-expiry, protected C2-C UDS framing/peercred, exact raw ACK forwarding, response-size/trailing-byte checks, the three disposable response-loss fault domains, thread-per-connection behavior and the reviewed listen backlog of 32 are preserved. The full exact-head C2-B/C/D regression matrix is green and the runtime contains no Python interpreter. These post-#135 security-relevant changes are included in the refreshed PR #142 review freeze; external independent findings/remediation/sign-off remain required.

Exact bounded P0-E4a foundation evidence:

- Nexus PR #116 merge [`f7b746eb92c5e1bda7be67814233f09c60ee90b9`](https://github.com/TriplexCorp/XMesh-Nexus/commit/f7b746eb92c5e1bda7be67814233f09c60ee90b9): [P0-E4a Storage Preflight #5](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40961979406) and [Backend CI #3665](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40961979407) — **success**.
- Node PR #44 merge [`50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e`](https://github.com/TriplexCorp/XMesh-Node/commit/50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e): [P0-E4a Power-cut Arm #2](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40962739169) and [P0-E Crash Durability #18](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40962739053) — **success**; the full six-workflow post-merge Node matrix completed without failures.
- Nexus PR #117 merge [`0eecd0a1b4f8439b934bf5182f59531b21b7aebe`](https://github.com/TriplexCorp/XMesh-Nexus/commit/0eecd0a1b4f8439b934bf5182f59531b21b7aebe): [P0-E4a Node Power-cut Contract #2](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40963109541) and [Backend CI #3667](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40963109551) — **success**.
- Nexus PR #121 merge [`d57e74ef73f704b2229347c4f8712c5c1e527b0b`](https://github.com/TriplexCorp/XMesh-Nexus/commit/d57e74ef73f704b2229347c4f8712c5c1e527b0b): [P0-E4a3 Power-cut Evidence Contract #4](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40972825779) and [Backend CI #3680](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40972822127) — **success**.
- Nexus PR #122 merge [`8ca408fd50169ef4311a30b6248c2a4743e6a3a5`](https://github.com/TriplexCorp/XMesh-Nexus/commit/8ca408fd50169ef4311a30b6248c2a4743e6a3a5): [P0-E4a4 Power-cut Matrix Contract #4](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40973807849) and [Backend CI #3682](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40973807725) — **success**.
- Node PR #45 merge [`7bf8cc92950f396e33891c8744c1f6855414154b`](https://github.com/TriplexCorp/XMesh-Node/commit/7bf8cc92950f396e33891c8744c1f6855414154b): [P0-E4a5 Lab Operation #2](https://github.com/TriplexCorp/XMesh-Node/actions/runs/40975150937) — **success** on the exact merge SHA. Nexus PR #123 merge [`a34d0999ca519e2a81e68d92ec7136cd606518d4`](https://github.com/TriplexCorp/XMesh-Nexus/commit/a34d0999ca519e2a81e68d92ec7136cd606518d4): [P0-E4a5 Node Lab Operation Contract #2](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40976111704) and [Backend CI #3684](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40976111693) — **success** on the exact merge SHA.
- Nexus PR #125 merge [`2889864d6ec7f89202d8d82f2feda87501f0f349`](https://github.com/TriplexCorp/XMesh-Nexus/commit/2889864d6ec7f89202d8d82f2feda87501f0f349): [P0-E4a6 Physical-run Handoff #2](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40981894822) and [Backend CI #3688](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40981894714) — **success** on the exact merge SHA. This proves the offline pre-cut/post-boot handoff contract and fail-closed raw-record/E3a-result binding only; it is **not** a physical power-loss experiment.

None of these CI runs is counted as an actual physical power-loss experiment. P0-E4a remains open until the reviewed representative external abrupt-power matrix is complete.

Exact post-merge P0-E3b evidence on `0afffa3933991861607c27d8410115bc2054cd7c`:

- [XSP-v2 P0-E3b Coordinated Backup Restore #24](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40953999674) — **success** on the exact merge SHA, including real coordinated PostgreSQL + Agent + signer + mTLS restore, old-set rejection against the independent E3a witness and mixed/missing/tampered component negatives.
- [Backend CI #3658](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40953999812) — **success** on the exact merge SHA, including strict Clippy, Docker build and disposable PostgreSQL/Redis/API authentication regression coverage.

Previous P0-E3a evidence remains on `f19d01e021efaa727bbba82672143005a96338b7`:

- [XSP-v2 P0-E3a Off-host Recovery Checkpoint #9](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40862058873) — **success** on the exact merge SHA, including real Ed25519 + ML-DSA-65 receipt verification, coordinated-old-state rejection, tamper/wrong-node negatives, formatting and strict test-target Clippy.
- [XSP-v2 Crypto PoC #213](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40862058598), [C2-C #61](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40862058488) and [Backend CI #3632](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40862058513) — **success** on the exact merge SHA, preserving the existing crypto/signer/DB boundary and full backend/disposable API regression matrix.

Previous P0-E2b evidence remains [XSP-v2 P0-E2b PostgreSQL Snapshot Rollback #6](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40846810762) — **success** on `f9a9c636f83a3a2ef7122fef7c3f3bc2bc76b7d4`, including the real PostgreSQL restore boundary, restore-time ACL re-hardening and current-Agent receipt witness.

The previous P0-D implementation checkpoint remains [`698d5e43d59c0c95532d513b39d95e42a2af4f20`](https://github.com/TriplexCorp/XMesh-Nexus/commit/698d5e43d59c0c95532d513b39d95e42a2af4f20), merge of [PR #105](https://github.com/TriplexCorp/XMesh-Nexus/pull/105). Its [Backend CI #3605](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40835127285) completed **success**. The disposable real-Agent migration/update proof remains [XSP-v2 P0-D real Agent E2E #10](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/40827536439) on PR #103 merge SHA `7df13962aae871f04677b47e0f05a7f6ab906e72` — **success**.

The current verified XMesh-Node security-test checkpoint is [`ffebcc30424463dd0afcdb8226bcd4b48c019bff`](https://github.com/TriplexCorp/XMesh-Node/commit/ffebcc30424463dd0afcdb8226bcd4b48c019bff), merge of Node PR #50; it layers the test-only NIST ACVP ML-DSA-65 gate on top of the parser-fuzz checkpoint `fc1548171aad331b8a7851a895a7f18a5440e858` and durable retirement checkpoint `3d2fc155ead11e86a2872ad12fbe28f157bb24db`. The P0-E4a5 lab-runner checkpoint remains `7bf8cc92950f396e33891c8744c1f6855414154b`, and the reviewed core power-cut/keyring source remains `50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e` from Node PR #44.

The previous complete C2-D implementation checkpoint remains [`7e0b42ea4847b273ba8cd55a0ff3e043a420c377`](https://github.com/TriplexCorp/XMesh-Nexus/commit/7e0b42ea4847b273ba8cd55a0ff3e043a420c377), merge of [PR #88](https://github.com/TriplexCorp/XMesh-Nexus/pull/88). Its exact post-merge C2-D transport-negative, lost-response/race, expired-recovery, Hybrid TLS and Backend CI matrix remains valid within that stated isolated staging/process boundary.

Production behavior remains unchanged. The root XMesh-Node edge router remains on its Go 1.23 production path; the signed shell/systemd control Agent remains the deployed command authority; the Go 1.27 migration/package path remains behind explicit non-default staging gates. `strict-pq` remains **OFF**. Completed P0-D and bounded P0-E evidence do **not** authorize production VPS/DNS/firewall/public-Nginx/key-material changes, Agent cutover or rollout.

## Completed XSP-v2 gates

### P0 — isolated signer — COMPLETE

PR #61 proved a separate signer process/socket boundary, protected private-key mounts, peer UID/GID checks, owner-approved Ed25519/ML-DSA-65 pins, least-privilege signer DB access, committed ACK readback and immutable receipt recovery.

### P0-C1 — dedicated PQ-only ingress — COMPLETE

PR #64 proved TLS **1.3 only**, actually negotiated `X25519MLKEM768`, trusted certificate/hostname verification, fresh handshakes and fail-closed downgrade negatives. The ingress remains isolated from the normal Nexus API and inactive in the default installer/Compose deployment.

### P0-C2-A — trusted Node identity / protected origin — COMPLETE

PR #66 proved:

`Node test client → TLS1.3/X25519MLKEM768 + ML-DSA-65 client identity → dedicated ingress → protected Unix-domain socket → origin verifier`

Trusted Node identity comes from the verified ML-DSA-65 client-certificate SPKI plus protected Unix peer credentials, never caller `nodeId`, arbitrary headers, source IP or legacy `XMESH1` identity.

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

D1 intentionally preserved ACK freshness and exposed the need for a separate historical-recovery domain rather than permitting stale commands.

### P0-C2-D2 — failure / retry / recovery / downgrade matrix — COMPLETE

C2-D2 was closed incrementally and then re-verified together on PR #88:

- **PR #77:** expired exact network recovery over the distinct `/ack/recover` / internal `XSP2C2H1` domain; fresh expired ACK remains rejected; no re-signing or second epoch transition.
- **PR #82:** lost-response windows, signer-off exact retry, eight-way exact duplicate race convergence and fresh mismatch rejection.
- **PR #84:** current XMesh-Node native recovery transport alignment and exact external `/api/v2/node/keys/rotation/ack/recover` contract.
- **PR #86:** real origin/C2-C/PostgreSQL/signer outages and restarts around uncommitted, committed-without-receipt and durable-receipt states; replay cardinality, old-key retention and topology invariants remain intact.
- **Node PR #33:** authenticated application authority binding — HTTP `Host` equals verified TLS `serverName`, while the direct TCP connect address may remain an internal alias/IP.
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

- **P0-D1a COMPLETE — immutable release identity:** PR #90 created the append-only exact release manifest ledger.
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
- **P0-E3a COMPLETE — owner/off-host monotonic recovery checkpoint:** PR #112 proves an offline third-domain checkpoint can derive its floor from the existing dual-signed commit receipt, independently verify both signer keys/signatures, reject coordinated old local state and same-epoch receipt divergence, and do so without a new mutable counter, remote API, DB mutation or recovery bypass. The bounded trust assumption is that the newest checkpoint and its independently provisioned pins do not roll back with Agent/Nexus state.
- **P0-E3b COMPLETE — coordinated backup/restore recovery:** PR #114 proves a disposable exact-current restore and coordinated-old restore boundary across PostgreSQL, complete Agent state, signer identity and mTLS identity. The current set validates against the owner-held E3a witness without resets/regeneration; the old set and mixed/missing/tampered components fail closed, while database ACL re-hardening preserves the security tuple.
- **Owner-authorized old-key retirement COMPLETE — bounded authorization/issuance/erasure:** Node PRs #46–#48 + Nexus PRs #127–#129 prove exact dual-owner authorization, offline owner-key custody/issuance, durable authenticated retirement intent, crash-safe erasure of only retained `.previous`/`.next` snapshots and persistent rollback/reintroduction floors. No production/API retirement path is enabled.
- **Strict recovery/retirement parser fuzz smoke COMPLETE — bounded robustness evidence:** Node PR #49 + Nexus PR #130 add native Go fuzz targets for the security JSON decoders with canonical/strict round-trip invariants. This is bounded CI smoke, not exhaustive fuzzing.
- **ML-DSA-65 FIPS 204 external verification vectors COMPLETE — bounded API-compatible scope:** Node PR #50 + Nexus PR #131 pin official NIST ACVP source revision/blobs and verify exactly 1 compatible group / 15 cases / 3 valid / 12 invalid against Go 1.27.3 `crypto/mldsa`. This is not ACVP certification and does not claim unsupported preHash/externalMu/internal-interface coverage.

#### P0-E4a1 — storage durability preflight — COMPLETE (bounded preflight)

PR #116 adds a read-only host/storage preflight that records the filesystem/mount/block-device chain and PostgreSQL durability settings before any physical qualification run. It rejects symlink traversal and unsupported/unreviewed filesystem classes, requires `fsync=on`, `full_page_writes=on`, an accepted `synchronous_commit` mode and a visible `wal_sync_method`, and flags write-back cache as requiring independent controller/device PLP evidence. The report is intentionally non-authoritative for physical durability and always carries `physicalPowerLossQualified=false`.

This gate proves qualification-input policy and fail-closed reporting only. It cannot prove controller/drive cache persistence, PLP correctness or an abrupt host/device power event.

#### P0-E4a2 — external power-cut arming/source contract — COMPLETE (bounded lab readiness)

Node PR #44 at `50c770c8bbb917b04ca893ac5b8d29e6c7f9af7e` adds a lab-only build tag on the already-proven Agent rotation durability checkpoints. The lab build may emit the exact `XSP2-POWERCUT-ARMED-V1` marker through an inherited FD and then block until a physically independent controller removes power. Normal Agent artifacts keep the checkpoint hook as a no-op; the process-crash and physical-power tags are mutually exclusive. Nexus PR #117 pins that exact Node source, independently runs the lab tests and proves the normal Agent artifact contains no qualification controls.

This gate proves only that a representative lab can synchronize an external abrupt-power event to the intended durability boundary without introducing a production remote-control path. It does **not** prove that the cut happened or that any storage stack survived it correctly.

### CURRENT external/hardware sub-gate — P0-E4a physical power-loss / storage durability

P0-E4a1 through P0-E4a6 provide the reviewed storage preflight, external arming, strict evidence schema, five-point review matrix, real-operation lab runner/source contract and physical-run handoff. PR #148 additionally defines how the independent reviewer returns a machine-checkable conclusion bound to the exact real E4a4 matrix and five E4a6 verification results. **P0-E4a remains open**: the remaining acceptance evidence still must come from five real representative abrupt host/device power-loss runs plus independent review and a later explicit reviewed qualification checkpoint. A normal process kill, VM stop/snapshot, successful `fsync(2)` return, synthetic evidence fixture, preflight PASS or GitHub CI run is not sufficient.

Acceptance requires a reviewed supported-storage test matrix that exercises abrupt host/power loss at the critical Agent keyring/journal and PostgreSQL durability boundaries, records the filesystem/virtual-disk/controller/cache flush semantics being relied on, and proves recovery is either the previous complete state or the next complete state — never a lowered epoch floor, torn active identity, fabricated ACK/receipt success or silently reconstructed security state. The exact five E4a6 verification outputs and E4a4 matrix must then be reviewed independently; the returned review must pass the PR #148 verifier as a qualification recommendation and still requires a later explicit reviewed checkpoint before qualification can be recorded. Configurations whose storage stack cannot provide the required durable-flush semantics must fail qualification rather than weaken the protocol. The independent E3a witness remains the external rollback floor. `strict-pq` stays OFF and production topology remains unchanged.

### CURRENT repo-side release sub-gate — independent security review

Bounded operational observability is COMPLETE. Node PR #51 plus Nexus PRs #133/#134 provide default-off local/DB read-only redacted views and an exact cross-repo checkpoint under `XSP_V2_OBSERVABILITY=staging-only`, without a network observability route, durable security-state mutation or production activation.

Nexus PR #135 remains the historical first handoff baseline, but its Nexus target predates the security-relevant Rust runtime hardening in PRs #139/#140. Nexus PR #142 merge `553bbfa70d993a5c53b054ea1105fc8feb0c1827` refreshes the bounded package and now freezes exact targets Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` + Node `083dc181c5e175f89007f4b93111cd5c45a69d97`. Contract v2 includes the Rust origin/ACK/recovery implementation evidence and still deliberately keeps `independentSecurityReviewComplete=false`, `physicalPowerLossQualified=false`, `productionActivation=false` and `strictPQEnabled=false`.

The repo-side freeze/preparation work is therefore COMPLETE. PR #144 provides reproducible content-addressed reviewer packaging, and PR #146 provides a fail-closed machine-readable result contract/verifier for the returned external report. The verifier distinguishes a structurally valid result from one eligible to close #137: rejection, failed domains, unresolved release blockers, wrong-target results and security-relevant remediation against the old freeze cannot close the gate; changed security code requires re-freeze/re-review. Closing P0-E still requires independently attributable findings, remediation disposition and final sign-off for the exact frozen target. The five real E4a physical-power experiments and their independent evidence review remain the parallel external/hardware blocker. Neither the handoff, reviewer bundle, result verifier, Rust migration nor green CI counts as independent review or authorizes production rollout.

`strict-pq` remains **OFF** throughout P0-E unless a later explicit production/release gate separately authorizes activation. Production rollout remains separately gated and unauthorized.

## Security guardrails

- `strict-pq` remains **OFF**.
- Production control-plane behavior remains legacy `XMESH1` / Ed25519 until separately approved P0-E and rollout gates authorize migration.
- No target-product fallback to XMESH1, Ed25519-only, X25519-only, TLS 1.2 or insecure certificate validation.
- Completed C2-D evidence is isolated staging/process evidence, not production activation.
- Completed P0-D capabilities/evidence and bounded P0-E recovery, retirement, parser-fuzz and external-vector proofs remain default-disabled staging/production-capable foundations; none authorize production rollout.
- P0-E3a provides the independent coordinated-rollback witness and P0-E3b proves the disposable coordinated restore procedure consumes it correctly; P0-E4a still owns the remaining host/storage physical power-loss durability boundary.
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
- [XSP-v2 P0-E owner/off-host recovery checkpoint](docs/XSP_V2_P0E_OFFHOST_RECOVERY_CHECKPOINT.md)
- [XSP-v2 P0-E coordinated backup/restore recovery](docs/XSP_V2_P0E_COORDINATED_BACKUP_RESTORE.md)
- [XSP-v2 P0-E durable owner-retirement erasure](docs/XSP_V2_P0E_OWNER_RETIREMENT_DURABLE_ERASURE.md)
- [XSP-v2 P0-E bounded parser fuzzing](docs/XSP_V2_P0E_PARSER_FUZZ.md)
- [XSP-v2 P0-E ML-DSA-65 FIPS 204 ACVP vectors](docs/XSP_V2_P0E_MLDSA65_FIPS204_ACVP.md)
- [XSP-v2 production rollout plan contract](docs/XSP_V2_PRODUCTION_ROLLOUT_PLAN.md)
- [XSP-v2 signer E2E](docs/XSP_V2_SIGNER_E2E.md)
- [XSP-v2 TLS / ingress-origin proof](docs/XSP_V2_TLS_PROBE.md)
- [Subscription security](docs/SUBSCRIPTION_SECURITY.md)

Historical long-form README content through 27 October 2026 is preserved under [`docs/archive/`](docs/archive/). Archived “current/next P0” statements do not override the current Roadmap.

---

XMesh Nexus is under active development. Code or a green isolated test alone does not establish enterprise/HA readiness, production PQ protection or successful deployment.
