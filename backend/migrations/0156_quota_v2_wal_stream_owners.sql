-- The existing WAL filename identifies a runtime, alias and direction.
-- A late batch must never move that stream to a different reservation.
CREATE TABLE quota_v2_wal_stream_owners (
    filename TEXT PRIMARY KEY CHECK (filename ~ '^meter-[0-9a-f]{64}\.jsonl$'),
    reservation_id UUID NOT NULL REFERENCES quota_v2_reservations(reservation_id),
    UNIQUE (filename, reservation_id)
);

-- Abort the migration if stored history already assigns one stream twice.
-- Lock out concurrent batches until the foreign key and trigger are installed.
LOCK TABLE quota_v2_wal_charges IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO quota_v2_wal_stream_owners (filename, reservation_id)
SELECT DISTINCT filename, reservation_id FROM quota_v2_wal_charges;

ALTER TABLE quota_v2_wal_charges ADD CONSTRAINT quota_v2_wal_charge_stream_owner
    FOREIGN KEY (filename, reservation_id)
    REFERENCES quota_v2_wal_stream_owners (filename, reservation_id);

CREATE TRIGGER quota_v2_wal_stream_owner_immutable
BEFORE UPDATE OR DELETE ON quota_v2_wal_stream_owners
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TRIGGER quota_v2_wal_stream_owner_no_truncate
BEFORE TRUNCATE ON quota_v2_wal_stream_owners
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE FUNCTION quota_v2_record_wal_stream_owner()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO quota_v2_wal_stream_owners (filename, reservation_id)
    VALUES (NEW.filename, NEW.reservation_id)
    ON CONFLICT (filename) DO NOTHING;
    RETURN NEW;
END
$$;

CREATE TRIGGER quota_v2_wal_charge_record_stream_owner
BEFORE INSERT ON quota_v2_wal_charges
FOR EACH ROW EXECUTE FUNCTION quota_v2_record_wal_stream_owner();

REVOKE ALL ON quota_v2_wal_stream_owners FROM PUBLIC;
