CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (key, value)
VALUES (
    'panel',
    '{"brand":"XMesh Nexus","domain":"","hooks":{"user.created":0,"user.limited":0,"user.expired":0,"user.expires_in_24_hours":0,"user.first_connected":0,"user.bandwidth_usage_threshold_reached":0}}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value)
VALUES ('xray_core_version', '"latest"'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS panel_auth_users (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username        TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS panel_auth_users_username_lower_uq
    ON panel_auth_users (LOWER(username));

CREATE TABLE IF NOT EXISTS panel_sessions (
    token_hash  TEXT PRIMARY KEY,
    admin_id    BIGINT NOT NULL REFERENCES panel_auth_users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS panel_sessions_expiry_idx ON panel_sessions (expires_at);

CREATE TABLE IF NOT EXISTS panel_records (
    collection  TEXT NOT NULL CHECK (collection IN (
        'users', 'nodes', 'profiles', 'hosts', 'squads',
        'tpls', 'subs', 'admins', 'tokens', 'srh'
    )),
    id          BIGINT GENERATED ALWAYS AS IDENTITY,
    data        JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS panel_records_collection_id_idx ON panel_records (collection, id);
CREATE INDEX IF NOT EXISTS panel_records_data_gin_idx ON panel_records USING GIN (data jsonb_path_ops);
CREATE UNIQUE INDEX IF NOT EXISTS panel_records_user_username_lower_uq
    ON panel_records (LOWER(data->>'username'))
    WHERE collection = 'users';

CREATE TABLE IF NOT EXISTS panel_audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor       TEXT NOT NULL,
    action      TEXT NOT NULL,
    collection  TEXT,
    record_id   BIGINT,
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS panel_audit_log_created_idx ON panel_audit_log (created_at DESC);
