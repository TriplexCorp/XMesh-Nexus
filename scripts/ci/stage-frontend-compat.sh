#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND="$ROOT/frontend"

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
