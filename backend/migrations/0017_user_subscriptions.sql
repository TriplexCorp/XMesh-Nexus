-- Subscription tokens are 256-bit random secrets; the plaintext is never stored.
CREATE TABLE user_subscription_tokens (
 user_id BIGINT PRIMARY KEY REFERENCES panel_records(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX user_subscription_tokens_hash_idx ON user_subscription_tokens(token_hash);
