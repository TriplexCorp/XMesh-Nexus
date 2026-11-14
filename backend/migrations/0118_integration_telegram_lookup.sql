-- Index the exact Telegram ID field already used by the panel (data->>'tg').
-- Multiple users MAY have the same Telegram ID: a purchaser can own several subscriptions.
CREATE INDEX panel_records_users_telegram_lookup_idx
    ON panel_records (BTRIM(data->>'tg'), id)
    WHERE collection='users' AND data ? 'tg';

-- Provenance is immutable and kept outside user JSON: a bot may bind only
-- an account it actually created, never claim an arbitrary legacy subscription.
CREATE TABLE integration_user_provisioners (
    user_id BIGINT PRIMARY KEY CHECK (user_id > 0),
    client_id BIGINT NOT NULL REFERENCES integration_clients(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX integration_user_provisioners_client_idx
    ON integration_user_provisioners(client_id, user_id);
