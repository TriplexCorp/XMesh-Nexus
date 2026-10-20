-- TimescaleDB is used only for high-volume time-series data.
-- Core panel records, auth, sessions, settings and audit remain regular PostgreSQL tables.
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS server_metric_samples (
    sampled_at          TIMESTAMPTZ NOT NULL,
    node_id             TEXT NOT NULL,
    cpu_percent         DOUBLE PRECISION CHECK (cpu_percent BETWEEN 0 AND 100),
    ram_used_bytes      BIGINT CHECK (ram_used_bytes >= 0),
    ram_total_bytes     BIGINT CHECK (ram_total_bytes >= 0),
    disk_used_bytes     BIGINT CHECK (disk_used_bytes >= 0),
    disk_total_bytes    BIGINT CHECK (disk_total_bytes >= 0),
    rx_bytes_per_sec    DOUBLE PRECISION CHECK (rx_bytes_per_sec >= 0),
    tx_bytes_per_sec    DOUBLE PRECISION CHECK (tx_bytes_per_sec >= 0),
    active_connections  INTEGER CHECK (active_connections >= 0),
    online_clients      INTEGER CHECK (online_clients >= 0),
    metrics             JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (sampled_at, node_id)
);

SELECT create_hypertable(
    'server_metric_samples',
    by_range('sampled_at', INTERVAL '1 day'),
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS server_metric_samples_node_time_idx
    ON server_metric_samples (node_id, sampled_at DESC);

CREATE TABLE IF NOT EXISTS panel_events (
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_id BIGINT GENERATED ALWAYS AS IDENTITY,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info'
        CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
    node_id TEXT,
    source TEXT NOT NULL DEFAULT 'panel',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (occurred_at, event_id)
);

SELECT create_hypertable(
    'panel_events',
    by_range('occurred_at', INTERVAL '7 days'),
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS panel_events_type_time_idx
    ON panel_events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS panel_events_node_time_idx
    ON panel_events (node_id, occurred_at DESC)
    WHERE node_id IS NOT NULL;
