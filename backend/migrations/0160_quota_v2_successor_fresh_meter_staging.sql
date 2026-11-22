-- Quota V2: append-only NON-AUTHORIZING isolated successor-meter staging.
--
-- A calendar successor prepared by 0157 has zero spending authority. Before
-- even designing a positive issuer, record the identity of a separately
-- measured successor Xray runtime and its independently empty WAL namespace.
-- SQL DOES NOT authenticate Docker, kernel PIDs, private WAL files, or
-- Ed25519. These fields are only forensic staging; no row is sufficient to
-- open VLESS, create a reservation, or credit an old one.
CREATE TABLE quota_v2_calendar_successor_meter_preflights (
    predecessor_id UUID PRIMARY KEY
        REFERENCES quota_v2_calendar_successor_preparations(predecessor_id),
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    account_epoch UUID NOT NULL,
    candidate_meter_epoch UUID NOT NULL UNIQUE,
    candidate_reservation_id UUID NOT NULL UNIQUE,
    -- Separate FROM the old running process and every previously signed
    -- first-genesis Xray runtime. A mere new account epoch is insufficient.
    fresh_runtime_id TEXT NOT NULL
        CHECK (fresh_runtime_id ~ '^[0-9a-f]{64}$'
               AND fresh_runtime_id <> repeat('0',64)),
    fresh_container_id TEXT NOT NULL
        CHECK (fresh_container_id ~ '^[0-9a-f]{64}$'
               AND fresh_container_id <> repeat('0',64)),
    fresh_started_at TIMESTAMPTZ NOT NULL,
    fresh_host_pid BIGINT NOT NULL CHECK (fresh_host_pid > 0),
    fresh_executable_sha256 TEXT NOT NULL
        CHECK (fresh_executable_sha256 ~ '^[0-9a-f]{64}$'
               AND fresh_executable_sha256 <> repeat('0',64)),
    fresh_config_sha256 TEXT NOT NULL
        CHECK (fresh_config_sha256 ~ '^[0-9a-f]{64}$'
               AND fresh_config_sha256 <> repeat('0',64)),
    -- The digest of exactly zero bytes: an empty newly isolated registry.
    -- Actual independently inspected source files MUST be verified by the
    -- trusted Agent before requesting a future signed positive cap.
    fresh_wal_inventory_sha256 TEXT NOT NULL
        CHECK (fresh_wal_inventory_sha256 =
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
    zero_initial_raw_counters BOOLEAN NOT NULL
        CHECK (zero_initial_raw_counters),
    isolated_new_wal_root BOOLEAN NOT NULL
        CHECK (isolated_new_wal_root),
    -- Explicitly impossible to turn this forensic record into spend rights.
    authorized_bytes BIGINT NOT NULL DEFAULT 0 CHECK (authorized_bytes = 0),
    can_spend BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT can_spend),
    can_start BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT can_start),
    can_resume BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT can_resume),
    final_meter_verified BOOLEAN NOT NULL DEFAULT FALSE
        CHECK (NOT final_meter_verified),
    refundable_bytes BIGINT NOT NULL DEFAULT 0
        CHECK (refundable_bytes = 0),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    -- A single clean Xray can host many users in the SAME successor cohort.
    -- Prohibit *one account* silently recycling its runtime across multiple
    -- old reservations without making multiuser startup impossible.
    UNIQUE(node_id,user_id,fresh_runtime_id),
    UNIQUE(node_id,user_id,fresh_container_id),
    CHECK (candidate_meter_epoch <> candidate_reservation_id)
);

CREATE FUNCTION quota_v2_guard_successor_fresh_meter_preflight()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    previous quota_v2_calendar_successor_preparations%ROWTYPE;
    predecessor_meter UUID;
BEGIN
    SELECT p.* INTO previous
      FROM quota_v2_calendar_successor_preparations p
      JOIN quota_v2_reservations r ON r.reservation_id=p.predecessor_id
      JOIN quota_v2_calendar_closures c ON c.reservation_id=p.predecessor_id
      WHERE p.predecessor_id=NEW.predecessor_id
      FOR SHARE OF p,r,c;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'successor lacks a committed predecessor close'
            USING ERRCODE='23514';
    END IF;
    SELECT meter_epoch INTO STRICT predecessor_meter
      FROM quota_v2_reservations
      WHERE reservation_id=NEW.predecessor_id;
    IF NEW.node_id IS DISTINCT FROM previous.node_id
       OR NEW.user_id IS DISTINCT FROM previous.user_id
       OR NEW.account_epoch IS DISTINCT FROM previous.account_epoch
       OR NEW.candidate_meter_epoch IS DISTINCT FROM previous.candidate_meter_epoch
       OR NEW.candidate_reservation_id IS DISTINCT FROM previous.candidate_reservation_id
       OR NEW.candidate_meter_epoch IS NOT DISTINCT FROM predecessor_meter
       OR NEW.candidate_reservation_id IS NOT DISTINCT FROM predecessor_meter
       OR NEW.fresh_runtime_id IS NOT DISTINCT FROM previous.predecessor_runtime_id
       -- A clean successor may have booted BEFORE this particular user's
       -- independent calendar window ended. No user can spend from this
       -- staging table: fresh signed per-user counters are still mandatory.
       OR NEW.fresh_started_at <= TIMESTAMPTZ '1970-01-01 00:00:00+00'
       OR NEW.fresh_started_at > clock_timestamp()
       OR EXISTS (
           SELECT 1 FROM quota_v2_signed_first_cap_outbox f
           WHERE f.runtime_id=NEW.fresh_runtime_id
       )
       OR EXISTS (
           SELECT 1 FROM quota_v2_reservations r
           WHERE r.reservation_id=NEW.candidate_reservation_id
              OR r.meter_epoch=NEW.candidate_meter_epoch
       )
    THEN
        RAISE EXCEPTION 'fresh successor meter is not isolated from predecessor'
            USING ERRCODE='23514';
    END IF;
    -- Serialize absent-row as well as existing-row cohort checks. A
    -- second user on the SAME Docker container must report the SAME
    -- immutable kernel runtime, start time, PID, executable/config and
    -- pristine WAL fingerprint, not a fabricated per-user variant.
    PERFORM pg_advisory_xact_lock(1786042, hashtext(NEW.fresh_container_id));
    IF EXISTS (
        SELECT 1 FROM quota_v2_calendar_successor_meter_preflights e
        WHERE e.fresh_container_id=NEW.fresh_container_id
          AND (e.node_id IS DISTINCT FROM NEW.node_id
            OR e.fresh_runtime_id IS DISTINCT FROM NEW.fresh_runtime_id
            OR e.fresh_started_at IS DISTINCT FROM NEW.fresh_started_at
            OR e.fresh_host_pid IS DISTINCT FROM NEW.fresh_host_pid
            OR e.fresh_executable_sha256 IS DISTINCT FROM NEW.fresh_executable_sha256
            OR e.fresh_config_sha256 IS DISTINCT FROM NEW.fresh_config_sha256
            OR e.fresh_wal_inventory_sha256 IS DISTINCT FROM NEW.fresh_wal_inventory_sha256)
    ) THEN
        RAISE EXCEPTION 'shared successor container has conflicting runtime evidence'
            USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER quota_v2_successor_fresh_meter_bound
BEFORE INSERT ON quota_v2_calendar_successor_meter_preflights
FOR EACH ROW EXECUTE FUNCTION quota_v2_guard_successor_fresh_meter_preflight();

CREATE TRIGGER quota_v2_successor_fresh_meter_immutable
BEFORE UPDATE OR DELETE ON quota_v2_calendar_successor_meter_preflights
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TRIGGER quota_v2_successor_fresh_meter_no_truncate
BEFORE TRUNCATE ON quota_v2_calendar_successor_meter_preflights
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

-- Even an apparently convincing staged measurement MUST NOT cause positive
-- issuance. Deliberately make the existing first-cap / renewal outboxes
-- unable to consume any unfunded candidate reservation. A future NEW
-- reviewed issuer will need a separate transaction-safe, budget-conserving
-- signed permit path; this staging guard is not that path.
CREATE FUNCTION quota_v2_guard_unfunded_successor_cap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- A different reservation UUID with the SAME candidate meter epoch is
    -- also forbidden; otherwise an issuer could bypass the zero-spend
    -- predecessor outbox simply by substituting a new reservation ID.
    IF EXISTS (
        SELECT 1 FROM quota_v2_calendar_successor_preparations p
        LEFT JOIN quota_v2_reservations r
            ON r.reservation_id=NEW.reservation_id
        WHERE p.candidate_reservation_id=NEW.reservation_id
           OR p.candidate_meter_epoch=r.meter_epoch
    ) THEN
        RAISE EXCEPTION 'unfunded calendar successor cannot issue a positive cap'
            USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME='quota_v2_signed_first_cap_outbox' THEN
        -- Once a new runtime was declared a non-authorizing successor,
        -- no legacy first-cap path may silently use it as a fresh genesis
        -- for a different reservation or user.
        IF EXISTS (
            SELECT 1 FROM quota_v2_calendar_successor_meter_preflights pre
            WHERE pre.fresh_runtime_id=NEW.runtime_id
        ) THEN
            RAISE EXCEPTION 'staged successor runtime cannot use legacy first-cap issuer'
                USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER quota_v2_successor_forbid_old_first_cap
BEFORE INSERT ON quota_v2_signed_first_cap_outbox
FOR EACH ROW EXECUTE FUNCTION quota_v2_guard_unfunded_successor_cap();

CREATE TRIGGER quota_v2_successor_forbid_old_cap_renewal
BEFORE INSERT ON quota_v2_cap_renewals
FOR EACH ROW EXECUTE FUNCTION quota_v2_guard_unfunded_successor_cap();

REVOKE ALL ON quota_v2_calendar_successor_meter_preflights FROM PUBLIC;
REVOKE ALL ON FUNCTION quota_v2_guard_successor_fresh_meter_preflight() FROM PUBLIC;
REVOKE ALL ON FUNCTION quota_v2_guard_unfunded_successor_cap() FROM PUBLIC;

COMMENT ON TABLE quota_v2_calendar_successor_meter_preflights IS
'NONAUTHORITATIVE isolated successor Xray/WAL candidate identity only; not signed positive-cap authority, a reservation, byte credit, runtime attestation, or final settlement.';
