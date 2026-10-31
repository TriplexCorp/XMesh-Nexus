# XMesh Nexus Documentation

This directory contains the product, operations, Xray, routing, subscription and security documentation for XMesh Nexus.

If you are new to the project, read these in order:

1. [Product Guide](PRODUCT_GUIDE.md)
2. [Installation and Operations](INSTALLATION.md)
3. [CLI Update](CLI_UPDATE.md)
4. [Single Public TCP/443 Control-Plane Contract](SINGLE_PUBLIC_443_CONTROL_PLANE.md)
5. [XRAY STUDIO Operator Guide](XRAY_STUDIO_GUIDE.md)
6. [Autonomous Nodes](AUTONOMOUS_NODES.md)
7. [Subscription Security](SUBSCRIPTION_SECURITY.md)
8. [Enterprise Roadmap](ENTERPRISE_ROADMAP.md)

For future development, also read the current [Development Checkpoint — 2026-10-31](DEVELOPMENT_CHECKPOINT_2026-10-31.md).

---

## Product and operations

| Document | Purpose |
| --- | --- |
| [PRODUCT_GUIDE.md](PRODUCT_GUIDE.md) | Canonical product-level feature map and component boundaries |
| [INSTALLATION.md](INSTALLATION.md) | Supported Ubuntu installation, public 80/443 topology, HTTPS, updates, backups and troubleshooting |
| [CLI_UPDATE.md](CLI_UPDATE.md) | Operator-facing manual update through `sudo bash xmeshctl` and menu item 4 |
| [SINGLE_PUBLIC_443_CONTROL_PLANE.md](SINGLE_PUBLIC_443_CONTROL_PLANE.md) | Binding public-port/SNI topology: public 443 only, loopback 8443/8444 |
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
| [SINGLE_PUBLIC_443_CONTROL_PLANE.md](SINGLE_PUBLIC_443_CONTROL_PLANE.md) | Network exposure and TLS-boundary contract for panel and strict-PQ control traffic |
| [SECURITY_AUDIT_2026-10-22.md](SECURITY_AUDIT_2026-10-22.md) | Historical security audit/checkpoint notes |
| [SUBSCRIPTION_SECURITY.md](SUBSCRIPTION_SECURITY.md) | Subscription credential isolation and public endpoint security |

## XSP-v2 / POSTQUANTUM control plane

XSP-v2 protects the Nexus↔Agent **control plane**. Xray-core remains the user VPN data plane.

Start with:

| Document | Purpose |
| --- | --- |
| [XSP_V2_PQ_ONLY_SECURITY_POLICY.md](XSP_V2_PQ_ONLY_SECURITY_POLICY.md) | Binding strict-PQ policy and no-classical-fallback rules |
| [SINGLE_PUBLIC_443_CONTROL_PLANE.md](SINGLE_PUBLIC_443_CONTROL_PLANE.md) | Current external port 443 + internal strict-PQ ingress routing contract |
| [XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md](XSP_V2_PRODUCTION_ACTIVATION_2026-10-31.md) | Bounded production activation/finalization evidence |
| [ENTERPRISE_ROADMAP.md](ENTERPRISE_ROADMAP.md) | Current rollout/release gates |
| [HYBRID_POST_QUANTUM_SECURITY_IMPLEMENTATION_PLAN.md](HYBRID_POST_QUANTUM_SECURITY_IMPLEMENTATION_PLAN.md) | Full architecture/implementation plan and historical context |

The repository also contains lower-level XSP-v2 wire, signer, permit/ACK, staging, durability and recovery documents. Those documents are intentionally detailed because cryptographic rollout claims must remain evidence-bound.

Some historical XSP-v2 evidence mentions a public/test `8444` listener. Do not reinterpret those frozen records as current firewall requirements. The current supported product topology is defined by `SINGLE_PUBLIC_443_CONTROL_PLANE.md`: **public 80/443 only, loopback 8443/8444**.

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
- preserve the single-public-443 invariant unless an explicit replacement architecture is reviewed;
- do not claim live deployment from CI alone;
- do not claim universal client compatibility from editor support alone;
- do not claim external independent audit unless one has actually been completed;
- keep strict-PQ claims bounded to the nodes/evidence actually verified.
