# Protected Integration API — sender-constrained tokens (v1 proof contract)

## Trust boundary and rollout

The public integration endpoint is `/api/v1/integrations/*`. Browser cookies,
headers such as `X-Forwarded-For`, and trusted administrative sessions never
authorize a service request. HTTPS is mandatory at the public reverse proxy.

**New token creation:** owner + fresh MFA. **Every new token**, including
read-only scopes such as `subscriptions:read`, **requires**
`proofPublicKey`. Even a stolen read-only bearer must not be able to
retrieve private subscription URLs without proof of key possession.
Sensitive mutation scopes also receive policy limits.

**Existing tokens:** pre-migration unbound tokens remain functional to avoid
breaking running bots. This is a temporary backward-compatibility boundary,
**not** retroactive protection. Review `GET /api/v1/integration-tokens`
for `senderConstrained:false` and revoke/reissue those credentials.
Do not activate destructive changes or assume that an unbound old key is safe.

When all historical keys are migrated, enable
`XMESH_INTEGRATION_REQUIRE_PROOF=true` in the Nexus deployment environment
and redeploy the API. This **rejects all remaining unbound keys** at
authentication time (401). Keep it `false` during the migration to avoid
surprising production outages. Verify the token inventory before cutover.

This stage uses an application-verified Ed25519 proof rather than relying on
an untrusted forwarded mTLS certificate header. **It is not RFC 9449 DPoP and
it is not an mTLS gateway deployment**. A future gateway may additionally
require verified client certificates, but certificate verification MUST occur
at a trusted TLS terminator with backend transport isolated from public access.
Never accept raw client-supplied `X-Client-Cert` or similar headers as proof.

## Token issuance and security policy

The owner's protected `POST /api/v1/integration-tokens` accepts:

```json
{
  "clientName": "billing_bot",
  "label": "billing_protected",
  "mfaCode": "123456",
  "scopes": ["users:read", "users:create", "entitlements:grant", "subscriptions:read"],
  "allUsers": true,
  "expiresInDays": 7,
  "proofPublicKey": "<64 lowercase hex characters of 32-byte Ed25519 public key>",
  "maxGrantDays": 30,
  "maxCreatesPerDay": 20
}
```

The server rejects every new service token without a valid public key. The default
limits for newly issued mutating credentials are 30 days per grant and
20 completed account creations per rolling 24 hours, per integration client
(shared across its tokens). Owner may choose stricter caps or explicit values
up to 3650 days / 1000 creations. All mutations still need their original
scope and resource authorization. Access to all users is still a separate,
explicit owner decision. The token is only shown once, then only its hash is
stored. Only the public signing key is uploaded: never the private key.

Existing token records with NULL policy fields are not automatically given
new caps. Rotate them.

## Generate the signing identity

Run locally on the bot host or a protected provisioning host:

```bash
umask 077
openssl genpkey -algorithm Ed25519 -out bot-proof-key.pem
openssl pkey -in bot-proof-key.pem -pubout -outform DER \
  | tail -c 32 | od -An -tx1 | tr -d ' \n'
```

Copy only the resulting **public** 64-character hex string into
`proofPublicKey`. Store the PEM file readable only by the bot service account.
For stronger protection use a non-exportable hardware-backed key or a remote
signing service with its own operation authorization; theft of the token
**and** signing capability is still a compromise.

## Sign each request

For each request supply exactly one each of:

- `Authorization: Bearer xmni_v1_...`
- `X-XMesh-Proof-Ts: <decimal UTC seconds>`
- `X-XMesh-Proof-Nonce: <32 lowercase hex characters, fresh every request>`
- `X-XMesh-Proof-Sig: <128 lowercase hex characters, Ed25519 signature>`

The Ed25519 message is UTF-8 and contains **exactly** these seven lines
(no trailing newline):

```text
xmesh-proof-v1
<SHA256 hex of full Bearer token, including xmni_v1_ prefix>
<UPPERCASE HTTP method>
<exact HTTP path and query as sent, e.g. /api/v1/integrations/users?limit=1>
<decimal Unix UTC timestamp>
<fresh nonce>
<SHA256 hex of the raw HTTP body bytes, or SHA256 of empty bytes>
```

Compute this string from the **exact raw bytes sent**, not a JSON object
re-serialized after signing. The proof binds token, method, path/query and
body, so modification, replay, substitution and cross-token reuse fail.
Clock drift >60s fails. After successful signature verification the nonce
is registered with Redis using atomic `SET NX EX 180`, scoped to the token.
A replay fails (401); Redis outages fail closed (503).

For example, the following signing function uses only Python's standard
library and OpenSSL (not a third-party SDK):

```python
import hashlib, os, subprocess, tempfile, time

def proof_headers(method: str, path_and_query: str, bearer: str,
                  exact_body: bytes, private_pem: str) -> dict:
    timestamp = str(int(time.time()))
    nonce = os.urandom(16).hex()
    fields = [
        "xmesh-proof-v1", hashlib.sha256(bearer.encode()).hexdigest(),
        method.upper(), path_and_query, timestamp, nonce,
        hashlib.sha256(exact_body).hexdigest(),
    ]
    message = "\n".join(fields).encode("utf-8")
    # OpenSSL Ed25519 one-shot signing needs seekable input.
    with tempfile.NamedTemporaryFile() as temporary:
        temporary.write(message)
        temporary.flush()
        signature = subprocess.run(
            ["openssl", "pkeyutl", "-sign", "-rawin",
             "-inkey", private_pem, "-in", temporary.name],
            capture_output=True, check=True,
        ).stdout.hex()
    return {
        "Authorization": "Bearer " + bearer,
        "X-XMesh-Proof-Ts": timestamp,
        "X-XMesh-Proof-Nonce": nonce,
        "X-XMesh-Proof-Sig": signature,
    }
```

Do not log headers, signatures, nonces, private keys or subscription URLs.
Retries require a **new proof nonce**, but should retain the same
`Idempotency-Key` for the same logical mutation.

## XMesh Sub: what is (and isn't) protected

The separate Sub gateway currently allows only public GET/HEAD subscription
paths and exact portal assets. Its update agent uses a signed release manifest,
does not accept arbitrary shell commands, and connects outbound over HTTPS.
Do not weaken the offline release-signature requirement.

Nexus now restricts the Sub agent authentication rate (30/minute per token,
3000/minute global), the one-time claim endpoint (300/minute global), and
rejects browser-style credentials on agent requests. Redis failure fails
closed for the management channel.

For **fresh** subscription installations the default Nexus token refresh
protection is now `protect` at 30 requests/minute per subscription token.
Saved operator configuration, including an existing `monitor` mode,
remains authoritative. Inspect `Subscription Studio → Flood protection`
or `GET /api/v1/sub-server/flood` and explicitly enable `protect` on
existing sites after checking client polling. Monitor 429s carefully.

**Not yet provided:** verified per-IP flood control at the stock XMesh Sub
Caddy edge. The manager currently reads but does not enforce the
`ipPerMinute` policy. Nexus cannot safely treat an untrusted
`X-Forwarded-For` header as peer identity. A signed, offline-approved
edge release is required for a trustworthy real-IP limiter. Do not present
the current IP setting as live enforcement.

A public VPN subscription URL is inherently a bearer credential: most VPN
clients cannot use mTLS or Ed25519 proofs to fetch it. Therefore theft of a
full subscription URL is still dangerous. Avoid request logs, use no-referrer
and no-store, rotate leaked links and credentials, and reduce account abuse
with server-side limits. Public feeds must stay compatible with installed clients.
