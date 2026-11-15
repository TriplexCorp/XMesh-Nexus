-- Independently enrolled XMesh Sub mirrors. The primary gateway retains its
-- existing single-agent identity during migration; mirrors are fail-closed.
-- Public Ed25519 keys only; private identities stay on each Sub VPS.
CREATE TABLE IF NOT EXISTS sub_mirrors (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    domain VARCHAR(253) NOT NULL UNIQUE,
    public_key VARCHAR(64) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT sub_mirrors_id_format CHECK (id ~ '^[0-9a-f]{32}$'),
    CONSTRAINT sub_mirrors_key_format CHECK (public_key IS NULL OR public_key ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_sub_mirrors_domain ON sub_mirrors (domain);
