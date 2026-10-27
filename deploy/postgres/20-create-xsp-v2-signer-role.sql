-- Create/refresh the least-privilege account used only by the isolated
-- XSP-v2 receipt signer. Execute as PostgreSQL administrator after migrations.
-- The role must never inherit xmesh_app or another application/admin role.
SELECT format(
    'CREATE ROLE xmesh_signer_reader LOGIN PASSWORD %L',
    :'signer_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmesh_signer_reader')
\gexec

ALTER ROLE xmesh_signer_reader
    WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS
    PASSWORD :'signer_password';
ALTER ROLE xmesh_signer_reader SET default_transaction_read_only = on;

-- If re-provisioning an existing role, first remove any role memberships it
-- may have acquired. NOINHERIT alone is not enough because SET ROLE remains
-- possible for a member.
DO $$
DECLARE
    membership RECORD;
BEGIN
    FOR membership IN
        SELECT parent.rolname
        FROM pg_auth_members AS m
        JOIN pg_roles AS parent ON parent.oid = m.roleid
        JOIN pg_roles AS child ON child.oid = m.member
        WHERE child.rolname = 'xmesh_signer_reader'
    LOOP
        EXECUTE format('REVOKE %I FROM xmesh_signer_reader', membership.rolname);
    END LOOP;
END
$$;

REVOKE ALL PRIVILEGES ON DATABASE xmesh FROM xmesh_signer_reader;
GRANT CONNECT ON DATABASE xmesh TO xmesh_signer_reader;

REVOKE ALL PRIVILEGES ON SCHEMA public FROM xmesh_signer_reader;
GRANT USAGE ON SCHEMA public TO xmesh_signer_reader;

-- Clear stale direct grants to all pre-existing objects before granting the
-- exact four tables needed for cryptographic readback.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM xmesh_signer_reader;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM xmesh_signer_reader;
REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM xmesh_signer_reader;

GRANT SELECT ON TABLE
    node_xsp_suite_state,
    node_xsp_public_keysets,
    node_xsp_replay_nonces,
    node_xsp_cutover_permit_ledger,
    node_xsp_signed_commit_receipt_outbox
TO xmesh_signer_reader;
