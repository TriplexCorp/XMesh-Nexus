# Cryptography review — partial

| Mechanism | Source observations | Remaining verification |
|---|---|---|
| Panel passwords | Argon2/password_hash library; asynchronous verification wrapper now bounds/offloads work | Parameter/storage upgrade policy, all non-login password operations |
| Sessions | Hashed session lookups and current server-side role/state checks observed | Logout, password/role changes, expiry, cookie policy and racing mutation negatives |
| Subscription capability | Strict 64-lowercase-hex public grammar and hashed lookup | CSPRNG/entropy proof for every issuance/migration, logging and caches |
| Integration sender proof | New tokens require Ed25519 proof key; legacy no-proof acceptance depends on policy | Canonical method/path/body/timestamp/nonce parsing, replay races and opt-in migration |
| Sub manager | Ed25519 signatures; CSPRNG nonce; root-only private key ownership/mode/link checks; no request redirects | Enrollment substitution, mirror binding, clock bounds, nonce exhaustion and revocation dynamics |
| Node | Product transport and registered legacy identity paths; replay state and node/path binding | Full key lifecycle, strict-PQ failure/downgrade cases and forged-report limits |
| Sub updates | GitHub OIDC/attestation source/workflow identity and artifact verification | Complete clean bootstrap and downgrade/rollback/adversarial artifact tests |

No new cryptographic algorithm was designed. Existing compatibility policies must be distinguished from new-token guarantees: sender proof required on newly issued Integration tokens does not imply every older token is sender-constrained. Container/environment mounts, debug logs, backups and crash output still require a complete secret-flow review. No exhaustive cryptographic safety conclusion is supported.
