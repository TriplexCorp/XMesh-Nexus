-- An explicitly approved recovery token may replace the existing legacy
-- Ed25519 Node key only AFTER the Node proves possession of the new key.
-- The default enrollment flow remains initial-only: tokens cannot rotate keys
-- unless the authenticated owner used the dedicated re-enrollment endpoint.
ALTER TABLE node_enrollment_tokens
  ADD COLUMN allow_key_replacement BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN node_enrollment_tokens.allow_key_replacement IS
  'Owner explicitly authorized legacy key replacement; single-use 10-minute token, proof-of-possession required. Never authorizes XSP-v2 downgrade.';
