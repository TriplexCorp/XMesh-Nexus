# Trust boundary for the 6.0.24 transition package

## What the existing installation trusts

The reviewed production baseline is Node [165c4759](https://github.com/TriplexCorp/XMesh-Node/tree/165c4759bc89a1077b76129c520b1b8c7dca9cb4) and Nexus [5bc138f4](https://github.com/TriplexCorp/XMesh-Nexus/tree/5bc138f4960d1e3c35a573fdd9c0dfbf8ba8571d). This is a source audit of the standard installer. A specific VPS can have additional trust configured by its operator.

- The stock Node bootstrap installs Ubuntu dependencies and can configure Docker's scoped APT key. That key does not approve XMesh release packages. No XMesh package key or repository is configured by the reviewed installer.
- The stock strict-PQ product transport authenticates Nexus control responses, but its fixed endpoint allowlist has no bridge package operation. Its staged release artifact path validates the immutable identity of a side-by-side Agent binary and runs its existing identity and state checks. The corresponding systemd unit cannot install a system package or write the control service.
- The legacy repair path fetches an updater from a fixed HTTPS origin and checks shell syntax and markers. This is insufficient to authorize the transition package. A digest delivered inside that same package checks internal consistency only.

There is no unattended trust-preserving route for this package on an unmodified stock installation. Keep the Nexus product update canary disabled on such nodes.

## Once-only trust provisioning

Use an operator-controlled deployment mechanism already trusted by the target, if one exists. Otherwise the operator must verify the release key fingerprint through an independently authenticated channel and provision that root of trust once. A signed APT repository can then authorize the package through a source-specific `signed-by` keyring. Never retrieve the trust root from the same publication being verified. Keep release signing keys off the nodes and out of the repository.

The package builder takes a reviewed bridge binary and its independently approved digest. Source timestamps are pinned to the Nexus checkout. Publish the Node revision, Nexus revision, bridge digest and package digest with the signed repository metadata. Publish one immutable artifact per package version with a finite signed `Valid-Until`. Increment the version for any changed bytes. Use normal APT version selection without downgrade, while the package pre-install check requires the original enrolled product image and its valid activation. After a successful product upgrade its pre-install check rejects the new image.

The package adds a systemd drop-in without overwriting the old control or updater files. Pre-install checks the exact original image before executing its activation verification. Post-install checks the packaged bridge digest, reloads systemd, and enables the recovery timer. Pre-removal refuses to remove a bridge with a pending command. After removal the original service definition applies on daemon reload. None of these package hooks modifies the Node enrollment, Xray state, WAL or quota reservations.

The isolated APT test preprovisions a lab key and checks metadata signed by a foreign key, expired signed metadata, the expected bytes and an altered package. It never operates on the system APT state or installs a package. Passing it does not supply a trust root to a stock VPS. A stock installation, real panel command, active VLESS traffic and reboot still need separate installed qualification.
