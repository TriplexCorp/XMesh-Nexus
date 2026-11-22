-- A mixed CDN addition is NOT a free-standing entitlement. It is only
-- valid alongside the exact immutable signed cap revision and challenge,
-- for the same original user, Node, and reservation.
--
-- The application deliberately inserts the independent CDN hold BEFORE
-- signing/storing its cap outbox, in one synchronous-commit transaction.
-- DEFERRABLE INITIALLY DEFERRED is required so PostgreSQL validates the
-- pair at COMMIT, without making partially created permits visible.
-- This also denies any accidental standalone CDN top-up transaction.
ALTER TABLE quota_v2_cap_renewals
    ADD CONSTRAINT quota_v2_cap_renewals_exact_revision_nonce
    UNIQUE (reservation_id, revision, nonce);

ALTER TABLE quota_v2_mixed_cdn_holds
    ADD CONSTRAINT quota_v2_mixed_cdn_holds_exact_identity
    UNIQUE (reservation_id, user_id, node_id);

ALTER TABLE quota_v2_mixed_cdn_topups
    ADD CONSTRAINT quota_v2_mixed_topup_signed_revision
    FOREIGN KEY (reservation_id, revision, request_nonce)
    REFERENCES quota_v2_cap_renewals(reservation_id, revision, nonce)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE quota_v2_mixed_cdn_topups
    ADD CONSTRAINT quota_v2_mixed_topup_origin
    FOREIGN KEY (reservation_id, user_id, node_id)
    REFERENCES quota_v2_mixed_cdn_holds(reservation_id, user_id, node_id);

-- Cap renewal rows and original holds are already append-only via their
-- independent immutable triggers. Neither their identity nor a later
-- top-up's nonce, revision or cumulative ceiling can be changed/deleted.

-- Additional DB-level consistency: a recorded CDN top-up cannot cite the
-- right nonce and revision but contradict the ACTUAL signed payload fields.
-- This trigger checks JSON FIELD CONSISTENCY only. Ed25519 cryptographic
-- authenticity is verified and produced by the Nexus signer and installed
-- Xray, not by SQL. A placeholder signature can never authorize traffic.
CREATE FUNCTION quota_v2_verify_mixed_cdn_signed_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    envelope JSONB;
    initial_hold BIGINT;
    expected_cdn NUMERIC;
    expected_shared BIGINT;
BEGIN
    SELECT convert_from(signed_envelope,'UTF8')::jsonb, grant_bytes
      INTO envelope,expected_shared
      FROM quota_v2_cap_renewals
     WHERE reservation_id=NEW.reservation_id
       AND revision=NEW.revision
       AND nonce=NEW.request_nonce;
    SELECT held_bytes INTO initial_hold
      FROM quota_v2_mixed_cdn_holds
     WHERE reservation_id=NEW.reservation_id
       AND user_id=NEW.user_id
       AND node_id=NEW.node_id;

    SELECT initial_hold::numeric + COALESCE(SUM(added_bytes::numeric),0)
      INTO expected_cdn
      FROM quota_v2_mixed_cdn_topups
     WHERE reservation_id=NEW.reservation_id AND revision<=NEW.revision;

    IF envelope IS NULL OR initial_hold IS NULL
       OR envelope->>'algorithm' IS DISTINCT FROM 'Ed25519'
       OR envelope->>'signature' IS NULL
       OR envelope#>>'{payload,kind}' IS DISTINCT FROM
           'xmesh.quota-v2.xray-cap-renewal'
       OR envelope#>>'{payload,reservationId}' IS DISTINCT FROM NEW.reservation_id::text
       OR envelope#>>'{payload,reservationRevision}' IS DISTINCT FROM NEW.revision::text
       OR envelope#>>'{payload,nonce}' IS DISTINCT FROM NEW.request_nonce
       OR envelope#>>'{payload,userId}' IS DISTINCT FROM NEW.user_id::text
       OR envelope#>>'{payload,nodeId}' IS DISTINCT FROM NEW.node_id::text
       OR envelope#>>'{payload,cdnCeilingBytes}' IS DISTINCT FROM NEW.cumulative_cdn_ceiling_bytes::text
       OR envelope#>>'{payload,sharedCeilingBytes}' IS DISTINCT FROM expected_shared::text
       OR expected_cdn IS DISTINCT FROM NEW.cumulative_cdn_ceiling_bytes::numeric
       OR NEW.cumulative_cdn_ceiling_bytes > expected_shared
    THEN
        RAISE EXCEPTION 'mixed CDN top-up does not match immutable signed cap'
            USING ERRCODE='23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER quota_v2_mixed_cdn_signed_fields_at_commit
AFTER INSERT ON quota_v2_mixed_cdn_topups
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION quota_v2_verify_mixed_cdn_signed_fields();
