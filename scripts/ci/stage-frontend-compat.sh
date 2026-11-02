#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND="$ROOT/frontend"

cleanup() {
  while IFS= read -r -d '' asset; do
    name="$(basename "$asset")"
    target="$ROOT/$name"
    if [[ -L "$target" ]]; then rm -f "$target"; fi
  done < <(find "$FRONTEND" -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' \) -print0)
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
done < <(find "$FRONTEND" -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' \) -print0)
