-- Node agent reports the last locally observed GeoData state.
-- This is telemetry, not an authority for granting access or routing.
ALTER TABLE node_runtime_heartbeats
    ADD COLUMN IF NOT EXISTS geo_data JSONB;
