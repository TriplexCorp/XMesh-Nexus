CREATE TABLE quota_v2_cap_renewals (
    reservation_id uuid NOT NULL REFERENCES quota_v2_reservations(reservation_id),
    revision bigint NOT NULL CHECK (revision > 0),
    nonce text NOT NULL CHECK (nonce ~ '^[0-9a-f]{64}$'),
    grant_bytes bigint NOT NULL CHECK (grant_bytes > 0),
    signed_envelope bytea NOT NULL CHECK (octet_length(signed_envelope) BETWEEN 100 AND 8192),
    PRIMARY KEY (reservation_id, revision),
    UNIQUE (reservation_id, nonce)
);

CREATE TRIGGER quota_v2_cap_renewals_immutable
BEFORE UPDATE OR DELETE ON quota_v2_cap_renewals
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TRIGGER quota_v2_cap_renewals_no_truncate
BEFORE TRUNCATE ON quota_v2_cap_renewals
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

REVOKE ALL ON quota_v2_cap_renewals FROM PUBLIC;
