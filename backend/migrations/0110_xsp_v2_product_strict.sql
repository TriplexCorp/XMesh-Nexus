-- XMesh v6 product strict-PQ state. Nodes present here are fail-closed:
-- direct XMESH1 control-plane requests are not sufficient for operation.
CREATE TABLE node_xsp_product_nodes (
    node_id BIGINT PRIMARY KEY REFERENCES node_metric_keys(node_id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('enrolled','active','revoked')),
    key_epoch BIGINT NOT NULL CHECK (key_epoch > 0),
    ed25519_key_id TEXT NOT NULL CHECK (length(ed25519_key_id) BETWEEN 1 AND 64),
    mldsa65_key_id TEXT NOT NULL CHECK (length(mldsa65_key_id) BETWEEN 1 AND 64),
    tls_spki_sha256 BYTEA NOT NULL CHECK (octet_length(tls_spki_sha256) = 32),
    release_version TEXT NOT NULL CHECK (length(release_version) BETWEEN 1 AND 64),
    release_source_revision TEXT NOT NULL CHECK (release_source_revision ~ '^[0-9a-f]{40}$'),
    release_artifact_sha256 TEXT NOT NULL CHECK (release_artifact_sha256 ~ '^[0-9a-f]{64}$'),
    activation_request_id TEXT,
    activation_request_sha256 BYTEA CHECK (activation_request_sha256 IS NULL OR octet_length(activation_request_sha256) = 32),
    receipt_sha256 BYTEA CHECK (receipt_sha256 IS NULL OR octet_length(receipt_sha256) = 32),
    receipt_envelope BYTEA,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    CHECK ((state = 'active') = (activated_at IS NOT NULL)),
    CHECK ((state = 'active') = (receipt_sha256 IS NOT NULL)),
    CHECK ((state = 'active') = (receipt_envelope IS NOT NULL)),
    CHECK (state <> 'revoked' OR revoked_at IS NOT NULL)
);

CREATE UNIQUE INDEX node_xsp_product_tls_spki_unique
    ON node_xsp_product_nodes (tls_spki_sha256);
CREATE UNIQUE INDEX node_xsp_product_activation_request_unique
    ON node_xsp_product_nodes (activation_request_id)
    WHERE activation_request_id IS NOT NULL;

CREATE TABLE node_xsp_product_nonces (
    node_id BIGINT NOT NULL REFERENCES node_xsp_product_nodes(node_id) ON DELETE CASCADE,
    key_epoch BIGINT NOT NULL CHECK (key_epoch > 0),
    direction SMALLINT NOT NULL CHECK (direction IN (1,2)),
    nonce BYTEA NOT NULL CHECK (octet_length(nonce) = 16),
    request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
    used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (node_id,key_epoch,direction,nonce)
);
CREATE INDEX node_xsp_product_nonces_used_at_idx ON node_xsp_product_nonces(used_at);

COMMENT ON TABLE node_xsp_product_nodes IS
    'XMesh v6 strict-PQ product nodes. Presence requires PQ tunnel authorization; active requires a persisted dual-signed activation receipt.';
COMMENT ON TABLE node_xsp_product_nonces IS
    'Durable anti-replay state for product XSP/2 envelopes; insert only after both signatures and mTLS identity verify.';
