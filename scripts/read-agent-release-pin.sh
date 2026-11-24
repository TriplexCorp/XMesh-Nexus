#!/usr/bin/env bash
# Strict data-only release record: never source or execute repository metadata.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
fail() { printf "%s\n" "$1" >&2; exit 1; }
file=deploy/agent-release-pin.conf
[[ -f "$file" && ! -L "$file" ]] || fail "Missing canonical Agent release record."
mapfile -t values < "$file"
(( ${#values[@]} == 6 )) || fail "Invalid Agent release record inventory."
[[ "${values[0]}" =~ ^version=control-v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Invalid Agent release version."
[[ "${values[0]#version=}" == "$(tr -d '\r\n' < AGENT_VERSION)" ]] || fail "Agent release version mismatch."
[[ "${values[1]}" =~ ^sourceRevision=[a-f0-9]{40}$ ]] || fail "Invalid Agent source revision."
[[ "${values[2]}" =~ ^productSha256=[a-f0-9]{64}$ ]] || fail "Invalid product digest."
[[ "${values[3]}" =~ ^activationSha256=[a-f0-9]{64}$ ]] || fail "Invalid activation digest."
[[ "${values[4]}" =~ ^builder=golang:[0-9]+\.[0-9]+\.[0-9]+-trixie@sha256:[a-f0-9]{64}$ ]] || fail "Invalid immutable Agent builder."
[[ "${values[5]}" =~ ^firstInstallApproved=[01]$ ]] || fail "Invalid first-install approval."
mapfile -t revisions < <(sed -n "s/^const XMESH_V6_NODE_BOOTSTRAP_SHA='\([a-f0-9]\{40\}\)';$/\1/p" frontend/js/features/nodes/node-bootstrap-v6.js)
(( ${#revisions[@]} == 1 )) && [[ "${values[1]#sourceRevision=}" == "${revisions[0]}" ]] || fail "Release and bootstrap source revisions differ."
printf "%s\n" "${values[0]#version=}" "${values[1]#sourceRevision=}" "${values[2]#productSha256=}" "${values[3]#activationSha256=}" "${values[4]#builder=}" "${values[5]#firstInstallApproved=}"
