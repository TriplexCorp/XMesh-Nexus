-- Remove the legacy metrics Bearer credential store.
-- Keep migration 0005 unchanged to preserve SQLx checksums for existing installs.
DROP TABLE IF EXISTS node_metric_auth;
