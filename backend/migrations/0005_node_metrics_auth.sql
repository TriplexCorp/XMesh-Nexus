-- Per-node bearer tokens for remote telemetry ingestion.
-- Only SHA-256 hashes are stored; the plaintext token is shown once when issued.
CREATE TABLE IF NOT EXISTS node_metric_auth (
    node_id       BIGINT PRIMARY KEY CHECK (node_id > 0),
    token_hash    TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS node_metric_auth_last_seen_idx
    ON node_metric_auth (last_seen_at DESC)
    WHERE last_seen_at IS NOT NULL;
