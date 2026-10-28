#!/usr/bin/env bash
set -euo pipefail

# Disposable CI database only. This proves the P0-D Agent release identity is
# canonical/append-only and that a future staging caller can atomically bind
# one exact manifest to the existing fixed-action update_agent queue. Nothing
# here activates XSP-v2 or changes the production API/Agent path.
psql_cmd=(docker compose exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d xmesh)
version='control-v99.0.0-p0d-ci'
revision='0123456789abcdef0123456789abcdef01234567'
digest='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
node=990001
public_key='1111111111111111111111111111111111111111111111111111111111111111'

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

# The migration binding reuses the existing authenticated single-flight command
# table. Seed only a disposable node identity so the FK is real.
"${psql_cmd[@]}" -q -c "INSERT INTO node_metric_keys(node_id,public_key) VALUES($node,'$public_key');"

binding=$("${psql_cmd[@]}" -Atq -F '|' -c "SELECT command_id,manifest_id,version,source_revision,artifact_sha256 FROM stage_node_xsp_agent_migration($node,'$version','ci-owner');")
IFS='|' read -r command_id manifest_id bound_version bound_revision bound_digest <<< "$binding"
[[ "$command_id" =~ ^[1-9][0-9]*$ ]] || { echo 'FAIL: migration command ID missing' >&2; exit 1; }
[[ "$manifest_id" =~ ^[1-9][0-9]*$ ]] || { echo 'FAIL: migration manifest ID missing' >&2; exit 1; }
[[ "$bound_version" == "$version" && "$bound_revision" == "$revision" && "$bound_digest" == "$digest" ]] || {
  echo 'FAIL: migration binding did not return exact immutable release identity' >&2; exit 1;
}

row=$("${psql_cmd[@]}" -Atq -F '|' -c "SELECT action,target_version,release_manifest_id,requested_by,state FROM node_restart_commands WHERE id=$command_id;")
[[ "$row" == "update_agent|$version|$manifest_id|ci-owner|pending" ]] || {
  echo "FAIL: migration command was not bound to fixed update_agent identity: $row" >&2; exit 1;
}

# Normal queue lifecycle state changes remain legal while identity fields are frozen.
"${psql_cmd[@]}" -q -c "UPDATE node_restart_commands SET state='claimed',claimed_at=NOW() WHERE id=$command_id;"
row=$("${psql_cmd[@]}" -Atq -F '|' -c "SELECT action,target_version,release_manifest_id,state FROM node_restart_commands WHERE id=$command_id;")
[[ "$row" == "update_agent|$version|$manifest_id|claimed" ]] || {
  echo 'FAIL: normal command state transition broke immutable binding' >&2; exit 1;
}

assert_rejected 'bound target version rewrite' "UPDATE node_restart_commands SET target_version='control-v99.9.9-p0d-ci' WHERE id=$command_id;"
assert_rejected 'bound manifest removal' "UPDATE node_restart_commands SET release_manifest_id=NULL WHERE id=$command_id;"
assert_rejected 'bound action rewrite' "UPDATE node_restart_commands SET action='restart_xray' WHERE id=$command_id;"
assert_rejected 'second active migration command' "SELECT * FROM stage_node_xsp_agent_migration($node,'$version','ci-owner');"
assert_rejected 'unknown release migration' "SELECT * FROM stage_node_xsp_agent_migration(990002,'control-v404.0.0','ci-owner');"

row=$("${psql_cmd[@]}" -Atq -F '|' -c "SELECT c.action,c.target_version,m.source_revision,m.artifact_sha256,c.state FROM node_restart_commands c JOIN node_xsp_agent_release_manifests m ON m.id=c.release_manifest_id WHERE c.id=$command_id;")
[[ "$row" == "update_agent|$version|$revision|$digest|claimed" ]] || {
  echo 'FAIL: rejected mutations changed authoritative migration binding' >&2; exit 1;
}

echo 'PASS P0-D Agent release manifest: canonical append-only identity and atomic fixed-action migration binding'
