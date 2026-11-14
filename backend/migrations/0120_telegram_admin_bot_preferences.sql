-- Telegram bot language preference persists across reconnects and token rotation.
-- Absence of a row means "first run": ask the admin to choose RU or EN.
CREATE TABLE telegram_admin_bot_preferences (
    admin_id BIGINT PRIMARY KEY CHECK(admin_id > 0),
    language TEXT NOT NULL CHECK(language IN ('ru', 'en')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Narrowly scoped, one-use operation payloads. Existing enable/disable
-- confirmations remain intact. Creation uses user_id=0 (no record yet).
ALTER TABLE telegram_admin_bot_actions
    DROP CONSTRAINT IF EXISTS telegram_admin_bot_actions_action_check,
    DROP CONSTRAINT IF EXISTS telegram_admin_bot_actions_user_id_check;
ALTER TABLE telegram_admin_bot_actions
    ADD CONSTRAINT telegram_admin_bot_actions_action_check
        CHECK(action IN ('enable','disable','renew','quota','create')),
    ADD CONSTRAINT telegram_admin_bot_actions_user_id_check
        CHECK(user_id >= 0),
    ADD COLUMN amount BIGINT,
    ADD COLUMN username TEXT;
ALTER TABLE telegram_admin_bot_actions
    ADD CONSTRAINT telegram_admin_bot_actions_amount_check
        CHECK(amount IS NULL OR amount BETWEEN 0 AND 100000),
    ADD CONSTRAINT telegram_admin_bot_actions_username_check
        CHECK(username IS NULL OR LENGTH(username) BETWEEN 3 AND 64);
