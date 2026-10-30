# XSP-v2 KVM VPS durability qualification

Status: **deployment-class-specific qualification policy for `kvm-vps`; non-executing tooling**.

This profile exists for deployments where the operator controls a KVM guest but does not control the physical host, BMC/PDU, storage controller, write cache or power-loss protection. It does not reinterpret a guest crash as physical power loss.

## Security boundary

For `deploymentClass=kvm-vps` the production durability claim is split explicitly:

- XMesh qualifies **guest-visible crash consistency** of the current Agent/PostgreSQL security state;
- the VPS provider owns physical host and block-storage durability;
- provider-managed block storage is an explicit external trust boundary;
- `providerStorageDurabilityAssumed=true` must be accepted by the release owner;
- `physicalPowerLossQualified=false` remains true for this deployment class.

The current runtime target is:

- Nexus `12b3170996bc062ee16c79659a6378e5e425fd0e`;
- Node `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`.

The Node target includes the master-key parent-directory durability remediation from PR #52.

## Five required crash-consistency runs

One real guest crash cycle is required at each existing durability checkpoint:

1. `after-previous` → `previous-complete`;
2. `after-floor` → `next-complete`;
3. `after-active` → `next-complete`;
4. `after-recovery-abort` → `previous-complete`;
5. `after-recovery-active` → `next-complete`.

The preferred method is `provider-hard-stop`: use the VPS provider's hard-stop/reset operation if it is explicitly documented as terminating the VM without an orderly guest shutdown.

If no such provider operation is available, the profile permits `guest-kernel-panic`. That exercises abrupt guest failure and recovery but is **not** equivalent to host power loss. The result remains scoped to KVM guest crash consistency and still relies on the provider for durable block-storage semantics.

Ordinary `shutdown`, `reboot`, service restart, process kill, container restart or snapshot rollback do not satisfy this five-run profile.

## Evidence per run

Each run records:

- unique run ID and one exact checkpoint;
- exact crash method and SHA-256 of the preserved crash trigger/provider event evidence;
- different pre/post boot IDs;
- exact Node ID and from/to epoch/key identities;
- expected complete post-boot state only;
- digest of recovered Agent security state;
- explicit `networkAttemptedBeforeValidation=false`;
- PostgreSQL recovery/integrity evidence with `fsync=on`, `full_page_writes=on` and accepted `synchronous_commit`;
- exact PostgreSQL security-tuple digest;
- off-host monotonic recovery-floor checkpoint and receipt digests.

The five crash-evidence hashes and run IDs must be unique.

## Provider storage risk acceptance

A KVM result must name the provider/storage class and contain an attributable, timestamped risk acceptance statement. The accepted statement means only:

> XMesh cannot independently test the provider's physical host/controller/PLP boundary from inside this VPS; production therefore relies on the provider honoring durable guest block-device flush semantics.

It does not waive Agent/PostgreSQL crash-consistency checks. Those still have to pass all five checkpoints.

## Result verification

The result schema is `xsp2-kvm-vps-durability-qualification-result-1` and the contract is:

`deploy/xsp-v2-kvm-vps-durability-qualification.contract.json`

Verify a completed five-run result with:

```bash
python3 scripts/verify-xsp-v2-kvm-vps-durability.py --result /path/to/kvm-vps-five-run-result.json
```

A successful verifier result contains:

```text
status=kvm-vps-durability-qualified-for-release-gate
deploymentClass=kvm-vps
guestCrashConsistencyQualified=true
providerStorageDurabilityAssumed=true
physicalPowerLossQualified=false
productionDurabilityGateEligible=true
productionActivation=false
strictPQEnabled=false
```

CI fixtures only exercise parser/policy behavior and are never real qualification evidence.

## Relationship to bare metal

The existing E4a physical-power profile remains available for bare-metal deployments with real BMC/PDU/controller access. It is stronger with respect to physical storage/controller behavior and must not be represented as complete merely because the KVM profile passed.

Conversely, a KVM VPS is not blocked on impossible access to provider hardware. Its release gate requires the KVM result instead of the bare-metal `physicalPowerLossQualified` result.

## Production boundary

Completing this five-run result does not switch PQ on. Production still requires the applicable independent security review, exact-candidate final canary, reviewed rollout/rollback plan, bounded strict-PQ approval and a separate execution step.

Until those later gates are satisfied, `strict-pq` remains **OFF** and production activation remains **NOT AUTHORIZED**.
