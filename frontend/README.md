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

Native dialog widths belong to the shared presentation/dialog geometry layer.
A feature stylesheet must not apply selectors like `dialog:not(...)` to unrelated
dialogs: an earlier global `30rem` width in `features/users/users.css` crushed
the XRAY STUDIO TLS editor. The TLS dialog has its own desktop-width,
viewport-bounded layout and mobile breakpoint; only its central body scrolls,
so the footer remains accessible. Do not fix that regression with browser zoom
or feature-wide `!important` overrides.

Run `node scripts/update-ui-cache.cjs` whenever a CSS import changes and
`node scripts/test-xray-tls-dialog-geometry.cjs` to verify the actual Chromium
modal, layout and working Save flow across mobile and desktop sizes.

See [Design System v3](../docs/UI_SYSTEM.md) and the
[XRAY STUDIO guide](../docs/XRAY_STUDIO_GUIDE.md) for ownership and TLS behavior.
