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

Fresh Nexus installs approve a Node build using `XSP_V2_PRODUCT_AGENT_PIN=<source SHA>:<product binary SHA-256>`. Set it on the initial `install.sh` invocation using the reviewed release evidence. New enrollment fails closed when the pin is absent or does not match. The panel supplies the exact Node and running Nexus revisions and checks the Node bootstrap hash before dispatch.

The first install does not require the bridge package. Unbound Agent update requests are refused. The signed plan, staging, atomic switch, COMMIT and signed ABORT code remain available for future release qualification. A successor release must be tested from the installed first release before enabling its update action.

## CI requirement

The Agent update source-contract check must verify version consistency. Pull requests that change deployed Agent/runtime surfaces without increasing `AGENT_VERSION` relative to the base branch must fail CI.

Current target: **`control-v6.0.27`**.
