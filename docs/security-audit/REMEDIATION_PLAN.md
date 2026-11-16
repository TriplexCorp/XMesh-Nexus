# Remediation and continuation plan

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
