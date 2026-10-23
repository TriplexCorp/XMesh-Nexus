-- Report actual running Xray version separately from the control-agent version.
ALTER TABLE node_runtime_heartbeats
 ADD COLUMN IF NOT EXISTS xray_version TEXT;
