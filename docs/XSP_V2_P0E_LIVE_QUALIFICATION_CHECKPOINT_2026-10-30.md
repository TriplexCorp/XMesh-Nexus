# XSP-v2 P0-E live qualification checkpoint — 30 October 2026

Status: **operator/session handoff for the current P0-E qualification work**.

This file records checks and evidence that were actually completed so a later session can resume without reconstructing state from chat history. It is not an activation record and does not close #137 or #138.

## Mandatory current boundary

```text
independentSecurityReviewComplete=false
guestCrashConsistencyQualified=false
physicalPowerLossQualified=false
strictPQEnabled=false
productionActivation=false
```

`strict-pq` remains OFF. Production activation remains NOT AUTHORIZED.

## Repository checkpoint

Current Nexus checkpoint after the latest qualification-policy merges:

```text
328da4bea1340201a0a0ab290583c3016b747be7
```

Completed repository work:

- PR #172 — protected owner-authenticated cutover permit operator; merge `c00c6dcf1dba0ef923dd23371bc17b9dec781602`.
- PR #173 — explicit permit-tooling source/binary binding; merge `47aca1fd65dc47498bc7faa5b9d79adc102b41b8`.
- PR #171 — topology-aware KVM VPS durability qualification v2; merge `328da4bea1340201a0a0ab290583c3016b747be7`.

Observed CI:

```text
PR #172 protected-permit workflow  41091525656  PASS
PR #172 Backend CI                 41091525617  PASS
PR #173 permit-tooling binding     41093671646  PASS
PR #173 Backend CI                 41093671628  PASS
PR #171 KVM durability v2          41061676309  PASS
PR #171 Backend CI                 41061676241  PASS
```

These are tooling/policy checks, not substitutes for real #137/#138 evidence.

## Frozen reviewed runtime

The reviewed production runtime target remains unchanged:

```text
XMesh-Nexus 12b3170996bc062ee16c79659a6378e5e425fd0e
XMesh-Node  34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb
```

Later permit and qualification code is separately bound as staging/qualification tooling. It does not redefine this runtime target.

## Independent-review package v5

Authoritative review-package identity:

```text
re-freeze merge                  dd9fe0e1fe0358d9ce6e8e595c80685eb153b533
workflow run                     41054352179
artifact ID                      12974974581
payload SHA-256                  7b118084777d59e1ef1791d6375c32c1c44cf6bcdf9a03a2b0648a7ad9f263f2
deterministic inner tar SHA-256  9d213e9281f0ffbbc3da21f9f3814d6e7fbef1e6b5273f6e9cb12175c63273c4
```

### #137

**OPEN.** A real attributable independent reviewer must still complete the required review. Project-owner review, AI review, CI, synthetic fixtures, or package generation do not satisfy #137.

## #138 topology-aware qualification model

PR #171 records the real topology correctly:

- Node and Nexus/PostgreSQL are separate failure domains;
- five Node abrupt-crash runs qualify the isolated Node qualification keyring;
- PostgreSQL crash/recovery is evidenced independently;
- the production off-host recovery floor is evidenced independently;
- provider-managed storage is an explicit external trust boundary;
- `physicalPowerLossQualified=false` remains correct for the KVM class.

Node qualification tooling binding:

```text
Node tooling revision            3e3b5aa80d3d3e6b3729805ea6cb3092f3103abb
Node runtime base                34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb
qualification binary SHA-256     4dae3081d270a721d5f91265063327e130c2a9fe7c2a959847bf363adc7edab2
subject Node ID                  13
```

## #138 A — five real Node crash runs: COMPLETE

All five required checkpoints were executed with the real subject Node ID, unique crash evidence, changed boot identity, expected post-boot classification, and no network attempt before local validation.

| Checkpoint | Outcome | Evidence SHA-256 |
| --- | --- | --- |
| `after-previous` | `previous-complete` | `726d06d7757dd1a2e46d96a106d5a78144d780a5ab883da255d5b487c724263d` |
| `after-floor` | `next-complete` | `73ef32336d6190e636f322d5e4dbe320ddd0168c2aa4fc813d585b94fb45ad72` |
| `after-active` | `next-complete` | `1719e950bf40104980c4f0bb46f2034aa0ab3dfc0b1cc071f590a7e2c1e064f9` |
| `after-recovery-abort` | `previous-complete` | `aa5fe427c4cc360aa654f522bb16698872558e1c6176fd2a8244d9b6eb7404d3` |
| `after-recovery-active` | `next-complete` | `9c52db6d5d14a95962044e1ba148339d3714279ac0482dba50a830748b2ab428` |

Canonical five-run material already transferred to the Nexus qualification side:

```text
nodeRuns JSON SHA-256
019c88d1d8c40f5803da746cfb8e6f881eee0c4070992b215209b3e9ac50dac0

five-run bundle SHA-256
27ee2b275efef60052c70b2c5f771422f61eedb2e105a6e90501d01503e60e31
```

Receiving-side validation reported all five checkpoint/outcome pairs as PASS.

### Evidence preserved but not accepted for final #138

Earlier placeholder-identity diagnostic matrix:

```text
4300f3028a68ef03e2c52b45966fe0709e0d0a82caf564b888dd53d0edc1e8af
```

Earlier orderly-shutdown attempt, preserved but not counted as an abrupt-crash run:

```text
1ceb3026fd8738b8a59fa70fd828bc46ba946015f499c0822e29c4a41ee00e06
```

Do not substitute either for the accepted five-run matrix.

## #138 B — independent PostgreSQL crash/recovery: COMPLETE

A real abrupt provider event was executed on the separate Nexus/PostgreSQL failure domain. PostgreSQL automatic recovery was observed, durability settings remained valid, logical integrity checks passed, and the subject security tuple digest was unchanged across recovery.

Canonical evidence:

```text
provider crash evidence SHA-256
577703599b4426096a599c26380871e724756553db1a17460e7bba6d68f2d66e

full crash/recovery archive SHA-256
21996209bbae7edf240f66e5066cfffb5912446f33167425d1c0e7196d177433

postgresCrashRecovery JSON SHA-256
2d5bae53da3b31f77bce79c09848e0cfba121d8b0c1602c818d364a45f1d4040

security tuple SHA-256 before/after
c35df84ea54b5efb7203103ed5d769770db6ffc39fd8a4f974b452ec9ed65be5

pg_dump SHA-256
c3248e07ddcd2d9f34533779568e8153171017d68dc4490e5bd7ce6a7326e709

pg_restore list SHA-256
a6ead15fb74ebcc1ea803f471c37b9f60323bbf65e2fa1fff604573b528c0fdf
```

This completes the independent PostgreSQL subcomponent only; #138 remains OPEN.

## Production cutover preparation state

A production-path next-epoch candidate has been prepared locally without changing the active committed epoch/floor. Candidate/public preparation artifacts were frozen and copied to the Nexus qualification side.

Important resume rule: **do not regenerate the prepared candidate merely to restart the workflow.** Preserve the existing private state and evidence.

The current checkpoint does not claim that the owner rotation prepare/proof, real protected permit issuance, production ACK/epoch commit, or immutable commit receipt has completed. Treat those boundaries as pending unless newer evidence exists.

## Protected permit tooling: repo-side COMPLETE, live evidence PENDING

PR #172 added the isolated signer/operator boundary and PR #173 bound that tooling explicitly to the reviewed runtime.

Binding identity:

```text
reviewed Nexus runtime           12b3170996bc062ee16c79659a6378e5e425fd0e
tooling base                     40d146fd3c24888cf65fa83333bdb376d0572439
permit tooling revision          c00c6dcf1dba0ef923dd23371bc17b9dec781602
binding merge                    47aca1fd65dc47498bc7faa5b9d79adc102b41b8
```

The real live signer/operator binary hashes have not yet been recorded in this checkpoint. The next live evidence step is to build the exact bound tooling, freeze the binary/build hashes, and pass the merged binding verifier without mutating production state.

## #138 C — off-host production recovery witness: PENDING

A genuine committed production receipt must exist first. Then a real independently preserved off-host recovery checkpoint and verification result must be created and hashed.

Required final fields include:

```text
nodeId
checkpointSha256
receiptSha256
verificationResultSha256
verificationStatus=verified
minimumEpoch
localEpoch >= minimumEpoch
```

This evidence must be independent of the same failure domain being protected.

## #138 D — provider-storage risk acceptance: PENDING

Separate attributable risk-acceptance records are still required for Node storage and Nexus/PostgreSQL storage. Real provider/storage facts and a real accepting actor/timestamp must be used; do not infer or fabricate them.

## Remaining sequence before #138 COMPLETE

1. Freeze and verify the real bound permit-tooling binaries/build evidence.
2. Complete owner approval and dual proof for the already prepared production candidate.
3. Provision the protected signer and least-privilege DB boundaries through reviewed paths.
4. Issue the real dual-signed cutover permit.
5. Complete the permitted Node transition and real applied ACK path.
6. Atomically commit the ACK/epoch transition in Nexus/PostgreSQL.
7. Produce and durably store the real immutable dual-signed commit receipt.
8. Create and independently preserve/verify the off-host recovery checkpoint.
9. Obtain the two provider-storage risk-acceptance records.
10. Assemble the final v2 result and aggregate evidence archive.
11. Run the merged topology-aware v2 verifier against the real result.

Only a full real verifier PASS permits these #138 release-gate claims:

```text
guestCrashConsistencyQualified=true
providerStorageDurabilityAssumed=true
productionDurabilityGateEligible=true
```

Even after that:

```text
physicalPowerLossQualified=false
strictPQEnabled=false
productionActivation=false
```

## Resume instructions

For a new session:

1. read this file and `docs/ENTERPRISE_ROADMAP.md`;
2. inspect current `main` before assuming the recorded repository SHA is still HEAD;
3. preserve all existing evidence artifacts;
4. do not regenerate or overwrite private production state merely to make a check pass;
5. continue from the first PENDING boundary above;
6. keep `strict-pq` OFF and production activation unauthorized until the later release sequence explicitly reaches a separate execution step.

If later work advances the state, create a newer dated checkpoint or update the authoritative status instead of silently reinterpreting this historical evidence.