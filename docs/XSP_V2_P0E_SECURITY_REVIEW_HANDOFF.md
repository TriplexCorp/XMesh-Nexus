# XSP-v2 P0-E independent security-review handoff

Status: **review-preparation / evidence-freeze only**. This document does not perform, replace or declare an independent security review. It does not qualify physical power-loss durability, enable `strict-pq`, or authorize production rollout.

## Frozen review target

The handoff freezes the current reviewed repositories at:

- XMesh-Nexus: `5cdb7825fcc51f8a7d296b992a7da4492ed2ce8e` — bounded observability checkpoint after Nexus PRs #133/#134.
- XMesh-Node: `083dc181c5e175f89007f4b93111cd5c45a69d97` — Node PR #51 bounded local observability on top of the completed retirement/parser/FIPS-204 evidence chain.

If either repository advances in security-relevant code after this freeze, the package is stale and must be regenerated and the independent reviewer must review the new revision rather than treating this handoff as transferable approval.

The machine-readable freeze is `deploy/xsp-v2-p0e-security-review-handoff.contract.json`.

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

At the frozen Nexus SHA the review package includes, at minimum:

- `docs/XSP_V2_PQ_ONLY_SECURITY_POLICY.md`
- `docs/XSP_V2_WIRE_SPEC.md`
- `docs/XSP_V2_SIGNER_E2E.md`
- `docs/XSP_V2_P0E_COORDINATED_BACKUP_RESTORE.md`
- `docs/XSP_V2_P0E4A6_PHYSICAL_RUN_HANDOFF.md`
- `docs/XSP_V2_P0E_OWNER_RETIREMENT_DURABLE_ERASURE.md`
- `docs/XSP_V2_P0E_PARSER_FUZZ.md`
- `docs/XSP_V2_P0E_MLDSA65_FIPS204_ACVP.md`
- `docs/XSP_V2_P0E_OBSERVABILITY.md`

The corresponding machine-checkable retirement, parser-fuzz, ML-DSA-65 ACVP and observability contracts are part of the handoff as listed in the companion JSON contract. Existing CI and test evidence is supporting material; a repository-controlled test cannot satisfy the requirement for independent review.

## Trust domains the reviewer must keep distinct

The architecture intentionally relies on several separate failure/rollback domains:

- the Node Agent's private local security state;
- Nexus/PostgreSQL durable control-plane state;
- the isolated panel-response signer and its protected signing identity;
- owner/off-host recovery checkpoint and independently provisioned verification pins;
- the external storage/controller/power-control evidence domain used by P0-E4a.

A review must explicitly evaluate correlated compromise or rollback assumptions between these domains. In particular, the owner/off-host floor cannot be stored only inside the same coordinated rollback domain it is intended to detect.

## Required reviewer output

The independent review is not complete merely because this handoff exists. Closure requires an externally attributable review result that records at least:

- the exact Nexus and Node revisions reviewed;
- reviewer identity/organization and review date;
- scope and methodology;
- findings with severity and affected trust boundary;
- disposition/remediation evidence for release-blocking findings;
- explicit statement on the final migration/no-fallback architecture and remaining limitations;
- an unambiguous approval/sign-off or rejection for the reviewed revisions.

Any remediation that changes security-relevant code invalidates the old frozen target and requires the affected revisions/evidence to be re-frozen and re-reviewed.

## External blocker that remains independent of this review package

P0-E4a remains OPEN. The repository already contains the E4a1–E4a6 preflight, arming, evidence, matrix, real-operation and operator-handoff tooling, but qualification still requires five real representative abrupt-power runs on the reviewed storage/controller/PLP stack plus independent evidence review. CI, SIGKILL, VM stop/snapshot and synthetic fixtures cannot substitute for those physical experiments.

The final production release decision therefore still depends on both the independent architecture/security review and the outstanding P0-E4a physical evidence. `strict-pq` remains OFF and production rollout remains NOT AUTHORIZED.
