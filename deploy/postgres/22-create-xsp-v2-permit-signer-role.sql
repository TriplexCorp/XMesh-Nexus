-- Read-only account used only by the isolated XSP-v2 permit signer.
-- Provision after migrations. It must never inherit xmesh_app, xmesh_c2c_writer,
-- xmesh_signer_reader, postgres, or another application/admin role.
SELECT format(
    'CREATE ROLE xmesh_permit_signer_reader LOGIN PASSWORD %L',
    :'permit_signer_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmesh_permit_signer_reader')
\gexec

ALTER ROLE xmesh_permit_signer_reader
    WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS
    PASSWORD :'permit_signer_password';
ALTER ROLE xmesh_permit_signer_reader SET default_transaction_read_only = on;

DO $$
DECLARE
    membership RECORD;
BEGIN
    FOR membership IN
        SELECT parent.rolname
        FROM pg_auth_members AS m
        JOIN pg_roles AS parent ON parent.oid = m.roleid
        JOIN pg_roles AS child ON child.oid = m.member
        WHERE child.rolname = 'xmesh_permit_signer_reader'
    LOOP
        EXECUTE format('REVOKE %I FROM xmesh_permit_signer_reader', membership.rolname);
    END LOOP;
END
$$;

REVOKE ALL PRIVILEGES ON DATABASE xmesh FROM xmesh_permit_signer_reader;
REVOKE CREATE, TEMPORARY ON DATABASE xmesh FROM PUBLIC;
GRANT CONNECT ON DATABASE xmesh TO xmesh_permit_signer_reader;

REVOKE ALL PRIVILEGES ON SCHEMA public FROM xmesh_permit_signer_reader;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO xmesh_permit_signer_reader;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM xmesh_permit_signer_reader;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM xmesh_permit_signer_reader;
REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM xmesh_permit_signer_reader;

DO $$
DECLARE
    granted_column RECORD;
BEGIN
    FOR granted_column IN
        SELECT n.nspname, c.relname, a.attname
        FROM pg_attribute AS a
        JOIN pg_class AS c ON c.oid = a.attrelid
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
          AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
    LOOP
        EXECUTE format(
            'REVOKE ALL PRIVILEGES (%I) ON TABLE %I.%I FROM xmesh_permit_signer_reader',
            granted_column.attname, granted_column.nspname, granted_column.relname
        );
    END LOOP;
END
$$;

GRANT SELECT ON TABLE
    node_xsp_suite_state,
    node_xsp_public_keysets,
    node_xsp_rotation_preparations,
    node_xsp_cutover_permit_ledger
TO xmesh_permit_signer_reader;
