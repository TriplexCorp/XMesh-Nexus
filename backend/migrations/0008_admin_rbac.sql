-- Upgrade existing authenticated administrators without invalidating their sessions.
-- Existing accounts retain full owner access. Subsequent accounts receive an
-- explicit owner/admin/viewer role managed through the protected API.
ALTER TABLE panel_auth_users
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'owner'
CONSTRAINT panel_auth_users_role_check CHECK (role IN ('owner','admin','viewer'));
CREATE INDEX IF NOT EXISTS panel_auth_users_role_idx
ON panel_auth_users (role) WHERE is_active = TRUE;
