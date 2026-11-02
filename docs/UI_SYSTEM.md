# XMesh Nexus Design System v3

Status: **authoritative panel design and composition contract**.

The v3 refactor replaces the historical global stack (`global-hover.css`, `ui-system.css`, `design-system-v2.css`, `spatial-engine.css`, `spatial-layout.css`) with one presentation entrypoint: `nexus-ui-v3.css`.

The goal is simple: **the panel must be designed as a system, not repaired page by page.**

## Active architecture

The browser loads CSS in this order:

1. `styles.css` — legacy structural/base compatibility. Existing markup still depends on it; **do not add new global design rules here**.
2. feature CSS — geometry unique to a feature/editor/dialog.
3. `nexus-ui-v3.css` — the only global presentation entrypoint.

`nexus-ui-v3.css` imports exactly three modules:

- `nexus-v3-foundation.css` — tokens, density, radii, Classic / Glass / Raised material;
- `nexus-v3-components.css` — shared surfaces, controls, tables, dialogs, selection and interaction states;
- `nexus-v3-layout.css` — workspace flow, toolbars, low-count collections, empty states and the small number of genuinely unique core layouts.

There must not be another global CSS layer after `nexus-ui-v3.css`.

## Ownership model

### Foundation owns

- surface material and Appearance modes;
- global radius and border behavior;
- density scale;
- spacing/control tokens;
- compatibility aliases such as `--ui-surface-*` and `--ds-*` while legacy features are migrated.

### Components own

- `.card` / shared surfaces;
- buttons, inputs, select controls and segmented controls;
- table visual language;
- dialog material;
- focus / hover / selected states;
- nested-surface depth isolation.

### Layout owns

- page/workspace rhythm;
- workspace frame width policy;
- toolbar geometry;
- metric grids;
- low-count collections;
- empty-state sizing;
- responsive reflow;
- Settings composition;
- Nodes composition;
- modal viewport safety.

### Feature CSS owns

Only geometry or typography that is genuinely specific to that feature, for example the XRAY STUDIO editor, TLS workspace, node routing editor or a specialized dialog layout.

Feature CSS must not implement its own Classic / Glass / Raised theme, global button system, global card system or page-wide spacing policy.

## Runtime builder

`ui-builder.js` is a semantic adapter, not a layout engine.

It may:

- map legacy markup to `data-ui-surface` roles;
- mark cards as `panel`, `table`, `empty`, `editor` or `canvas`;
- classify a workspace frame as `management`, `data` or `canvas` from semantic content;
- mark reusable card heading anatomy without inserting presentation wrappers;
- identify metric groups, collections and toolbars;
- observe SPA content added later.

It must **not**:

- move feature DOM nodes to obtain a layout;
- create wrapper elements for presentation;
- measure `getBoundingClientRect()` to guess whether a card looks empty;
- set widths/heights from JavaScript;
- duplicate page-specific rendering logic.

If a layout cannot be expressed cleanly in CSS, fix the markup at its renderer instead of adding runtime geometry hacks.

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

Legacy modules may register a selector centrally through `XMeshUIBuilder.register(...)`. Do not add private material implementations.

## Layout roles

Cards/workspaces may receive:

- `data-ui-layout="panel"`
- `data-ui-layout="table"`
- `data-ui-layout="empty"`
- `data-ui-layout="editor"`
- `data-ui-layout="canvas"`

Collections may receive:

- `data-ui-collection`
- `data-ui-count`
- `data-ui-low-count="expand"`

Toolbars receive `data-ui-toolbar="actions|filters"`.

Views receive one workspace frame:

- `data-ui-frame="management"` — ordinary CRUD, settings and infrastructure screens;
- `data-ui-frame="data"` — tables and data-dense operational screens;
- `data-ui-frame="canvas"` — editors, charts and other work areas whose value comes from width.

These attributes describe semantics. CSS decides presentation.

## Workspace frame contract

The Appearance content-width setting is an **outer allowance**, not an instruction to stretch every control and card until that width is consumed.

On wide screens:

- `management` is capped at `120rem` even if the user selected a larger content width;
- `data` may use up to `138rem`;
- `canvas` may use the complete user-selected `--panel-content-max` value.

The cap disappears naturally on smaller viewports because the workspace is still `width:100%`. This keeps ordinary screens composed on ultrawide monitors while preserving full width for XRAY STUDIO, analytical canvases and other purposeful work areas.

A page must not opt into `canvas` merely to avoid fixing bad composition.

## Spatial contract

Content-driven height is the default.

A surface must not be substantially taller or wider than its meaningful content unless the extra space has a product purpose such as an editor, chart canvas, preview, drop zone or explicit empty state.

Avoid:

- decorative `min-height`;
- forced equal-height cards;
- `flex-grow` used only to fill the viewport;
- oversized padding that simulates importance;
- controls stretched simply because a track is wide;
- separate full-width rows for a tiny count/status that could live in a toolbar;
- small cards stranded in a huge low-count grid;
- empty modal bodies/footers inherited from a larger editor layout.

Low-count states recompose. One or two objects should use available width deliberately instead of preserving fleet-scale columns.

Do not fill voids with fake UI. Fix the geometry that created the void.

## Purposeful whitespace exceptions

Large whitespace is allowed for:

- code/editor workspaces;
- analytical charts/canvases;
- intentional previews;
- user-generated-content work areas;
- clear empty states.

XRAY STUDIO and explicit `[data-ui-editor]` surfaces are protected from generic compaction.

## Material contract

Appearance remains authoritative:

- `data-surface="solid"` → Classic;
- `data-surface="glass"` → Glass;
- `data-surface="raised"` → Raised.

Glass must use real transparency/backdrop blur unless the OS requests reduced transparency.

Raised is a neutral depth hierarchy, not an accent-tinted theme. Accent belongs to selection, focus and primary actions.

Nested modal sections do not stack outer shadows or backdrop filters. A dialog has one primary material shell.

Separators are structural and remain quieter than surface borders, including in Strong border mode.

## Interaction contract

Bloom is not an interaction primitive.

Generic hover must not use neon glow or `translateY` lift. Selected state must remain more obvious than hover. Keyboard focus uses the shared focus token.

Composite controls have one material shell; inner native inputs remain transparent/borderless.

## Core composition rules

### Settings

Settings is a real two-column workspace on wide desktop. Columns are balanced rather than stretched into one huge control rail. Card headings form a consistent anatomy, explanatory copy stays readable, and the control rail has a deliberate maximum instead of consuming half of an ultrawide card. Palette presets use a compact full-width grid. Rows remain content-driven and controls align consistently.

### Nodes

The Nodes page has no giant enclosing card. The description/view controls, explorer filters, result meta and node cards are separate composition layers with small deliberate gaps.

Search/filter controls have deliberate working widths instead of equal-fr stretching. A single node expands into a wide two-zone card using the existing DOM, but KPI tiles and the speed rail stop growing after they reach a useful reading width. Runtime JavaScript must not move node elements into presentation wrappers.

### Tables / Users / Squads / Hosts

Short tables are short surfaces. They do not reserve fleet-scale height. The page background may remain empty below real content; that is preferable to stretching the table card or inventing content.

Data-dense pages may use the wider `data` frame, but controls inside them still need deliberate widths.

### Empty states / Templates / Balancers

Empty states stay compact and explicit. They do not become half-screen blank cards.

### Editors

Editors own their useful workspace. Global compaction must not shrink code, chart or canvas areas that benefit from height or width.

## Migration rule

When touching an old feature:

1. keep behavior/data logic unchanged;
2. remove global-looking material/interaction declarations from feature CSS;
3. map legacy markup to shared roles when needed;
4. move reusable geometry into v3 layout primitives;
5. keep only truly feature-specific geometry in the feature stylesheet;
6. remove obsolete compatibility rules/tests rather than layering another override.

`styles.css` is compatibility debt. New global visual work in it is forbidden. Over time its presentation rules should shrink as renderers are migrated.

## Review checklist

Before merging UI work:

1. Classic / Glass / Raised all remain visibly distinct.
2. Dark and light themes are usable.
3. Radius, border and density settings affect the same shared primitives.
4. No new global stylesheet is loaded after `nexus-ui-v3.css`.
5. No feature stylesheet adds `html[data-surface=...]` variants.
6. No generic hover glow/lift is introduced.
7. Wide desktop has no accidental dead regions inside surfaces.
8. Ultrawide management pages do not mechanically stretch controls to the content-width ceiling.
9. Narrow desktop reflows before controls clip or overflow.
10. Low-count states intentionally use available width.
11. Empty states are compact.
12. Editors/canvases retain purposeful workspace.
13. Runtime builder does not move DOM or measure geometry.

## CI contract

Run:

```bash
node scripts/check-ui-system.js
```

The check enforces the single v3 entrypoint, production packaging, three-module architecture, material variants, shared primitives, semantic workspace frames, non-mutating builder behavior, spatial rules and retirement of the historical global override stack.
