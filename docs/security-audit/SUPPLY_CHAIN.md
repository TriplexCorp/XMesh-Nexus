# Supply-chain evidence — collected, triage incomplete

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

## Executed evidence update

The following completed jobs provide evidence, not security approval: SAST job 133078918822 and dependency job 133078919121. Resolve their run from the PR checks.

- SAST job 133078918822: Semgrep Nexus 13 candidates and 3 parse errors, Node/Sub zero candidates/parse errors; Bandit Nexus 607, Node 106, Sub 22 candidates, none labelled High. Many are assertions/subprocess imports in test/tooling code; no blanket suppression was added.
- Gitleaks history: Nexus 79, Node 2, Sub 4 candidates. Raw values remain redacted. Sample source review ties Node hits to fixture construction and Sub hits to installer variable initialization, but historical patch attribution requires care: current-file line numbers alone do not clear an old deleted secret.
- Browser npm audit: zero advisories in the committed test-tooling lock.
- Go JSON scans completed but contain module/package/symbol findings despite exit zero. Source SDK 1.27.3 reports GO-2026-6859 (fixed 1.27.4); gateway also reports pgx/x/net candidates. The actual router binary is built using Go 1.23.12 and contains a larger advisory set. These require applicability review, not automatic Critical counts.
- Syft generated three source CycloneDX SBOMs and image SBOMs for actual Node router, Sub Caddy and Sub Python images. Trivy produced advisory-bearing reports for these images.
- Rust audit failed with exit 101 and missing JSON; no clean Rust dependency result or complete Rust lock inventory can be inferred. Tool diagnostics are being collected separately.

First retained artifact links: [SAST](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/43799838961/artifacts/14195642519), [dependency/SBOM](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/43799838961/artifacts/14196147246). Retention is 14 days: preserve these externally for long-term audit evidence before expiry.

Sub action pinning draft #18 passed its CI. Runtime SDK advisory updates, full secret candidate adjudication, SAST parse-error review and production image coverage remain open.

Rust evidence collection was adjusted to run the capability-dropped container as the runner UID/GID and keep Cargo home in its writable private report mount. This avoids relying on root DAC override for runner-owned source/report directories. Toolchain is aligned with Rust 1.100 used by CI; the next scan remains required to establish success.

## Manual advisory applicability notes

GO-2026-6859 describes concurrent HTTP/1 response-header writes when MaxBytesReader is exceeded. A scoped repository code search found no MaxBytesReader reference, and the reviewed gateway reads bounded bodies using io.LimitReader, so broad derived HTTP-symbol traces alone do not establish that crash in XMesh.

GO-2026-5004 requires pgx's non-default simple protocol, a dollar-quoted SQL literal containing placeholder-like text and attacker-controlled corresponding values. The reviewed gateway main source contains neither an explicit simple-protocol mode nor dollar-quoted SQL. DSN/operator configuration and indirect usage still require review before a final disposition. x/text Nickname/invalid-UTF8 iterator conditions likewise need usage verification. No scanner severity was converted into a confirmed High/Critical without these prerequisites.

## Latest Rust result (supersedes earlier collection failure)

At `ea184737`, dependency job [133081499235](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/43801161952/job/133081499235) successfully installed cargo-audit 0.23.0 and audited the generated lock. Exit 1 now represents five advisories, not missing JSON: RUSTSEC-2026-0459 (libsqlite3-sys 0.37.0) and RUSTSEC-2026-0429/0367/0369/0368 (zip 2.6.1). Full upstream CVSS strings are retained in the redacted report and are not assigned as XMesh impact scores.

The ZIP advisories describe extract()/stream-extract symlink allocation, permissions and path behavior. The reviewed `backend/src/core.rs` uses manual allowlisted entry reads, rejects path separators and symlinks and does not call extract(). Its read_to_end before the binary-size check still warrants a separate decompression-budget review. The generated lock includes optional SQLx SQLite resolution; production Cargo features explicitly select PostgreSQL with SQLx defaults disabled. An active-feature/deployed-binary dependency tree is required before classifying SQLite as a production exposure.

The latest generated lock is retained as evidence, not committed as a production lock without verifying the Docker Rust 1.99.1 build and all feature combinations. Current source/image SBOMs include this richer resolution.

Latest dependency/SBOM artifact: https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/43801161952/artifacts/14196034811
ZIP SHA-256: `a42e3c7b17190e56346cd32f69a78a5e26db11c9aed19bd3db74694bf026e67e`.
Retention remains 14 days. All aggregate scanner jobs remain failing while advisory candidates/triage are open; nothing was ignored to produce a green result.
