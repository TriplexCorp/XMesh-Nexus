-- Quota V2: production fail-closed terminal-refund quarantine.
--
-- Migration 0129 intentionally prepared an SQL settlement primitive while
-- its proof-verifying Node -> Nexus handler and final-Xray meter do not exist.
-- That older function accepts a caller-supplied digest: SQL alone cannot
-- authenticate a Node signature, verify an old Xray runtime, or establish
-- that every stream/writer has stopped. A database-role owner can otherwise
-- call it directly with arbitrary plausible values, bypassing the absent
-- application proof verifier and returning unspent quota.
--
-- Replace the BODY with an unconditional denial in every runtime database.
-- Do not use a session variable, env switch, feature flag, role whitelist,
-- or caller-supplied "verified" boolean: all can be spoofed by a SQL caller.
-- Future reactivation requires a NEW audited migration implementing a
-- least-privileged trusted proof boundary plus positive real-Xray evidence.
--
-- Existing reservations, conservative burns, applied revocations, historic
-- rows and terminal-settlement table are preserved. This migration neither
-- repays nor releases one byte.
CREATE OR REPLACE FUNCTION quota_v2_settle_verified_terminal(
    p_user BIGINT, p_epoch UUID, p_node BIGINT, p_meter UUID,
    p_reservation UUID, p_request UUID, p_revision BIGINT,
    p_runtime TEXT, p_digest TEXT, p_total BIGINT
) RETURNS quota_v2_terminal_settlements LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION
      'Quota V2 terminal settlement is quarantined: signed post-stop final Xray meter not verified'
      USING ERRCODE = '42501';
END;
$$;

-- Keep the prior PUBLIC privilege prohibition and make the restriction
-- visible to operators inspecting the schema. Even the function owner is
-- denied by its unconditional body; EXPLICIT separate migration required.
REVOKE ALL ON FUNCTION quota_v2_settle_verified_terminal(
    BIGINT,UUID,BIGINT,UUID,UUID,UUID,BIGINT,TEXT,TEXT,BIGINT) FROM PUBLIC;

COMMENT ON FUNCTION quota_v2_settle_verified_terminal(
    BIGINT,UUID,BIGINT,UUID,UUID,UUID,BIGINT,TEXT,TEXT,BIGINT) IS
'QUARANTINED: never settles/refunds. Enabling XMESH_QUOTA_V2_ENABLED=1 does not unlock this SQL function. A new independently verified final-Xray proof protocol and explicit migration are required.';
