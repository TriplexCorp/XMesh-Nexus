# Remediation and continuation plan

## Release coordination — updated 16 November 2026

This plan is a live audit checklist, **not** a release approval. Original
checkpoint text below predates the following merged changes.

1. **Priority gate:** finish full Backend CI for signed telemetry [#495](https://github.com/TriplexCorp/XMesh-Nexus/pull/495). Its real disposable signed cross-Squad authorization test passes. Restore CI fixture compatibility with supported managed inbound topologies (one proxy or TCP+Hysteria2), rather than weakening the 403 tests or changing production routing rules. After all checks pass, review and merge against current Nexus `main`; retest revoked/changed Squad memberships, same tag across different profiles, sampled/stale counters and per-user quota isolation.
2. **Already shipped:** Nexus login admission [#496](https://github.com/TriplexCorp/XMesh-Nexus/pull/496), bounded Xray archive unpack [#494](https://github.com/TriplexCorp/XMesh-Nexus/pull/494), Node supported runtime and actual-image scan [#83](https://github.com/TriplexCorp/XMesh-Node/pull/83), Sub publisher action pinning [#18](https://github.com/TriplexCorp/XMesh-Sub/pull/18). **Do not cherry-pick or remerge these from this audit branch.**
3. **Source/supply-chain review:** process every SAST/Bandit/Gitleaks candidate and dependency advisory with reachability, environment and current artifact evidence. In particular, investigate zip `extract` advisories (generic helper not used in Xray path), local bundled SQLite+WAL prerequisites and the remaining Go advisory records; record dispositions without suppressing failures.
4. **Cross-component and install gates:** enforce Sub origin/IPv6 peer semantics, old integration-token least privilege, per-node compromise blast radius, cancellation-safe accounting, fresh VPS install/reboot/interrupted update/rollback. Maintain normal zero-manual-key provisioning and existing strict-PQ release gates.
5. **Audit branch disposition:** current #493 contains auth work already landed by #496 and historical scanner snapshots. Reconcile against current `main`, preserve source evidence, and produce a documentation-only final audit report or a separately reviewable outstanding code fix. Do not merge this old feature branch wholesale.

## Immediate review gates

1. Finish latest CI for Nexus draft #493 after the handler/permit-lifetime refactor. Keep all Clippy/security checks enabled.
2. Complete the evidence workflow; distinguish tool failures, scanner candidates and confirmed findings. Produce per-repository SBOM artifacts and record exact image/module identities.
3. Update the ledger with links and actual results. Do not merge automatically.

## Next high-value security work

1. API authorization: enumerate handler guards and collection allowlists; run owner/admin/viewer/anonymous and Integration scope/user-grant negatives against actual API. Include session revocation and account mutation races.
2. Public DoS: add DB/Redis instrumentation and failure injection proving malformed requests reject before storage. Compare edge/origin and multi-instance behavior.
3. Node compromise: signed requests claiming a different node/user, unassigned metrics, replayed/reset counters, integer boundaries and stale/offline quota enforcement. Trace credentials shared across assignments.
4. Sub compromise: cross-mirror report/queue ownership, enrollment single use/revocation, signed replay/window tests and actual IPv6 /64 peer identity through Docker.
5. Updates/install: three fresh disposable machines or equivalent nested systemd/network qualification, downloaded artifact corruption/provenance/downgrade tests, reboot and rollback.
6. Frontend: Chromium hostile notes/URLs/API data and CSP/clickjacking checks; verify subscription states and client imports across mobile widths.
7. Second pass: re-review every changed control, rerun adjacent integration/compatibility checks and reassess finding severities.

## Workflow rules

Separate working branches/PRs per repository when runtime or workflow changes are confirmed. Coordinate version/Agent bumps only when the changed release contract requires them. Do not remove features or disable CI to pass. Keep sensitive exploit details in private advisories if a confirmed High/Critical requires it. Preserve all remaining coverage explicitly; an interim checkpoint is not completion.

Latest scanner step is now triage rather than fixing a failed Rust invocation. Establish active SQLx features, validate ZIP extraction bounds/upgrade compatibility, assess actual Node SDK/runtime advisory conditions, and preserve the generated lock/SBOM artifact before its retention expires. Device HWID and physical-device/credential-cloning guarantees must be documented separately.

Track the Host dialog overflow assertion separately; original browser CI remains failing. The independent security matrix target exists so that layout failure cannot prevent signed-node and actual RBAC/MFA/scoped-token checks. Record its result and investigate any security failure before approval.

## Follow-up checkpoint — 2026-11-16

Latest verified head ea675441: default Rust, crypto, isolated signer E2E, baseline/candidate resource and independent security integration checks succeeded. SAST/dependency aggregates and combined browser/API job remain failing; they are not security approval.

Additional source review traced telemetry persistence and migrations 0006/0028. Node identity verification and user-object authorization are distinct assurance requirements. The reviewed persistence schema's positive-ID checks and composite keys do not themselves enforce assignment. This is a priority hypothesis, not a dynamically confirmed finding or assigned CVSS score. Before remediation, inspect every relevant trigger/migration and provisioning membership rule, then test two separately assigned disposable node/user fixtures. Verify that rejecting unauthorized objects preserves legitimate delayed samples and quota reconciliation. Existing signature/replay tests alone do not establish this property.

The local executor remains unavailable. No new dynamic reproduction, production request, runtime modification, dependency upgrade or merge occurred in this follow-up. Reuse existing scan artifacts; next execution should prioritize the focused cross-identity test rather than rerunning broad scans with unchanged source.
