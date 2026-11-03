# XMesh Nexus Design System v3

Status: **authoritative panel design and composition contract**.

The panel has **one presentation entrypoint**: `nexus-ui-v3.css`.
The goal is simple: **the panel must be designed as a system, not repaired page by page.**

## Active architecture

The browser loads presentation in this order:

1. historical `styles.css` is imported into the low-priority **legacy cascade layer** `xmesh-legacy`;
2. feature CSS owns feature-local editor/dialog geometry;
3. `nexus-ui-v3.css` is the modern global authority.

Legacy CSS is compatibility input, not a competing design system. Because it lives in a named cascade layer, modern unlayered feature/system CSS outranks it without specificity escalation or `!important` wars.

`nexus-ui-v3.css` imports exactly four modules:

- `nexus-v3-foundation.css` — tokens, density, radii, Classic / Glass / Raised material;
- `nexus-v3-components.css` — shared surfaces, controls, tables, dialogs, selection and interaction states;
- `nexus-v3-layout.css` — page-agnostic shell/workspace flow, toolbars, collections, empty states and modal viewport safety;
- `nexus-v3-workspaces.css` — canonical **workspace composition** for complex core screens such as Settings and Nodes.

There must not be another global design layer after `nexus-ui-v3.css`.

## Ownership model

### Foundation owns

- surface material and Appearance modes;
- global radius and border behavior;
- density scale;
- spacing/control tokens;
- compatibility aliases such as `--ui-surface-*` and `--ds-*` while old markup is migrated.

### Components own

- `.card` and shared material surfaces;
- buttons, inputs, selects and segmented controls;
- table visual language;
- dialog material;
- focus / hover / selected states;
- nested-surface depth isolation.

### Layout owns

Only page-agnostic geometry:

- application shell and `.wrap`;
- generic `.view` flow;
- toolbar geometry;
- metric grids;
- low-count collections;
- empty-state sizing;
- tables and generic sparse states;
- editor/canvas exceptions;
- modal viewport safety;
- global responsive shell behavior.

`nexus-v3-layout.css` must **not** contain `.appearance-layout`, `.nodes-page` or any other complex page-specific workspace selector.

### Workspaces owns

Complex first-party management screens whose composition cannot be expressed by generic primitives alone. It currently owns:

- Settings / Appearance composition;
- Nodes fleet composition;
- their container-query breakpoints;
- low-count recomposition unique to those screens.

Workspace rules must be scoped from the page root (`#view > ...`) so one screen cannot accidentally restyle another.

### Feature CSS owns

Only geometry or typography genuinely specific to a feature/editor/dialog, for example XRAY STUDIO, TLS/Reality editors, node routing, diagnostics, user creation or subscription tooling.

Feature CSS must not implement its own Classic / Glass / Raised material, global button system, global card system, `.wrap`, `.view` or application-shell policy.

## Runtime builder

`ui-builder.js` is a **semantic adapter, not a layout engine**.

It may:

- map legacy markup to `data-ui-surface` roles;
- mark cards as `panel`, `table`, `empty`, `editor` or `canvas`;
- expose semantic frame metadata when useful;
- mark reusable card heading anatomy;
- identify metric groups, collections and toolbars;
- observe SPA content added later.

It must **not**:

- move feature DOM nodes to obtain a layout;
- create presentation wrappers;
- measure `getBoundingClientRect()` to guess geometry;
- set element widths/heights from JavaScript;
- duplicate Settings/Nodes rendering logic;
- decide visual width policy from generic semantic labels.

Semantic frame metadata must not be used as a universal width clamp. A CRUD page, Settings page and infrastructure page can all be “management” while needing different useful compositions.

## Surface roles

Use these shared roles:

| Role | Purpose |
| --- | --- |
| `panel` | top-level card/workspace surface |
| `dialog` | modal shell |
| `section` | grouped content inside a surface |
| `metric` | KPI/stat tile |
| `item` | list/selectable item |
| `floating` | popover/dropdown |

Preferred markup:

```html
<section data-ui-surface="section">...</section>
```

Legacy modules may register selectors centrally through `XMeshUIBuilder.register(...)`. Material must still come from the shared system.

## Width contract

The Appearance content-width setting controls the outer `.wrap` allowance directly. It is not a command to stretch every child to that width, and it is not overridden by a generic “management page” cap.

Useful width belongs to composition:

- generic tables/lists use the available workspace naturally;
- complex workspaces may define a deliberate maximum inside `nexus-v3-workspaces.css`;
- editors/canvases may use the complete user-selected width;
- individual controls, text rails and KPI groups choose readable/proportional tracks inside that workspace.

Do not solve ultrawide design by globally shrinking the application. Compose the page.

## Spatial contract

**Content-driven height is the default**.

A surface must not be substantially taller or wider than its meaningful content unless the extra space has a product purpose such as an editor, chart canvas, preview, drop zone or explicit empty state.

Avoid:

- decorative `min-height`;
- forced equal-height cards;
- `flex-grow` used only to fill the viewport;
- oversized padding that simulates importance;
- controls stretched simply because a track is wide;
- tiny information stranded inside a huge card;
- fixed-width KPI bottlenecks on a wide operational surface;
- hidden implicit grid columns;
- `display: contents` used to defeat meaningful workspace wrappers;
- separate full-width rows for tiny metadata that belongs in a toolbar;
- empty modal bodies/footers inherited from a larger editor layout.

**Low-count states recompose.** One or two objects should use available width deliberately instead of preserving fleet-scale columns.

**Do not fill voids with fake UI.** Fix the geometry that created the void.

## Legacy quarantine contract

`frontend/styles/legacy/styles.css` is compatibility debt. It still contains historical rules required by unmigrated markup, including old page-specific layout declarations.

Hard rules:

1. it is loaded only through `@import ... layer(xmesh-legacy)`;
2. it must never return as an ordinary unlayered `<link>`;
3. no new design work is added there;
4. modern modules must not increase selector specificity merely to beat it;
5. when a modern workspace takes ownership, old legacy rules may remain temporarily, but CI must prove they cannot own the rendered cascade;
6. old source-contract tests must not define the current visual architecture.

This quarantine is what lets the panel be migrated incrementally without allowing historical selectors to override the enterprise system.

## Material contract

Appearance remains authoritative:

- `data-surface="solid"` → Classic;
- `data-surface="glass"` → Glass;
- `data-surface="raised"` → Raised.

Glass must use real transparency/backdrop blur unless the OS requests reduced transparency.

Raised is a neutral depth hierarchy, not an accent-tinted theme. Accent belongs to selection, focus, status and primary action.

Nested modal sections do not stack outer shadows or backdrop filters. A dialog has one primary material shell.

Separators are structural and remain quieter than surface borders, including Strong border mode.

## Interaction contract

Bloom is not an interaction primitive.

Generic hover must not use neon glow or `translateY` lift. Selected state must remain more obvious than hover. Keyboard focus uses the shared focus token.

Composite controls have one material shell; inner native inputs remain transparent/borderless.

## Core composition rules

### Settings

Settings uses two real workspace columns on wide desktop: approximately 54/46 rather than six independently positioned cards.

Requirements:

- `.appearance-column` remains a real grid wrapper;
- cards are content-height, never forced equal-height;
- old explicit `grid-area` placement is neutralized;
- title/description anatomy stays quiet and consistent;
- controls use a readable right rail instead of a half-screen stretch;
- palette presets use a stable full-card grid;
- font selection is a structured chooser, not a wrapped sentence;
- custom-palette and range controls reflow before clipping;
- responsive behavior is based on actual workspace width through container queries.

Decorative pseudo-icons must not be generated merely to make Settings look “premium”. Hierarchy comes from typography, spacing, material and grouping.

### Nodes

The active owner is `frontend/styles/features/nodes/nodes.css`; `nodesP()` in
`frontend/js/core/app.js` renders the anatomy. Historical workspace-module
references elsewhere in this document predate the current three-system-module
asset graph, enforced by `scripts/check-ui-system.js`.

- Nodes tracks are anchored to the left workspace edge and capped by density: Compact 40rem, Standard 68rem, Spacious 76rem.
  Cards and their action buttons stop stretching across ultrawide low-count fleets;
  narrower workspaces still shrink the tracks to fit. Global radius settings remain authoritative.
- Compact is the square-card experiment: summary above telemetry, a separating line,
  and three horizontal KPI tiles at readable card widths. Its proportions follow
  content, with no forced aspect ratio or clipped actions. Four action columns fit
  from a 36rem content width; narrower cards retain the two-column fallback.
- The header groups flag/name/endpoint/provider on the left and runtime badges on the right.
- `.node-body` is a real grid: summary 40%, telemetry 60% once the card has room.
- Users and XRAY STUDIO are adjacent summary columns with a vertical divider.
- TLS retains its shield during runtime updates; GeoData retains its status dot.
- Three equal-height KPI tiles share one row above the full telemetry speed rail.
- Actions use four equal columns, four equal columns, then full-width Create Host.
  Only narrow cards reflow to two columns.
- Card depth comes from `--nx-panel-shadow`; accent outer bloom is forbidden.
- Compact / Standard / Spacious change actual fleet track geometry.
- Container queries use card width for anatomy and workspace width for fleet density.
- Icons come from the shared `ic()` SVG renderer.

### User Details

`workspace-dialog-contract.css` owns final dialog geometry; `user-details.css`
owns feature content. The desktop height budget uses the viewport minus its safe margin, so content
can grow beyond the former 54rem cap when the screen has room. Header, usage band and footer stay in flow without shrinking. Three
panes start at the same baseline. `.user-canvas-grid` is the single scroll owner
with a stable scrollbar gutter. `userDrawer()` resets that owner's scroll
position after mounting, including when another user replaces an open dialog.

Browser acceptance lives in `scripts/test-ui-browser.cjs`: real DOM rectangles,
semantic icons after runtime refresh, neutral computed shadow, 4 + 4 + 1 actions,
54rem/viewport bounds, pane baselines, and reopening after a real scroll.
Artifacts include `nodes-{width}x{height}.png` and
`user-details-{width}x{height}.png` at 1920×1080, 2560×1440 and 3440×1440.

### Tables / Users / Squads / Hosts

Short tables are short surfaces. They do not reserve fleet-scale height. Empty page background below real content is preferable to artificial stretching.

Large data sets may use more horizontal space, but form controls and text still need deliberate reading widths.

### Empty states / Templates / Balancers

Empty states stay compact and explicit. They do not become half-screen blank cards.

### Editors

Editors own useful working area. Global compaction must not shrink code, chart, JSON or canvas surfaces that benefit from height or width.

## Migration rule

When touching an old feature:

1. keep behavior/data logic unchanged unless the task explicitly requires behavior work;
2. identify which layer currently owns its geometry before writing CSS;
3. remove competing global-looking material/interaction rules from feature CSS;
4. map legacy markup to shared semantic roles when useful;
5. put reusable generic geometry in `nexus-v3-layout.css`;
6. put complex core workspace geometry in `nexus-v3-workspaces.css`;
7. keep only truly feature-specific geometry in feature CSS;
8. remove obsolete visual contracts/tests instead of preserving them as architectural requirements;
9. never solve a cascade conflict by adding another global override stack.

**New global visual work in it is forbidden** — `styles.css` remains compatibility debt only.

## Frontend ownership audit

For every CSS change, review the whole selector scope, not just the screenshot being repaired.

A feature stylesheet is suspicious if it defines any of the following without a feature root:

- `.wrap`;
- `.view`;
- `.app` shell geometry;
- `.card` material;
- `.btn`, `.gh`, `.seg` global visual language;
- `html[data-surface=...]` or equivalent Appearance forks.

An intentional `display: contents` inside a tightly scoped editor (for example an XRAY STUDIO internal grid) is allowed. It is not allowed as a shortcut that erases a first-class page/workspace wrapper.

## Review checklist

Before merging UI work:

1. Classic / Glass / Raised are visibly distinct.
2. Dark and light themes remain usable.
3. Radius, border and density settings affect the shared primitives.
4. Legacy CSS is loaded only in the `xmesh-legacy` cascade layer.
5. No modern feature adds Appearance material forks.
6. `nexus-v3-layout.css` contains no complex page-specific geometry.
7. Complex workspace selectors are scoped from `#view`.
8. No generic hover glow/lift is introduced.
9. Wide desktop has no accidental dead regions inside a meaningful surface.
10. Ultrawide pages use composition rather than a global shrink cap.
11. Narrow desktop reflows before controls clip or overflow.
12. Low-count states intentionally use available width.
13. Empty states are compact.
14. Editors/canvases retain purposeful workspace.
15. Runtime builder does not move DOM or measure geometry.
16. Old source-contract tests do not dictate current visual architecture.

## CI contract

The primary architecture check is:

```bash
node scripts/check-ui-system.js
```

Nodes composition is additionally protected by:

```bash
node scripts/check-node-grid-layout.js
```

The checks enforce content-addressed runtime assets, the four-module architecture, legacy quarantine, shared material primitives, page-agnostic global layout, scoped Settings/Nodes workspace ownership, non-mutating builder behavior and retirement of the historical override stack.
