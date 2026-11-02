# XMesh Nexus Spatial Composition

Status: **authoritative implementation contract for workspace geometry**.

The panel must not be redesigned page by page. `ui-system.css` owns material, `design-system-v2.css` owns shared scale and interaction language, and the spatial pipeline owns how rendered content uses the available workspace.

The spatial pipeline exists to put the whole panel on one design conveyor: new pages should inherit sane spacing, low-count behavior, table height, empty-state size and toolbar composition without adding a private layout system.

## Runtime pipeline

The shared stack is loaded in this order:

1. feature CSS;
2. `ui-system.css` — Classic / Glass / Raised material authority;
3. `design-system-v2.css` — control scale, hierarchy and interaction restraint;
4. `spatial-engine.css` — generic content-driven workspace geometry;
5. `spatial-layout.css` — narrow adapters for structures that genuinely cannot be expressed generically;
6. `ui-builder.js` — runtime classifier/composer for SPA content.

`spatial-engine.css` and `spatial-layout.css` must never implement Appearance material branches. They may consume existing shared tokens, but they do not own background themes, border themes, blur modes or elevation modes.

## Runtime classification

`ui-builder.js` observes the SPA and classifies rendered content instead of requiring every feature to reinvent layout primitives.

The main workspace receives:

- `data-ui-flow="workspace"` — content-driven vertical flow;
- `data-ui-page-density="normal|sparse"` — runtime density signal.

Panels may receive:

- `data-ui-layout="panel"` — ordinary content card;
- `data-ui-layout="table"` — tabular/data surface;
- `data-ui-layout="empty"` — intentional empty state;
- `data-ui-layout="sparse"` — content occupies substantially less height than its shell;
- `data-ui-layout="editor"` — purposeful editor workspace, exempt from automatic compaction;
- `data-ui-layout="canvas"` — purposeful canvas/preview workspace, exempt from automatic compaction.

Collections may receive `data-ui-collection`, `data-ui-count` and `data-ui-low-count="expand"`. Metric groups receive `data-ui-metrics`. Toolbars receive `data-ui-toolbar="actions|filters"`.

These attributes describe geometry only. They are not themes.

## Universal spatial rules

### 1. Content-driven height is the default

Ordinary pages, cards, tables and sections hug their content. Fixed height, large `min-height`, `flex-grow: 1`, equal-height grid rows and viewport-filling shells are forbidden unless the surface is explicitly an editor/canvas or has another documented product purpose.

A card must not become tall only because a sibling is tall.

### 2. Low-count states recompose

A collection with one, two or three items must use the available width deliberately instead of preserving a many-column fleet layout with isolated cards and dead space.

The runtime builder exposes the item count so the shared engine can expand low-count collections without feature-specific breakpoints.

Unique rich cards may use a narrow adapter in `spatial-layout.css`. The Nodes single-card workspace is an example: the existing node DOM is recomposed into identity/summary, metrics and actions while preserving all existing handlers and live-update nodes.

### 3. Empty states are compact product states

Empty states must explain what is missing and provide the next useful action, but they must not reserve editor-sized height.

Large whitespace is valid only for an explicit workspace such as a code editor, canvas, preview, map, drop target or visualization that needs the area.

### 4. Tables are data, not giant cards

A table with zero to three rows must remain content-driven. It must not reserve the same height as a large dataset.

Sparse tables may still use the full horizontal workspace when the columns benefit from it, but unused vertical height is not preserved for hypothetical future rows.

### 5. Toolbars spend width on the primary task

Search/filter/action bars should allocate the most width to search or the primary editor control, keep filters/actions compact, wrap deliberately, and avoid separate full-width rows for counters or pagination when those controls fit in the utility rail.

Counters and pagination are metadata, not reasons to push primary content down.

### 6. Do not fill voids with fake UI

When a page has a large empty zone, fix the geometry that caused it. Do not add decorative KPI cards, redundant labels, placeholder illustrations or duplicate controls merely to occupy space.

### 7. Responsive behavior is structural

The pipeline collapses filters and low-count grids progressively. Features should not add arbitrary desktop-only widths to compensate for a broken base layout.

## Purposeful whitespace exceptions

Automatic compaction must not collapse surfaces whose empty area is the product:

- code/configuration editors;
- graph canvases where the selected time range requires a stable plotting area;
- visual previews;
- maps/topologies;
- drag-and-drop targets;
- comparison canvases.

Mark new purposeful workspaces with `data-ui-layout="editor"` or `data-ui-layout="canvas"` when the builder cannot infer the role safely.

## Feature rules

A feature may own content-specific grid semantics, but it must not own a second global spacing system.

Before adding feature CSS for layout:

1. check whether `spatial-engine.css` already expresses the required behavior;
2. prefer semantic markup / runtime spatial attributes;
3. extend the generic engine when the behavior is reusable;
4. use `spatial-layout.css` only for a genuinely unique composition;
5. never add feature-specific Classic / Glass / Raised branches to solve geometry.

## Review gate

Every screen must be reviewed at representative wide and narrow desktop widths.

Fail review when any of the following is visible without a product reason:

- a large blank band between toolbar and primary content;
- a card whose content occupies only a small part of its height;
- a one-item grid leaving most of the workspace unused;
- pagination/count metadata on a dedicated row that pushes content down;
- an empty-state container sized like an editor;
- controls or actions falling below the viewport because preceding geometry reserves unnecessary height;
- equal-height cards where the shorter card contains a large void;
- a table reserving vertical space for rows that do not exist.

## CI

Run:

```bash
node scripts/check-ui-system.js
node scripts/check-spatial-system.js
```

The spatial check verifies asset order, Docker packaging, runtime classification, low-count composition hooks, editor exceptions and the absence of private surface-mode branches in the spatial CSS layers.
