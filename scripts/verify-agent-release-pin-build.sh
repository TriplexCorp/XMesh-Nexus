#!/usr/bin/env bash
# Rebuild both reviewed artifacts without granting the candidate any authority.
set -Eeuo pipefail
root="$(cd "$(dirname "$0")/.." && pwd -P)"
node="$(cd "${1:?exact Node checkout required}" && pwd -P)"
record="$(bash "$root/scripts/read-agent-release-pin.sh")"
mapfile -t fields <<< "$record"
version="${fields[0]}"; revision="${fields[1]}"; product="${fields[2]}"; activation="${fields[3]}"; builder="${fields[4]}"
[[ "$(uname -m)" == x86_64 ]] || { echo "Reviewed Agent candidate requires amd64." >&2; exit 1; }
[[ "$(git -c safe.directory="$node" -C "$node" rev-parse HEAD)" == "$revision" ]]
[[ -z "$(git -c safe.directory="$node" -C "$node" status --porcelain)" ]]
[[ "$(tr -d '\r\n' < "$node/AGENT_VERSION")" == "$version" ]]
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
docker run --rm --platform linux/amd64 -v "$node:/src:ro" -v "$out:/out" -w /src/agent/xspv2 "$builder" \
  sh -ec "CGO_ENABLED=0 go build -trimpath -ldflags '-X main.version=$version -X main.sourceRevision=$revision' -o /out/xmesh-agent-xspv2-activate ./cmd/xmesh-agent-xspv2-activate && CGO_ENABLED=0 go build -trimpath -ldflags '-X main.version=$version -X main.sourceRevision=$revision' -o /out/xmesh-agent-xspv2-product ./cmd/xmesh-agent-xspv2-product"
printf "%s  %s\n%s  %s\n" "$activation" "$out/xmesh-agent-xspv2-activate" "$product" "$out/xmesh-agent-xspv2-product" | sha256sum --check --strict
echo "Exact reviewed Agent bytes rebuilt using immutable compiler image; this is not production authorization."
