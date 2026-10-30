# XSP-v2 P0-E independent security-review handoff — v5 KVM VPS

Status: **review-preparation / v5 evidence freeze only**. This handoff does not perform or replace an independent security review, does not qualify real KVM crash evidence, does not enable `strict-pq`, and does not authorize production.

## Frozen runtime target

v5 keeps the security-remediated v4 runtime target unchanged:

- XMesh-Nexus runtime: `12b3170996bc062ee16c79659a6378e5e425fd0e`;
- XMesh-Node runtime: `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`.

The runtime did not change between v4 and v5. The reason for a new review freeze is a **material release-control policy change**, not new production runtime code.

## Why v5 exists

The deployment environment for the current production path is a KVM VPS. The operator does not control the provider's physical host, BMC/PDU, storage controller, write cache or PLP boundary. Requiring the bare-metal E4a physical-power qualification as the only production durability gate was therefore impossible to satisfy without changing infrastructure.

PR #166 / merge `af87c9e99c8ab358a87c36120ff121b4b5275653` first rebound the retained bare-metal E4a preparation tooling to the remediated Node PR #52 target. Historical PR #44/#45 revisions remain provenance only.

PR #167 / merge `9bc592c875058f213da38d4565ab77dad015461c` then added a separate `deploymentClass=kvm-vps` release path. This path does **not** reinterpret a guest crash as physical power loss.

## KVM durability boundary

For `deploymentClass=kvm-vps` the release model is:

- XMesh qualifies guest-visible Agent/PostgreSQL crash consistency at all five existing durability checkpoints;
- preferred crash method is a provider hard-stop/reset that does not perform orderly guest shutdown;
- `guest-kernel-panic` is an allowed fallback when no provider lifecycle primitive is available;
- provider-managed block storage is an explicit external trust boundary;
- release-owner acceptance of that provider-storage risk is mandatory;
- `guestCrashConsistencyQualified=true` may be claimed only after the real five-run result passes the KVM verifier;
- `physicalPowerLossQualified=false` remains mandatory for this KVM deployment class.

The independent reviewer must evaluate whether this trust-boundary split is appropriate and whether the KVM five-run evidence contract is sufficient for the stated deployment class.

## Bare-metal profile remains separate

The physical E4a profile remains available for bare-metal deployments with real BMC/PDU/controller/PLP control. Passing the KVM profile does not complete or weaken that profile.

Likewise, the KVM production path must never set the old `physicalPowerQualificationAccepted=true` field merely to satisfy a bare-metal gate. PR #167 adds a separate bounded KVM strict-PQ approval verifier instead.

## KVM activation policy

A KVM strict-PQ approval can become eligible only with all of:

1. accepted independent security-review evidence;
2. accepted KVM five-run durability result;
3. explicit provider-storage risk acceptance;
4. exact-candidate final canary result;
5. independently reviewed rollout/rollback plan.

It retains the same cryptographic/transport invariants:

- TLS 1.3 only;
- `X25519MLKEM768` key exchange;
- ML-DSA-65 client identity;
- Ed25519 **AND** ML-DSA-65 critical-message signatures;
- `automaticFallback=false`;
- `classicalOnlyAllowed=false`;
- maximum 50 named Nodes per approval;
- maximum 24-hour approval window;
- `strictPqAction=enable` with `legacyXMESH1Action=retain`.

Even an eligible approval remains non-executing and reports:

```text
productionActivation=false
strictPQEnabled=false
legacyXMESH1Retired=false
physicalPowerLossQualified=false
requiresSeparateExecution=true
```

## Mandatory review domains

The external reviewer must still cover all eleven domains:

1. protocol and canonicalization;
2. hybrid cryptography and key-purpose binding;
3. PQ-only transport and Node identity;
4. isolated signer and key custody;
5. PostgreSQL replay / ACK / epoch / receipt transactionality;
6. Agent local durability and rollback;
7. coordinated backup/restore and off-host recovery floor;
8. owner-authorized key retirement;
9. parser fuzzing and external ML-DSA-65 verification vectors;
10. default-off redacted observability;
11. production migration, no-fallback and rollback architecture.

For v5, domains 6 and 11 must explicitly review:

- the KVM five-checkpoint crash-consistency model;
- the provider-managed block-storage trust assumption;
- the fact that guest kernel panic is weaker than provider hard-stop and neither proves physical host power-loss behavior;
- the separation between KVM and bare-metal qualification profiles;
- the KVM-specific strict-PQ approval gate and its prohibition on pretending physical qualification is true.

Domains 3 and 6 must also retain the v4 remediation review for `AI-LOW-001` and `AI-LOW-002`.

## Evidence packaging

The machine contract is:

`deploy/xsp-v2-p0e-security-review-handoff-v5.contract.json`

The v5 bundle contains:

- complete source archives of the unchanged runtime target `12b317… + 34d3d7…`;
- source evidence from the frozen Nexus runtime revision;
- post-runtime control evidence from the current branch, including the remediated E4a bindings and the KVM durability/activation policy;
- deterministic hashes and manifest metadata.

Post-runtime control evidence is intentionally kept separate from the runtime source archives so the reviewer can distinguish code under execution from later release policy.

## Required external result

A closure-eligible #137 result must bind this v5 package, identify an attributable independent reviewer, cover all eleven domains, disposition all findings, and explicitly review the KVM deployment-class policy above.

Any later security-relevant runtime change or material release-control change invalidates the affected v5 scope and requires another freeze/re-review.

## External blockers

Two production blockers remain:

- **#137** — independent external security review/sign-off for this v5 scope;
- **#138** — five real KVM VPS crash-consistency runs on the current target plus explicit provider-storage risk acceptance.

Until they and the later exact-candidate release gates are satisfied:

```text
independentSecurityReviewComplete=false
guestCrashConsistencyQualified=false
providerStorageDurabilityAssumed=false
physicalPowerLossQualified=false
productionActivation=false
strictPQEnabled=false
```

`strict-pq` remains OFF and XMESH1 remains retained.
