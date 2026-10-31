# XSP-v2 strict-PQ production activation — Node 13 — 2026-10-31

Status: **PRODUCTION ACTIVATION COMPLETE** for the bounded canary Node 13.

This record captures the live production execution that followed the reviewed release gates. It does not broaden the rollout beyond Node 13, does not retire XMESH1, does not claim physical host power-loss qualification, and does not claim an independent external security review.

## Frozen production target

- Nexus runtime revision: `a1267ae186f74d5e21561e3b64fc7375d499132e`
- Node runtime revision: `64709ce8f5f0ce80e2c0bab59b4476347825e57c`
- Nexus runtime manifest/image binding: `sha256:af27a110220f98880dc539141d614683741a05fbd3afd30792819b3192b9ef45`
- approved Node activation artifact SHA-256: `a5f8e739b381640e4ac1d632dfef47d879ebc4c6ce7c4fbd8fab5744ad9cdd63`
- bounded activation approval SHA-256: `b2e43b137d4ea5b24b1313899e57701608874e059bdf5d5d2ba9f263ba866259`

The production execution wrapper continued to require the frozen runtime build inputs to be byte-identical to the reviewed target while allowing later release-control/tooling commits.

## Release evidence used by the approval

- AI-assisted internal security review v6 result SHA-256: `2efb039f6581eb50b52c3b0f34c2d44cc320fbf2e1883f472e047746cfcba1a5`
- KVM VPS durability result SHA-256: `fd8ef8e680e999bb95ef5b081806eb24a32f1537a7d1f6cd678ecd41591c6a0f`
- provider-storage risk acceptance SHA-256: `49a311a8bf871c6afcaa5841622b9f1e28e74675452671abc4e970f644dec604`
- final canary v3 result SHA-256: `ef8beb21746890ad5169b71e7a8d937b6043519513e6381471c0f6d11d62f287`
- rollout plan SHA-256: `7ce7a159b2851dd1a55f5f2810d43aeaf5a70e73dc4e0f886c975f55b2f65364`
- rollout review SHA-256: `93ee69fe8caca8846368865cf8d141ab96cf6e521f2cce5dd4c4559fdbc91585`

Governance for this release is **AI-assisted internal review + explicit release-owner risk acceptance**. It is not represented as independent external review.

## Live execution

The dedicated strict-PQ Nexus stack was launched for Node 13 with:

- TLS 1.3 only;
- `X25519MLKEM768` key exchange;
- ML-DSA-65 client identity;
- critical Ed25519 + ML-DSA-65 signed messages;
- no automatic fallback;
- no classical-only mode;
- XMESH1 retained.

The Nexus readiness record was created only as a pre-cutover state:

```text
productionStackReady=true
strictPQEnabled=false
legacyXMESH1Retired=false
```

Node 13 then executed the approved `xmesh-agent-xspv2-activate` artifact in **recovery mode**, reusing the existing immutable committed receipt rather than issuing a new cutover.

Canonical Node result: [`evidence/xsp-v2-node13-production-result-2026-10-31.json`](evidence/xsp-v2-node13-production-result-2026-10-31.json)

- Node result SHA-256: `ac1025fdc4bf2b433d1e596a7a35dd14deca94bcc44a10866c72c31b76d2fe9f`
- receipt binding SHA-256: `1747647618cb1a824b85ef379646da242de7846e8c3ebff0bfdad9bc078ecb39`
- `minimumEpoch=2`
- `strictPQEnabled=true`
- `legacyXMESH1Retired=false`

The Nexus finalizer consumed that exact Node result and wrote the production activation record at `2026-10-31T10:52:13Z`.

Canonical activation record: [`evidence/xsp-v2-node13-production-activation-2026-10-31.json`](evidence/xsp-v2-node13-production-activation-2026-10-31.json)

- activation record SHA-256: `6cfb4dc49edacff87033bbd99ca45ad7279813b4a10a5cbe958d5348e8a0ee9d`
- `productionActivation=true`
- `strictPQEnabled=true`
- `legacyXMESH1Retired=false`
- `physicalPowerLossQualified=false`

## Live rollout defects found and corrected

The live execution exposed release-control defects outside the frozen crypto/runtime source target:

1. `xsp-v2-strict-pq-production-execute-v2.sh` directly executed the base shell script and therefore depended on the checkout executable bit.
2. execute/finalize/rollback used Python `open(path, os.O_RDONLY)` instead of `os.open(...)` for parent-directory `fsync`.
3. C2-C and ingress bind-mounted operator-owned material whose source directory permissions were not guaranteed readable by fixed container UIDs/GIDs.
4. `docker compose up` could return while C2-C/ingress were already entering a restart loop, so the old launcher could emit `stack-ready.json` prematurely.

The post-activation release-control patch fixes these without changing the frozen runtime build inputs:

- invoke the base launcher through `bash`;
- use `os.open` + `os.fsync` + `os.close` for directory durability;
- stage panel-pin and ingress certificate material into runtime-owned least-privilege paths for GID 10001 / 10003;
- require all four strict-PQ services to be running and non-restarting and require ingress port 8444 to be published before writing readiness evidence;
- add CI assertions for these regressions.

## Authoritative production claim

For the bounded production canary Node 13, the authoritative state after finalization is:

```text
productionActivation=true
strictPQEnabled=true
nodeId=13
minimumEpoch=2
legacyXMESH1Retired=false
physicalPowerLossQualified=false
automaticFallback=false
classicalOnlyAllowed=false
```

This is the first point in the release sequence at which `strictPQEnabled=true` is a valid production claim.
