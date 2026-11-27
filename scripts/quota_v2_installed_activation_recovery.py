"""Fail-closed installed installer-guard qualification on disposable Nodes."""
import subprocess

IDENTITY_SQL = (
    "SELECT activation_request_sha256,receipt_sha256,release_source_revision "
    "FROM node_xsp_product_nodes WHERE node_id=%s"
)


def run_installer_guard(guest, *, state, product, panel, original, db, before):
    """Accept only active/resumed, or a proven original systemd race + retry.

    The enabled recovery unit may restore active.json between the guard's
    initial verify-active and its fail-closed check for an existing marker.
    Exit 2 is NOT a successful recovery. Only a fully reverified original
    local state and unchanged SQL row can justify one fresh guard invocation;
    that invocation must report active. Never bypass the installer guard.
    """
    args = (
        "bash", "-ec",
        'source /opt/xmesh-node/deploy/xmesh-pq-install-guard.sh; '
        'xmesh_verify_or_resume_enrolled_product "$@"',
        "bash", state, product, panel, str(guest.node),
    )
    try:
        result = guest.exec(*args, timeout=60)
    except subprocess.CalledProcessError as exc:
        if exc.returncode != 2:
            raise
        # Do not repair, accept a partial restore, or consume a fresh token.
        # Verify the signed state BEFORE retrying the exact original guard.
        guest.exec(product, "verify-active", "--panel", panel, "--node-id", str(guest.node))
        for name, digest in original.items():
            actual = guest.exec("sha256sum", f"{state}/{name}").split()[0].decode()
            assert actual == digest, f"Node {guest.node} concurrent recovery altered {name}"
        assert db.execute(IDENTITY_SQL, (guest.node,)).fetchone() == before, (
            f"Node {guest.node} concurrent recovery changed activation SQL identity"
        )
        result = guest.exec(*args, timeout=60)
        assert result.strip() == b"active", (
            f"Node {guest.node} guard still did not recognize proven original state: {result!r}"
        )
        print(f"Node {guest.node} installer rejected concurrent recovery safely; "
              "the exact original signed state and SQL identity verified before one successful retry.",
              flush=True)
    assert result.strip() in (b"active", b"resumed"), (
        f"Node {guest.node} installer re-enrollment guard failed: {result!r}"
    )
    return None
