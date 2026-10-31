# XMesh Nexus — Enterprise Roadmap

## Authoritative engineering status — 31 October 2026

XSP-v2 P0-E has reached a real bounded production activation on canary Node 13.

Current authoritative state:

```text
P0-C2-D = COMPLETE
P0-D = COMPLETE
P0-E bounded Node 13 production activation = COMPLETE

productionActivation=true
strictPQEnabled=true
nodeId=13
minimumEpoch=2
legacyXMESH1Retired=false
physicalPowerLossQualified=false
automaticFallback=false
classicalOnlyAllowed=false
```

The production claim is deliberately narrow. It applies to Node 13 only and does not authorize an automatic fleet-wide rollout.

## Frozen production target

Reviewed production runtime target:

- **XMesh-Nexus:** `a1267ae186f74d5e21561e3b64fc7375d499132e`;
- **XMesh-Node:** `64709ce8f5f0ce80e2c0bab59b4476347825e57c`;
- **Nexus runtime manifest/image binding:** `sha256:af27a110220f98880dc539141d614683741a05fbd3afd30792819b3192b9ef45`;
- **approved production Agent artifact:** `a5f8e739b381640e4ac1d632dfef47d879ebc4c6ce7c4fbd8fab5744ad9cdd63`.

Later release-control/tooling commits are allowed only while the frozen runtime build inputs remain byte-identical to this target.

## P0-E completed release gates

### Durability / qualification

- Node KVM abrupt-crash matrix: **COMPLETE 5/5**;
- independent Nexus/PostgreSQL crash/recovery: **COMPLETE**;
- off-host monotonic recovery witness: **COMPLETE**;
- provider-storage risk acceptance: **COMPLETE**;
- topology-aware KVM VPS verifier: **PASS**;
- `physicalPowerLossQualified=false`: preserved as the correct deployment-class claim.

Canonical KVM durability result SHA-256:

`fd8ef8e680e999bb95ef5b081806eb24a32f1537a7d1f6cd678ecd41591c6a0f`

Provider-storage risk acceptance SHA-256:

`49a311a8bf871c6afcaa5841622b9f1e28e74675452671abc4e970f644dec604`

### Security / governance

The accepted release governance is:

**AI-assisted internal review + explicit release-owner risk acceptance.**

It must not be represented as an independent external audit.

- AI-assisted security review v6 result SHA-256: `2efb039f6581eb50b52c3b0f34c2d44cc320fbf2e1883f472e047746cfcba1a5`;
- #137: **CLOSED** under the replacement governance policy;
- rollout/rollback plan review: **COMPLETE**.

### Final release candidate / canary

- final canary v3: **PASS**;
- final canary result SHA-256: `ef8beb21746890ad5169b71e7a8d937b6043519513e6381471c0f6d11d62f287`;
- rollout plan SHA-256: `7ce7a159b2851dd1a55f5f2810d43aeaf5a70e73dc4e0f886c975f55b2f65364`;
- rollout review SHA-256: `93ee69fe8caca8846368865cf8d141ab96cf6e521f2cce5dd4c4559fdbc91585`.

### Bounded approval

The Node 13 strict-PQ approval was bounded by node scope and validity window and required:

- TLS 1.3 only;
- `X25519MLKEM768`;
- ML-DSA-65 client identity;
- Ed25519 + ML-DSA-65 critical signatures;
- `automaticFallback=false`;
- `classicalOnlyAllowed=false`;
- `strictPqAction=enable`;
- `legacyXMESH1Action=retain`.

Approval SHA-256:

`b2e43b137d4ea5b24b1313899e57701608874e059bdf5d5d2ba9f263ba866259`

## Production activation — COMPLETE

The dedicated strict-PQ Nexus stack reached readiness first with:

```text
productionStackReady=true
strictPQEnabled=false
legacyXMESH1Retired=false
```

This readiness state was intentionally not treated as production activation.

Node 13 then ran the approved production Agent in `recover` mode against the existing committed epoch-2 state. The Agent returned:

```text
status=strict-pq-node-cutover-receipt-verified
mode=recover
nodeId=13
minimumEpoch=2
strictPQEnabled=true
legacyXMESH1Retired=false
```

Node result SHA-256:

`ac1025fdc4bf2b433d1e596a7a35dd14deca94bcc44a10866c72c31b76d2fe9f`

Receipt binding SHA-256:

`1747647618cb1a824b85ef379646da242de7846e8c3ebff0bfdad9bc078ecb39`

Nexus then consumed that exact result and finalized:

```text
productionActivation=true
strictPQEnabled=true
legacyXMESH1Retired=false
physicalPowerLossQualified=false
```

Activation timestamp: `2026-10-31T10:52:13Z`.

Activation record SHA-256:

`6cfb4dc49edacff87033bbd99ca45ad7279813b4a10a5cbe958d5348e8a0ee9d`

Full evidence: [`XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md`](XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md).

## Production orchestration hardening

The live Node 13 rollout exposed release-control defects outside the frozen crypto/runtime build inputs:

1. direct execution of the base shell launcher depended on a checkout executable bit;
2. execute/finalize/rollback used Python `open(path, os.O_RDONLY)` instead of `os.open(...)` for directory `fsync`;
3. C2-C and ingress depended on operator source-directory permissions for bind-mounted panel-pin/TLS material;
4. the launcher could emit readiness while C2-C/ingress had already entered restart loops.

The post-activation control-plane patch therefore:

- invokes the base launcher through `bash`;
- uses correct `os.open` directory durability calls;
- stages C2-C public pin material for GID 10001 and ingress TLS material for GID 10003 into runtime-owned least-privilege paths;
- requires all four strict-PQ services to be running/non-restarting and ingress port 8444 to be published before writing readiness evidence;
- adds CI assertions for those exact regression classes.

These changes are release-control/tooling hardening and do **not** alter the frozen production runtime build inputs.

## Current production decision

**Strict-PQ is active in production for bounded canary Node 13.**

XMESH1 remains retained. There is no automatic/classical fallback. `physicalPowerLossQualified=false` remains the correct KVM VPS claim.

A broader rollout is a separate release decision. It requires a new bounded scope/approval and must not be inferred from the Node 13 activation evidence.

## Next engineering sequence

```text
Node 13 bounded production activation COMPLETE
            ↓
merge live rollout orchestration hardening + evidence
            ↓
observe/operate bounded canary without weakening strict-PQ policy
            ↓
prepare a separate phased expansion decision if broader rollout is desired
```

Do not rerun the completed KVM durability matrix, cutover, final canary, or historical recovery witness unless the frozen runtime/security assumptions materially change.
