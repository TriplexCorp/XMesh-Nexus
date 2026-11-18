-- Readiness-only metadata derived from authenticated node/gateway desired-config
-- requests. It is NOT a cryptographic attestation of deployed Agent code,
-- installed Xray config, dataplane finality, or refundable bytes.
CREATE TABLE quota_v2_authenticated_protocol_observations (
    node_id BIGINT PRIMARY KEY CHECK (node_id > 0),
    protocol_version SMALLINT NOT NULL CHECK (protocol_version BETWEEN 0 AND 255),
    authenticated_request_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_v2_claim_at TIMESTAMPTZ,
    -- An old Agent may still be running alongside an upgraded worker.
    -- Require a full quiet window with NO authenticated legacy requests.
    last_legacy_claim_at TIMESTAMPTZ
);
CREATE INDEX quota_v2_authenticated_protocol_observations_fresh_idx
    ON quota_v2_authenticated_protocol_observations (authenticated_request_at DESC);

-- A v1 request overwrites the CURRENT observation, even if the node had
-- previously claimed v2. The last-v2 timestamp is diagnostic only.
-- No trigger, ledger or SQL function turns this information into grants.

-- A new v2 claim does not erase evidence of a recently running v1 worker.
-- Operators must observe a full 15-minute legacy-quiescence window before
-- treating the node as ready for a fleet-wide protocol switch.
