-- Dedicated built-in Telegram administrator bot. Never expose token ciphertext
-- through generic panel settings, public APIs or subscription endpoints.
CREATE TABLE telegram_admin_bot (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    token_ciphertext BYTEA,
    token_fingerprint TEXT,
    admin_ids BIGINT[] NOT NULL DEFAULT '{}',
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    last_update_id BIGINT NOT NULL DEFAULT 0 CHECK (last_update_id >= 0),
    bot_id BIGINT,
    bot_username TEXT,
    last_connected_at TIMESTAMPTZ,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (cardinality(admin_ids) <= 50),
    CHECK (enabled = FALSE OR (token_ciphertext IS NOT NULL AND cardinality(admin_ids) > 0))
);
INSERT INTO telegram_admin_bot(singleton) VALUES(TRUE);

-- Confirmation actions must be one-time, owner-scoped and expire rapidly.
-- Never trust callback_data as authorization for an irreversible action.
CREATE TABLE telegram_admin_bot_actions (
    nonce UUID PRIMARY KEY,
    admin_id BIGINT NOT NULL CHECK(admin_id > 0),
    user_id BIGINT NOT NULL CHECK(user_id > 0),
    action TEXT NOT NULL CHECK(action IN ('enable','disable')),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX telegram_admin_bot_actions_expiry_idx
    ON telegram_admin_bot_actions(expires_at);
