# Repository inventory

## Exact audited snapshots

| Repository | main SHA | Version | Agent | Files | Branches | Open PRs | Published releases/tags |
|---|---|---|---|---:|---:|---:|---|
| XMesh-Nexus | `4aa18331e537d6a1eacd747d58af55041748abf0` | 6.0.0 | control-v6.0.11 | 685 | 374 | 1 | none returned by Releases and tag refs APIs |
| XMesh-Node | `1f4744d19177056bd9ffa6ca2009975805050936` | 6.0.0 | control-v6.0.11 | 191 | 32 | 0 | none returned by Releases and tag refs APIs |
| XMesh-Sub | `6fca4eb0e0388e6ec5e6817e9a8d58942935aaa2` | 0.4.3 | N/A | 15 | 15 | 0 | none returned by Releases and tag refs APIs |

All repositories were accessible and public at inventory time. Counts are file-tree inventory, not a claim that every file has been security-reviewed. Nexus branch pagination was followed through 374 branches. Forty-six security/audit/auth/flood/release-named branches were compared with the corresponding pinned main. Divergent Git history does not itself mean a fix is absent: squash merges require content comparison.

## Executable components found

- Nexus: Rust/Axum API, PostgreSQL, Redis, built-in Telegram worker, Go product gateway, OpenSSL-backed ingress, isolated Rust signer and feature-gated operator/qualification binaries. The precise feature/deployment boundary of each crypto component remains to be reviewed.
- Node: Go TCP/UDP router; strict-PQ activation/product clients; private state/cutover helpers; signed control/metrics workers; Python Xray reconciliation, credential/quota/TLS/GeoData helpers; managed Xray.
- Sub: Caddy public proxy, private Unix-socket Python limiter and outbound-only root Python manager; OIDC-attested bootstrap/release verification.

## Source inventory

| Repository | Rust | Go | Python | JS/CJS | Shell | YAML | SQL |
|---|---:|---:|---:|---:|---:|---:|---:|
| Nexus | 77 | 7 | 47 | 148 | 36 | 57 | 58 |
| Node | 0 | 99 | 20 | 0 | 11 | 18 | 0 |
| Sub | 0 | 0 | 6 | 0 | 4 | 2 | 0 |

Nexus has backend/Cargo.toml without a committed Cargo.lock; scripts/browser/package-lock.json and the product gateway go.sum exist. Node's Go modules inspected so far use standard-library/local-module boundaries; complete transitive resolution and SBOMs are pending. Sub Python uses the standard library in the reviewed runtime files; OS/container dependencies still require scanning.

## Branch/review status

Only Nexus PR #176 was open before this audit: historical cutover/status documentation, not a fresh code-level approval of current main. Node and Sub had no open PRs. Historical review claims will not be reused as current proof. The API returned no release objects or tag refs for any repository; version files and pinned source identities currently matter for deployment.

## Known limits

Detailed review coverage, dynamic results, dependency advisories, clean installation and recovery qualification are not complete. New branch heads must be re-resolved before any later final audit sign-off.
