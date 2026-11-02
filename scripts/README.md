# Repository scripts

`scripts/` contains repository verification, integration and release tooling. Existing script paths are treated as automation contracts: do not move a script merely to make the tree look nicer if workflows, release evidence or operator documentation reference its path.

## Placement rules

- `scripts/ci/` — CI-only adapters/fixtures. These helpers must never become production runtime dependencies.
- `check-*.js` / `check-*.sh` — active source/contract gates. A new check belongs here only when it is wired into an active workflow or intentionally documented as an operator command.
- `test-*.py` / `test-*.sh` — executable behavioral/integration tests used by CI or documented validation procedures.
- `xsp-v2-*`, `build-xsp-*`, `verify-xsp-*`, `assemble-xsp-*` — release/security evidence tooling. Their paths are stability-sensitive and should be moved only together with every workflow, document and evidence contract that references them.

## Hygiene rule

Do not keep abandoned standalone checks, marker/version scratch files or one-off migration helpers indefinitely. If a script is not invoked by CI, not referenced by maintained documentation and not a supported operator/release command, remove it rather than archiving executable code in place.

The repository-wide guard is `scripts/check-repo-layout.js`; browser source belongs under `frontend/`, not in the repository root.
