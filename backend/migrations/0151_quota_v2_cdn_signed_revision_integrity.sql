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
