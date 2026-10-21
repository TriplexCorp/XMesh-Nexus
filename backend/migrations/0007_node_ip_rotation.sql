-- Transactional cursor per user and node for subscription-address rotation.
-- Do not store client subscription tokens, just the last served public IP.
CREATE TABLE IF NOT EXISTS node_ip_rotation_cursors (
    node_id     BIGINT NOT NULL,
    user_id     BIGINT NOT NULL,
    next_index  BIGINT NOT NULL DEFAULT 0,
    last_ip     TEXT NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (node_id, user_id)
);
CREATE INDEX IF NOT EXISTS node_ip_rotation_cursors_updated_idx
    ON node_ip_rotation_cursors (updated_at);
