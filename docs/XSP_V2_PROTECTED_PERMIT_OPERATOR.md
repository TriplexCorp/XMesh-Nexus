# XSP-v2 protected cutover permit operator

**Status:** staging-only protected operator path. This does not enable `strict-pq`, retire old Node keys, change normal production routing, or authorize production rollout.

This path closes the missing gap between an owner-approved/proved rotation candidate and the already-reviewed signed permit / applied ACK / immutable receipt chain.

## Trust split

Two dedicated binaries are built only with `xsp-v2-experimental`:

- `xsp-v2-permit-signer` owns the existing `panel_response` Ed25519 + ML-DSA-65 private keys. It has a dedicated **SELECT-only** PostgreSQL role and a protected Unix socket. It independently re-reads the current suite state, active Node public keys, proved/unexpired prepared public keys, recorded approving owner, and any existing permit before it signs.
- `xsp-v2-permit-operator` never receives panel private keys. It runs under a different UID/GID, reads an independently provisioned public panel pin, authenticates the real active panel `owner` with the stored Argon2 password hash, freezes the owner account and candidate rows in one PostgreSQL transaction, requests an exact permit from the signer, verifies both panel signatures through `persist_verified_permit`, commits the exact permit bytes to `node_xsp_cutover_permit_ledger`, and only then prints the permit.

The signer and operator use a dedicated Unix socket. The signer verifies the operator peer UID/GID; the operator verifies the signer peer UID/GID and socket ownership before sending an issuance request.

## Fail-closed conditions

Permit issuance fails if any of these are false:

- runtime gate is exactly `staging-only`;
- the DB account used by the operator is the non-superuser `xmesh_app` role;
- the supplied panel account exists, is active, has role `owner`, and its Argon2 password verifies;
- the authenticated owner is the same `approved_by` recorded on the prepared candidate;
- suite floor/phase/epoch are eligible for the staged one-epoch transition;
- the current and pending Ed25519/ML-DSA-65 public keys are valid and match their fingerprints;
- the pending candidate has dual PoP, is unexpired, and has at least ten seconds of validity remaining;
- the independently pinned `panel_response` public pair matches the exact signer key pair;
- another `issued` permit does not already exist for the Node;
- the permit TTL is at most 60 seconds and cannot outlive the prepared candidate;
- the returned permit verifies under both panel signatures and the exact transaction-locked candidate digest;
- the ledger transaction commits before the permit is emitted to stdout.

An exact retry using the same request ID returns the already stored permit bytes instead of creating a newly randomized signature.

## Database role

Provision `deploy/postgres/22-create-xsp-v2-permit-signer-role.sql` with a fresh password. `xmesh_permit_signer_reader` is read-only and can SELECT only:

- `node_xsp_suite_state`
- `node_xsp_public_keysets`
- `node_xsp_rotation_preparations`
- `node_xsp_cutover_permit_ledger`

It has no table writes, sequence privileges, DDL, TEMP, role memberships, or superuser-style attributes.

## Runtime layout

Recommended local paths:

- private signer keys: `/etc/xmesh-nexus/xsp-v2-signer/panel-ed25519.pem` and `panel-mldsa65.pem` (root-owned, group `10001`, restricted mode);
- permit signer socket directory: `/run/xmesh-permit-signer`, owner `10006:10005`, mode `2750`;
- independent public pin: `/run/xmesh-permit-public/panel-pin.json`, root-owned, group `10005`, mode `0640`.

Build the two isolated images from the reviewed source:

```bash
docker build -f backend/Dockerfile.xsp-permit --target permit-signer -t xmesh-xsp-permit-signer:staging .
docker build -f backend/Dockerfile.xsp-permit --target permit-operator -t xmesh-xsp-permit-operator:staging .
```

The operator password must not be placed in argv, an environment variable, a file, or container logs. Read it silently in the invoking shell and provide it only on stdin:

```bash
read -rsp 'Owner password: ' OWNER_PASSWORD; echo
printf '%s\n' "$OWNER_PASSWORD" | docker run --rm -i ... xmesh-xsp-permit-operator:staging \
  --node 13 --owner Triplex
unset OWNER_PASSWORD
```

The successful JSON result contains the exact `signedPermitB64`, request ID, candidate digest, canonical permit-input digest, and explicit safety claims:

- `cutoverAuthorized=true` — only for the exact signed Node 1→2 transition in that permit;
- `strictActivated=false`;
- `productionActivation=false`.

## What this still does not do

This component does **not** activate the Node vault, produce an applied ACK, advance the Nexus epoch, issue the commit receipt, retire old keys, enable strict PQ, qualify physical power loss, or satisfy the independent external security review. Those remain separate gates.
