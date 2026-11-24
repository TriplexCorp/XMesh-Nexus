-- Existing owner-approved release command queue, narrowed to a live old
-- product activation. Canary selection and owner authorization are in the API.
CREATE FUNCTION queue_node_xsp_product_upgrade(p_node_id BIGINT, p_requested_by TEXT)
RETURNS TABLE (command_id BIGINT)
LANGUAGE sql VOLATILE AS $$
    WITH eligible AS MATERIALIZED (
        SELECT p.node_id
        FROM node_xsp_product_nodes p
        JOIN node_runtime_heartbeats h USING (node_id)
        JOIN panel_records d ON d.id=p.node_id AND d.collection='nodes'
        WHERE p.node_id=p_node_id AND p.state='active' AND p.release_version='control-v6.0.24'
          AND (d.data->'disabled') IS DISTINCT FROM 'true'::jsonb
          AND h.version='control-v6.0.24' AND h.received_at>clock_timestamp()-interval '65 seconds'
          AND EXISTS (
              SELECT 1 FROM node_xsp_public_keysets k
              WHERE k.node_id=p.node_id AND k.purpose='node_request' AND k.key_epoch=p.key_epoch
                AND k.ed25519_key_id=p.ed25519_key_id AND k.mldsa65_key_id=p.mldsa65_key_id
                AND k.revoked_at IS NULL
          )
          AND NOT EXISTS (
              SELECT 1 FROM node_xsp_product_release_commits c
              WHERE c.node_id=p.node_id AND c.activation_sha256=p.receipt_sha256
          )
    )
    SELECT m.command_id FROM eligible e
    CROSS JOIN LATERAL stage_node_xsp_agent_migration(e.node_id,'control-v6.0.27',p_requested_by) m
$$;
