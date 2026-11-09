ALTER TABLE node_restart_commands ADD COLUMN IF NOT EXISTS progress JSONB;
ALTER TABLE node_restart_commands ADD COLUMN IF NOT EXISTS progress_received_at TIMESTAMPTZ;
