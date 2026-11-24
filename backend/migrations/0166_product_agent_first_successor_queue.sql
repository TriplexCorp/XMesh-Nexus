-- The initial v6.0.27+ install can queue its first strictly forward
-- successor once the exact target manifest and installed lifecycle are
-- approved. No legacy bridge, unbound request, or version downgrade.
-- Keep the original activation immutable; a second successor requires
-- an independently qualified chained-release protocol.
CREATE FUNCTION queue_node_xsp_product_first_successor(
    p_node_id BIGINT, p_target_version TEXT, p_requested_by TEXT
) RETURNS TABLE (command_id BIGINT)
LANGUAGE sql VOLATILE AS $$
    WITH eligible AS MATERIALIZED (
        SELECT p.node_id
        FROM node_xsp_product_nodes p
        JOIN node_runtime_heartbeats h USING (node_id)
        JOIN panel_records d ON d.id=p.node_id AND d.collection='nodes'
        JOIN node_xsp_public_keysets k ON k.node_id=p.node_id AND k.purpose='node_request'
          AND k.key_epoch=p.key_epoch AND k.ed25519_key_id=p.ed25519_key_id
          AND k.mldsa65_key_id=p.mldsa65_key_id AND k.revoked_at IS NULL
        JOIN node_xsp_agent_release_manifests m ON m.version=p_target_version
        CROSS JOIN LATERAL (
            SELECT regexp_match(p.release_version, '^control-v6[.](0|[1-9][0-9]{0,9})[.](0|[1-9][0-9]{0,9})$') AS parts
        ) prior
        CROSS JOIN LATERAL (
            SELECT regexp_match(m.version, '^control-v6[.](0|[1-9][0-9]{0,9})[.](0|[1-9][0-9]{0,9})$') AS parts
        ) next_release
        WHERE p.node_id=p_node_id AND p.state='active'
          AND p.receipt_sha256 IS NOT NULL
          AND (d.data->'disabled') IS DISTINCT FROM 'true'::jsonb
          AND h.version=p.release_version
          AND h.received_at>clock_timestamp()-interval '65 seconds'
          AND m.source_revision<>p.release_source_revision
          AND m.artifact_sha256<>p.release_artifact_sha256
          AND prior.parts IS NOT NULL AND next_release.parts IS NOT NULL
          AND (prior.parts[1])::BIGINT<=4294967295 AND (prior.parts[2])::BIGINT<=4294967295
          AND (next_release.parts[1])::BIGINT<=4294967295 AND (next_release.parts[2])::BIGINT<=4294967295
          AND ROW((prior.parts[1])::BIGINT,(prior.parts[2])::BIGINT)>=ROW(0::BIGINT,27::BIGINT)
          AND ROW((next_release.parts[1])::BIGINT,(next_release.parts[2])::BIGINT)>
              ROW((prior.parts[1])::BIGINT,(prior.parts[2])::BIGINT)
          AND NOT EXISTS (
              SELECT 1 FROM node_xsp_product_release_commits c
              WHERE c.node_id=p.node_id AND c.activation_sha256=p.receipt_sha256
          )
        FOR UPDATE OF p FOR SHARE OF k,d
    )
    SELECT m.command_id FROM eligible e
    CROSS JOIN LATERAL stage_node_xsp_agent_migration(e.node_id,p_target_version,p_requested_by) m
$$;
