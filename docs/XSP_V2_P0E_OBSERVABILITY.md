# XSP-v2 P0-E bounded observability checkpoint

This checkpoint pins the two merged, default-off observability surfaces that are allowed to inspect bounded XSP-v2 security state without creating a production API or exposing replayable/key material.

## Exact reviewed revisions

- **XMesh-Node PR #51**: `083dc181c5e175f89007f4b93111cd5c45a69d97`, from reviewed predecessor `ffebcc30424463dd0afcdb8226bcd4b48c019bff`.
- **XMesh-Nexus PR #133**: `ccb9e384dca47f0c1a69c0ecd82461d523344c7a`, from reviewed predecessor `3be8c71dff44ef67ec71f70d440dfed31123a385`.

The companion machine-readable contract is `deploy/xsp-v2-p0e-observability.contract.json`.

## Node boundary

The Node side is a local operator CLI only. It is compiled from the production-capable Agent tree but remains inert unless `XSP_V2_OBSERVABILITY=staging-only` is set explicitly. It opens existing Agent state read-only and emits the `xsp2-node-observability-1` schema with bounded identity/epoch/key-ID/retention/retirement metadata.

It does not export private keys, public-key bytes, authorization digests, cutover journals or a network endpoint, and it does not initialize, rotate, retire, repair or rewrite security state.

## Nexus boundary

The Nexus side is a separate operator-only binary behind the non-default Cargo feature `xsp-v2-observability`. It requires the same exact `XSP_V2_OBSERVABILITY=staging-only` runtime gate and one explicit positive Node ID. It emits the `xsp2-nexus-observability-1` schema from read-only PostgreSQL queries over whitelisted status/count/timestamp/key-ID metadata.

The reviewed CI seeds sentinel values into adjacent sensitive/replayable columns and proves those values do not appear in output. The report deliberately excludes raw public-key bytes, request IDs, nonces, challenges, serialized permits, ACKs, receipts, signatures, release-identity payloads and command result/detail text. The dedicated proof also compares durable PostgreSQL state before and after the report and requires it to remain identical.

## What this closes

Within the repository-controlled scope, the bounded operational-observability software gate is complete once the exact Node and Nexus revisions above are independently pinned and re-verified by the companion CI workflow. This gives operators a diagnostic surface for the already-built recovery/retirement state machines without widening their authority or exporting security payloads.

## What remains open

This checkpoint does **not** establish representative physical abrupt-power qualification. P0-E4a remains OPEN until the required real storage/controller runs are executed and independently reviewed.

It also does **not** constitute the independent security review of the final migration/production architecture. That review remains a separate release gate. `strict-pq` remains OFF and production rollout remains NOT AUTHORIZED.
