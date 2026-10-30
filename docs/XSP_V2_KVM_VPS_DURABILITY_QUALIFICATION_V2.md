# XSP-v2 KVM VPS durability qualification v2

Status: **versioned acceptance policy for real KVM guest crash-consistency evidence; non-activating**.

This v2 profile exists because the real operator-facing KVM runner was added to XMesh-Node after the reviewed v5 production runtime target was frozen. It preserves that runtime target exactly while binding the later qualification-only tooling revision separately.

The original v1 contract, verifier and v5 review bundle remain historical and are not rewritten or reinterpreted.

## Exact binding

Production runtime target:

- Nexus: `12b3170996bc062ee16c79659a6378e5e425fd0e`
- Node: `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`

Qualification tooling:

- Node revision: `3e3b5aa80d3d3e6b3729805ea6cb3092f3103abb`
- runtime base revision: `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`
- runner: `security/xspv2/poc-go/cmd/xspv2-kvm-qualify/main.go`
- required build tag: `xspv2_powercut_qualification`

The delta from the runtime Node revision to the tooling revision is restricted to the five qualification-only files listed in the v2 contract. CI verifies that exact path set and proves the normal Agent built from the tooling revision still excludes the qualification marker/control strings.

This separation means a result must not pretend the production runtime revision itself contained the operator runner. The result records both revisions and the SHA-256 of the exact runner binary used for the real runs.

## Exact Node binding

A completed result contains one positive `subjectNodeId`, and every run must use that same Node ID. The operator must pass the real Node ID to the runner:

```bash
./xspv2-kvm-qualify arm \
  --run-id <UNIQUE_RUN_ID> \
  --checkpoint <CHECKPOINT> \
  --node-id <REAL_NODE_ID>
```

A crash matrix executed with a placeholder Node ID is useful diagnostic evidence but is not accepted as the final issue-#138 result unless that placeholder is in fact the real Node ID.

## Five required real crash cycles

The required matrix remains unchanged:

1. `after-previous` → `previous-complete`
2. `after-floor` → `next-complete`
3. `after-active` → `next-complete`
4. `after-recovery-abort` → `previous-complete`
5. `after-recovery-active` → `next-complete`

Allowed crash methods remain `provider-hard-stop` and `guest-kernel-panic`. Ordinary shutdown/reboot, process or service restart, container restart and snapshot rollback do not qualify.

## Evidence bundle

The v2 result binds the preserved raw evidence archive with:

- `evidenceBundle.archiveName`
- `evidenceBundle.archiveSha256`

It also binds the exact qualification runner with `qualificationTooling.binarySha256`.

Each run still requires:

- unique run ID and checkpoint;
- crash method plus SHA-256 of preserved provider-event/crash-trigger evidence;
- different pre/post Linux boot IDs;
- the exact subject Node ID;
- from/to epoch and Ed25519/ML-DSA-65 key identities;
- exact expected complete post-boot identity;
- Agent security-state SHA-256;
- `networkAttemptedBeforeValidation=false`;
- PostgreSQL recovery observed and integrity checks passed;
- `fsync=on`, `full_page_writes=on`, accepted `synchronous_commit`, and non-empty WAL sync method;
- PostgreSQL security-tuple SHA-256;
- off-host monotonic recovery-floor checkpoint and receipt SHA-256 values.

All five run IDs and crash-evidence hashes must be unique.

## Provider storage boundary

The result must explicitly record the VPS provider and storage class, use:

`storageTrustBoundary=provider-managed-block-storage`

and include attributable, timestamped release-owner risk acceptance for:

`providerStorageDurabilityAssumed=true`.

The accepted risk statement acknowledges reliance on the provider honoring durable guest block-device flush semantics. It does not claim physical host/controller/PLP testing.

## Verification

Contract:

`deploy/xsp-v2-kvm-vps-durability-qualification-v2.contract.json`

Verifier:

```bash
python3 scripts/verify-xsp-v2-kvm-vps-durability-v2.py \
  --result /path/to/kvm-vps-five-run-result-v2.json
```

A successful result reports:

```text
status=kvm-vps-durability-qualified-for-release-gate
guestCrashConsistencyQualified=true
providerStorageDurabilityAssumed=true
physicalPowerLossQualified=false
productionDurabilityGateEligible=true
productionActivation=false
strictPQEnabled=false
```

The verifier also reports the bound runtime Node revision, qualification tooling revision, subject Node ID, evidence archive SHA-256 and matrix SHA-256.

## Relationship to frozen v5 review evidence

The v5 review bundle remains immutable evidence for its exact contents. This v2 qualification policy does not alter that historical bundle. Before an independent review is accepted for a release candidate, the later qualification-tooling binding and any resulting accepted evidence must be included in a new reviewed checkpoint/package rather than silently attributed to v5.

## Production boundary

Passing this verifier does **not** enable `strict-pq` and does **not** authorize production activation. The expected claims remain:

```text
guestCrashConsistencyQualified=true
providerStorageDurabilityAssumed=true
physicalPowerLossQualified=false
productionActivation=false
strictPQEnabled=false
```

Independent review, exact-candidate canary, reviewed rollout/rollback approval, bounded strict-PQ approval and separate production execution remain distinct later gates.
