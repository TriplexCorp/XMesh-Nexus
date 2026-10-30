# XSP-v2 AI-assisted internal security audit — 30 October 2026

## Status and independence

This document records an **AI-assisted internal security review** of the frozen XSP-v2 P0-E v3 review scope. It is intentionally **not** represented as an independent third-party audit.

Reviewer: ChatGPT / GPT-5.6 Sol, working with the project owner during the implementation and review-preparation process.

Therefore:

- `independent=false`;
- this report is useful pre-review evidence and may reduce external-review effort;
- this report **does not satisfy or close issue #137** under its current policy;
- this report does not satisfy #138 physical abrupt-power qualification;
- `independentSecurityReviewComplete=false`;
- `physicalPowerLossQualified=false`;
- `productionActivation=false`;
- `strictPQEnabled=false`.

## Exact scope

The review was performed against the same v3 identities used by the current independent-review handoff:

- Nexus review snapshot: `0bab1a48cff570b3abe405bcda4dc242b23b8a4b`;
- Node review target: `083dc181c5e175f89007f4b93111cd5c45a69d97`;
- protected Nexus runtime baseline: `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091`;
- v3 reviewer bundle workflow: `41037503656`;
- deterministic inner tar SHA-256: `bac34400ac9b646c8a0f64ca9495e380ff0afce373310787c96385b9e40486bf`;
- bundle payload / `SHA256SUMS` digest: `33c8f07f4513cb03400c8b7af2f34f804661a79501336206482c0f426866620a`.

The review covered source code, PostgreSQL migrations and role restrictions, strict parser/canonicalization logic, cryptographic bindings, Agent durable state/recovery, owner-authorized retirement, observability, physical-qualification preparation, and the non-executing production release-control gates.

## Method and limitations

Method:

1. static source inspection at the exact frozen revisions above;
2. trust-boundary review of Agent, Nexus/PostgreSQL, isolated signer, ingress/origin/C2-C, owner/off-host checkpoint and release-control boundaries;
3. review of negative/fail-closed conditions and parser/canonicalization behavior;
4. review of transaction and durability ordering around permit, ACK, epoch, receipt, key rotation and retirement;
5. review of existing test/fuzz/vector/recovery evidence and exact-commit CI results as corroborating evidence only;
6. review of production rollout and strict-PQ approval contracts for forbidden fallback and evidence dependencies.

Limitations:

- no physical power was removed from representative hardware during this review;
- no claim is made about controller firmware, PLP, volatile write cache or storage-stack behavior beyond the repository's read-only preflight/tooling;
- this was not an organizationally independent review;
- this was not an exhaustive formal verification or cryptographic proof;
- existing CI was treated as evidence, not as a substitute for reasoning or external qualification.

## Executive result

**Internal disposition: PASS WITH LOW FINDINGS for the reviewed software and release-control scope.**

No Critical, High, or Medium severity vulnerability was identified in the reviewed frozen scope.

Finding count:

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 2 |
| Informational / limitations | 3 |

The principal positive result is that the security properties are implemented as mutually reinforcing boundaries rather than as labels: strict parsing and domain separation, Ed25519 **and** ML-DSA-65 authorization, negotiated TLS 1.3 `X25519MLKEM768`, certificate/authority binding, UDS peer credentials, isolated signer roles, transactionally committed replay/epoch/ACK state, immutable receipt evidence, durable Agent floors/journals, an independent off-host rollback floor, owner-authorized retirement, and non-executing production approval gates all fail closed in the reviewed paths.

This result supports proceeding to the independent external review. It does **not** authorize production activation.

## Findings

### AI-LOW-001 — client certificate is required at the HTTP route rather than the TLS handshake

**Severity:** Low  
**Domain:** PQ-only transport / Node identity / availability hardening

`deploy/xsp-v2-ingress/nginx-c2b.conf` configures the named ingress with:

```nginx
ssl_verify_client optional;
```

Every mounted security-sensitive exact location then explicitly requires `$ssl_client_verify == SUCCESS`, and caller headers are stripped before forwarding to the protected UDS. This means the condition is **not an authentication bypass**: an unauthenticated client cannot reach the ACK, recovery, or identity operation successfully.

The residual issue is availability. A client without a certificate can complete the expensive TLS 1.3 / hybrid-KEM server handshake and only then receive an HTTP-layer rejection. On a public production listener this leaves more unauthenticated handshake work reachable than necessary.

**Impact:** bounded remote resource-consumption / DoS hardening gap; no confidentiality, integrity, identity, or downgrade bypass was found.

**Recommended remediation:** before public production exposure, prefer handshake-level client authentication (`ssl_verify_client on`) if it is compatible with the intended ML-DSA-65 client-certificate deployment. Otherwise document the reason for `optional` and add explicit connection/rate/resource controls appropriate to the production topology.

**Release impact:** not considered release-blocking for the reviewed cryptographic/authentication model, but should be dispositioned in the external review/rollout plan.

### AI-LOW-002 — master-key creation fsyncs the file but not its parent directory

**Severity:** Low  
**Domain:** Agent local durability / provisioning durability

In `security/xspv2/poc-go/keyring/sealed.go`, `CreateMasterKey` creates the master key with exclusive mode, writes it and calls `fsync` on the file. Unlike the `atomicFile` helper used for rotation state, it does not subsequently fsync the parent directory after creating the new directory entry.

On filesystems where a successful file `fsync` does not guarantee persistence of the newly created directory entry, an abrupt power loss immediately after successful provisioning can therefore lose the name entry even though the file contents were synced.

The normal rotation path is stronger: temporary-file fsync, atomic rename, and parent-directory fsync are all present. The reviewed staged `xmesh-agent-xspv2` command also does not automatically invoke master-key creation, reducing current exposure.

**Impact:** fail-closed availability/recovery risk during initial provisioning; no silent epoch rollback, signature forgery, or key-confidentiality bypass was identified.

**Recommended remediation:** after successful creation/close of the master-key file, fsync the parent directory using the same durable-directory pattern used by the rotation helpers, and add a provisioning-specific abrupt-power test.

**Release impact:** low severity. Any remediation to the frozen Node security source must be handled through the project's normal re-freeze/re-review rule.

## Informational observations

### AI-INFO-001 — durable receipt evidence and `receipt_sent` state are separate concepts in the current implementation

The permit ledger permits an `ack_verified -> receipt_sent` state transition, while the signed receipt issuance path persists an immutable signed-receipt outbox entry after verifying the exact committed ACK. In the reviewed runtime path, the durable outbox is the effective receipt evidence and the ledger can remain `ack_verified`.

No security bypass was found: outbox insertion is bound to the exact `ack_verified` ledger row, and UPDATE/DELETE/TRUNCATE protections preserve the evidence. The distinction should remain explicitly documented so operators do not interpret a zero `receipt_sent` count as absence of durable signed receipt evidence when the outbox is authoritative.

### AI-INFO-002 — fuzzing and NIST ACVP coverage are deliberately bounded

The recovery parser fuzz targets check strict decode/canonical validation/semantic round-trip for the recovery checkpoint, retirement request and retirement authorization parsers. The ML-DSA-65 ACVP test exercises the compatible FIPS 204 `sigVer` / external / pure / `externalMu=false` subset and verifies both expected-valid and expected-invalid cases.

This is useful evidence, but it is not exhaustive parser fuzzing, ACVP certification, implementation formal verification, or coverage of every possible ML-DSA interface. The repository already documents this limitation correctly; no false security claim is required.

### AI-INFO-003 — physical storage qualification remains outside static software review

The P0-E4a storage preflight correctly refuses to claim physical qualification and explicitly requires controller/device power-loss evidence, changed boot IDs, PostgreSQL/WAL recovery evidence and five real abrupt-power checkpoints. Static review cannot establish those hardware facts.

This is not a software finding; it is the remaining evidence boundary tracked by #138.

## Review of all 11 mandatory domains

| # | Review domain | Internal disposition | Summary |
| ---: | --- | --- | --- |
| 1 | Protocol and canonicalization | PASS | Strict size/complexity limits, duplicate/trailing/unknown-field rejection, canonical Base64/hex, exact message direction/type/path, domain-separated signing inputs and bounded freshness were found. |
| 2 | Hybrid cryptography and key-purpose binding | PASS | Critical cutover messages require both Ed25519 and ML-DSA-65 signatures; public pins carry explicit purpose/issuer/Node/key IDs and exact key fingerprints. No single-signature fallback was found. |
| 3 | PQ-only transport and Node identity | PASS WITH LOW-001 | TLS 1.3 only, actual `X25519MLKEM768`, certificate validation, ML-DSA-65 client identity evidence, direct-address versus authenticated authority separation, no proxy/redirect/keepalive fallback, exact routes and protected UDS identity are present. Handshake-level client-auth hardening remains LOW-001. |
| 4 | Isolated signer and key custody | PASS | Signer uses a dedicated UDS with peer credentials, protected key files and owner-approved key IDs, independently rereads committed ACK evidence, and runs with a narrowly validated read-only PostgreSQL role. |
| 5 | PostgreSQL replay / ACK / epoch / receipt transactionality | PASS | Replay nonce insertion, prepared-key installation, epoch CAS, immutable ACK evidence and commit happen transactionally; signed receipt outbox binding is immutable and a dedicated TRUNCATE guard closes the statement-level deletion gap. |
| 6 | Agent local durability and rollback | PASS WITH LOW-002 | Rotation uses durable previous/floor/active ordering with temp-file fsync, rename and parent sync; rollback/substitution fails closed. Initial master-key directory-entry persistence is the LOW-002 exception. |
| 7 | Coordinated backup/restore and off-host recovery floor | PASS FOR SOFTWARE BOUNDARY | The off-host checkpoint is outside both local rollback domains, is derived from exact dual-signed receipt evidence, rejects lower epochs and same-epoch receipt divergence, and requires independently provisioned panel pins. Operational independence of the off-host store remains an external deployment assumption. |
| 8 | Owner-authorized key retirement | PASS | Retirement binds exact Node/authority/epochs/key IDs/checkpoint/request to dual owner signatures. A persistent HMAC-authenticated retirement intent is written before deletion; floor and anti-resurrection checks fail closed across crash/retry. |
| 9 | Parser fuzzing and external ML-DSA-65 vectors | PASS WITH DOCUMENTED LIMITATION | Native fuzz invariants and externally sourced compatible NIST ACVP `sigVer` vectors provide meaningful negative evidence, but the coverage is intentionally bounded and is not certification/exhaustive assurance. |
| 10 | Default-off redacted observability | PASS | Node and Nexus surfaces are staging-gated/read-only, expose bounded IDs/counters/state rather than private keys, signed payloads or replayable authorization artifacts, and explicitly report production/strict-PQ false. |
| 11 | Production migration, no-fallback and rollback architecture | PASS FOR TOOLING; NOT ACTIVATION-ELIGIBLE | Rollout-plan and activation-approval contracts require exact candidate/evidence digests, final canary, independent review, explicit topology/security dispositions, no automatic/classical-only fallback, max 50 named Nodes and max 24-hour approval; approval remains non-executing and retains XMESH1. #137/#138 are still unsatisfied. |

## Domain evidence notes

### 1. Protocol / canonicalization

The Node strict envelope parser imposes a 1 MiB envelope cap and 512 KiB payload cap, recursively rejects duplicate object keys, limits JSON complexity/depth, rejects trailing JSON, uses unknown-field rejection and re-encodes canonical fields for the signing input. The cutover protocol has separate domain strings for permits and applied ACKs, requires exactly `fromEpoch + 1`, binds method/path/request/candidate/nonces and prevents reuse of the permit nonce as the ACK nonce.

No alternate permissive parser was found on the reviewed critical path.

### 2. Hybrid signatures / purpose separation

`VerifyPermit` and `VerifyAppliedACK` require both Ed25519 and ML-DSA-65 verification. Trusted public material is checked for purpose, issuer, Node identity, key IDs and fingerprints before use. Panel-response and Node-request purposes are distinct.

No classical-signature-only critical-message path was identified.

### 3. Transport / Node identity

The Node transport validates a direct connect address separately from the authenticated server authority. TLS configuration fixes TLS 1.3 and `X25519MLKEM768`, disables session resumption for the probe, verifies certificate chains/hostname and verifies the ML-DSA-65 client identity. The HTTP exchange disables proxy use, redirects, keepalive/compression and HTTP/2, pins the request Host to the authenticated authority and only persists a cryptographically verified signed receipt.

The ingress rejects unknown SNI, mounts only exact ACK/recovery paths, rejects non-POST/transfer-encoding/missing length, strips caller headers and recreates only TLS-derived identity evidence before protected UDS forwarding.

### 4. Signer / key custody

The signer validates Unix peer UID/GID, bounds request sizes/times, refuses arbitrary signing input and rereads the exact committed ACK from PostgreSQL before producing a commit receipt. Key IDs are derived from public material and checked against expected pins. The signer DB role has no superuser/create/replication/bypass-RLS privileges, no role memberships, and receives SELECT-only access to the small XSP-v2 state set.

### 5. PostgreSQL transactionality / replay

The ACK commit flow inserts the replay nonce, installs the exact proved candidate, advances the suite epoch with a compare-and-swap condition, stores the exact signed ACK and commits only after all checks succeed. Historical recovery compares exact persisted hashes/bytes rather than reconstructing success. The signed-receipt outbox is bound by FK/trigger to the exact ledger identity and immutable digests; application code re-verifies both receipt signatures before insertion and verifies exact equality on conflict/retry.

### 6. Agent durability / rollback

The keyring stores active, staged and previous state under private 0700/0600 ownership boundaries. Rotation persists the prior complete state before advancing the monotonic floor and only then replaces the active encrypted identity. Recovery rejects inconsistent floor/active/staged combinations and can deterministically complete the new state when the floor has already advanced. Restored old state is rejected by current authoritative evidence/off-host floor rather than repaired silently.

### 7. Coordinated recovery

The third trust domain is correctly explicit: the newest trusted off-host checkpoint and panel-response pins must live outside both Agent and Nexus/PostgreSQL rollback sets. A local epoch below the checkpoint floor or a same-epoch different receipt digest is rejected. A higher local epoch is only accepted as satisfying the floor, not as automatically authenticating the newer state.

### 8. Retirement

Retirement authorization is dual-signed by owner keys and bound to the accepted off-host checkpoint. The Agent persists an authenticated retirement record before removing either retained snapshot, revalidates active/floor identity on resume and refuses reappearance of retired material. The active identity and monotonic floor are not erased.

### 9. Fuzz / external vectors

Fuzz targets assert that any accepted input remains canonical-valid and semantically stable across decode/marshal/decode. The NIST test checks expected metadata, selects the exact compatible ML-DSA-65 subset, constructs the public key with Go's `crypto/mldsa` and compares verification results against the expected ACVP results.

### 10. Observability

The Node snapshot excludes public-key bytes, private material, authorization digests and journal payloads. The Nexus snapshot exposes counters/epochs/key IDs and bound Agent-update counts only. Both are read-only; the Nexus tool requires `XSP_V2_OBSERVABILITY=staging-only`; production and strict-PQ outputs remain false.

### 11. Release control

The production rollout verifier requires P0-E external evidence, an exact release candidate and final canary before a plan can become gate-eligible. It validates topology, DNS, firewall, Nginx, database, key-material, observability and rollback dispositions and rejects command/script/private-key/secret/credential fields.

The final activation approval contract fixes:

- TLS 1.3;
- `X25519MLKEM768`;
- ML-DSA-65 client identity;
- Ed25519 **and** ML-DSA-65 critical-message signatures;
- `automaticFallback=false`;
- `classicalOnlyAllowed=false`;
- `strictPqAction=enable`;
- `legacyXMESH1Action=retain`;
- at most 50 explicitly named Nodes;
- at most 24 hours;
- accepted #137/#138 evidence, final canary and rollout-plan evidence before eligibility.

Even an eligible approval still emits false production/strict-PQ state and requires a separate execution step. No arbitrary command execution path is embedded in the approval artifact.

## CI corroboration at the exact review identities

Visible checks on Nexus `0bab1a48cff570b3abe405bcda4dc242b23b8a4b` were successful, including the strict-PQ activation-approval contract and Backend CI jobs (`rust`, `cli`, `subscription-build`, API authentication integration).

Visible checks on Node `083dc181c5e175f89007f4b93111cd5c45a69d97` were successful, including the main test job, one-sided snapshot rollback, Agent artifact, local observability and crash-durability jobs.

These check results corroborate the reviewed invariants but are not treated as proof of independence or physical durability.

## Final internal recommendation

**Recommendation: proceed to independent external review with the two LOW findings disclosed.**

The reviewed software architecture did not reveal a Critical/High/Medium release-blocking flaw. The two LOW findings are concrete hardening/durability items and should be explicitly dispositioned by the independent reviewer and production rollout owner.

Do not mark #137 complete from this report alone because the reviewer is not independent under the existing contract. Do not mark #138 complete because no real physical abrupt-power matrix was executed by this review.

Until those external evidence gates are genuinely satisfied, the correct state remains:

```text
independentSecurityReviewComplete=false
physicalPowerLossQualified=false
finalReleaseCanarySatisfied=false
productionActivation=false
strictPQEnabled=false
legacyXMESH1Retired=false
```
