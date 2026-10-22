-- Tokens are 256-bit random secrets; store only their SHA-256 hash.
-- panel_records has a COMPOSITE primary key (collection, id), not a unique id.
CREATE TABLE user_subscription_tokens (
 user_id BIGINT PRIMARY KEY,
 collection TEXT NOT NULL DEFAULT 'users' CHECK (collection = 'users'),
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY (collection, user_id) REFERENCES panel_records(collection, id) ON DELETE CASCADE
);
