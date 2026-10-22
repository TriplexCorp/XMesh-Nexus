-- Legacy rows remain valid. An existing hash-only secret cannot be recovered,
-- so its owner must explicitly rotate the link to populate the ciphertext.
-- Use an AES-256-GCM envelope; the encryption key is derived from the
-- provisioned TOTP_ENCRYPTION_KEY with an independent domain separator.
ALTER TABLE user_subscription_tokens
  ADD COLUMN token_ciphertext TEXT;
