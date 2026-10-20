-- Query-path indexes for large panel collections and operational audit queries.
CREATE INDEX IF NOT EXISTS panel_records_collection_updated_idx
    ON panel_records (collection, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS panel_sessions_admin_expiry_idx
    ON panel_sessions (admin_id, expires_at);

CREATE INDEX IF NOT EXISTS panel_audit_log_actor_created_idx
    ON panel_audit_log (actor, created_at DESC);
