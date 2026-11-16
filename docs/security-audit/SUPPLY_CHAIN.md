# Supply-chain evidence — collection in progress

Pinned snapshots and source/module inventory are in REPOSITORY_INVENTORY.md. Tool binary versions and literal SHA-256 digests are in TOOL_PINS.json. The installer accepts only official GitHub release sources, verifies the archive checksum before parsing and extracts only the named regular binary. Semgrep/Bandit top-level versions are pinned; the actual Python transitive environment is retained.

The evidence workflow checks out only the three permitted repositories. Read-only GitHub permissions and disabled persisted credentials apply; no production secrets are used. SAST includes Semgrep, Bandit and redacted Gitleaks history scans. Dependency collection includes cargo-audit, browser-tool npm audit, source and actual-binary govulncheck, Syft CycloneDX and Trivy. Tool errors, missing/invalid output and findings remain nonzero; scanner hits require manual triage.

## Important resolution limits

- Baseline Nexus has no committed Cargo.lock. Generated lock evidence reflects audit-time resolution, not necessarily the exact dependencies of an earlier deployed image.
- Node source checks under Go 1.27.3 cannot alone assess the router image compiled using Go 1.23. The collector additionally builds and scans the actual router binary.
- Sub Python is standard-library based in reviewed runtime files. That does not exempt Python/Caddy/Alpine container packages from CVEs.
- Browser npm packages are test tooling; their advisory scope must not be confused with deployed frontend dependencies.
- Mutable image tags require recording the resolved image identity in retained SBOM metadata.
- Nexus API, PostgreSQL, Redis, ingress and signer production image SBOMs/scans are not yet complete.
- Remote Semgrep rules and vulnerability databases evolve; tool pinning alone does not make rule/advisory evidence immutable.
- cargo-audit/govulncheck resolution metadata must accompany results; not every transitive tool artifact is independently pinned.

## Run status

Initial evidence workflow validation failed before execution; runner context selection was corrected in `239f62e`. Final scan and SBOM production, review of candidates and any advisory fixes are pending. No completed clean dependency scan or SBOM is claimed at this checkpoint. CodeQL/Semgrep coverage equivalence is not assumed; CodeQL, cargo-deny, ShellCheck/actionlint and targeted fuzzing remain candidate next checks.
