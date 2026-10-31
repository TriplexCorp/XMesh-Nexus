# XMesh Nexus Documentation

This directory contains the product, operations, Xray, routing, subscription and security documentation for XMesh Nexus.

If you are new to the project, read these in order:

1. [Product Guide](PRODUCT_GUIDE.md)
2. [Installation and Operations](INSTALLATION.md)
3. [XRAY STUDIO Operator Guide](XRAY_STUDIO_GUIDE.md)
4. [Autonomous Nodes](AUTONOMOUS_NODES.md)
5. [Subscription Security](SUBSCRIPTION_SECURITY.md)
6. [Enterprise Roadmap](ENTERPRISE_ROADMAP.md)

For future development, also read the current [Development Checkpoint — 2026-10-31](DEVELOPMENT_CHECKPOINT_2026-10-31.md).

---

## Product and operations

| Document | Purpose |
| --- | --- |
| [PRODUCT_GUIDE.md](PRODUCT_GUIDE.md) | Canonical product-level feature map and component boundaries |
| [INSTALLATION.md](INSTALLATION.md) | Supported Ubuntu installation, ports, HTTPS, updates, backups and troubleshooting |
| [PANEL_UPDATE_AND_TELEMETRY.md](PANEL_UPDATE_AND_TELEMETRY.md) | Owner-authorized panel update path, telemetry and accounting behavior |
| [AUTONOMOUS_NODES.md](AUTONOMOUS_NODES.md) | Managed node/Agent operational model |
| [DEVELOPMENT_CHECKPOINT_2026-10-31.md](DEVELOPMENT_CHECKPOINT_2026-10-31.md) | Current UX/security/config invariants that future development must preserve |
| [ENTERPRISE_ROADMAP.md](ENTERPRISE_ROADMAP.md) | Current engineering/release roadmap and readiness boundaries |

## Xray configuration

| Document | Purpose |
| --- | --- |
| [XRAY_STUDIO_GUIDE.md](XRAY_STUDIO_GUIDE.md) | Studio security model, XHTTP constructor, randomization, FinalMask and client projection |
| [FINALMASK_COMPATIBILITY.md](FINALMASK_COMPATIBILITY.md) | Detailed FinalMask server/client/transport compatibility matrix |
| [XRAY_CLIENT_EXPORT_MATRIX.md](XRAY_CLIENT_EXPORT_MATRIX.md) | Client export/projection compatibility matrix |
| [NODE_ROUTING.md](NODE_ROUTING.md) | Node-side routing configuration |
| [CLIENT_ROUTING.md](CLIENT_ROUTING.md) | Client-side routing configuration/projection |
| [GEODATA_ROUTING.md](GEODATA_ROUTING.md) | GeoIP/GeoSite routing data and source behavior |

## Subscriptions

| Document | Purpose |
| --- | --- |
| [SUBSCRIPTION_SECURITY.md](SUBSCRIPTION_SECURITY.md) | Public subscription token/security model |
| [PRODUCT_GUIDE.md](PRODUCT_GUIDE.md#7-subscription-system) | Portal, native Xray JSON, client apps, User-Agent behavior and supported output families |
| [XRAY_CLIENT_EXPORT_MATRIX.md](XRAY_CLIENT_EXPORT_MATRIX.md) | What can be projected from managed Xray profiles to client JSON |

## Administrative and node security

| Document | Purpose |
| --- | --- |
| [SECURITY_NODE_IDENTITY.md](SECURITY_NODE_IDENTITY.md) | Node identity and signed trust model |
| [SECURITY_AUDIT_2026-10-22.md](SECURITY_AUDIT_2026-10-22.md) | Historical security audit/checkpoint notes |
| [SUBSCRIPTION_SECURITY.md](SUBSCRIPTION_SECURITY.md) | Subscription credential isolation and public endpoint security |

## XSP-v2 / POSTQUANTUM control plane

XSP-v2 protects the Nexus↔Agent **control plane**. Xray-core remains the user VPN data plane.

Start with:

| Document | Purpose |
| --- | --- |
| [XSP_V2_PQ_ONLY_SECURITY_POLICY.md](XSP_V2_PQ_ONLY_SECURITY_POLICY.md) | Binding strict-PQ policy and no-classical-fallback rules |
| [XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md](XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md) | Bounded production activation/finalization evidence |
| [ENTERPRISE_ROADMAP.md](ENTERPRISE_ROADMAP.md) | Current rollout/release gates |
| [HYBRID_POST_QUANTUM_SECURITY_IMPLEMENTATION_PLAN.md](HYBRID_POST_QUANTUM_SECURITY_IMPLEMENTATION_PLAN.md) | Full architecture/implementation plan and historical context |

The repository also contains lower-level XSP-v2 wire, signer, permit/ACK, staging, durability and recovery documents. Those documents are intentionally detailed because cryptographic rollout claims must remain evidence-bound.

## Historical material

`docs/archive/` contains earlier README/roadmap snapshots and engineering handoffs. They are useful for provenance and debugging historical decisions, but **must not override current product behavior or current release policy**.

When an archived document conflicts with current `main`, use:

1. current implementation/tests;
2. current product/security documentation;
3. current roadmap/evidence;
4. archived material only as historical explanation.

## Documentation rules for contributors

When a product contract changes:

- update the subsystem documentation in the same PR;
- update [DEVELOPMENT_CHECKPOINT_2026-10-31.md](DEVELOPMENT_CHECKPOINT_2026-10-31.md) or replace it with a newer dated checkpoint when the old one becomes stale;
- update README feature claims if user-visible behavior changed;
- keep installation ports/dependencies synchronized with `install.sh` and `compose.yaml`;
- do not claim live deployment from CI alone;
- do not claim universal client compatibility from editor support alone;
- do not claim external independent audit unless one has actually been completed;
- keep strict-PQ claims bounded to the nodes/evidence actually verified.
