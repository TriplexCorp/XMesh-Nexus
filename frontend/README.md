# Frontend source tree

`frontend/` is the canonical tracked source root for browser assets.

- `index.html`, `login.html` — authenticated panel and login entrypoints.
- `styles/system/` — the single `nexus-ui-v3.css` panel entrypoint and its three system owners: foundation, components and page-agnostic layout.
- `styles/features/` — scoped page/feature/editor geometry (including Settings and Nodes), imported by the panel entrypoint.
- `styles/auth/` — login-only styling; the public subscription portal has its own presentation.
- `js/core/` — panel bootstrap, localization and shared UI primitives.
- `js/auth/` — authentication and security UI.
- `js/features/` — feature-owned runtime modules.

The backend packages `frontend/` at `/app/static/`; browser assets are served under absolute `/styles/...` and `/js/...` paths. Import and entrypoint cache keys are SHA-256 content-addressed and updated through `node scripts/update-ui-cache.cjs`.

The historical legacy stylesheet, `ui-builder.js`, fourth workspaces CSS module and temporary compatibility staging script have been removed. Do not restore them or add secondary panel styling entrypoints.

See [Design System v3](../docs/UI_SYSTEM.md) for active ownership and layout contracts.
