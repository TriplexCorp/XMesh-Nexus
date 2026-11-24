# XMesh ecosystem security — current-main evidence ledger

Date: **2026-11-16**. Scope is *only* `TriplexCorp/XMesh-Nexus`, `TriplexCorp/XMesh-Node`, `TriplexCorp/XMesh-Sub`. ProjectHimera is **excluded**.

## Exact source revisions and released mitigations

| Component | Audited main SHA | Previously merged and tested |
|---|---|---|
| Nexus | `5f2e6cc7c9f07102849906faca312908b20261ae` | #492 Host UI, #494 bounded Xray ZIP/unpack, #495 signed Node user/squad/inbound scope, #496 Argon2 admission, #497 editor layout |
| Node | `647adcf7af326b205fce12545fb5d75a20bb8191` | #83 Go 1.27.4 / Alpine 3.24, actual router-image Trivy scan |
| Sub | `17be0aab84ec04412ef490fcaa0953181b3e4262` | #18 publisher action SHA pins and verification |

**Current security build status:** these patches passed the PR-specific tests at merge. That does not prove that they cover all code paths, future configuration changes or node compromises. Rerun independent security integration and scan **the exact listed snapshots**.

## Evidence collection

The new [workflow](../../.github/workflows/security-audit-current.yml) runs independent `sast` and `dependencies` jobs on all three pinned checkouts with SHA-pinned Syft/Trivy/Gitleaks tools; Semgrep/Bandit are version-pinned and run in a private virtual environment. The workflow:
- Reports all scanner exit codes; **does not skip warnings or convert findings to a green compliance status**.
- Separates redacted finding metadata from untrusted raw scanner output; no secret values or customer data are published.
- Runs source scans for Nexus/Node/Sub and a build + scan of the current **Node router** runtime image.
- Reports Go modules, a generated Nexus Rust lock graph, npm browser tooling, selected Sub *base* images and CycloneDX SBOMs. **Sub base images are not proof of final running Sub container safety**.
- Does not scan production VPS images, private environments, live services or production secrets.

**At the time this ledger was written, new-run results were pending.** Replace the provisional statuses below only with run URL, artifact ID, source SHA, exact advisory and documented reachability. Existing evidence in the archive is not a current finding by itself.

## Outstanding issues — manual classification required

| Area | Historical evidence (not yet revalidated) | Required decision / test |
|---|---|---|
| Rust `zip` | RUSTSEC-2026-0367/0368/0369/0429 on zip 2.6.1 | Current `core.rs` explicitly restricts ZIP entry names and decompressed size after #494. Check each advisory's affected API and actual call site, plus whether 2.x is still in the *resolved production graph*, before choosing upgrade or compensating controls |
| Rust SQLite | RUSTSEC-2026-0459, `libsqlite3-sys` 0.37.0 | Determine feature provenance from SQLx and actual production binary. The public Nexus `Cargo.toml` selects PostgreSQL; do not assume SQLite is reachable without build/feature and untrusted file evidence |
| Historic secrets | Gitleaks candidates in Nexus integration docs, Node test fixtures, Sub install script | Inspect fingerprints privately without exposing values. Classify example token vs real credential; for confirmed live secrets rotate/revoke **before** changing history. Never paste secrets into PR |
| Source analysis | Semgrep/Bandit findings for dynamic URLs, subprocess execution, HTTP binding, plus parse errors | Classify test/dev/installer/runtime, data source and injection path. Investigate parser errors separately from clean results. No blanket suppressions |
| Node router | Historical Alpine 3.21 image finding | Latest Node #83 rebuilt Alpine 3.24 image passed its separate Trivy High/Critical gate. Confirm current scanner output matches the **new** SHA and note remaining lower-severity advisories |
| Sub gateway | Historical scans of `caddy:2` and `python:3.12-alpine` | Build and scan the actual deployable Sub images, pin exact base digests and review Caddy reverse-proxy trust/IPv6 source-IP rules; base-image scans alone are incomplete |
| Cross-component auth | Node identity vs per-user authorization and stale/rotated API keys | Run current-main signed telemetry scope + RBAC/MFA/revocation tests; test profile/squad membership changes, reused inbound tags, malicious Node, expired/queued samples and quota reconciliation |

## Release-blocking tests not covered by this evidence-only PR

1. Confirm real IPv4/IPv6 **peer** and `X-Forwarded-For` trust semantics on Sub behind Caddy; prevent direct origin/bypass and spoofed header rate-limit evasion.
2. Run a disposable multi-Node compromise simulation with two distinct Node keys, users and scopes; include revocation and replay under concurrent traffic reports.
3. Verify old API keys' permissions/revocation paths; validate cross-mirror enrollments and per-node/monthly CDN quota accounting.
4. Qualify from an entirely clean VPS using the intended installer commands (no offline/manual key provisioning), reboot, update interruption, rollback and first boot; record firewall and TLS/proxy behavior.
5. Preserve exact scanner artifacts before retention, conduct human triage and open individual targeted remediation PRs. Never declare the ecosystem safe from a passing CI alone.

## Status

**Audit ongoing.** #493 remains historical reference; this continuation is the current-source report and rerun mechanism, not a completed independent penetration test or authorization to expose the services publicly.
