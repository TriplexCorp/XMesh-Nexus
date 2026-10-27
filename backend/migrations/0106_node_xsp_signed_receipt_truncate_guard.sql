-- Staging-only hardening of the immutable XSP-v2 signed receipt outbox.
-- Row-level UPDATE/DELETE triggers from 0105 do NOT fire on TRUNCATE.
-- A privileged role can otherwise erase every durable signed receipt at once.
-- This additive migration must never be used as a substitute for a separate
-- least-privilege application role, protected backups, or audit/anti-rollback.
CREATE FUNCTION xsp2_signed_receipt_outbox_deny_truncate() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'XSP-v2 signed receipt outbox cannot be truncated'
        USING ERRCODE = '23514';
END
$$;

CREATE TRIGGER node_xsp_signed_receipt_outbox_truncate_guard
BEFORE TRUNCATE ON node_xsp_signed_commit_receipt_outbox
FOR EACH STATEMENT
EXECUTE FUNCTION xsp2_signed_receipt_outbox_deny_truncate();

-- Table owners/superusers retain administrative bypass capabilities.
-- Removing PUBLIC TRUNCATE is defense in depth, not role isolation.
REVOKE TRUNCATE ON node_xsp_signed_commit_receipt_outbox FROM PUBLIC;
