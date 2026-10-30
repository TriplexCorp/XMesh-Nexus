# XSP-v2 KVM VPS strict-PQ activation approval

Status: **non-executing production authorization gate for `deploymentClass=kvm-vps`**.

This gate replaces the bare-metal `physicalPowerQualificationAccepted` prerequisite only for the KVM VPS deployment class. It does not claim physical host/storage qualification and never enables strict-PQ itself.

## Required runtime target

The current KVM durability-qualified runtime target is fixed at:

- Nexus runtime `12b3170996bc062ee16c79659a6378e5e425fd0e`;
- Node `34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb`.

Any security-relevant runtime change invalidates this target and requires a new KVM five-run qualification before activation approval.

## Required evidence

An approval is eligible only when all of the following are explicitly true and bound by SHA-256:

1. independent security review accepted;
2. KVM VPS five-run durability qualification accepted;
3. provider block-storage durability risk explicitly accepted;
4. exact-candidate final canary passed;
5. rollout/rollback plan independently reviewed.

The old v1 rollout-plan verifier may still be used for structural plan validation without `--require-gate-eligible`; its bare-metal `physicalPowerQualificationAccepted` field is not reused or lied about for KVM. The KVM approval gate owns the deployment-class-specific durability prerequisite and binds the reviewed plan/result hashes directly.

## Transport and scope policy

The approval cannot weaken:

- TLS 1.3 only;
- `X25519MLKEM768` key exchange;
- ML-DSA-65 client identity;
- Ed25519 **AND** ML-DSA-65 critical-message signatures;
- `automaticFallback=false`;
- `classicalOnlyAllowed=false`.

One approval is bounded to:

- `limited-canary` or `phased` mode;
- at most 50 named Nodes;
- at most 24 hours;
- release-owner authority;
- `strictPqAction=enable`;
- `legacyXMESH1Action=retain`.

## Pre-execution claims

Even a fully eligible approval must still contain:

```text
productionActivation=false
strictPQEnabled=false
legacyXMESH1Retired=false
physicalPowerLossQualified=false
```

The verifier returns `requiresSeparateExecution=true`. Approval is authorization for a later execution step, not the execution itself.

## Verification

Contract:

`deploy/xsp-v2-kvm-vps-strict-pq-activation-approval.contract.json`

Verifier:

```bash
python3 scripts/verify-xsp-v2-kvm-vps-strict-pq-activation-approval.py \
  --approval /path/to/kvm-vps-activation-approval.json
```

A positive result is `kvm-vps-strict-pq-approval-eligible` and still reports `strictPQEnabled=false` and `productionActivation=false`.

## Relationship to bare metal

The original strict-PQ approval contract remains the bare-metal profile and continues to require accepted physical-power qualification. This KVM-specific contract does not weaken or reinterpret that profile; it defines a separate production path for VPS deployments where the physical storage boundary belongs to the provider.
