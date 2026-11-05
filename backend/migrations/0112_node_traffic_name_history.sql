-- Preserve the last display name when a live node is deleted.
-- Signed per-user traffic remains historical accounting; do not cascade-delete.
CREATE TABLE IF NOT EXISTS node_traffic_name_history (
    node_id BIGINT PRIMARY KEY CHECK (node_id > 0),
    display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 256),
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
