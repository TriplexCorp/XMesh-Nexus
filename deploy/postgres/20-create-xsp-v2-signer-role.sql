-- Create/refresh the least-privilege account used only by the isolated
-- XSP-v2 receipt signer. Execute as PostgreSQL administrator after migrations.
-- The role is never granted membership in xmesh_app and has no write privileges.
SELECT format(
    'CREATE ROLE xmesh_signer_reader LOGIN PASSWORD %L',
    :'signer_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmesh_signer_reader')
\gexec

ALTER ROLE xmesh_signer_reader
    WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT
    PASSWORD :'signer_password';
ALTER ROLE xmesh_signer_reader SET default_transaction_read_only = on;

GRANT CONNECT ON DATABASE xmesh TO xmesh_signer_reader;
GRANT USAGE ON SCHEMA public TO xmesh_signer_reader;

REVOKE ALL PRIVILEGES ON TABLE
    node_xsp_suite_state,
    node_xsp_public_keysets,
    node_xsp_replay_nonces,
    node_xsp_cutover_permit_ledger
FROM xmesh_signer_reader;

GRANT SELECT ON TABLE
    node_xsp_suite_state,
    node_xsp_public_keysets,
    node_xsp_replay_nonces,
    node_xsp_cutover_permit_ledger
TO xmesh_signer_reader;
