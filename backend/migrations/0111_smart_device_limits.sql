-- Authoritative device slots for subscription HWID enforcement.
-- Raw client HWIDs are never persisted: device_key is a per-user SHA-256 digest.
CREATE TABLE user_subscription_devices (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    collection      TEXT NOT NULL DEFAULT 'users' CHECK (collection = 'users'),
    device_key      TEXT NOT NULL CHECK (length(device_key) = 64),
    hwid_tag        TEXT NOT NULL CHECK (length(hwid_tag) = 12),
    platform        TEXT NOT NULL CHECK (platform IN ('ios','android','windows','macos','linux','unknown')),
    device_os       TEXT NOT NULL DEFAULT '' CHECK (char_length(device_os) <= 80),
    os_version      TEXT NOT NULL DEFAULT '' CHECK (char_length(os_version) <= 80),
    model           TEXT NOT NULL DEFAULT '' CHECK (char_length(model) <= 160),
    app             TEXT NOT NULL DEFAULT '' CHECK (char_length(app) <= 80),
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    refresh_count   BIGINT NOT NULL DEFAULT 1 CHECK (refresh_count >= 1),
    UNIQUE (user_id, device_key),
    FOREIGN KEY (collection, user_id)
        REFERENCES panel_records(collection, id) ON DELETE CASCADE
);
CREATE INDEX user_subscription_devices_user_last_seen_idx
    ON user_subscription_devices (user_id, last_seen_at DESC, id DESC);

-- The historical `devices` JSON array was never authoritative. Reset it once;
-- Rust now maintains a sanitized projection from user_subscription_devices.
UPDATE panel_records
SET data = jsonb_set(data, '{devices}', '[]'::jsonb, true)
WHERE collection = 'users' AND data ? 'devices';

-- Prevent stale browser payloads and generic record edits from overwriting the
-- server-derived device projection. Authoritative writers explicitly opt in for
-- their current transaction via SET LOCAL xmesh.device_projection_write='1'.
CREATE OR REPLACE FUNCTION xmesh_protect_device_projection()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.collection = 'users'
       AND NEW.collection = 'users'
       AND (NEW.data -> 'devices') IS DISTINCT FROM (OLD.data -> 'devices')
       AND COALESCE(current_setting('xmesh.device_projection_write', true), '') <> '1'
    THEN
        NEW.data := jsonb_set(
            NEW.data,
            '{devices}',
            COALESCE(OLD.data -> 'devices', '[]'::jsonb),
            true
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER panel_records_protect_device_projection
BEFORE UPDATE OF data ON panel_records
FOR EACH ROW EXECUTE FUNCTION xmesh_protect_device_projection();

-- Rotating or revoking a subscription is also the coarse-grained emergency
-- reset for all trusted device slots. Keep the derived JSON projection in sync.
CREATE OR REPLACE FUNCTION xmesh_reset_subscription_devices()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    target_user_id BIGINT;
BEGIN
    target_user_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
    DELETE FROM user_subscription_devices WHERE user_id = target_user_id;
    PERFORM set_config('xmesh.device_projection_write', '1', true);
    UPDATE panel_records
       SET data = jsonb_set(data, '{devices}', '[]'::jsonb, true)
     WHERE collection = 'users' AND id = target_user_id;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER user_subscription_devices_reset_on_token_change
AFTER INSERT OR UPDATE OF token_hash OR DELETE ON user_subscription_tokens
FOR EACH ROW EXECUTE FUNCTION xmesh_reset_subscription_devices();
