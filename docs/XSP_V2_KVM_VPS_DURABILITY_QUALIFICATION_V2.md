# XSP-v2 KVM VPS durability qualification v2

Status: **versioned, topology-aware acceptance policy for real KVM durability evidence; non-activating**.

This v2 profile exists for two reasons:

1. the operator-facing KVM runner was added to XMesh-Node after the reviewed v5 production runtime target was frozen;
2. the deployed architecture uses **separate failure domains** for XMesh-Node and Nexus/PostgreSQL, so a Node VPS hard stop cannot honestly be claimed as a PostgreSQL recovery event.

The original v1 contract/verifier and the frozen v5 review bundle remain historical evidence and are not rewritten or reinterpreted.

## Exact source binding

Production runtime target:

- Nexus: `12b3170996bc062ee16c79659a6378e5e425fd0e`
- Node: `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`

Qualification tooling:

- Node revision: `3e3b5aa80d3d3e6b3729805ea6cb3092f3103abb`
- runtime base revision: `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`
- runner: `security/xspv2/poc-go/cmd/xspv2-kvm-qualify/main.go`
- required build tag: `xspv2_powercut_qualification`

The delta from the runtime Node revision to the qualification revision is restricted to the five qualification-only files listed in the v2 contract. CI verifies that exact delta and proves the normal Agent binary excludes qualification controls.

A real result records both Node revisions and the SHA-256 of the exact qualification binary.

## Topology boundary

The production topology is represented explicitly:

- `nodeStateScope=isolated-qualification-keyring`;
- Node and Nexus/PostgreSQL have different failure-domain identifiers;
- the five Node hard-stop cycles qualify the Node keyring implementation on the actual subject Node host;
- PostgreSQL crash/recovery is qualified independently on the Nexus/PostgreSQL host;
- the production off-host monotonic floor is verified independently using the existing `xsp-v2-recovery-checkpoint verify` tool.

The manual KVM runner intentionally never touches the production Agent vault. Therefore its temporary epoch/key IDs are **qualification state**, not production Node key IDs. V2 does not compare those temporary epochs to the production off-host floor.

This is a composition of three independent evidence domains, not a claim that one VPS power event crashed all components.

## Exact subject Node binding

A completed result contains one positive `subjectNodeId`, and every Node crash run must use that same Node ID.

For the current qualification host the confirmed panel Node ID is `13`. The exact qualification binary currently built from the pinned tooling revision has SHA-256:

`4dae3081d270a721d5f91265063327e130c2a9fe7c2a959847bf363adc7edab2`

Those values are evidence inputs, not hard-coded contract constants; a final result must bind the exact values actually used.

The operator command shape is:

```bash
./xspv2-kvm-qualify arm \
  --run-id <UNIQUE_RUN_ID> \
  --checkpoint <CHECKPOINT> \
  --node-id <REAL_NODE_ID>
```

A matrix run with a placeholder Node ID is diagnostic only and is not accepted as the final issue-#138 result unless the value is the real Node ID. The already-completed `node-id=1` five-run matrix is therefore retained as diagnostic crash-consistency evidence, not as the final #138 Node matrix.

## A. Five required real Node crash cycles

The Node matrix is:

1. `after-previous` → `previous-complete`
2. `after-floor` → `next-complete`
3. `after-active` → `next-complete`
4. `after-recovery-abort` → `previous-complete`
5. `after-recovery-active` → `next-complete`

Each run requires:

- unique run ID and exact checkpoint;
- allowed crash method (`provider-hard-stop` preferred, `guest-kernel-panic` fallback);
- SHA-256 of preserved crash-trigger/provider-event evidence;
- different pre/post Linux boot IDs;
- exact subject Node ID;
- from/to qualification epoch and Ed25519/ML-DSA-65 key IDs;
- exact expected complete post-boot identity;
- qualification security-state SHA-256;
- `networkAttemptedBeforeValidation=false`.

All five run IDs and crash-evidence hashes must be unique.

Ordinary shutdown/reboot, process/service/container restart and snapshot rollback do not qualify.

## B. Independent Nexus/PostgreSQL crash recovery

Because PostgreSQL is not on the Node VPS, v2 requires a separate real crash/recovery record from the Nexus/PostgreSQL failure domain.

That record must contain:

- the same `subjectNodeId` whose XSP-v2 security tuple is being checked;
- an allowed abrupt crash method and preserved crash-evidence SHA-256;
- a separate evidence-record SHA-256;
- different Nexus-host pre/post boot IDs;
- `recoveryObserved=true`;
- `integrityChecksPassed=true`;
- `fsync=on`;
- `full_page_writes=on`;
- accepted `synchronous_commit` (`on`, `remote_apply`, or `remote_write`);
- non-empty `wal_sync_method`;
- SHA-256 of the subject Node's security tuple before and after recovery.

The before/after security-tuple digests must be identical. The PostgreSQL crash-event digest must also be distinct from every Node crash-event digest, proving that the result does not reuse one event across different failure domains.

## C. Independent production off-host witness

V2 separately binds the real production recovery floor for the subject Node.

The result records:

- Node ID;
- SHA-256 of the preserved off-host checkpoint;
- SHA-256 of the embedded authoritative receipt;
- SHA-256 of the `xsp-v2-recovery-checkpoint verify` output;
- `verificationStatus=verified`;
- `minimumEpoch`;
- independently validated production `localEpoch`.

The verifier requires `localEpoch >= minimumEpoch` and exact Node identity. This witness is production state; it is intentionally not derived from the isolated qualification keyring.

## Evidence bundle

The final result binds one preserved aggregate archive with:

- `evidenceBundle.archiveName`;
- `evidenceBundle.archiveSha256`.

The archive should contain the five Node run manifests/post-boot records, five preserved Node crash-event records, the independent PostgreSQL crash/recovery record and raw crash evidence, the off-host checkpoint and verification result, and operator/provider risk-acceptance material.

The diagnostic archive already produced from the placeholder-Node matrix has SHA-256:

`4300f3028a68ef03e2c52b45966fe0709e0d0a82caf564b888dd53d0edc1e8af`

It must remain labelled diagnostic and must not be substituted for the final aggregate archive.

## Provider storage boundary

Because Node and Nexus/PostgreSQL are separate failure domains, provider-storage trust is recorded for both:

- `providerStorage.node`;
- `providerStorage.nexusPostgres`.

Each record names the provider and storage class, uses:

`storageTrustBoundary=provider-managed-block-storage`

and contains attributable, timestamped release-owner acceptance of:

`providerStorageDurabilityAssumed=true`.

The risk statement acknowledges reliance on the provider honoring durable guest block-device flush semantics. It does not claim physical host/controller/PLP testing.

## Verification

Contract:

`deploy/xsp-v2-kvm-vps-durability-qualification-v2.contract.json`

Verifier:

```bash
python3 scripts/verify-xsp-v2-kvm-vps-durability-v2.py \
  --result /path/to/kvm-vps-durability-result-v2.json
```

A successful result reports:

```text
status=kvm-vps-durability-qualified-for-release-gate
topologyAware=true
nodeCrashMatrixQualified=true
postgresCrashRecoveryQualified=true
offhostProductionWitnessVerified=true
guestCrashConsistencyQualified=true
providerStorageDurabilityAssumed=true
physicalPowerLossQualified=false
productionDurabilityGateEligible=true
productionActivation=false
strictPQEnabled=false
```

CI fixtures exercise parser/policy behavior only and are never real production qualification evidence.

## Relationship to frozen v5 review evidence

The v5 review bundle remains immutable evidence for its exact contents. This v2 policy does not alter that historical bundle. The later qualification-tooling binding and any accepted real evidence must be included in a new reviewed checkpoint/package before an independent review can authorize a release candidate.

## Production boundary

Passing this verifier does **not** enable `strict-pq` and does **not** authorize production activation.

Expected claims remain:

```text
guestCrashConsistencyQualified=true
providerStorageDurabilityAssumed=true
physicalPowerLossQualified=false
productionActivation=false
strictPQEnabled=false
```

Independent review, exact-candidate canary, reviewed rollout/rollback approval, bounded strict-PQ approval and separate production execution remain distinct later gates.
