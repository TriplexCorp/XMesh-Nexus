-- Monotonic node-wide NIC traffic counters, distinct from authenticated Xray user usage.
-- First authenticated observation establishes a baseline. Counter resets or interface
-- changes never subtract traffic or invent historical bytes.
CREATE TABLE IF NOT EXISTS node_network_traffic_totals (
 node_id BIGINT PRIMARY KEY CHECK (node_id > 0),
 interface_name TEXT NOT NULL,
 last_rx_bytes BIGINT NOT NULL CHECK (last_rx_bytes >= 0),
 last_tx_bytes BIGINT NOT NULL CHECK (last_tx_bytes >= 0),
 rx_bytes BIGINT NOT NULL DEFAULT 0 CHECK (rx_bytes >= 0),
 tx_bytes BIGINT NOT NULL DEFAULT 0 CHECK (tx_bytes >= 0),
 observations BIGINT NOT NULL DEFAULT 1,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
