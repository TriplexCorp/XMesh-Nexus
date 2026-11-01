# XMesh Nexus UI System

Status: **authoritative panel appearance and composition contract**.

This document exists to stop feature-by-feature visual forks. New dialogs, cards, workspaces and editor sections must use the shared UI system instead of implementing their own Classic / Glass / Raised surfaces or private visual language.

## Problem this solves

Historically the panel accumulated feature CSS such as `user-create-*.css`, XRAY STUDIO overrides and multiple Squad editor revisions. The Appearance page changed root settings, but many feature surfaces hard-coded their own `background`, `border`, `box-shadow` and `backdrop-filter`. At the same time the panel accumulated a second problem: controls became small, pages gained too many nested cards, and accent hover effects turned into visible bloom.

The rule is now:

> Feature styles own geometry. `ui-system.css` owns material.

`design-system-v2.css` owns shared scale, composition and interaction restraint. It is deliberately separate from material: it may make controls larger, flatten an unnecessary toolbar container, or establish a shared page rhythm, but it must consume the material tokens from `ui-system.css` rather than creating another Classic / Glass / Raised implementation.

Geometry means grid, width, height, padding required by the feature, overflow, responsive layout and content-specific typography. Material means background, border treatment, separators, elevation, blur/transparency and shared radius. Shared composition means the cross-panel control scale, hierarchy, page spacing and interaction language used to keep those feature layouts coherent.

## Runtime files

- `ui-system.css` — material authority. It converts Appearance settings into shared material tokens and applies them to registered surfaces.
- `design-system-v2.css` — final presentation layer. It consumes material tokens and owns shared control scale, hierarchy, restrained hover/focus behavior and high-level composition for core workspaces.
- `ui-builder.js` — runtime role builder. It tags dynamic DOM with `data-ui-surface` and observes future content added by the SPA.
- `scripts/check-ui-system.js` — CI contract. It ensures both shared layers are packaged, ordered and kept free of feature-specific material forks.

## Design direction

The product uses a **calm enterprise** visual language:

- the primary workspace is visually dominant;
- secondary toolbars are quiet and should not look like another card unless they genuinely need their own surface;
- controls are large enough to read and target comfortably at normal desktop zoom;
- accent is reserved for selection, focus and primary actions;
- nested surfaces are minimized;
- typography hierarchy does more work so borders and backgrounds can do less;
- hover is a state change, not a special effect.

Bloom is not an interaction primitive. Ordinary hover must not add neon glow, large accent shadows or `translateY` lift. Primary actions may change tone or border contrast, while neutral controls use a quiet surface/border delta. Persistent selection must remain more obvious than hover.

## Surface roles

Use only these roles for ordinary panel material:

| Role | Use |
| --- | --- |
| `panel` | top-level workspace/card surface |
| `dialog` | modal shell |
| `section` | grouped content inside a page/panel; modal use must be explicit |
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
- `--ui-surface-dialog-bg`
- `--ui-surface-section-bg`
- `--ui-surface-item-bg`
- `--ui-surface-control-bg`
- `--ui-surface-border`
- `--ui-separator`
- `--ui-surface-panel-shadow`
- `--ui-surface-dialog-shadow`
- `--ui-surface-control-shadow`
- `--ui-surface-filter`

The same mechanism consumes global radius/border/density settings. A feature must not copy their values.

## Shared composition tokens

`design-system-v2.css` defines presentation tokens such as:

- `--ds-control-h` — default interactive control height;
- `--ds-card-pad` — shared top-level panel padding;
- `--ds-page-gap` / `--ds-section-gap` — workspace rhythm;
- `--ds-hover-bg` / `--ds-hover-border` — restrained neutral hover;
- `--ds-selected-bg` / `--ds-selected-border` — persistent selected state;
- `--ds-focus` — shared keyboard focus ring.

These tokens must not encode a surface mode. In particular, `design-system-v2.css` must not contain `html[data-surface=solid|glass|raised]` branches.

## Raised depth model

Raised is a **depth hierarchy**, not an accent-tinted theme.

- top-level `panel`, `dialog` and `floating` surfaces own the strongest outer elevation;
- `section` surfaces use a lower neutral depth level;
- `metric` / `item` surfaces use restrained local elevation;
- ordinary controls may use a subtle `--ui-surface-control-shadow`, while Classic controls remain intentionally flat;
- ordinary rows inside a card are not automatically promoted into surfaces;
- the accent color is reserved for focus, selected state and deliberate emphasis rather than mixed into every section background.

Light theme must preserve a visibly larger depth delta between Classic and Raised. `#fff` and the light secondary surface are too close for a small tone mix to communicate a mode change by themselves, so light Raised uses an explicit neutral tonal ladder plus stronger multi-level shadows. The difference must remain obvious at normal zoom without relying on accent tinting.

Generic segmented controls are selection controls, not glow effects. Their track follows the shared material, while the final composition layer intentionally reduces active-state bloom and keeps the selected pill recognizable through tone, border and typography.

## Glass requirement

Glass is not just a slightly different color. Registered outer surfaces must visibly use transparency and `backdrop-filter`.

Nested modal groups are different: the dialog shell already owns the blur, so inner modal sections and controls must **not stack additional backdrop filters**. They use translucent fills on top of the blurred shell instead. This avoids muddy double-blur and opaque-looking form islands.

`prefers-reduced-transparency` is respected: when the OS asks for less transparency the material safely falls back to opaque surfaces.

## Modal layering contract

A modal has exactly one primary material shell.

- `dialog .box` / `data-ui-surface="dialog"` owns the modal background, border, radius, blur and outer shadow.
- A plain semantic `<section>` inside a dialog is structural by default and is **not automatically promoted** to a surface by `ui-builder.js`.
- If a modal group genuinely needs separation, mark/register it explicitly as `section`; shared modal-context rules will keep it flat and restrained.
- Nested modal `section`, `metric` and `item` surfaces do not receive outer shadows or their own backdrop blur.
- Inputs/selects inside a dialog use the modal control token and do not stack blur over the dialog shell.

Do not solve modal hierarchy by adding another feature-specific card background or shadow.

## Separator hierarchy

Separators are structural, not surface borders.

A one-pixel divider between rows must use `--ui-separator`, not `--ui-surface-border`, `--ui-surface-border-strong` or a raw `var(--ln)` color. Separators deliberately remain low-contrast in Glass and Raised so a card does not become a stack of ruled horizontal bands.

The global **Strong / Яркие** border mode strengthens actual surface and control boundaries only. It must **not** amplify row separators. `data-borders="off"` removes both borders and separators.

Legacy `.setting-row` dividers are adapted centrally by `ui-system.css`; `design-system-v2.css` may reduce their visual contrast further, but it must not turn each row into a card.

## Composite controls

A composite control has exactly one material shell.

Examples include `36 px`, search fields with an embedded icon/button, unit inputs and controls where several interactive/text elements visually form one capsule. The outer shell owns background, border, radius and any material treatment. Inner native inputs must remain transparent, borderless and shadowless.

Preferred markup:

```html
<label data-ui-control="shell">
  <input data-ui-control="inner" type="number">
  <span>px</span>
</label>
```

Do not allow the global input material to paint an inner field again. That creates hard rectangular seams inside a rounded capsule, especially visible in Glass.

## Core workspace composition

### Nodes

The fleet explorer is a toolbar, not a second large card. Search and filters remain first-class controls but the explorer shell itself is flattened. Node cards are deliberately larger at low node counts, metric tiles are quieter, and action buttons use the shared control height.

### Settings

Appearance settings use a larger vertical rhythm. Setting rows remain flat content inside their parent card; labels and descriptions carry hierarchy so horizontal rules can stay subtle. Controls should not look like a collection of unrelated tiny pills.

### XRAY STUDIO

XRAY STUDIO is editor-first. The code workspace is the visual anchor; top navigation and inline tools are secondary chrome. Toolbars therefore use quiet separators instead of nested card backgrounds, controls are larger, and the document inspector remains a restrained side pane.

## Radius and borders

- panel/card/dialog radius → `--ui-radius` through `--ui-surface-panel-radius`;
- controls/buttons → existing `--ui-control-radius` contract;
- border visibility/strength comes from the global `data-borders` state;
- strong borders may use the accent, but they must not turn neutral surfaces into accent-filled slabs or row separators into rulers;
- features must not hard-code a second appearance system.

A content-specific circular control may remain circular.

## Density

Existing `data-density` remains authoritative for material spacing. The design layer establishes the comfortable default control scale and may give core workspaces explicit low-count/readability rules. Compact mode must remain usable without reverting to tiny text.

Shared material spacing tokens remain:

- `--ui-space-section`
- `--ui-space-item`

## Legacy adaptation

`ui-builder.js` contains a small centralized compatibility registry for legacy feature selectors. This registry is the only acceptable place to adapt old markup to shared surface roles.

When touching an old feature:

1. remove hard-coded material declarations from its feature CSS where practical;
2. use semantic `<section>` / `.card` markup or `data-ui-surface`;
3. do not auto-cardify ordinary rows merely because they are visually grouped;
4. convert hard `var(--ln)` row dividers to `--ui-separator` when they are structural rather than surface boundaries;
5. for compound fields, make one shell own material and keep inner inputs transparent;
6. remove its entry from the compatibility registry once it no longer needs one.

## CSS load order

Feature CSS loads first. `ui-system.css` loads after feature CSS and remains the material authority. `design-system-v2.css` loads last as the cross-panel composition/interaction layer.

The final design layer may consume material tokens and override excessive feature geometry, but it must not define its own Classic / Glass / Raised branches. This ordering lets us simplify legacy feature chrome without reintroducing material forks.

`ui-builder.js` loads after feature scripts and observes dynamically rendered SPA content.

## Review checklist for every new UI

Before merging a new screen/dialog:

1. Change Appearance between Classic, Glass and Raised. The surface must visibly change without recoloring every inner row; in light theme, Classic and Raised must remain plainly distinguishable at normal zoom.
2. Open a modal in all three modes. It must have one clear shell and must not become a stack of nested cards.
3. Change border mode. The same screen must follow it without accent flooding or hardening internal row separators.
4. Inspect compound/unit controls at high zoom. There must be only one visible capsule with no rectangular inner-input seams.
5. Change radius. Panels, dialogs and controls must follow the shared radius contract.
6. Change density and content width. Layout must remain usable and readable.
7. Check dark and light theme.
8. Hover neutral and primary actions. There must be no generic neon bloom or lift animation.
9. Do not add a feature-specific `html[data-surface=...]` implementation.
10. If the feature needs a new generic visual role, extend the shared system and documentation instead of creating a private theme.

## CI contract

Run:

```bash
node scripts/check-ui-system.js
```

The check verifies asset order, Docker packaging, root Appearance mapping, builder roles, perceptible Raised light-mode depth, modal isolation, separator hierarchy, composite-control ownership, Design System v2 anti-bloom/scale rules and the absence of new feature-specific Classic/Glass/Raised forks.