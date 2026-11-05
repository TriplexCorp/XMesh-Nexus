# English localization contract

English is a complete panel language. Every page, dialog, tooltip, accessible
label, empty/loading state, validation message and asynchronous notification
must have a clear English equivalent. This includes login, MFA, infrastructure
operations and API errors shown by the panel.

Use concise, natural English and consistent terms: **node**, **squad**,
**subscription**, **inbound**, **outbound** and **routing template**. Translate
meaning and instructions rather than Russian word order. Preserve protocol
names, configuration keys and interpolation placeholders exactly.

User-provided names, notes, identifiers, URLs, credentials and configuration
JSON are data, not interface copy. Keep them unchanged. Mark rendered data
with `data-no-translate` where needed; do not apply it to mixed containers that
also contain labels, statuses or instructions.

The canonical catalog and reversible DOM runtime are in
`frontend/js/core/i18n.js`. Dynamic text should use complete message templates
with named placeholders, or choose localized text when constructing the UI.
Do not concatenate untranslated fragments into accessible labels. The custom
select component uses the field caption, not the entire enclosing label.

## Required checks

```sh
npm ci --prefix scripts/browser --ignore-scripts
node scripts/check-english-complete.cjs
node scripts/check-english-coverage.js
```

The complete source audit parses all panel JavaScript, HTML and CSS-generated labels, plus backend
Russian error literals. Every discovered phrase must resolve to English; no
legacy-debt allowlist is permitted. It also checks interpolation slots and
exercises interpolated API messages.

On a **disposable** API/database, with test admin credentials provided through
the environment, run the separate Chromium check:

```sh
XMESH_UI_DISPOSABLE=1 node scripts/test-english-browser.cjs
```

`XMESH_TEST_URL` defaults to `http://127.0.0.1:8080`. Install Playwright Chromium
or provide `CHROMIUM_PATH`. The check visits every panel route, opens entity,
device, routing and Xray dialogs, tests login/MFA error states and verifies
language restoration. It scans rendered text and accessible attributes while
preserving explicitly named fixture data and raw JSON. It creates uniquely
named fixtures and removes them afterward. The English report is retained as
`english-report.json` in `XMESH_BROWSER_OUTPUT`.

Both the source audit and the separate rendered-English check run in CI.
Extend the browser cases when adding a new dialog or dynamic state. Passing a
source audit alone does not prove that assembled runtime text is translated.
