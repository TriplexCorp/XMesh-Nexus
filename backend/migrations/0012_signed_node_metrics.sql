-- Sender-bound Ed25519 telemetry credentials. Each node is independently enrolled.
-- A unique nonce is consumed atomically for every verified request (replay defense).
CREATE TABLE node_metric_keys (
    node_id BIGINT PRIMARY KEY CHECK (node_id > 0),
    public_key TEXT NOT NULL UNIQUE CHECK (length(public_key) = 64),
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ
);
CREATE TABLE node_metric_nonces (
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    nonce TEXT NOT NULL CHECK (length(nonce) = 32),
    used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (node_id, nonce)
);
CREATE INDEX node_metric_nonces_used_at_idx ON node_metric_nonces(used_at);
