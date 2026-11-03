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

Preset autofill explicitly refreshes the existing XMeshSelects component so its
visible profile caption matches the updated native select value. Browser checks
verify both values to prevent a stale profile label after choosing a node.

## Host workbench: desktop height acceptance

The full-width assignment row in the previous iteration still followed the
height of the longest preview column. This follow-up makes the preview an
independent sidebar spanning both editing rows. Connection/override fields share
the upper editing area; node assignments span only that editing area below them.
Outer card nesting is removed from editable sections. Empty error state no longer
reserves a phantom grid track in the canonical dialog shell.

Long preview values remain intact in the DOM/title and have a full-value copy
action rather than wrapping an unbounded path into multiple rows. The browser
fixture now contains a 300+ character XHTTP path and seven real nodes. Desktop
acceptance requires workspace scrollHeight <= clientHeight + 1 at 1920×1080 and
2560×1440. Mobile retains a single scroll owner, stable actions and non-overlapping
sections.

Design research: official Geist Modal and Input examples
(https://vercel.com/geist/modal, https://vercel.com/geist/input), and Cloudflare's
responsive dashboard redesign (https://blog.cloudflare.com/redesigning-cloudflare/).
These inform hierarchy and form density; existing XMesh tokens and icon helpers
remain the implementation owners.

## Panel-wide refinement

Shared refinements cover every navigation section: dashboard, statistics, users,
squads, hosts, nodes, templates, XRAY STUDIO, SUBSCRIPTION STUDIO, balancers,
client routing, diagnostics, administrators, security and settings.

- Shared text/select focus is drawn inside the control; user/squad feature focus
  owners no longer add a detached shadow. Host focus screenshots and computed
  outline/shadow assertions cover the reported double-contour defect.
- Nested ordinary cards become separated sections, solid panels lose decorative
  shadows, background tint is reduced without removing appearance modes, table
  headings use readable sentence case, and labels have stronger hierarchy.
- Decorative workspace/delivery/operations headers and redundant CRUD/balancer
  titles are removed. Entity descriptions and Host helper text are concise, with
  matching English translations. Operational warnings and destructive-action
  explanations remain intact.
- Dashboard counts use separators; subscription URL fields lose an extra framed
  container. Diagnostics adapts to its container width, fixing document overflow
  beside the sidebar at 768px. Mobile routing controls reserve usable editor space.
- The browser harness exercises all 15 routes at 390, 768, 1366, 1440, 1920, 2560,
  3440 and 3840px, with document overflow checks and route screenshots at mobile,
  desktop and ultrawide widths. Populated template, balancer and routing editors
  supplement the real user/node/host/squad/profile fixtures. Draft balancers and
  routing templates are reviewed without saving infrastructure changes.

Review artifacts include per-route screenshots, focused Host fields and populated
editors. Native table/JSON scroll boundaries remain available where content is
intrinsically larger than the viewport; the document itself must stay bounded.

Mobile Settings also wraps long updater feedback and version metadata. The
regression fixture includes an unbroken URL token so server-dependent messages
cannot expand the document on narrow viewports.
