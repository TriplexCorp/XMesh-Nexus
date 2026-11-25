-- Immutable, first-Genesis TLS authority storage. No production issuer is
-- connected. SQL validates identity, exact cap roster, timing and replay,
-- NOT Ed25519 signatures or live Xray/WAL/certificate evidence. A trusted
-- future Rust issuer must validate those and hold the full current plan
-- locks before signing, storing and committing. No row opens a socket.
CREATE TABLE quota_v2_public_tls_authority_outbox (
    node_id BIGINT NOT NULL CHECK(node_id>0),
    request_challenge TEXT NOT NULL CHECK(request_challenge ~ '^[0-9a-f]{64}$'),
    activation_sha256 TEXT NOT NULL CHECK(activation_sha256 ~ '^[0-9a-f]{64}$'),
    runtime_id TEXT NOT NULL CHECK(runtime_id ~ '^[0-9a-f]{64}$'),
    profile_revision TEXT NOT NULL CHECK(profile_revision ~ '^[0-9a-f]{64}$'),
    genesis_policy_sha256 TEXT NOT NULL CHECK(genesis_policy_sha256 ~ '^[0-9a-f]{64}$'),
    signer_public_key TEXT NOT NULL CHECK(signer_public_key ~ '^[0-9a-f]{64}$'),
    cap_roster_sha256 TEXT NOT NULL CHECK(cap_roster_sha256 ~ '^[0-9a-f]{64}$'),
    authority_sha256 TEXT NOT NULL UNIQUE CHECK(authority_sha256 ~ '^[0-9a-f]{64}$'),
    issued_at_ms BIGINT NOT NULL CHECK(issued_at_ms>0),
    valid_until_ms BIGINT NOT NULL,
    signed_envelope BYTEA NOT NULL CHECK(octet_length(signed_envelope) BETWEEN 100 AND 8192),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(node_id,request_challenge),
    CHECK(valid_until_ms>issued_at_ms AND
          valid_until_ms::NUMERIC-issued_at_ms::NUMERIC<=120000),
    CHECK(authority_sha256=encode(sha256(signed_envelope),'hex'))
);
CREATE INDEX quota_v2_public_tls_authority_current
ON quota_v2_public_tls_authority_outbox(node_id,valid_until_ms);
REVOKE ALL ON quota_v2_public_tls_authority_outbox FROM PUBLIC;

-- Recompute the exact cross-language canonical roster using only validated
-- ASCII aliases and decimal user IDs; JSONB's pretty text is NOT the wire
-- representation. Hash the immutable original cap BYTES including newline.
CREATE FUNCTION quota_v2_public_tls_sql_roster_digest(p_node BIGINT)
RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
    cap quota_v2_signed_first_cap_outbox;
    alias JSONB;
    aliases JSONB;
    class TEXT;
    email TEXT;
    previous TEXT;
    alias_wire TEXT;
    roster_wire TEXT := '';
    last_user BIGINT := 0;
    total INTEGER := 0;
BEGIN
    FOR cap IN SELECT * FROM quota_v2_signed_first_cap_outbox
                WHERE node_id=p_node ORDER BY user_id,request_challenge
    LOOP
        total := total+1;
        IF total>2048 OR cap.user_id<=last_user THEN RETURN NULL; END IF;
        last_user := cap.user_id;
        aliases := (convert_from(cap.signed_envelope,'UTF8')::JSONB)->'payload'->'aliasScopes';
        IF jsonb_typeof(aliases) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
        IF jsonb_array_length(aliases) NOT BETWEEN 1 AND 2 THEN RETURN NULL; END IF;
        previous := '';
        alias_wire := '';
        FOR alias IN SELECT value FROM jsonb_array_elements(aliases)
        LOOP
            IF jsonb_typeof(alias) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
            IF (SELECT count(*) FROM jsonb_object_keys(alias))<>2
               OR jsonb_typeof(alias->'class') IS DISTINCT FROM 'string'
               OR jsonb_typeof(alias->'email') IS DISTINCT FROM 'string' THEN
                RETURN NULL;
            END IF;
            class := alias->>'class';
            email := alias->>'email';
            IF class NOT IN ('main','cdn')
               OR email IS DISTINCT FROM ('xmesh-u'||cap.user_id::TEXT||'--vless-'||class)
               OR email COLLATE "C" <= previous COLLATE "C" THEN RETURN NULL; END IF;
            previous := email;
            IF alias_wire<>'' THEN alias_wire := alias_wire||','; END IF;
            alias_wire := alias_wire||format('{"class":"%s","email":"%s"}',class,email);
        END LOOP;
        IF roster_wire<>'' THEN roster_wire := roster_wire||','; END IF;
        roster_wire := roster_wire||format(
            '{"aliases":[%s],"grantSha256":"%s","userId":%s}',
            alias_wire,encode(sha256(cap.signed_envelope),'hex'),cap.user_id);
    END LOOP;
    IF total=0 THEN RETURN NULL; END IF;
    RETURN encode(sha256(convert_to('['||roster_wire||']','UTF8')),'hex');
END;
$$;
REVOKE ALL ON FUNCTION quota_v2_public_tls_sql_roster_digest(BIGINT) FROM PUBLIC;

CREATE FUNCTION quota_v2_public_tls_guard_authority_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
    now_ms BIGINT;
    ttl BIGINT;
    doc JSONB;
    claims JSONB;
BEGIN
    IF current_setting('transaction_isolation')<>'read committed' THEN
        RAISE EXCEPTION 'TLS authority requires READ COMMITTED' USING ERRCODE='22023';
    END IF;
    IF NEW.issued_at_ms IS NULL OR NEW.valid_until_ms IS NULL
       OR NEW.issued_at_ms<=0 OR NEW.valid_until_ms<=NEW.issued_at_ms
       OR NEW.valid_until_ms::NUMERIC-NEW.issued_at_ms::NUMERIC>120000 THEN
        RAISE EXCEPTION 'invalid TLS authority lifetime' USING ERRCODE='22023';
    END IF;
    now_ms := (EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT;
    IF NEW.issued_at_ms>now_ms OR NEW.issued_at_ms<now_ms-8000
       OR NEW.valid_until_ms<=now_ms THEN
        RAISE EXCEPTION 'stale TLS authority' USING ERRCODE='22023';
    END IF;
    ttl := GREATEST(1000,NEW.valid_until_ms-now_ms);
    IF NOT quota_v2_public_tls_lock_exact_first_roster(
        NEW.node_id,NEW.activation_sha256,NEW.runtime_id,NEW.profile_revision,
        NEW.genesis_policy_sha256,NEW.signer_public_key,ttl
    ) THEN
        RAISE EXCEPTION 'TLS authority has no current complete SQL roster'
            USING ERRCODE='22023';
    END IF;
    -- The lock on Genesis serializes all legitimate concurrent first-cap
    -- and authority writes for this node. Recheck exact roster after locks.
    IF quota_v2_public_tls_sql_roster_digest(NEW.node_id)
          IS DISTINCT FROM NEW.cap_roster_sha256 THEN
        RAISE EXCEPTION 'TLS authority roster differs from signed outbox'
            USING ERRCODE='22023';
    END IF;
    now_ms := (EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT;
    IF NEW.issued_at_ms<now_ms-8000 OR NEW.valid_until_ms<=now_ms THEN
        RAISE EXCEPTION 'TLS authority expired while acquiring locks' USING ERRCODE='22023';
    END IF;
    doc := convert_from(NEW.signed_envelope,'UTF8')::JSONB;
    claims := doc->'payload';
    IF jsonb_typeof(doc) IS DISTINCT FROM 'object'
       OR jsonb_typeof(claims) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'malformed TLS authority envelope' USING ERRCODE='22023';
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(doc))<>3
       OR doc->>'algorithm' IS DISTINCT FROM 'Ed25519'
       OR COALESCE(doc->>'signature','') !~ '^[0-9a-f]{128}$'
       OR (SELECT count(*) FROM jsonb_object_keys(claims))<>11
       OR claims->'schemaVersion' IS DISTINCT FROM '1'::JSONB
       OR claims->>'kind' IS DISTINCT FROM 'xmesh.quota-v2.public-tls-ingress'
       OR claims->'nodeId' IS DISTINCT FROM to_jsonb(NEW.node_id)
       OR claims->>'activationReceiptSha256' IS DISTINCT FROM NEW.activation_sha256
       OR claims->>'runtimeId' IS DISTINCT FROM NEW.runtime_id
       OR claims->>'profileRevision' IS DISTINCT FROM NEW.profile_revision
       OR claims->>'genesisPolicySha256' IS DISTINCT FROM NEW.genesis_policy_sha256
       OR claims->'issuedAtMs' IS DISTINCT FROM to_jsonb(NEW.issued_at_ms)
       OR claims->'validUntilMs' IS DISTINCT FROM to_jsonb(NEW.valid_until_ms)
       OR claims->'canServePublic' IS DISTINCT FROM 'true'::JSONB
       OR jsonb_typeof(claims->'bindings') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'TLS envelope differs from outbox identity' USING ERRCODE='22023';
    END IF;
    IF jsonb_array_length(claims->'bindings') NOT BETWEEN 1 AND 2 THEN
        RAISE EXCEPTION 'invalid TLS binding count' USING ERRCODE='22023';
    END IF;
    IF EXISTS(SELECT 1 FROM quota_v2_public_tls_authority_outbox o
        WHERE o.node_id=NEW.node_id AND o.valid_until_ms>now_ms
          AND o.request_challenge<>NEW.request_challenge) THEN
        RAISE EXCEPTION 'previous TLS authority is still live' USING ERRCODE='22023';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER quota_v2_public_tls_authority_guard
BEFORE INSERT ON quota_v2_public_tls_authority_outbox
FOR EACH ROW EXECUTE FUNCTION quota_v2_public_tls_guard_authority_insert();
CREATE TRIGGER quota_v2_public_tls_authority_immutable
BEFORE UPDATE OR DELETE ON quota_v2_public_tls_authority_outbox
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();
CREATE TRIGGER quota_v2_public_tls_authority_no_truncate
BEFORE TRUNCATE ON quota_v2_public_tls_authority_outbox
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();
REVOKE ALL ON FUNCTION quota_v2_public_tls_guard_authority_insert() FROM PUBLIC;
COMMENT ON TABLE quota_v2_public_tls_authority_outbox IS
'Immutable first-Genesis TLS authority bytes; no production writer or reader attached. SQL does not verify Ed25519, live meter/WAL/certificates or current plan. Never traffic authority by itself.';
