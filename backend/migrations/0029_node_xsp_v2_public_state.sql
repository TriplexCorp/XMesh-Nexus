-- XSP-v2 PR03 foundation. Additive metadata ONLY; no production v2 routes,
-- no activation, no private key storage and no changes to existing XMESH1.
-- Do not treat these tables as proof of hybrid authentication.
CREATE TABLE node_xsp_suite_state (
    node_id BIGINT PRIMARY KEY REFERENCES node_metric_keys(node_id) ON DELETE CASCADE,
    minimum_suite SMALLINT NOT NULL DEFAULT 1 CHECK (minimum_suite IN (1, 2)),
    activation_phase TEXT NOT NULL DEFAULT 'legacy'
        CHECK (activation_phase IN ('legacy', 'discovered', 'dual_enrolled', 'shadow', 'strict')),
    key_epoch BIGINT NOT NULL DEFAULT 0 CHECK (key_epoch >= 0),
    last_verified_revision TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((activation_phase = 'strict') = (minimum_suite = 2)),
    CHECK (minimum_suite <> 2 OR key_epoch > 0)
);

-- Reject accidental rollback even from application bugs. Privileged,
-- audited recovery migration is intentionally NOT provided at this stage.
CREATE FUNCTION enforce_node_xsp_suite_monotonic() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.node_id <> OLD.node_id
        OR NEW.minimum_suite < OLD.minimum_suite
        OR NEW.key_epoch < OLD.key_epoch
        OR (OLD.activation_phase = 'strict' AND NEW.activation_phase <> 'strict') THEN
        RAISE EXCEPTION 'XSP-v2 suite floor or key epoch may not decrease';
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;
CREATE TRIGGER node_xsp_suite_monotonic
BEFORE UPDATE ON node_xsp_suite_state
FOR EACH ROW EXECUTE FUNCTION enforce_node_xsp_suite_monotonic();

-- Public verification keys ONLY. Binary sizes are FIPS 204 ML-DSA-65
-- public 1952 octets and Ed25519 public 32 octets. No secrets in DB.
CREATE TABLE node_xsp_public_keysets (
    node_id BIGINT NOT NULL REFERENCES node_metric_keys(node_id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('node_request', 'panel_response')),
    key_epoch BIGINT NOT NULL CHECK (key_epoch > 0),
    ed25519_key_id TEXT NOT NULL CHECK (length(ed25519_key_id) BETWEEN 1 AND 64),
    mldsa65_key_id TEXT NOT NULL CHECK (length(mldsa65_key_id) BETWEEN 1 AND 64),
    ed25519_public BYTEA NOT NULL CHECK (octet_length(ed25519_public) = 32),
    mldsa65_public BYTEA NOT NULL CHECK (octet_length(mldsa65_public) = 1952),
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    PRIMARY KEY (node_id, purpose, key_epoch),
    UNIQUE (node_id, purpose, ed25519_key_id),
    UNIQUE (node_id, purpose, mldsa65_key_id),
    CHECK (revoked_at IS NULL OR revoked_at >= enrolled_at)
);

-- A future authenticated verifier MUST insert nonce in the SAME transaction
-- as the authenticated action. Uniqueness prevents concurrent replay;
-- do not prune recent nonces before expiry/skew budgets have elapsed.
CREATE TABLE node_xsp_replay_nonces (
    node_id BIGINT NOT NULL REFERENCES node_metric_keys(node_id) ON DELETE CASCADE,
    key_epoch BIGINT NOT NULL CHECK (key_epoch > 0),
    direction SMALLINT NOT NULL CHECK (direction IN (1, 2)),
    nonce BYTEA NOT NULL CHECK (octet_length(nonce) = 16),
    request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
    used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (node_id, key_epoch, direction, nonce)
);
CREATE INDEX node_xsp_replay_nonces_used_at_idx
    ON node_xsp_replay_nonces (used_at);

COMMENT ON TABLE node_xsp_suite_state IS
    'Inactive candidate XSP-v2 public state: do not enable strict without reviewed key provisioning and durable node counterpart';
COMMENT ON TABLE node_xsp_public_keysets IS
    'XSP-v2 verification PUBLIC keysets only; never insert private signing keys here';
COMMENT ON TABLE node_xsp_replay_nonces IS
    'Future v2 anti-replay store. Must be written atomically with the verified side effect';
