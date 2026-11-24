#!/usr/bin/env bash
# Full panel installation must not report success with an unenrollable Agent.
# This check does not approve a new release or trust the staging candidate.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
fail() { printf '%s\n' "$1" >&2; exit 1; }

supplied="${XSP_V2_PRODUCT_AGENT_PIN:-}"
stored=""
if [[ -f .env ]]; then
  mapfile -t pins < <(sed -n 's/^XSP_V2_PRODUCT_AGENT_PIN=//p' .env)
  (( ${#pins[@]} <= 1 )) || fail 'Multiple approved Agent pins in .env; refusing ambiguous release identity.'
  # Compose accepts whitespace and export syntax too. Do not allow another
  # assignment to override the canonical line that install.sh preserves.
  mapfile -t assignments < <(grep -E '^[[:space:]]*(export[[:space:]]+)?XSP_V2_PRODUCT_AGENT_PIN[[:space:]]*=' .env || true)
  (( ${#assignments[@]} == ${#pins[@]} )) || fail 'Noncanonical approved Agent pin assignment in .env.'
  if (( ${#pins[@]} == 1 )) && [[ -z "${pins[0]}" ]]; then
    fail 'Empty approved Agent pin in .env; remove the empty assignment before installation.'
  fi
  stored="${pins[0]:-}"
fi
for pin in "$supplied" "$stored"; do
  if [[ -n "$pin" && ! "$pin" =~ ^[a-f0-9]{40}:[a-f0-9]{64}$ ]]; then
    fail 'Invalid approved Agent pin; expected source SHA:artifact SHA-256.'
  fi
done
if [[ -n "$supplied" && -n "$stored" && "$supplied" != "$stored" ]]; then
  fail 'Refusing to replace the previously approved Agent identity.'
fi
pin="${supplied:-$stored}"
[[ -n "$pin" ]] || fail 'No approved Agent release identity. Provide XSP_V2_PRODUCT_AGENT_PIN from the reviewed release before installing Nexus.'
mapfile -t revisions < <(sed -n "s/^const XMESH_V6_NODE_BOOTSTRAP_SHA='\([a-f0-9]\{40\}\)';$/\1/p" frontend/js/features/nodes/node-bootstrap-v6.js)
(( ${#revisions[@]} == 1 )) || fail 'Cannot determine the exact Node bootstrap revision.'
[[ "${pin%%:*}" == "${revisions[0]}" ]] || fail 'Approved Agent source does not match the Node bootstrap revision shipped by this Nexus.'
