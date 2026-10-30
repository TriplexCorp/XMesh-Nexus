# XSP-v2 P0-E protected permit tooling binding

Status: **staging/qualification tooling binding; non-activating**.

This gate exists because the protected cutover permit signer/operator was added after the reviewed production Nexus runtime target was frozen. The tooling must therefore be identified separately instead of silently changing the production runtime revision used by the durability and security-review evidence.

## Exact revisions

Reviewed Nexus production runtime remains:

`12b3170996bc062ee16c79659a6378e5e425fd0e`

Protected permit tooling is pinned to the merged PR #172 revision:

`c00c6dcf1dba0ef923dd23371bc17b9dec781602`

Its first-parent tooling base is:

`40d146fd3c24888cf65fa83333bdb376d0572439`

The contract is:

`deploy/xsp-v2-p0e-permit-tooling-binding.contract.json`

The verifier is:

`scripts/verify-xsp-v2-p0e-permit-tooling-binding.py`

## Why this does not change the production runtime target

CI proves two separate facts:

1. between the reviewed runtime `12b317...` and tooling base `40d146...`, `backend/src` and `backend/Cargo.toml` are unchanged;
2. the first-parent delta `40d146... -> c00c6dc...` is exactly the nine PR #172 tooling/test/documentation files listed in the contract.

The default production panel Cargo manifest does not declare `xsp-v2-permit-signer` or `xsp-v2-permit-operator`. Both are built only through `backend/xsp-permit/Cargo.toml`, require the experimental feature, and remain outside the default production stack.

## Runtime separation

The permit signer:

- owns the protected `panel_response` Ed25519 and ML-DSA-65 private keys;
- uses the dedicated SELECT-only `xmesh_permit_signer_reader` PostgreSQL role;
- independently re-reads the proved/approved candidate;
- accepts requests only over the protected Unix socket from the dedicated operator identity;
- requires `XSP_V2_PROTECTED_PERMIT_ISSUER=staging-only`.

The permit operator:

- never mounts the signer private keys;
- authenticates the active panel owner using the stored Argon2 password hash;
- locks owner/candidate state transactionally;
- requires the same owner that approved the candidate;
- verifies the returned dual-signed permit using the independently mounted public pin;
- persists exact permit bytes through the existing verified ledger writer;
- requires `XSP_V2_PROTECTED_PERMIT_OPERATOR=staging-only`.

Issuing a permit authorizes only the bounded staged cutover represented by that signed permit. It does **not** itself activate the Node vault, advance the production epoch, retire keys, enable strict-PQ, or authorize production rollout.

## Real evidence result

Before the tooling is used against the real Node-13 production-state qualification path, build the signer and operator from exact revision `c00c6dc...` and preserve:

- SHA-256 of `xsp-v2-permit-signer`;
- SHA-256 of `xsp-v2-permit-operator`;
- SHA-256 of the build/evidence record that proves the exact checkout, Dockerfile/manifest inputs, image identities and extracted binary hashes.

The result schema is:

```json
{
  "schema": "xsp2-p0e-permit-tooling-binding-result-1",
  "productionRuntimeTarget": {
    "nexusRevision": "12b3170996bc062ee16c79659a6378e5e425fd0e"
  },
  "tooling": {
    "revision": "c00c6dcf1dba0ef923dd23371bc17b9dec781602",
    "toolingBaseRevision": "40d146fd3c24888cf65fa83333bdb376d0572439",
    "runtimeBaseRevision": "12b3170996bc062ee16c79659a6378e5e425fd0e",
    "permitSignerBinarySha256": "<64 lowercase hex>",
    "permitOperatorBinarySha256": "<64 lowercase hex>",
    "buildEvidenceSha256": "<64 lowercase hex>"
  },
  "claims": {
    "stagingOnly": true,
    "productionRuntimeSourceUnchanged": true,
    "strictPQEnabled": false,
    "productionActivation": false
  }
}
```

Verify with:

```bash
python3 scripts/verify-xsp-v2-p0e-permit-tooling-binding.py \
  --result /path/to/xsp-v2-permit-tooling-binding-result.json
```

A PASS reports `permitToolingBound=true` while keeping `strictPQEnabled=false` and `productionActivation=false`.

## Evidence integrity

CI-generated keys, binaries and synthetic result documents prove policy/tool behavior only. They are **not** real #137 or #138 evidence.

The real build evidence and binary hashes must be produced from the actual operator checkout used for the Node-13 qualification cutover and preserved in the final evidence archive. The frozen v5 package remains historical evidence; this later tooling and its real evidence must be included in the next independent-review checkpoint/package.

`strict-pq` remains OFF. Production activation remains NOT AUTHORIZED.
