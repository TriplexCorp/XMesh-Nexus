# Frontend source tree

`frontend/` is the only tracked source root for browser assets.

- `index.html`, `login.html` — HTML entrypoints served by the API.
- `styles/legacy/` — compatibility CSS still required by historical renderers. Do not add new global design rules here.
- `styles/system/` — Design System v3 foundation, components and layout authority.
- `styles/features/` — feature-local geometry only.
- `styles/auth/` — login-only styles.
- `js/core/` — panel bootstrap, localization and shared UI primitives.
- `js/auth/` — authentication and security UI.
- `js/features/` — feature-owned runtime modules.

Production keeps this hierarchy: `backend/Dockerfile` copies `frontend/` to `/app/static/` as-is. Browser references therefore use absolute `/styles/...` and `/js/...` paths.

Some older source-contract checks still open historical root basenames. CI creates temporary, untracked symlinks through `scripts/ci/stage-frontend-compat.sh`; those links are test fixtures only and must never be committed or packaged.
