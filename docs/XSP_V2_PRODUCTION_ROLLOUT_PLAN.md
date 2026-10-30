# XSP-v2 production rollout plan contract

## Status

This document defines **planning/acceptance tooling only** for the separately reviewed production rollout plan required after P0-E and the final exact-candidate disposable canary.

It does not deploy anything, change DNS/firewall/Nginx/PostgreSQL/key material, start XSP-v2 in production, enable `strict-pq`, or retire XMESH1.

The machine-readable contract is:

- `deploy/xsp-v2-production-rollout-plan.contract.json`
- verifier: `scripts/verify-xsp-v2-production-rollout-plan.py`
- CI contract: `.github/workflows/xsp-production-rollout-plan-contract.yml`

## Why this gate exists

Production rollout has failure domains that are intentionally outside the earlier protocol/Agent proofs: public topology, DNS propagation, firewall exposure, Nginx listener configuration, database migrations/backups/ACLs, signer/key custody, operator ordering and rollback.

A green P0-E proof or disposable canary does not authorize an operator to improvise those changes. The exact release candidate needs a separately authored and separately reviewed plan with explicit before/after/rollback evidence.

## Baseline invariants

The verifier preserves the current deployment/security boundaries instead of allowing the rollout plan to weaken them:

- public panel traffic remains Nginx-facing on ports 80/443;
- the panel application remains bound to `127.0.0.1` on a distinct internal port;
- PostgreSQL and Redis remain unexposed on host ports;
- the XSP-v2 Node ingress remains a dedicated listener, not a shared legacy listener;
- XSP-v2 ingress is TLS 1.3 only with `X25519MLKEM768` key exchange and ML-DSA-65 client identity;
- unknown/missing XSP-v2 SNI is rejected;
- XSP-v2 application routes are exact `/api/v2/...` routes, never a generic prefix to XMESH1;
- XSP-v2 Nginx ingress keeps access logging disabled and exact locations only;
- database rollout evidence uses a verified custom-format `pg_dump` backup, ACL manifest and off-host recovery checkpoint;
- owner private keys remain offline, persistent application secrets are preserved, and signer keys remain read-only to the signer boundary;
- rollback cannot rewind XSP-v2 security state below the independent recovery floor.

The public panel's normal HTTPS policy is a separate web/UI boundary; the TLS-1.3-only rule above applies specifically to the dedicated XSP-v2 Node ingress.

## Plan structure

An operator plan uses schema `xsp2-production-rollout-plan-1` and must explicitly contain:

1. exact release candidate identity: Nexus revision, Node revision, Nexus image SHA-256 and Agent artifact SHA-256;
2. P0-E/security-review/physical-qualification/final-canary gate references;
3. final topology, including public panel and dedicated XSP-v2 ingress;
4. DNS changes or an explicit no-change reason;
5. firewall changes or an explicit no-change reason;
6. Nginx changes or an explicit no-change reason;
7. PostgreSQL backup/migrations/ACL/recovery evidence;
8. public-only key identifiers/fingerprints and custody domains, or an explicit key-material no-change reason;
9. ordered rollout stages with pre-checks, success checks and rollback references;
10. rollback evidence for DB, Nginx, DNS, firewall, Agent LKG and off-host recovery floor;
11. redacted/no-secret observability checks;
12. separate author/reviewer identity and approval state;
13. the separate strict-PQ/XMESH1 decisions; and
14. explicit false production/strict-PQ/legacy-retirement claims because this verifier itself performs no activation.

The schema deliberately has no command/script/shell/password/token/private-key/credential/URL fields. A rollout plan is a reviewed change contract, not a place to smuggle arbitrary execution input.

## Draft plan versus rollout-plan gate eligibility

A structurally valid draft may exist before P0-E is complete. In that state:

- security-review / physical-qualification evidence hashes may be `null` while their acceptance booleans are false;
- `releaseCandidate.canaryResultSha256` may be `null` while `finalCanaryPassed=false`;
- plan review may be pending;
- verifier output still reports `reviewReady=true` but `rolloutPlanGateEligible=false`.

Once the external gates and exact-candidate final canary really exist, their exact evidence digests must be recorded. For gate eligibility the plan must also have a separate reviewer approval and be checked against the expected exact candidate:

```bash
python3 scripts/verify-xsp-v2-production-rollout-plan.py \
  --plan /path/to/production-rollout-plan.json \
  --expected-nexus-revision <40-hex> \
  --expected-node-revision <40-hex> \
  --expected-canary-result-sha256 <64-hex> \
  --require-gate-eligible
```

`--require-gate-eligible` fails unless all of these are true:

- P0-E is recorded complete;
- the attributable independent security-review result is accepted;
- the representative physical-power qualification result is accepted;
- the final canary for this exact release candidate passed;
- the canary result digest is present and matches the expected digest;
- the plan has been approved by a reviewer separate from its author; and
- all topology/rollback/key/observability invariants validate.

For a real release, the referenced P0-E review/qualification artifacts and final-canary artifact must still be verified with their own existing tools. A digest reference is binding evidence metadata, not a substitute for those verifiers.

## Separate strict-PQ and XMESH1 decisions

This rollout-plan gate intentionally requires exactly:

```json
{
  "strictPqActivation": {"action": "remain-off", "approved": false},
  "legacyXMESH1Retirement": {"action": "retain", "approved": false}
}
```

Therefore a plan cannot use gate #4 to silently activate `strict-pq`, remove the legacy path, or combine those decisions with infrastructure rollout. Those are a later, separately approved release decision/gate.

Even a synthetically gate-eligible plan verifier result always contains:

```json
{
  "productionActivation": false,
  "strictPQEnabled": false,
  "legacyXMESH1Retired": false
}
```

## Rollback requirements

Rollback is not allowed to mean security-state rewind. A plan must preserve:

- the exact verified PostgreSQL backup used by the database section;
- an exact Nginx rollback config digest from the planned Nginx change;
- DNS and firewall rollback readiness;
- Agent last-known-good package state;
- the same independent off-host recovery checkpoint referenced by the database/recovery section;
- fail-stop behavior on failed stage checks; and
- `noSecurityStateRewind=true`.

The existing P0-E3a/P0-E3b recovery floor remains authoritative during rollback.

## CI scope

CI uses synthetic JSON fixtures only. It proves parser/policy behavior such as:

- a draft plan is valid but ineligible;
- a synthetic fully reviewed plan can become **plan-gate eligible** while all activation claims remain false;
- wrong candidate binding fails;
- final-canary PASS without a canary digest fails;
- public app/DB exposure fails;
- TLS 1.2 or a shared legacy XSP ingress fails;
- XSP ingress access logging or weakened rollback fails;
- unverified backup semantics fail;
- malformed stage ordering fails;
- arbitrary command fields/private-key material fail;
- attempting to activate strict-PQ or retire XMESH1 in this gate fails; and
- self-review cannot approve the rollout plan.

Synthetic CI is not a real production plan review and authorizes no deployment.

## Release boundary

The intended order remains:

1. complete P0-E, including external issue #137 and external issue #138;
2. freeze the resulting exact release candidate if remediation changed security-relevant code;
3. run the full disposable canary on that exact candidate;
4. author the real topology/DNS/firewall/Nginx/DB/key rollout plan;
5. obtain a separate review of that plan and pass this verifier against the exact candidate;
6. only then proceed to the separately approved strict-PQ activation / XMESH1-retirement decision and any eventual production execution authorization.

This contract is preparation for step 4/5. It does not skip steps 1–3 or perform step 6.
