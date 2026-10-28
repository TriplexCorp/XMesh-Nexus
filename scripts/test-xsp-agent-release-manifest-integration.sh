#!/usr/bin/env bash
set -euo pipefail

# Disposable CI database only. This proves the P0-D Agent release identity table
# is canonical and append-only; it does not activate XSP-v2 or update any Node.
psql_cmd=(docker compose exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d xmesh)
version='control-v99.0.0-p0d-ci'
revision='0123456789abcdef0123456789abcdef01234567'
digest='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

assert_rejected(){
  local label="$1" statement="$2"
  if "${psql_cmd[@]}" -q -c "$statement" >/dev/null 2>&1; then
    printf 'FAIL: %s was accepted\n' "$label" >&2
    exit 1
  fi
}

"${psql_cmd[@]}" -q -c "INSERT INTO node_xsp_agent_release_manifests(version,source_revision,artifact_sha256,created_by) VALUES('$version','$revision','$digest','ci-owner');"

count=$("${psql_cmd[@]}" -Atq -c "SELECT COUNT(*) FROM node_xsp_agent_release_manifests WHERE version='$version' AND source_revision='$revision' AND artifact_sha256='$digest' AND created_by='ci-owner';")
[[ "$count" == '1' ]] || { echo 'FAIL: exact Agent release identity was not stored' >&2; exit 1; }

assert_rejected 'duplicate version rebinding' "INSERT INTO node_xsp_agent_release_manifests(version,source_revision,artifact_sha256,created_by) VALUES('$version','1123456789abcdef0123456789abcdef01234567','1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef','ci-owner');"
assert_rejected 'duplicate source/digest under another version' "INSERT INTO node_xsp_agent_release_manifests(version,source_revision,artifact_sha256,created_by) VALUES('control-v99.0.1-p0d-ci','$revision','$digest','ci-owner');"
assert_rejected 'uppercase source revision' "INSERT INTO node_xsp_agent_release_manifests(version,source_revision,artifact_sha256,created_by) VALUES('control-v99.0.2-p0d-ci','ABCDEF0123456789abcdef0123456789abcdef01','$digest','ci-owner');"
assert_rejected 'short artifact digest' "INSERT INTO node_xsp_agent_release_manifests(version,source_revision,artifact_sha256,created_by) VALUES('control-v99.0.3-p0d-ci','$revision','deadbeef','ci-owner');"
assert_rejected 'manifest update' "UPDATE node_xsp_agent_release_manifests SET artifact_sha256='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' WHERE version='$version';"
assert_rejected 'manifest delete' "DELETE FROM node_xsp_agent_release_manifests WHERE version='$version';"
assert_rejected 'manifest truncate' "TRUNCATE node_xsp_agent_release_manifests;"

count=$("${psql_cmd[@]}" -Atq -c "SELECT COUNT(*) FROM node_xsp_agent_release_manifests WHERE version='$version' AND source_revision='$revision' AND artifact_sha256='$digest';")
[[ "$count" == '1' ]] || { echo 'FAIL: append-only Agent release identity changed after rejection checks' >&2; exit 1; }

echo 'PASS P0-D Agent release manifest: canonical exact identity and append-only DB enforcement'
