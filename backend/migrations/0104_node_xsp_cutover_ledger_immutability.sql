-- XSP-v2 staging: database-level cutover ledger immutability.
-- No API route, signing, epoch switch, key activation or key retirement.
-- This function only rejects mutated ledger records; it DOES NOT verify signatures.
CREATE FUNCTION xsp2_cutover_ledger_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    -- Treat any signed decision as immutable, including node binding and TTL.
    IF ROW(NEW.node_id, NEW.request_id, NEW.from_epoch, NEW.to_epoch,
           NEW.candidate_sha256, NEW.permit_nonce, NEW.permit_input_sha256,
           NEW.signed_permit, NEW.issued_at, NEW.expires_at, NEW.issued_by,
           NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.node_id, OLD.request_id, OLD.from_epoch, OLD.to_epoch,
           OLD.candidate_sha256, OLD.permit_nonce, OLD.permit_input_sha256,
           OLD.signed_permit, OLD.issued_at, OLD.expires_at, OLD.issued_by,
           OLD.created_at)
    THEN
        RAISE EXCEPTION 'XSP-v2 cutover permit binding is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.state = 'issued' THEN
        IF NEW.state NOT IN ('issued', 'ack_verified', 'aborted') THEN
            RAISE EXCEPTION 'Invalid cutover state transition from issued'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.state = 'issued' AND
            ROW(NEW.applied_ack_sha256, NEW.signed_applied_ack, NEW.ack_verified_at)
            IS DISTINCT FROM
            ROW(OLD.applied_ack_sha256, OLD.signed_applied_ack, OLD.ack_verified_at)
        THEN
            RAISE EXCEPTION 'Cannot amend unverified cutover ACK'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.state = 'ack_verified'
           AND (NEW.ack_verified_at IS NULL
                OR NEW.ack_verified_at < OLD.issued_at)
        THEN
            RAISE EXCEPTION 'Invalid ACK verification timestamp'
                USING ERRCODE = '23514';
        END IF;
    ELSIF OLD.state = 'ack_verified' THEN
        IF NEW.state NOT IN ('ack_verified', 'receipt_sent') THEN
            RAISE EXCEPTION 'ACK commit cannot be rolled back'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
        -- receipt_sent and aborted are terminal. An aborted request can never
        -- be resurrected through this ledger.
        RAISE EXCEPTION 'Terminal cutover state is immutable'
            USING ERRCODE = '23514';
    END IF;

    -- ACK bytes/hash/time become immutable at the first authenticated commit.
    -- The future trusted application must verify both signatures and commit
    -- the ACK atomically with the epoch change before making this transition.
    IF OLD.state IN ('ack_verified', 'receipt_sent', 'aborted')
       AND ROW(NEW.applied_ack_sha256, NEW.signed_applied_ack,
               NEW.ack_verified_at)
           IS DISTINCT FROM
           ROW(OLD.applied_ack_sha256, OLD.signed_applied_ack,
               OLD.ack_verified_at)
    THEN
        RAISE EXCEPTION 'Committed cutover ACK is immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END
$$;

CREATE TRIGGER node_xsp_cutover_ledger_guard
BEFORE UPDATE ON node_xsp_cutover_permit_ledger
FOR EACH ROW EXECUTE FUNCTION xsp2_cutover_ledger_guard();

COMMENT ON FUNCTION xsp2_cutover_ledger_guard() IS
    'Staging safety gate: rejects cutover permit mutation, ACK replacement, resurrection and state rollback. Does not verify signatures, authorize cutover or perform trusted epoch advancement.';
