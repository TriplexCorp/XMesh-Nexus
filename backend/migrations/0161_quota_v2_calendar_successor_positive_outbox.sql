-- Quota V2 calendar: an EXACT signed positive successor outbox is the only
-- valid mate of an already funded, separately metered successor reservation.
-- This migration does NOT itself allocate bytes or attach a public route.
-- The application must hold the existing user/account lock and commit the
-- reservation, immutable period/class/CDN bindings AND exact signed bytes in
-- ONE PostgreSQL transaction. No stale WAL debt is ever refunded.

CREATE TABLE quota_v2_calendar_successor_positive_caps (
    predecessor_id UUID PRIMARY KEY REFERENCES
        quota_v2_calendar_successor_meter_preflights(predecessor_id),
    node_id BIGINT NOT NULL CHECK(node_id>0),
    user_id BIGINT NOT NULL CHECK(user_id>0),
    account_epoch UUID NOT NULL,
    meter_epoch UUID NOT NULL UNIQUE,
    reservation_id UUID NOT NULL UNIQUE REFERENCES
        quota_v2_reservations(reservation_id) DEFERRABLE INITIALLY DEFERRED,
    fresh_runtime_id TEXT NOT NULL CHECK(fresh_runtime_id ~ '^[0-9a-f]{64}$'),
    policy_sha256 TEXT NOT NULL CHECK(policy_sha256 ~ '^[0-9a-f]{64}$'),
    signer_public_key TEXT NOT NULL CHECK(signer_public_key ~ '^[0-9a-f]{64}$'),
    nonce TEXT NOT NULL CHECK(nonce ~ '^[0-9a-f]{64}$'),
    revision BIGINT NOT NULL CHECK(revision=1),
    grant_bytes BIGINT NOT NULL CHECK(grant_bytes BETWEEN 1 AND 67108864),
    cdn_ceiling_bytes BIGINT NOT NULL CHECK(cdn_ceiling_bytes BETWEEN 0 AND grant_bytes),
    issued_at_ms BIGINT NOT NULL CHECK(issued_at_ms>0),
    install_before_ms BIGINT NOT NULL,
    valid_until_ms BIGINT NOT NULL,
    signed_envelope BYTEA NOT NULL CHECK(octet_length(signed_envelope) BETWEEN 100 AND 8192),
    can_start BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT can_start),
    can_resume BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT can_resume),
    final_meter_verified BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT final_meter_verified),
    refundable_bytes BIGINT NOT NULL DEFAULT 0 CHECK(refundable_bytes=0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (install_before_ms>issued_at_ms AND valid_until_ms>install_before_ms)
);

CREATE TRIGGER quota_v2_successor_positive_immutable
BEFORE UPDATE OR DELETE ON quota_v2_calendar_successor_positive_caps
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TRIGGER quota_v2_successor_positive_no_truncate
BEFORE TRUNCATE ON quota_v2_calendar_successor_positive_caps
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE FUNCTION quota_v2_guard_successor_positive_cap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    pre quota_v2_calendar_successor_meter_preflights%ROWTYPE;
    preparation quota_v2_calendar_successor_preparations%ROWTYPE;
    lease quota_v2_reservations%ROWTYPE;
    account quota_v2_accounts%ROWTYPE;
    doc JSONB;
    payload JSONB;
    held NUMERIC;
BEGIN
    SELECT * INTO STRICT pre FROM quota_v2_calendar_successor_meter_preflights
      WHERE predecessor_id=NEW.predecessor_id FOR SHARE;
    SELECT * INTO STRICT preparation FROM quota_v2_calendar_successor_preparations
      WHERE predecessor_id=NEW.predecessor_id FOR SHARE;
    SELECT * INTO STRICT lease FROM quota_v2_reservations
      WHERE reservation_id=NEW.reservation_id FOR SHARE;
    SELECT * INTO STRICT account FROM quota_v2_accounts
      WHERE user_id=NEW.user_id AND epoch=NEW.account_epoch FOR SHARE;
    IF account.closed OR
       pre.node_id IS DISTINCT FROM NEW.node_id OR
       pre.user_id IS DISTINCT FROM NEW.user_id OR
       pre.account_epoch IS DISTINCT FROM NEW.account_epoch OR
       pre.candidate_meter_epoch IS DISTINCT FROM NEW.meter_epoch OR
       pre.candidate_reservation_id IS DISTINCT FROM NEW.reservation_id OR
       pre.fresh_runtime_id IS DISTINCT FROM NEW.fresh_runtime_id OR
       preparation.node_id IS DISTINCT FROM NEW.node_id OR
       preparation.user_id IS DISTINCT FROM NEW.user_id OR
       preparation.account_epoch IS DISTINCT FROM NEW.account_epoch OR
       preparation.signer_public_key IS DISTINCT FROM NEW.signer_public_key OR
       preparation.policy_sha256 IS DISTINCT FROM NEW.policy_sha256 OR
       lease.node_id IS DISTINCT FROM NEW.node_id OR
       lease.user_id IS DISTINCT FROM NEW.user_id OR
       lease.epoch IS DISTINCT FROM NEW.account_epoch OR
       lease.meter_epoch IS DISTINCT FROM NEW.meter_epoch OR
       lease.reservation_id IS DISTINCT FROM NEW.reservation_id OR
       lease.revision IS DISTINCT FROM NEW.revision OR
       lease.ceiling_bytes IS DISTINCT FROM NEW.grant_bytes OR
       lease.acknowledged_bytes<>0 OR
       lease.conservative_burn_floor_bytes<>0 OR
       NOT lease.node_confirmed OR
       (EXTRACT(EPOCH FROM lease.valid_until)*1000)::BIGINT < NEW.valid_until_ms OR
       NEW.valid_until_ms > (EXTRACT(EPOCH FROM lease.valid_until)*1000)::BIGINT OR
       NEW.install_before_ms<= (EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT OR
       NEW.install_before_ms-NEW.issued_at_ms>120000 OR
       NEW.valid_until_ms-NEW.issued_at_ms>86400000 OR
       NOT EXISTS (SELECT 1 FROM quota_v2_calendar_closures
                   WHERE reservation_id=NEW.predecessor_id) OR
       EXISTS (SELECT 1 FROM quota_v2_revocation_requests v
               WHERE v.reservation_id=NEW.reservation_id) THEN
        RAISE EXCEPTION 'successor cap lacks a committed, conserved and isolated new reservation'
            USING ERRCODE='23514';
    END IF;
    SELECT COALESCE(SUM(GREATEST(
        r.ceiling_bytes::numeric-GREATEST(r.acknowledged_bytes,
            r.conservative_burn_floor_bytes),0
    )),0) INTO held FROM quota_v2_reservations r
      WHERE r.user_id=NEW.user_id AND r.epoch=NEW.account_epoch;
    IF held+GREATEST(account.settled_bytes,account.observed_floor_bytes)
        >account.limit_bytes THEN
        RAISE EXCEPTION 'successor cap exceeds global held and settled budget'
            USING ERRCODE='23514';
    END IF;
    -- Exact immutable classification and independent CDN hold are required.
    -- A mixed-cap's CDN bytes are independently prefunded; a CDN-only cap
    -- consumes the full class allowance. Never reclassify historic bytes.
    IF NOT EXISTS (
      SELECT 1 FROM quota_v2_reservation_classes c
       WHERE c.reservation_id=NEW.reservation_id
         AND c.user_id=NEW.user_id AND c.node_id=NEW.node_id
         AND ((c.class='main' AND NEW.cdn_ceiling_bytes=0)
           OR (c.class='cdn' AND NEW.cdn_ceiling_bytes=NEW.grant_bytes)
           OR (c.class='mixed' AND
               EXISTS(SELECT 1 FROM quota_v2_mixed_cdn_holds h
               WHERE h.reservation_id=c.reservation_id
                 AND h.user_id=c.user_id AND h.node_id=c.node_id
                 AND h.held_bytes=NEW.cdn_ceiling_bytes)))
    ) THEN
        RAISE EXCEPTION 'successor cap lacks immutable MAIN/CDN class accounting'
            USING ERRCODE='23514';
    END IF;
    BEGIN
        doc := convert_from(NEW.signed_envelope,'UTF8')::JSONB;
        payload := doc->'payload';
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'invalid successor cap envelope JSON' USING ERRCODE='23514';
    END;
    IF jsonb_typeof(doc)<>'object' OR
       (SELECT count(*) FROM jsonb_object_keys(doc))<>3 OR
       doc->>'algorithm'<>'Ed25519' OR
       doc->>'signature' !~ '^[0-9a-f]{128}$' OR
       jsonb_typeof(payload)<>'object' OR
       payload->>'kind'<>'xmesh.quota-v2.xray-cap-admission' OR
       payload->>'schemaVersion'<>'1' OR
       payload->>'nodeId'<>NEW.node_id::TEXT OR
       payload->>'userId'<>NEW.user_id::TEXT OR
       payload->>'runtimeId'<>NEW.fresh_runtime_id OR
       payload->>'policySha256'<>NEW.policy_sha256 OR
       payload->>'accountEpoch'<>NEW.account_epoch::TEXT OR
       payload->>'meterEpoch'<>NEW.meter_epoch::TEXT OR
       payload->>'reservationId'<>NEW.reservation_id::TEXT OR
       payload->>'reservationRevision'<>NEW.revision::TEXT OR
       payload->>'nonce'<>NEW.nonce OR
       payload->>'sharedCeilingBytes'<>NEW.grant_bytes::TEXT OR
       payload->>'nodeCeilingBytes'<>NEW.grant_bytes::TEXT OR
       payload->>'cdnCeilingBytes'<>NEW.cdn_ceiling_bytes::TEXT OR
       payload->>'inventoryTailDigest'<>repeat('0',64) OR
       payload->>'witnessedWalBytes'<>'0' OR
       payload->>'witnessedCdnBytes'<>'0' OR
       payload->>'canSpend'<>'true' OR payload->>'canStart'<>'false' OR
       payload->>'canResume'<>'false' OR
       payload->>'finalMeterVerified'<>'false' OR
       payload->>'refundableBytes'<>'0' OR
       payload->>'issuedAtMs'<>NEW.issued_at_ms::TEXT OR
       payload->>'installBeforeMs'<>NEW.install_before_ms::TEXT OR
       payload->>'validUntilMs'<>NEW.valid_until_ms::TEXT THEN
        RAISE EXCEPTION 'signed successor bytes differ from immutable PostgreSQL funded reservation'
            USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER quota_v2_successor_positive_validate
BEFORE INSERT ON quota_v2_calendar_successor_positive_caps
FOR EACH ROW EXECUTE FUNCTION quota_v2_guard_successor_positive_cap();

-- Zero-byte preparation remains non-authorizing. If an application ever
-- inserts a candidate reservation by itself, it MUST atomically commit the
-- corresponding exact signed positive outbox or the whole tx rolls back.
CREATE FUNCTION quota_v2_require_successor_outbox_on_commit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
      SELECT 1 FROM quota_v2_calendar_successor_preparations p
      WHERE p.candidate_reservation_id=NEW.reservation_id
    ) AND NOT EXISTS (
      SELECT 1 FROM quota_v2_calendar_successor_positive_caps o
      WHERE o.reservation_id=NEW.reservation_id
    ) THEN
      RAISE EXCEPTION 'unfunded or unsigned successor reservation cannot commit'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER quota_v2_successor_must_sign_reservation
AFTER INSERT OR UPDATE ON quota_v2_reservations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION quota_v2_require_successor_outbox_on_commit();

REVOKE ALL ON quota_v2_calendar_successor_positive_caps FROM PUBLIC;
REVOKE ALL ON FUNCTION quota_v2_guard_successor_positive_cap() FROM PUBLIC;
REVOKE ALL ON FUNCTION quota_v2_require_successor_outbox_on_commit() FROM PUBLIC;

COMMENT ON TABLE quota_v2_calendar_successor_positive_caps IS
'Exact immutable signed successor cap, atomically paired with fresh-WAL reservation; never releases old WAL debt or refund. Separate authenticated issuer required.';
