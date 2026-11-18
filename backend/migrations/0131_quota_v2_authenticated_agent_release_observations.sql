-- An authenticated heartbeat reports the claimed control-Agent release.
-- It is a rollout hint, NOT attestation of installed binary/Xray state.
-- An older worker may be sharing the same node identity after an upgrade;
-- keep its last observation for a full quiet period even after a new version
-- reports successfully. A router-only 0.1.0 heartbeat is excluded in code.
CREATE TABLE quota_v2_authenticated_agent_release_observations (
    node_id BIGINT PRIMARY KEY CHECK(node_id > 0),
    reported_version TEXT NOT NULL CHECK(length(reported_version) BETWEEN 1 AND 80),
    last_authenticated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_non_target_at TIMESTAMPTZ
);
CREATE INDEX quota_v2_agent_release_seen_idx
    ON quota_v2_authenticated_agent_release_observations(last_authenticated_at DESC);

-- No trigger turns this read-only operator preflight state into a grant,
-- revocation, refund, or independently verified terminal Xray meter.
