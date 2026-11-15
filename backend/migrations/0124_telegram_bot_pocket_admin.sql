-- Allow permanent user deletion only through the existing short-lived,
-- admin-bound confirmation transaction. Subscription tokens cascade on
-- panel_records deletion; no extra secret-bearing storage is introduced.
ALTER TABLE telegram_admin_bot_actions
    DROP CONSTRAINT telegram_admin_bot_actions_action_check;
ALTER TABLE telegram_admin_bot_actions
    ADD CONSTRAINT telegram_admin_bot_actions_action_check
        CHECK (action IN ('enable', 'disable', 'renew', 'quota', 'create', 'delete'));
