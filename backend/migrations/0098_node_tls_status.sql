-- Certificate metadata is reported by authenticated node heartbeat; no private keys or PEM are stored.
ALTER TABLE node_runtime_heartbeats ADD COLUMN IF NOT EXISTS tls_status JSONB;
