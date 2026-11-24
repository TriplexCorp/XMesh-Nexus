-- An installed release changes only the effective tunnel revision. Keep the
-- original activation immutable: existing signed policies and WAL use it.
CREATE TABLE node_xsp_product_release_commits (
    command_id BIGINT PRIMARY KEY REFERENCES node_xsp_product_release_plans(command_id),
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    activation_sha256 BYTEA NOT NULL CHECK (octet_length(activation_sha256) = 32),
    plan_sha256 BYTEA NOT NULL CHECK (octet_length(plan_sha256) = 32),
    source_revision TEXT NOT NULL CHECK (source_revision ~ '^[0-9a-f]{40}$'),
    signed_envelope BYTEA NOT NULL CHECK (octet_length(signed_envelope) BETWEEN 1 AND 16384),
    UNIQUE (node_id, activation_sha256)
);

CREATE TRIGGER product_release_commit_no_mutation
BEFORE UPDATE OR DELETE ON node_xsp_product_release_commits
FOR EACH ROW EXECUTE FUNCTION reject_product_release_plan_mutation();

CREATE TRIGGER product_release_commit_no_truncate
BEFORE TRUNCATE ON node_xsp_product_release_commits
FOR EACH STATEMENT EXECUTE FUNCTION reject_product_release_plan_mutation();

-- The legacy update ACK and heartbeat must not publish success for a
-- command that the gateway bound to a strict-PQ signed plan.
CREATE FUNCTION require_product_release_commit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.state='failed' AND NEW.state IS DISTINCT FROM 'failed'
       AND EXISTS (SELECT 1 FROM node_xsp_product_release_plans WHERE command_id=NEW.id) THEN
        RAISE EXCEPTION 'aborted strict-PQ release command is terminal';
    END IF;
    IF NEW.state = 'succeeded'
       AND OLD.state IS DISTINCT FROM 'succeeded'
       AND EXISTS (SELECT 1 FROM node_xsp_product_release_plans WHERE command_id=NEW.id)
       AND NOT EXISTS (SELECT 1 FROM node_xsp_product_release_commits WHERE command_id=NEW.id) THEN
        RAISE EXCEPTION 'strict-PQ release commit required';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER node_restart_require_product_release_commit
BEFORE UPDATE ON node_restart_commands
FOR EACH ROW EXECUTE FUNCTION require_product_release_commit();
