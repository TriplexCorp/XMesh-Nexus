# XMesh Nexus UI System

Status: **authoritative panel appearance contract**.

This document exists to stop feature-by-feature visual forks. New dialogs, cards, workspaces and editor sections must use the shared UI system instead of implementing their own Classic / Glass / Raised surfaces.

## Problem this solves

Historically the panel accumulated feature CSS such as `user-create-*.css`, XRAY STUDIO overrides and multiple Squad editor revisions. The Appearance page changed root settings, but many feature surfaces hard-coded their own `background`, `border`, `box-shadow` and `backdrop-filter`. As a result, selecting **Glass** could change ordinary `.card` elements while a custom dialog still looked opaque.

The rule is now simple:

> Feature styles own geometry. `ui-system.css` owns material.

Geometry means grid, width, height, padding required by the feature, overflow, responsive layout and content-specific typography. Material means background, border treatment, elevation, blur/transparency and shared radius.

## Runtime files

- `ui-system.css` — final stylesheet loaded after all feature CSS. It converts Appearance settings into shared material tokens and applies them to registered surfaces.
- `ui-builder.js` — runtime role builder. It tags dynamic DOM with `data-ui-surface` and observes future content added by the SPA.
- `scripts/check-ui-system.js` — CI contract. It ensures the final layer stays final, packaged, documented and connected to the three Appearance surface choices.

## Surface roles

Use only these roles for ordinary panel material:

| Role | Use |
| --- | --- |
| `panel` | top-level workspace/card surface |
| `dialog` | modal shell |
| `section` | grouped content inside panel/dialog |
| `metric` | KPI/stat tile |
| `item` | selectable/list item |
| `floating` | popover/dropdown surface |

Preferred markup:

```html
<section data-ui-surface="section">...</section>
```

or at runtime:

```js
window.XMeshUIBuilder.surface(element, 'section');
```

A module may register one legacy selector centrally:

```js
window.XMeshUIBuilder.register('.my-existing-widget', 'panel');
```

Do **not** create `my-feature-glass.css`, `my-feature-raised.css`, or root selectors such as `html[data-surface=glass] .my-widget` inside feature styles.

## Appearance mapping

The existing Appearance setting remains the source of truth:

- `data-surface="solid"` → **Классика / Classic**
- `data-surface="glass"` → **Glass**
- `data-surface="raised"` → **Объём / Raised**

`ui-system.css` maps those values to tokens such as:

- `--ui-surface-panel-bg`
- `--ui-surface-section-bg`
- `--ui-surface-item-bg`
- `--ui-surface-control-bg`
- `--ui-surface-border`
- `--ui-surface-panel-shadow`
- `--ui-surface-filter`

The same mechanism consumes global radius/border/density settings. A feature must not copy their values.

## Glass requirement

Glass is not just a slightly different color. Registered surfaces must visibly use both transparency and `backdrop-filter`. Inputs and selects participate in the same material so a Glass dialog does not contain opaque form islands.

`prefers-reduced-transparency` is respected: when the OS asks for less transparency the material safely falls back to opaque surfaces.

## Radius and borders

- panel/card radius → `--ui-radius` through `--ui-surface-panel-radius`;
- controls/buttons → existing `--ui-control-radius` contract;
- border visibility/strength comes from the global `data-borders` state;
- features must not hard-code a second appearance system.

A content-specific circular control may remain circular.

## Density

Existing `data-density` remains authoritative. Shared surface spacing tokens are:

- `--ui-space-section`
- `--ui-space-item`

Feature layout may use additional spacing only when dictated by content. New generic panels should use these tokens rather than fixed pixel spacing.

## Legacy adaptation

`ui-builder.js` contains a small centralized compatibility registry for legacy feature selectors. This registry is the only acceptable place to adapt old markup to shared surface roles.

When touching an old feature:

1. remove hard-coded material declarations from its feature CSS where practical;
2. use semantic `<section>` / `.card` markup or `data-ui-surface`;
3. remove its entry from the compatibility registry once it no longer needs one.

The target state is a shrinking registry, not an expanding list of per-feature theme overrides.

## CSS load order

`ui-system.css` **must be the final panel stylesheet**. This is intentional: it prevents a feature stylesheet from silently defeating Appearance after the user changes Classic / Glass / Raised.

`ui-builder.js` loads after feature scripts and observes dynamically rendered SPA content.

## Review checklist for every new UI

Before merging a new screen/dialog:

1. Change Appearance between Classic, Glass and Raised. The surface must visibly change.
2. Change border mode. The same screen must follow it.
3. Change radius. Panels and controls must follow the shared radius contract.
4. Change density and content width. Layout must remain usable.
5. Check dark and light theme.
6. Do not add a feature-specific `html[data-surface=...]` implementation.
7. If the feature needs a new generic visual role, extend the shared system and documentation instead of creating a private theme.

## Squad editor reference

The Squad editor is a migration/reference case. Its layout-specific CSS can still define the two-column editor, inbound list geometry and impact arrangement, while its material is overridden by `ui-system.css`. Selecting Glass therefore changes the modal shell, sections, KPI tiles, inbound items and form controls together.

## CI contract

Run:

```bash
node scripts/check-ui-system.js
```

The check verifies asset order, Docker packaging, root Appearance mapping, builder roles and the absence of new Squad-specific Classic/Glass/Raised forks.
