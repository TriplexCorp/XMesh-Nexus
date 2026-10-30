# XSP-v2 P0-E4a physical qualification review result

Status: **post-run result-acceptance tooling only; P0-E4a remains OPEN**.

This layer does not execute or simulate a power cut, does not replace the existing E4a3/E4a4/E4a6 evidence chain, and can never set `physicalPowerLossQualified=true`. It defines how the independent reviewer returns a conclusion **after** all five real abrupt-power experiments have already been executed and the existing five-run matrix has validated.

## Why this exists

P0-E4a6 deliberately ends with a real-lab evidence set that is `physical-run-handoff-verified-for-independent-review` and still carries `physicalPowerLossQualified=false`. P0-E4a4 aggregates exactly the five required evidence bundles into `xsp2-p0e4a4-powercut-matrix-1`, emits `matrixSha256Hex`, and likewise keeps qualification false.

The remaining external sequence is therefore:

1. execute the five real abrupt physical power removals;
2. preserve and verify each run with the existing E4a6 handoff;
3. run the existing E4a4 matrix over exactly those five E4a3 bundles;
4. have an independent reviewer inspect the raw controller/storage/WAL/Agent/PostgreSQL/E3a evidence;
5. return an attributable review result bound to the exact matrix and five E4a6 verification results;
6. only then create a later explicit reviewed checkpoint that may record qualification.

The contract in `deploy/xsp-v2-p0e4a-qualification-review-result.contract.json` and verifier in `scripts/verify-xsp-v2-p0e4a-qualification-review-result.py` define step 5. They intentionally do not perform step 6.

## Inputs

The verifier consumes three existing evidence products plus the external review result:

- `--matrix-result`: the JSON output from `scripts/xsp-v2-p0e4a4-powercut-matrix.py` over the five real E4a3 evidence files;
- `--handoff-results-dir`: exactly five preserved JSON outputs from E4a6 `verify`, named after the five checkpoints;
- `--result`: the independent reviewer's result JSON;
- optionally `--contract` to override the repository contract path.

The five required checkpoint files are exactly:

- `after-previous.json`
- `after-floor.json`
- `after-active.json`
- `after-recovery-abort.json`
- `after-recovery-active.json`

No sixth file, missing point, duplicate run/evidence/controller binding, or different source/storage generation is accepted.

## Qualification scope binding

The returned external result must repeat the exact scope derived from the real E4a4 matrix:

- Node ID;
- reviewed Node power-cut source revision;
- reviewed Node real-operation lab-runner revision;
- reviewed Nexus E4a5 lab/source-contract revision;
- exact lab binary SHA-256;
- reviewed storage-profile ID;
- PLP evidence ID;
- E4a4 `matrixSha256Hex`;
- SHA-256 of the exact serialized matrix-result JSON.

It must also contain a SHA-256 mapping for the exact five raw E4a6 verification-result JSON files. The verifier recomputes those values locally and rejects any mismatch.

This prevents an independent conclusion for one binary, storage stack, matrix, run set, or controller-event generation from being silently reused for another.

## Mandatory independent evidence attestations

The external reviewer must explicitly attest all of the following as `true` before the result can recommend qualification:

- all five runs actually used abrupt physical power removal;
- raw external controller records were reviewed;
- changed pre/post boot identities were reviewed;
- post-boot Agent security state was reviewed;
- PostgreSQL/WAL recovery and integrity evidence was reviewed;
- storage/controller/cache/PLP semantics were reviewed;
- the independent E3a off-host witness was reviewed;
- the E4a4 matrix digest and per-run bindings were reviewed.

A false attestation may still form part of a structurally valid external rejection/result, but it is not a qualification recommendation.

## Findings and sign-off

Each finding has a unique ID, severity, status, `releaseBlocking` flag, `qualificationScopeChanged` flag, title, evidence references, and disposition.

Allowed decisions are:

- `qualify`
- `qualify-with-findings`
- `reject`

A result is **not eligible even as a qualification recommendation** when:

- the reviewer decision is `reject`;
- any mandatory evidence attestation is false;
- a release-blocking finding remains unremediated;
- any finding changes the qualification scope.

A scope-changing remediation means the tested binary/storage/controller/profile or other qualification basis is no longer the same scope. In that case the verifier reports `requiresNewFiveRunMatrix=true`; the five physical experiments must be executed again for the new scope rather than transferring the old matrix result.

The sign-off identity must match the attributable reviewer name and organization, and the reviewer must explicitly declare `independent=true`.

## Critical non-claim

Even when an external result passes with `--require-qualification-recommendation`, verifier output is still fixed to:

```json
{
  "requiresExplicitReviewedCheckpoint": true,
  "physicalPowerLossQualified": false
}
```

That successful verification means only: **the external reviewer recommends qualification for the exact bound five-run scope and the result is complete enough to be consumed by the later explicit reviewed checkpoint**.

The verifier does not mutate README/Roadmap, does not flip a production feature flag, does not close issue #138, and does not authorize production rollout.

## Verification

After the real lab and external review:

```bash
python3 scripts/verify-xsp-v2-p0e4a-qualification-review-result.py \
  --matrix-result /path/to/e4a4-matrix-result.json \
  --handoff-results-dir /path/to/e4a6-verify-results \
  --result /path/to/independent-qualification-review.json \
  --require-qualification-recommendation
```

Exit status meanings:

- `0`: structurally valid result; with `--require-qualification-recommendation`, reviewer recommendation is eligible for the later explicit checkpoint;
- `1`: malformed, wrong-scope, missing/mismatched run binding, non-independent, or otherwise invalid result;
- `2`: structurally valid external result, but reviewer does not currently recommend qualification.

## Synthetic CI boundary

Repository CI may generate fake matrix/handoff/reviewer JSON only to test this parser and fail-closed policy. Such fixtures are **not** physical evidence. They do not prove that electricity was removed, do not qualify any storage/controller stack, and must never be attached to issue #138 as acceptance evidence.

## Remaining gate

Issue #138 remains OPEN until all five real experiments exist, their E4a6 verification results and E4a4 matrix are preserved, an independent reviewer evaluates the raw evidence, this result verifier accepts the returned review, and a later explicit reviewed checkpoint records the final qualification state.

Until then `physicalPowerLossQualified=false`, `strict-pq` remains OFF, and production rollout remains NOT AUTHORIZED.
