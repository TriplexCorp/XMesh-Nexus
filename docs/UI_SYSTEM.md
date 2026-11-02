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

`ui-builder.js` is a **semantic adapter**, not a layout engine.

It may:

- map legacy markup to `data-ui-surface` roles;
- mark cards as `panel`, `table`, `empty`, `editor` or `canvas`;
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

These attributes describe semantics. CSS decides presentation.

## Spatial contract

Content-driven height is the default.

A surface must not be substantially taller or wider than its meaningful content unless the extra space has a product purpose such as an editor, chart canvas, preview, drop zone or explicit empty state.

Avoid:

- decorative `min-height`;
- forced equal-height cards;
- `flex-grow` used only to fill the viewport;
- oversized padding that simulates importance;
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

Settings is a real two-column workspace on wide desktop. Both columns stretch to available tracks; cards must never collapse to intrinsic narrow widths with a giant middle void. Palette presets use a compact full-width grid. Rows are content-driven and controls align consistently.

### Nodes

The Nodes page has no giant enclosing card. The description/view controls, explorer filters, result meta and node cards are separate composition layers with small deliberate gaps.

A single node expands into a wide two-column card using the existing DOM. Runtime JavaScript must not move node elements into presentation wrappers.

### Tables / Users / Squads / Hosts

Short tables are short surfaces. They do not reserve fleet-scale height. The page background may remain empty below real content; that is preferable to stretching the table card or inventing content.

### Empty states / Templates / Balancers

Empty states stay compact and explicit. They do not become half-screen blank cards.

### Editors

Editors own their useful workspace. Global compaction must not shrink code, chart or canvas areas that benefit from height.

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
8. Narrow desktop reflows before controls clip or overflow.
9. Low-count states intentionally use available width.
10. Empty states are compact.
11. Editors/canvases retain purposeful workspace.
12. Runtime builder does not move DOM or measure geometry.

## CI contract

Run:

```bash
node scripts/check-ui-system.js
```

The check enforces the single v3 entrypoint, production packaging, three-module architecture, material variants, shared primitives, non-mutating builder behavior, spatial rules and retirement of the historical global override stack.
