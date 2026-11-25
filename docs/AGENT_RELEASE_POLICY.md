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

Current target: **`control-v6.0.33`**.

## First-install release record

`deploy/agent-release-pin.conf` binds the exact source revision, both Agent
artifact digests, and immutable Go builder. The record is parsed as data, never
sourced as shell. A dedicated CI job independently rebuilds both binaries and
must match their recorded digests. The 6.0.32 candidate was independently rebuilt in [Node CI](https://github.com/TriplexCorp/XMesh-Node/actions/runs/45542891767) at source `15ecd5b63ea63125f2dd119c3e905ff57414fe8e`. The signed Xray qualification remains separate, and production Quota V2 must stay disabled until the new source-matched Xray is verified. The 6.0.31 candidate was built in [Node CI](https://github.com/TriplexCorp/XMesh-Node/pull/178/checks) at exact revision `74c966c35c62a0e7c3b85089790f1bc9670671f6`. The immutable builder and both candidate digests must independently match in Nexus CI; installed staging coverage does not qualify ordinary metered traffic, reboot recovery, or a live quota upgrade. The 6.0.30 candidate was built in [Node CI](https://github.com/TriplexCorp/XMesh-Node/actions/runs/45429776676). The previous 6.0.28 candidate was built in [Node CI](https://github.com/TriplexCorp/XMesh-Node/actions/runs/45360660315), independently reproduced in [Nexus CI](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/45366366675), and matched all three installed scenarios in [Nexus CI](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/45366366448) at Nexus revision `11dff82c870f6dddb0940835d0f3fab3e561fa7d`. The matrix verified the product artifact SHA-256 and exact Node revision recorded in the pin; the isolated clean-install lifecycle also completed signed ABORT, synthetic first-successor COMMIT and activation recovery.

`firstInstallApproved=1` approves only the exact initial Agent identity for a new installation. The full installer automatically imports the canonical pin; it never overwrites an existing different approval. No separate manual pin copy is required. An explicitly supplied matching operator pin is still accepted. The approval does not authorize the synthetic successor, a full runtime-bundle upgrade or production quota activation.

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

The owner-only ordinary update action has a gated first-successor queue.
It requires a recent heartbeat for the exact original enrolled version,
an immutable approved strictly forward manifest, a nonrevoked keyset, and
no committed previous successor. `XSP_V2_PRODUCT_FIRST_SUCCESSOR_QUALIFIED`
defaults to zero and must stay zero until real installed lifecycle testing
qualifies the successor; planning and commit gates must also be enabled.
The queue refuses production Quota V2 operation until live-quota update
and rollback have been qualified. This is not a claim of chained upgrades.
