# XSP-v2 P0-E independent security-review handoff

Status: **review-preparation / refreshed evidence-freeze only**. This document does not perform, replace or declare an independent security review. It does not qualify physical power-loss durability, enable `strict-pq`, or authorize production rollout.

## Frozen review target

This refreshed handoff freezes the current reviewed repositories at:

- XMesh-Nexus: `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` — PR #141 authoritative README/Roadmap checkpoint after the security-relevant Rust staging-ingress hardening in PRs #139/#140.
- XMesh-Node: `083dc181c5e175f89007f4b93111cd5c45a69d97` — Node PR #51 bounded local observability on top of the completed retirement/parser/FIPS-204 evidence chain.

The previous PR #135 freeze targeted Nexus `5cdb7825fcc51f8a7d296b992a7da4492ed2ce8e` plus the same Node revision. That Nexus target is retained as historical preparation evidence but is superseded for current `main` because security-relevant Nexus PRs #139 and #140 landed afterwards.

If either repository advances in security-relevant code after this refreshed freeze, the package is stale and must be regenerated; independent approval is not transferable to a later security-relevant revision.

The machine-readable freeze is `deploy/xsp-v2-p0e-security-review-handoff.contract.json`.

## Post-#135 implementation scope added to this freeze

The external reviewer must explicitly include the Rust origin/runtime hardening added after the old freeze:

- PR #139 merge `36ee6f7a5b1686f9c0d51beda5d24e84830982c7`: replaces the C2-A Python origin verifier with dependency-free Rust while preserving Linux `SO_PEERCRED`, pinned ingress UID/GID, exact client SPKI SHA-256, fixed trusted Node identity and UDS-only handling. The dedicated runtime contains neither Python nor a Rust toolchain.
- PR #140 merge `03679120726ff06005eff903909b262fb1271960`: replaces the C2-B/C/D Python ACK/recovery origin state machine with an isolated Rust 2024/`serde` implementation while preserving strict schema and duplicate-field rejection, ACK Node/issuer/method/path/epoch/freshness binding, historical recovery only after expiry, protected `XSP2C2C1` / `XSP2C2H1` / `XSP2C2R1` framing, C2-C peer credentials `10001:10001`, exact raw ACK forwarding, response-size/trailing-byte checks, the three disposable response-loss fault domains, thread-per-connection behavior and Unix listen backlog 32.

PR #140 exact-head and post-merge Backend CI, Hybrid TLS, C2-C authorization, expired recovery, lost-response/race, transport-negative/no-legacy and PostgreSQL rollback workflows completed successfully. That CI is supporting implementation evidence only; it does not satisfy the independent-review requirement.

## Required independent review domains

The external reviewer must cover at least the following boundaries as one migration/production architecture rather than approving each green CI job in isolation:

1. protocol canonicalization, domain separation, identity/direction/purpose binding and malformed-input behavior;
2. Ed25519 + ML-DSA-65 hybrid signing semantics and key-purpose separation;
3. TLS 1.3 `X25519MLKEM768`, ML-DSA-65 Node identity, authenticated authority/Host binding, downgrade rejection and absence of an XMESH1/classical fallback on the XSP-v2 path;
4. isolated signer process/socket boundary, filesystem/peer credentials, DB reader privileges and private-key custody assumptions;
5. PostgreSQL permit/replay/ACK/epoch/receipt transactionality, immutable evidence and lost-response/idempotent recovery semantics;
6. Agent local vault/floor/journal durability, crash recovery and one-sided rollback rejection;
7. coordinated backup/restore, independent owner/off-host monotonic floor and trust-domain separation;
8. owner-authorized retirement, offline owner-key custody, durable retirement intent, retained-key erasure and anti-resurrection floors;
9. parser fuzz scope and the externally pinned NIST ACVP ML-DSA-65 verification-vector scope/limitations;
10. default-off redacted Node/Nexus observability and its no-secret/no-replayable-payload boundary;
11. the final production migration, rollback, key provisioning, deployment/topology and fail-closed/no-fallback plan.

## Frozen evidence index

At frozen Nexus revision `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091`, the review package includes the normative/security evidence documents and machine contracts listed by the companion JSON contract, including:

- `docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md`
- `docs/XSP_V2_WIRE_SPEC.md`
- `docs/XSP_V2_SIGNER_E2E.md`
- `docs/XSP_V2_P0E_COORDINATED_BACKUP_RESTORE.md`
- `docs/XSP_V2_P0E4A6_PHYSICAL_RUN_HANDOFF.md`
- `docs/XSP_V2_P0E_OWNER_RETIREMENT_DURABLE_ERASURE.md`
- `docs/XSP_V2_P0E_PARSER_FUZZ.md`
- `docs/XSP_V2_P0E_MLDSA65_FIPS204_ACVP.md`
- `docs/XSP_V2_P0E_OBSERVABILITY.md`
- `docs/ENTERPRISE_ROADMAP.md`

The refreshed contract also enumerates the concrete C2-A/C2-B/C2-C/C2-D Rust implementation, source-contract scripts, process harnesses and regression workflows that were added or exercised by PRs #139/#140. Existing CI and test evidence is supporting material; repository-controlled tests cannot satisfy the independent-review requirement.

## Trust domains the reviewer must keep distinct

The architecture intentionally relies on several separate failure/rollback domains:

- the Node Agent's private local security state;
- Nexus/PostgreSQL durable control-plane state;
- the isolated panel-response signer and its protected signing identity;
- the staging ingress/origin boundary and the protected C2-C local authorization boundary;
- owner/off-host recovery checkpoint and independently provisioned verification pins;
- the external storage/controller/power-control evidence domain used by P0-E4a.

A review must explicitly evaluate correlated compromise or rollback assumptions between these domains. In particular, the owner/off-host floor cannot be stored only inside the same coordinated rollback domain it is intended to detect, and ingress identity metadata must not become a caller-controlled replacement for the reviewed peer-credential/SPKI boundary.

## Required reviewer output

The independent review is not complete merely because this handoff exists. Closure requires an externally attributable review result that records at least:

- the exact Nexus and Node revisions reviewed;
- reviewer identity/organization and review date;
- scope and methodology;
- findings with severity and affected trust boundary;
- disposition/remediation evidence for release-blocking findings;
- explicit statement on the Rust origin/ACK/recovery migration and final migration/no-fallback architecture;
- remaining limitations;
- an unambiguous approval/sign-off or rejection for the reviewed revisions.

Any remediation that changes security-relevant code invalidates this frozen target and requires the affected revisions/evidence to be re-frozen and re-reviewed.

## External blocker that remains independent of this review package

P0-E4a remains OPEN. The repository already contains the E4a1–E4a6 preflight, arming, evidence, matrix, real-operation and operator-handoff tooling, but qualification still requires five real representative abrupt-power runs on the reviewed storage/controller/PLP stack plus independent evidence review. CI, SIGKILL, VM stop/snapshot and synthetic fixtures cannot substitute for those physical experiments.

The final production release decision therefore still depends on both the independent architecture/security review and the outstanding P0-E4a physical evidence. `strict-pq` remains OFF and production rollout remains NOT AUTHORIZED.
