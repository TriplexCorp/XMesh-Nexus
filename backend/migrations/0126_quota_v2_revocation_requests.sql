-- Quota-v2 revocation intents are durable and never refund a node's grant.
-- The signed Node policy carries request_id, scoped to an exact lease.
-- A later verified applied-stop proof is REQUIRED before any refund path
-- can be added; this migration deliberately contains no refund procedure.
CREATE TABLE quota_v2_revocation_requests (
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    epoch UUID NOT NULL,
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    meter_epoch UUID NOT NULL,
    reservation_id UUID NOT NULL,
    request_id UUID NOT NULL UNIQUE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, epoch, node_id, meter_epoch),
    FOREIGN KEY (user_id, epoch, node_id, meter_epoch)
        REFERENCES quota_v2_reservations(user_id, epoch, node_id, meter_epoch)
);
-- Once revoked, the lease is permanently non-renewable in that epoch.
-- Its ceiling stays held until an authenticated final stop/settlement
-- (or full conservative consumption of the grant) proves release safe.
