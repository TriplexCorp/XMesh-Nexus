# XMesh Agent release/version policy

`AGENT_VERSION` is the canonical target version advertised by XMesh Nexus for the production node Agent. It uses `control-vMAJOR.MINOR.PATCH` numbering.

## Mandatory bump rule

Any change that alters deployed Agent/runtime behavior **must increase the Agent version in the same release**. This includes node-control logic, Agent installers/updaters, strict-PQ Agent binaries, node-side reconciliation/runtime helpers, or a control-plane contract change that requires different node behavior.

Pure documentation, UI-only work, tests, or backend changes that do not alter the node runtime contract do not require an Agent bump.

Version intent:

- **PATCH** — backwards-compatible bug fixes, reliability/security hardening, and runtime behavior corrections.
- **MINOR** — backwards-compatible new Agent capabilities or protocol/runtime features that operators need to distinguish during rollout.
- **MAJOR** — incompatible wire/security architecture changes or migrations requiring an explicit major cutover.

The XMesh Node product `VERSION` and Agent version are independent. Keeping the Node product version unchanged is never a reason to reuse an old Agent version after runtime behavior changed.

## Release consistency

For every production Agent release, all of the following must point to the same new target version:

- heartbeat `AGENT_VERSION`;
- Nexus `CONTROL_AGENT_VERSION` target;
- Update Agent target/release manifest;
- strict-PQ activation/product binary release identity;
- clean-install and upgrade validators;
- CI/source-contract expectations.

`sourceRevision` and `artifactSha256` remain immutable release-identity fields, but they do **not** replace the version bump requirement.

Fresh Nexus installs approve a Node build using `XSP_V2_PRODUCT_AGENT_PIN=<source SHA>:<product binary SHA-256>`. Set it on the initial `install.sh` invocation using the reviewed release evidence. Full installation fails before host dependency provisioning when the approved pin is missing, malformed, ambiguous, or does not match the shipped Node bootstrap revision. An existing approved pin is preserved and cannot be silently replaced. New enrollment also fails closed when the binary digest does not match. The panel supplies the exact Node and running Nexus revisions and checks the Node bootstrap hash before dispatch.

The first install does not require the bridge package. Unbound Agent update requests are refused. The signed plan, staging, atomic switch, COMMIT and signed ABORT code remain available for future release qualification. A successor release must be tested from the installed first release before enabling its update action.

## CI requirement

The Agent update source-contract check must verify version consistency. Pull requests that change deployed Agent/runtime surfaces without increasing `AGENT_VERSION` relative to the base branch must fail CI.

Current target: **`control-v6.0.27`**.

## First-install release record

`deploy/agent-release-pin.conf` binds the exact source revision, both Agent
artifact digests, and immutable Go builder. The record is parsed as data, never
sourced as shell. A dedicated CI job independently rebuilds both binaries and
must match their recorded digests. The previous candidate and its installed matrix matched exactly ([Node](https://github.com/TriplexCorp/XMesh-Node/actions/runs/45346121399), [Nexus](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/45346249796)). The current candidate includes forward-release, activation-recovery, V1 local grant conservation, and V2 reservation downgrade fixes ([Node build](https://github.com/TriplexCorp/XMesh-Node/actions/runs/45351241471)); it requires a fresh installed matrix and reproducible-build check before approval.

`firstInstallApproved=0` is deliberately retained while the release remains
a candidate. Only a reviewed first-install promotion may change this to 1.
After promotion the full installer automatically imports the canonical pin;
it never overwrites an existing different approval. No separate manual pin
copy is required for that approved first release. An explicitly supplied,
matching operator pin is still accepted for reviewed testing.

The record does not enable Quota V2, authorize production traffic, or grant
update/rollback authority. The successor release still needs the signed
update protocol and installed lifecycle acceptance.

## Local first-release recovery supervisor

The clean install uses `xmesh-product-release-update.timer` and a private,
digest-checked copy of the enrolled initial product executable. It is
initialized only from the cryptographically verified original activation;
the old APT bridge package is not an installation dependency. The control
worker accepts only an authenticated manifest-bound command and does not send
a legacy success ACK for that command. The supervisor independently requests
the signed release plan, stages exact bytes, and waits for a signed COMMIT
or ABORT. It never treats a transport timeout as rollback authority.

This is the **first successor binary** mechanism; it is not yet qualification
of an entire Agent/runtime bundle, multiple successive upgrades, or an
upgrade while production quota spending is active. These gates must not be
silently bypassed by the fresh installation path.
