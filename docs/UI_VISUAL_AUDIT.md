# Panel visual audit — 2026-11-03

This pass preserves the current design system and appearance settings. It fixes
reproduced layout defects rather than introducing a new visual style.

## Findings fixed

- Template editor: sticky footer painted over the final fields; the first-use
  countdown switch could appear below the action buttons. Template and admin
  editors now have a dedicated scrolling field body with a reserved footer.
  Input names, delegated events and submit handlers are unchanged.
- Shared checkbox choices: long unbroken names could exceed the label boundary.
  The existing `.ck` component now bounds its width and wraps its text child.
- Squad inbound search: the nested input inherited generic control materials,
  producing a second border and background inside the search shell. The shared
  search component now owns only one material shell.
- Scrolling editor fields reserve a small inset so keyboard focus outlines are
  not cut off at the body boundary.

## Ownership and validation

- Markup: `frontend/js/core/app.js` (`entForm`, template/admin editor wrapper).
- Ordinary editor geometry: `styles/system/workspace-dialog-contract.css`.
- Choice component: `styles/system/nexus-v3-components.css`.
- Search component: `styles/system/nexus-v3-layout.css`.
- Existing Chromium harness visits all 16 panel routes and existing appearance,
  editor, workspace and interaction scenarios. New cases exercise template/admin
  field containment at 1366×768, 1920×1080 and 390×844, including a long unbroken
  squad name. Squad search assertions reject nested borders/shadows.
- Screenshot review includes template/admin dialogs, squad editor, routing,
  balancers and diagnostics. This pass does not claim that every possible data
  state in every section has been exhaustively reviewed.

Canonical cache keys are regenerated with `node scripts/update-ui-cache.cjs`.

## Populated Squad editor follow-up

The empty-list screenshot did not expose the cramped nested inbound scroller.
The Squad feature stylesheet now places compact settings and impact information
in the left rail, with the wider inbound list on the right. The list grows in
normal flow and the workspace remains the single scroll owner. Header decoration
and nested impact card borders are reduced, supporting text is larger, inbound
names wrap, and Save uses the shared accent/foreground tokens.

Browser coverage adds six real inbound choices, desktop/mobile geometry,
search/select-all/clear interactions, enabled Save state and screenshots at
1920×1080, 2560×1440, 1366×768 and 390×844. New profiles are loaded before opening
the editor, so these cases exercise the actual renderer with populated data.

## Host editor redesign

The host editor retains three permanent editing zones and all existing field names
and data attributes. The primary rail is wider; public fields use
aligned pairs, paired port/country inputs align, and node assignments form a bounded
choice grid in a full-width assignment rail below the editing zones. Semantic SVG headings distinguish connection, overrides and preview.
The preview consumes the existing section material without another nested panel.
Obsolete feature-level sticky-footer rules are removed; dialog geometry and its
single scroll owner remain in the canonical workspace contract. All controls and
panels use shared radius/material tokens.

Regression cases use a real TLS/XHTTP profile and a real node fleet at 1920×1080,
2560×1440 and 390×844. They exercise preset autofill, SNI preview, reset overrides,
semantic heading icons, field baselines and responsive section containment.
