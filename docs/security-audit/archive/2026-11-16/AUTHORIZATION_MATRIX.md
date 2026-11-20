# Authorization matrix — reviewed boundary and pending negative tests

| Principal | Observed permitted boundary | Must be denied | Current evidence |
|---|---|---|---|
| Anonymous | Login/MFA challenge, health, static assets, valid bearer feed | Protected management and arbitrary service operations | Router middleware reviewed; exhaustive runtime negatives pending |
| Subscriber | Own bearer feed and client configuration while entitled | Other users, panel management, expired/revoked credentials | Token/status paths partially reviewed; client-state tests pending |
| Viewer session | Server-defined read operations and redacted views | Writes, owner operations, private key/password/session disclosure | Router membership is insufficient; handler/redaction inventory pending |
| Admin session | Server-defined infrastructure/user operations | Owner-only security/accounts/integration issuance | Individual guards require complete negative matrix |
| Owner session | Owner operations with required MFA | CSRF, stale/revoked session, bypassed MFA | Account create/delete and token issuance owner gates observed |
| Integration key | Separate service API scopes and optional user allowlist | Panel administration, security settings, arbitrary node/control operations | Scope grammar/issuance reviewed; every handler/object test pending |
| Sub identity | Its signed claim/poll/report and assigned mirror work | Other mirror operations and administrative API | Signature/nonce code reviewed; cross-identity negatives pending |
| Node identity | Own registered signed/product control and metrics | Other node identity/admin calls/unassigned users | Product revocation rejection reviewed; dynamic compromise tests pending |

New integration token issuance requires owner + MFA and Ed25519 proof key. Legacy tokens may lack proof unless the require-proof policy is enabled. Scope names observed include users read/create/update/write, traffic/subscription read, quotas read/write, squads read/membership write, node read, Telegram read/assign and entitlement grant. Scope presence is not blanket authorization to every object.

Browser mutations require matching Origin/Host under CSRF middleware, with explicit machine exceptions; Integration bearer proof and node/Sub signatures are separate authentication mechanisms. Negative tests must vary principal, method, path/object ID, content type, encoded IDs, unknown fields and expired/revoked tokens. No complete endpoint authorization approval has yet been issued.

## Independent security integration — final checkpoint result

At `f6df491`, [isolated security job 133085685995](https://github.com/TriplexCorp/XMesh-Nexus/actions/runs/43802473626/job/133085685995) passed the actual signed-node identity/tamper/replay and PostgreSQL/Redis RBAC/MFA/scoped-Integration/revocation scripts on fresh disposable state. Its public subscription preflight also verified invalid token, uppercase token, unknown custom route and oversized path/query responses. This establishes the covered negative cases, not every endpoint or rejection-before-storage claim. Baseline/candidate resource jobs, default Rust and crypto jobs passed at that revision. The separate browser layout failure remains visible; no UI assertion was changed.
