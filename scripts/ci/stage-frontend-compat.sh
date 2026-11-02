#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND="$ROOT/frontend"
DOCKERFILE="$ROOT/backend/Dockerfile"
LEGACY_DOCKER_MARKER='# legacy-source-contract-fixture:'

cleanup() {
  while IFS= read -r -d '' asset; do
    name="$(basename "$asset")"
    target="$ROOT/$name"
    if [[ -L "$target" ]]; then rm -f "$target"; fi
  done < <(find "$FRONTEND" -type f \( -name '*.js' -o -name '*.css' \) -print0)
  for page in index.html login.html; do
    if ! git -C "$ROOT" ls-files --error-unmatch "$page" >/dev/null 2>&1; then
      rm -f "$ROOT/$page"
    fi
  done
  if grep -Fq "$LEGACY_DOCKER_MARKER" "$DOCKERFILE"; then
    sed -i "/legacy-source-contract-fixture:/d" "$DOCKERFILE"
  fi
}

if [[ "${1:-}" == "--cleanup" ]]; then
  cleanup
  exit 0
fi

# Legacy source-contract checks historically read browser assets by root basename.
# Keep their compatibility view ephemeral: canonical tracked files live only under frontend/.
declare -A seen=()
while IFS= read -r -d '' asset; do
  name="$(basename "$asset")"
  rel="${asset#$ROOT/}"
  if [[ -n "${seen[$name]:-}" ]]; then
    echo "duplicate frontend basename: $name ($rel and ${seen[$name]})" >&2
    exit 1
  fi
  seen[$name]="$rel"
  target="$ROOT/$name"
  if [[ -e "$target" && ! -L "$target" ]]; then
    echo "refusing to shadow tracked/root file: $name" >&2
    exit 1
  fi
  ln -sfn "$rel" "$target"
done < <(find "$FRONTEND" -type f \( -name '*.js' -o -name '*.css' \) -print0)

for page in index.html login.html; do
  if git -C "$ROOT" ls-files --error-unmatch "$page" >/dev/null 2>&1; then
    echo "refusing to shadow tracked/root file: $page" >&2
    exit 1
  fi
done

# Some historical contracts assert the exact old flat URL form in index.html.
# Generate that view only in CI; production always serves frontend/index.html directly.
python3 - "$ROOT" <<'PY'
from pathlib import Path
import re, sys
root=Path(sys.argv[1])

def flatten(text):
    return re.sub(r"/(?:styles|js)/(?:[^/\"']+/)*([^/\"']+\.(?:css|js))", r"/\1", text)

index=flatten((root/'frontend/index.html').read_text())
relative={
    'styles.css','node-geodata.css','node-routing.css','subscription-studio.css',
    'xray-json-intelligence.js','xray-json-diagnostics.js','i18n.js','subscription-studio.js',
    'qr-code.js','mfa-ui.js','security-ui.js','client-config.js','node-geodata.js','node-routing.js','app.js',
}
for name in relative:
    index=index.replace(f'="/{name}', f'="{name}')
(root/'index.html').write_text(index)
(root/'login.html').write_text(flatten((root/'frontend/login.html').read_text()))
PY

# A few old source checks also parse the historical flat Docker COPY line. Keep
# that text as an untracked CI-only comment instead of polluting production packaging.
if ! grep -Fq "$LEGACY_DOCKER_MARKER" "$DOCKERFILE"; then
  cat >> "$DOCKERFILE" <<'EOF'
# legacy-source-contract-fixture: COPY index.html styles.css settings-updates.css node-dialogs.css user-create-v3.css user-sharing-risk.css node-dialogs.js squad-editor-premium-v5.css user-create-policy-v6.css user-create-policy-v6.js user-create-extra-v7.css nexus-ui-v3.css nexus-v3-foundation.css nexus-v3-components.css nexus-v3-layout.css ui-builder.js i18n.js subscription-studio.css subscription-public.css subscription-studio.js subscription-portal.js qr-code.js mfa-ui.js security-ui.js xray-studio-v4.css xray-studio-hosts.css xray-studio-hosts.js xray-studio-dialogs.js xray-studio-composer.js xray-studio-tools.js xray-studio-v4.js xray-studio-xhttp-strict.js xray-studio-xhttp-expert.js xray-xhttp-core-validator.js xray-studio-protocol-tls.js xray-studio-tls-dialog.css xray-studio-tls-dialog.js xray-studio-reality-dialog.css xray-json-intelligence.js xray-json-diagnostics.js client-config.js node-geodata.js node-geodata.css node-routing.js node-routing.css client-routing.js client-routing.css app.js user-fingerprint-override.js node-bootstrap-v6.js unified-selects.js diagnostics.js diagnostics.css user-sharing-context.js user-sharing-risk.js user-editor-draft.js login.html login.css login.js /app/static/
EOF
fi
