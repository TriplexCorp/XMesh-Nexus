-- Staging-only outbox for exact, independently verified dual-signed
-- XSP-v2 Nexus commit receipt envelopes. No API route or key provisioning.
-- A receipt can only be inserted against the precise already-committed ACK.
-- Never infer a signed receipt from an HTTP status or an unsigned DB row.
CREATE TABLE node_xsp_signed_commit_receipt_outbox (
    node_id BIGINT NOT NULL,
    request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
    from_epoch BIGINT NOT NULL CHECK (from_epoch > 0),
    to_epoch BIGINT NOT NULL CHECK (to_epoch = from_epoch + 1),
    permit_input_sha256 BYTEA NOT NULL CHECK (octet_length(permit_input_sha256) = 32),
    applied_ack_sha256 BYTEA NOT NULL CHECK (octet_length(applied_ack_sha256) = 32),
    signed_receipt_sha256 BYTEA NOT NULL CHECK (octet_length(signed_receipt_sha256) = 32),
    signed_receipt BYTEA NOT NULL CHECK (octet_length(signed_receipt) BETWEEN 1 AND 16384),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (node_id,request_id),
    FOREIGN KEY (node_id,request_id)
        REFERENCES node_xsp_cutover_permit_ledger(node_id,request_id)
        ON DELETE RESTRICT
);

-- This trigger checks durable relational bindings, NOT cryptographic signatures.
-- Application MUST verify both panel_response signatures on the exact bytes
-- before INSERT, and reverify stored bytes on every read/retry.
CREATE FUNCTION xsp2_signed_receipt_outbox_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    committed RECORD;
BEGIN
    IF TG_OP IN ('UPDATE','DELETE') THEN
        RAISE EXCEPTION 'XSP-v2 signed receipt outbox is immutable'
            USING ERRCODE = '23514';
    END IF;
    SELECT state,from_epoch,to_epoch,permit_input_sha256,applied_ack_sha256
      INTO committed
      FROM node_xsp_cutover_permit_ledger
      WHERE node_id=NEW.node_id AND request_id=NEW.request_id
      FOR SHARE;
    IF NOT FOUND
       OR committed.state <> 'ack_verified'
       OR committed.from_epoch <> NEW.from_epoch
       OR committed.to_epoch <> NEW.to_epoch
       OR committed.permit_input_sha256 IS DISTINCT FROM NEW.permit_input_sha256
       OR committed.applied_ack_sha256 IS DISTINCT FROM NEW.applied_ack_sha256
    THEN
        RAISE EXCEPTION 'No exact committed ACK for immutable signed receipt'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER node_xsp_signed_receipt_outbox_insert_guard
BEFORE INSERT ON node_xsp_signed_commit_receipt_outbox
FOR EACH ROW EXECUTE FUNCTION xsp2_signed_receipt_outbox_guard();

CREATE TRIGGER node_xsp_signed_receipt_outbox_immutable_guard
BEFORE UPDATE OR DELETE ON node_xsp_signed_commit_receipt_outbox
FOR EACH ROW EXECUTE FUNCTION xsp2_signed_receipt_outbox_guard();

COMMENT ON TABLE node_xsp_signed_commit_receipt_outbox IS
    'Staging immutable exact signed Nexus Ed25519+ML-DSA-65 commit receipts. The application verifies signatures and locked DB ACK state; no route, signer provisioning, key retirement or production activation.';
