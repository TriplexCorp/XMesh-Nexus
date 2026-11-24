-- A signed plan identifies exact bytes but grants no runtime replacement.
-- The live XSP/2 activation, WAL and quota ledgers are untouched.
CREATE TABLE node_xsp_product_release_plans (
    command_id BIGINT PRIMARY KEY CHECK (command_id > 0),
    activation_sha256 BYTEA NOT NULL CHECK (octet_length(activation_sha256) = 32),
    signed_envelope BYTEA NOT NULL CHECK (octet_length(signed_envelope) BETWEEN 1 AND 16384)
);

CREATE FUNCTION reject_product_release_plan_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'node_xsp_product_release_plans is append-only';
END;
$$;

CREATE TRIGGER product_release_plan_no_mutation
BEFORE UPDATE OR DELETE ON node_xsp_product_release_plans
FOR EACH ROW EXECUTE FUNCTION reject_product_release_plan_mutation();

CREATE TRIGGER product_release_plan_no_truncate
BEFORE TRUNCATE ON node_xsp_product_release_plans
FOR EACH STATEMENT EXECUTE FUNCTION reject_product_release_plan_mutation();
