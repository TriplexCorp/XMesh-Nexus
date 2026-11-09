# Agent bootstrap transport repair (control-v6.0.11)

## Confirmed failure

The strict operational services prepend `/usr/local/libexec/xmesh-strict-pq-bin`
to PATH. Its `curl` is a deliberately narrow adapter: registered signed panel
POSTs go through the verified XSP/2 product client. It rejects `-4` with exit 2
and must not be extended to fetch arbitrary URLs.

The 6.0.9/6.0.10 control worker used that unqualified command to fetch the public
updater from GitHub. All three attempts therefore failed locally, before an HTTP
request, producing `Fresh Agent updater download failed: curl exit 2`.
The updater's own dependencies had the same dispatch problem if it inherited
the service PATH. Retrying or changing DNS does not fix this defect.

The 6.0.11 release uses `/usr/bin/curl` explicitly for fixed public release files
in the control bootstrap, updater and initial enrollment installer. The bootstrap
and updater restrict redirects to HTTPS and retain existing bounded IPv4 retries,
target-version validation, syntax checks and immutable staged identity validation.
PATH is not rewritten. Signed panel calls still execute the strict-PQ adapter,
which retains its POST-only origin/path allowlist and has no classical fallback.

The gateway retains recovery identities for 6.0.9/6.0.10 and prior documented
versions. Node and Nexus must be released together. Fresh-install commands pin
the paired reviewed Node commit, including its 6.0.11 identity and Xray worker.

## Recover an already installed worker

A server-side release cannot change the broken download function already on a
node. After both paired PRs are merged and the panel is updated, run the official
updater locally once on a canary node. This is the existing full Agent/router
upgrade; it retains enrollment keys. It is not a replacement for the immutable
staged package path. Do not alter the strict-PQ curl adapter or service PATH.

```sh
sudo /bin/bash <<'SH'
set -Eeuo pipefail
umask 077
bootstrap=$(mktemp /run/xmesh-agent-recovery.XXXXXXXX)
trap 'rm -f "$bootstrap"' EXIT
/usr/bin/curl -4 --retry 2 --retry-delay 2 --proto '=https' --proto-redir '=https' \
  --tlsv1.2 --fail --silent --show-error --location --connect-timeout 8 --max-time 30 \
  https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/update-node-control-agent.sh \
  --output "$bootstrap"
/bin/bash -n "$bootstrap"
grep -Fq 'XMESH_TARGET_AWARE_UPDATER=1' "$bootstrap"
grep -Fq 'AGENT_VERSION="control-v6.0.11"' "$bootstrap"
/bin/bash "$bootstrap" manual
SH
```

Verify the panel heartbeat reports `control-v6.0.11`, both installed product
binaries report that version with their actual sourceRevision/artifactSha256,
and the next signed operation succeeds. Only then resume Xray updates and batch
the remaining nodes. No production node is changed by the regression tests.

## Evidence

`scripts/test-agent-bootstrap-transport.py` runs the actual bootstrap function
under the service's strict PATH and the actual paired Node adapter. It reproduces
the old exit 2, verifies public-client dispatch, rejects partial/wrong-target
downloads before execution, and proves signed panel requests still traverse the
product adapter while unknown paths remain rejected. Only public HTTP, systemd
and disposable filesystem locations are substituted; no production keys are used.
