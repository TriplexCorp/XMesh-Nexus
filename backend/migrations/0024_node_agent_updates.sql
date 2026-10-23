-- Extend the authenticated, single-flight node command queue with one fixed
-- agent updater action. Never mutate previously applied migrations.
ALTER TABLE node_restart_commands
  DROP CONSTRAINT IF EXISTS node_restart_commands_action_check;
ALTER TABLE node_restart_commands
  ADD CONSTRAINT node_restart_commands_action_check
  CHECK (action IN ('restart_xray', 'update_xray', 'update_agent'));
