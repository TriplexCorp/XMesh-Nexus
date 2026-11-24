-- Strong DB boundary: once a strictly staged quarantine policy exists,
-- neither legacy desired-config nor a different privileged writer may
-- transition the old policy_path_used marker and expose v1/offline budgets.
-- The future positive issuer must use a NEW authenticated activation state,
-- never a blind reset or reuse of the legacy marker.
CREATE FUNCTION quota_v2_block_legacy_after_genesis_quarantine()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.policy_path_used IS FALSE
      AND NEW.policy_path_used IS TRUE
      AND EXISTS(SELECT 1 FROM quota_v2_genesis_quarantine_policies
                 WHERE node_id=OLD.node_id) THEN
    RAISE EXCEPTION 'quarantined first Genesis cannot activate legacy desired-config'
      USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER quota_v2_no_legacy_after_quarantine
BEFORE UPDATE OF policy_path_used ON quota_v2_xray_genesis
FOR EACH ROW EXECUTE FUNCTION quota_v2_block_legacy_after_genesis_quarantine();
COMMENT ON FUNCTION quota_v2_block_legacy_after_genesis_quarantine() IS
'Fail closed when unsigned/legacy desired-config tries to turn a staged signed Genesis policy into traffic authority. Positive XSP/2 issuance must use a separate explicit activation path.';
