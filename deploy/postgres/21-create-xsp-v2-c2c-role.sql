-- Staging-only writer used by the local P0-C2-C ACK authorization service.
-- Provision only after migrations. This role is intentionally distinct from
-- both the normal API role and the SELECT-only isolated signer role.
SELECT format(
    'CREATE ROLE xmesh_c2c_writer LOGIN PASSWORD %L',
    :'c2c_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xmesh_c2c_writer')
\gexec

ALTER ROLE xmesh_c2c_writer
    WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS
    PASSWORD :'c2c_password';

DO $$
DECLARE
    membership RECORD;
BEGIN
    FOR membership IN
        SELECT parent.rolname
        FROM pg_auth_members AS m
        JOIN pg_roles AS parent ON parent.oid = m.roleid
        JOIN pg_roles AS child ON child.oid = m.member
        WHERE child.rolname = 'xmesh_c2c_writer'
    LOOP
        EXECUTE format('REVOKE %I FROM xmesh_c2c_writer', membership.rolname);
    END LOOP;
END
$$;

REVOKE ALL PRIVILEGES ON DATABASE xmesh FROM xmesh_c2c_writer;
REVOKE CREATE, TEMPORARY ON DATABASE xmesh FROM PUBLIC;
GRANT CONNECT ON DATABASE xmesh TO xmesh_c2c_writer;

REVOKE ALL PRIVILEGES ON SCHEMA public FROM xmesh_c2c_writer;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO xmesh_c2c_writer;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM xmesh_c2c_writer;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM xmesh_c2c_writer;
REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM xmesh_c2c_writer;

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
            'REVOKE ALL PRIVILEGES (%I) ON TABLE %I.%I FROM xmesh_c2c_writer',
            granted_column.attname, granted_column.nspname, granted_column.relname
        );
    END LOOP;
END
$$;

GRANT SELECT ON TABLE
    node_xsp_suite_state,
    node_xsp_public_keysets,
    node_xsp_rotation_preparations,
    node_xsp_replay_nonces,
    node_xsp_cutover_permit_ledger,
    node_xsp_signed_commit_receipt_outbox
TO xmesh_c2c_writer;

GRANT UPDATE (key_epoch)
ON node_xsp_suite_state TO xmesh_c2c_writer;

GRANT INSERT
    (node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public)
ON node_xsp_public_keysets TO xmesh_c2c_writer;

GRANT INSERT (node_id,key_epoch,direction,nonce,request_id)
ON node_xsp_replay_nonces TO xmesh_c2c_writer;

GRANT UPDATE (state,applied_ack_sha256,signed_applied_ack,ack_verified_at)
ON node_xsp_cutover_permit_ledger TO xmesh_c2c_writer;

GRANT INSERT
    (node_id,request_id,from_epoch,to_epoch,permit_input_sha256,
     applied_ack_sha256,signed_receipt_sha256,signed_receipt)
ON node_xsp_signed_commit_receipt_outbox TO xmesh_c2c_writer;
