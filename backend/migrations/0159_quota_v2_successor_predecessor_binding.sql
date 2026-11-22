-- A ZERO-SPEND successor staging identity is not an independent account.
-- Even if the API path is accidentally called incorrectly, PostgreSQL must
-- reject a different Node/user/account and reuse of the old WAL meter epoch.
-- The immutable closure must already be committed before any successor stage.
CREATE FUNCTION quota_v2_guard_successor_predecessor()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    predecessor RECORD;
BEGIN
    SELECT r.user_id, r.node_id, r.epoch, r.meter_epoch,
           c.boundary_at
      INTO predecessor
      FROM quota_v2_reservations r
      JOIN quota_v2_calendar_closures c
        ON c.reservation_id=r.reservation_id
     WHERE r.reservation_id=NEW.predecessor_id
     FOR SHARE OF r,c;
    IF NOT FOUND
       OR predecessor.user_id IS DISTINCT FROM NEW.user_id
       OR predecessor.node_id IS DISTINCT FROM NEW.node_id
       OR predecessor.epoch IS DISTINCT FROM NEW.account_epoch
       OR predecessor.meter_epoch IS NOT DISTINCT FROM NEW.candidate_meter_epoch
       OR predecessor.meter_epoch IS NOT DISTINCT FROM NEW.candidate_reservation_id
       OR NEW.issued_at_ms <
          (EXTRACT(EPOCH FROM predecessor.boundary_at)*1000)::bigint
    THEN
        RAISE EXCEPTION 'successor does not belong to closed predecessor meter'
          USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER quota_v2_successor_bound_to_closed_predecessor
BEFORE INSERT ON quota_v2_calendar_successor_preparations
FOR EACH ROW EXECUTE FUNCTION quota_v2_guard_successor_predecessor();

REVOKE ALL ON FUNCTION quota_v2_guard_successor_predecessor() FROM PUBLIC;
