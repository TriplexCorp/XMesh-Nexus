# XSP-v2 P0-E independent security-review handoff

Status: **review-preparation / refreshed evidence-freeze only**. This document does not perform, replace or declare an independent security review. It does not qualify physical power-loss durability, enable `strict-pq`, or authorize production rollout.

## Frozen review target

This v3 handoff freezes the current review snapshot at:

- XMesh-Nexus: `0bab1a48cff570b3abe405bcda4dc242b23b8a4b` — merge of PR #155, after the bounded disposable-canary rehearsal (#150), production rollout-plan acceptance gate (#152), and explicit strict-PQ activation approval gate (#155).
- XMesh-Node: `083dc181c5e175f89007f4b93111cd5c45a69d97` — Node PR #51 bounded local observability on top of the completed retirement/parser/FIPS-204 evidence chain.

The previous PR #142 freeze targeted Nexus `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` plus the same Node revision. That target remains the frozen **runtime baseline**. The v3 Nexus snapshot advances only review/release-control tooling and documentation; the handoff CI must prove that the critical runtime paths are unchanged between `8c64a8e5c06cec12fb34b13c5cb2cb789f5ce091` and `0bab1a48cff570b3abe405bcda4dc242b23b8a4b`.

This refresh is required because the mandatory `production-migration-no-fallback-and-rollback` domain must review the actual final release-control architecture, not only the earlier runtime implementation. If either repository later advances in security-relevant runtime code or the release-control policy changes materially, the package is stale and the affected scope must be re-frozen/re-reviewed.

The machine-readable freeze is `deploy/xsp-v2-p0e-security-review-handoff.contract.json`.

## Runtime implementation scope retained from the v2 freeze

The external reviewer must explicitly include the Rust origin/runtime hardening that remains part of the unchanged runtime baseline:

- PR #139 merge `36ee6f7a5b1686f9c0d51beda5d24e84830982c7`: replaces the C2-A Python origin verifier with dependency-free Rust while preserving Linux `SO_PEERCRED`, pinned ingress UID/GID, exact client SPKI SHA-256, fixed trusted Node identity and UDS-only handling. The dedicated runtime contains neither Python nor a Rust toolchain.
- PR #140 merge `03679120726ff06005eff903909b262fb1271960`: replaces the C2-B/C/D Python ACK/recovery origin state machine with an isolated Rust 2024/`serde` implementation while preserving strict schema and duplicate-field rejection, ACK Node/issuer/method/path/epoch/freshness binding, historical recovery only after expiry, protected `XSP2C2C1` / `XSP2C2H1` / `XSP2C2R1` framing, C2-C peer credentials `10001:10001`, exact raw ACK forwarding, response-size/trailing-byte checks, the three disposable response-loss fault domains, thread-per-connection behavior and Unix listen backlog 32.

PR #140 Backend CI, Hybrid TLS, C2-C authorization, expired recovery, lost-response/race, transport-negative/no-legacy and PostgreSQL rollback workflows completed successfully. That CI is supporting implementation evidence only; it does not satisfy the independent-review requirement.

## Release-control scope added after the v2 freeze

The v3 review snapshot additionally requires the reviewer to examine the final non-executing release controls that landed after PR #142:

- PR #150 merge `497def9b950d57152f2e0ca2abb7eb0657a8d22f`: disposable release-canary rehearsal composing real Agent install/upgrade/retry/restart/LKG rollback, coordinated E3b restore, and default-off redacted observability. It proves harness readiness only and keeps `finalReleaseCanarySatisfied=false` until the exact post-P0-E candidate is rerun.
- PR #152 merge `b71c0d0c641b5e0f6a60785586486b18dbb45db3`: fail-closed production rollout-plan verifier requiring exact-candidate evidence, external review/physical qualification, final canary, explicit topology/DNS/firewall/Nginx/PostgreSQL/key/observability/rollback dispositions and separate plan review. It never performs deployment.
- PR #155 merge `0bab1a48cff570b3abe405bcda4dc242b23b8a4b`: explicit strict-PQ activation approval gate bound to the exact candidate, final canary, reviewed rollout plan and external evidence digests, with a bounded named-Node scope and short approval window. Even an eligible approval keeps `strictPQEnabled=false`, `productionActivation=false`, `legacyXMESH1Retired=false` and requires a separate execution step.

The release decision remains intentionally split: first PQ activation may retain legacy XMESH1; XMESH1 retirement is a later, separately approved action. Automatic fallback, classical-only activation and bundling XMESH1 retirement into initial strict-PQ activation remain forbidden.

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
11. the final production migration, rollback, key provisioning, deployment/topology, exact-candidate canary, reviewed rollout plan, explicit activation approval and fail-closed/no-fallback policy.

## Frozen evidence index

At frozen Nexus review snapshot `0bab1a48cff570b3abe405bcda4dc242b23b8a4b`, the package includes the normative/security evidence documents and machine contracts listed by the companion JSON contract, including:

- `docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md`
- `docs/XSP_V2_WIRE_SPEC.md`
- `docs/XSP_V2_SIGNER_E2E.md`
- `docs/XSP_V2_P0E_COORDINATED_BACKUP_RESTORE.md`
- `docs/XSP_V2_P0E4A6_PHYSICAL_RUN_HANDOFF.md`
- `docs/XSP_V2_P0E_OWNER_RETIREMENT_DURABLE_ERASURE.md`
- `docs/XSP_V2_P0E_PARSER_FUZZ.md`
- `docs/XSP_V2_P0E_MLDSA65_FIPS204_ACVP.md`
- `docs/XSP_V2_P0E_OBSERVABILITY.md`
- `docs/XSP_V2_DISPOSABLE_CANARY_REHEARSAL.md`
- `docs/XSP_V2_PRODUCTION_ROLLOUT_PLAN.md`
- `docs/XSP_V2_STRICT_PQ_ACTIVATION_APPROVAL.md`
- `docs/ENTERPRISE_ROADMAP.md`

The contract also enumerates the concrete C2-A/C2-B/C2-C/C2-D Rust implementation and regression evidence plus the release-control verifier/workflow evidence for #150/#152/#155. Existing CI and test evidence is supporting material; repository-controlled tests cannot satisfy the independent-review requirement.

## Trust domains the reviewer must keep distinct

The architecture intentionally relies on several separate failure/rollback domains:

- the Node Agent's private local security state;
- Nexus/PostgreSQL durable control-plane state;
- the isolated panel-response signer and its protected signing identity;
- the staging ingress/origin boundary and the protected C2-C local authorization boundary;
- owner/off-host recovery checkpoint and independently provisioned verification pins;
- the external storage/controller/power-control evidence domain used by P0-E4a;
- the human/independent review and bounded release-authorization process that supplies external evidence digests to the rollout and activation verifiers.

A review must explicitly evaluate correlated compromise or rollback assumptions between these domains. In particular, the owner/off-host floor cannot be stored only inside the same coordinated rollback domain it is intended to detect, ingress identity metadata must not become a caller-controlled replacement for the reviewed peer-credential/SPKI boundary, and release approvals must not be self-issued by the artifact they are supposed to authorize.

## Required reviewer output

The independent review is not complete merely because this handoff exists. Closure requires an externally attributable review result that records at least:

- the exact Nexus and Node revisions reviewed;
- reviewer identity/organization and review date;
- scope and methodology;
- findings with severity and affected trust boundary;
- disposition/remediation evidence for release-blocking findings;
- explicit statement on the Rust origin/ACK/recovery migration;
- explicit statement on the #150/#152/#155 exact-candidate canary, rollout-plan, approval and no-fallback architecture;
- remaining limitations;
- an unambiguous approval/sign-off or rejection for the reviewed revisions.

Any remediation that changes security-relevant code or materially changes the release-control policy invalidates the affected frozen scope and requires a new freeze/re-review.

## External blocker that remains independent of this review package

P0-E4a remains OPEN. The repository already contains the E4a1–E4a6 preflight, arming, evidence, matrix, real-operation and operator-handoff tooling, but qualification still requires five real representative abrupt-power runs on the reviewed storage/controller/PLP stack plus independent evidence review. CI, SIGKILL, VM stop/snapshot and synthetic fixtures cannot substitute for those physical experiments.

The final production release decision therefore still depends on both the independent architecture/security review and the outstanding P0-E4a physical evidence, followed by an exact post-P0-E canary, a separately reviewed rollout plan, an explicit bounded strict-PQ approval, and a separate execution step. `strict-pq` remains OFF and production rollout remains NOT AUTHORIZED.
