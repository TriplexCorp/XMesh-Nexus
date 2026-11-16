# Residual risks and assurance gaps

The audit is incomplete. No absence-of-vulnerability conclusion follows from the current finding count or CI results.

- Anonymous feed, health and machine endpoints still require complete cost/admission and storage-failure testing.
- Per-process admission/ceilings do not establish fleet-wide limits or volumetric DDoS protection.
- Gateway origin identity is not enforced for public feeds; direct-origin callers retain Nexus rate-control exposure.
- Docker peer-IP behavior for IPv6 /64 rate limiting has not been measured.
- Node reporting trust, quota reconciliation delay, offline access and counter reset/replay bounds are not yet established.
- Legacy integration tokens can have different sender-proof guarantees than newly issued tokens.
- Full API object/function authorization, frontend adversarial rendering and crypto lifecycle coverage remain open.
- Dependency/SBOM results need actual successful collection and manual triage; production image coverage is partial.
- Fresh installation, reboot, interrupted upgrade and recovery on clean machines remain unqualified.
- Historical branch divergence and earlier security documents do not establish fixes are present or protections work today.

No production change is requested for the draft login fix until review/CI complete. Its eventual rollout is Nexus-only with existing configuration/API contracts. Operators should retain documented network isolation and supported TLS settings; no manual origin key/provisioning workaround was introduced.

Executed evidence additionally confirms old Node router Go/Alpine versions and advisory-bearing gateway/Agent/container reports. These remain open for applicability assessment and coordinated dependency remediation. Source and selected image SBOMs now exist; Rust dependency scan and full image coverage remain incomplete.

Device slots are based on a client-provided HWID. They are not hardware attestation and do not independently prevent cloning already-issued VPN credentials between physical devices. Stronger physical-device guarantees would require a separately designed credential/identity lifecycle; no breaking API change was introduced in this checkpoint.
