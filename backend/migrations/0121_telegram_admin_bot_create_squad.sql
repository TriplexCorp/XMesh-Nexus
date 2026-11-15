-- A new Telegram-created user must be explicitly attached to an existing
-- squad before its creation confirmation can be consumed.
-- NULL represents the unselected short-lived picker stage.
ALTER TABLE telegram_admin_bot_actions
    ADD COLUMN squad_id BIGINT;
ALTER TABLE telegram_admin_bot_actions
    ADD CONSTRAINT telegram_admin_bot_actions_squad_choice_check
    CHECK (squad_id IS NULL OR (action='create' AND squad_id>0));
