# Cross-repository security boundaries

| Compromised capability | Observed reach | Existing boundary | Assurance still needed |
|---|---|---|---|
| Subscription token | Bearer feed and associated client configuration for its user | Hash lookup, status and subscription rules | Real revocation/expiry/cache tests; credential rotation across all nodes |
| Sub host | Traffic and feed secrets it terminates; its own manager identity | No panel session; signed fixed-operation manager requests | Cross-mirror queue/report ownership and revocation tests |
| Node host | Its private identity and assigned user VPN credentials | Node/path binding, product state, replay tracking | Other-node impersonation, assigned-user metrics and configuration isolation |
| Integration bearer | Its granted operations, subject to sender-proof policy | Separate service namespace, scopes and optional user allowlists | Every scope negative; legacy bearer-only compatibility migration |
| Panel viewer/admin | Permissions attached to current server-side role | Session verification and per-handler guards | Complete secret-redaction/object/function authorization matrix |
| Release publisher | Trusted bootstrap/update authority | Attestation identity and source binding in reviewed Sub flow | Publisher/workflow compromise and rollback qualification |

An intermediary that terminates HTTPS can read or replace the content it serves. Hiding the feed URL in the browser does not protect it from that intermediary. A node holding reused VPN credentials may use them elsewhere they are accepted, without possessing Nexus administrative authority.

Direct public feed requests to Nexus do not authenticate Sub as the sender. Nexus retains its own resource controls; source visibility alone does not prove a subscription-authentication bypass. Any origin-only mode must use automatically provisioned credentials, a real cryptographic channel or network restriction. A forgeable ordinary header is insufficient. No origin restriction was deployed during this checkpoint.

Sub manager signatures bind endpoint/identity/body/timestamp/nonce; the remote reply is additionally constrained by independently verified update artifacts. Node product control crosses a separate gateway and internal shared-secret boundary. Exact compromise reach of the gateway/container and signed reporting still requires disposable tests. No root/key/signature migration was introduced.
