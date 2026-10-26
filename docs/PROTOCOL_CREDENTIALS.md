# Isolated VPN user credentials

## Why different protocols do not share one UUID

A randomly generated UUID v4 has 122 random bits and is not practical to
brute-force. However, using the same bearer secret as a VLESS identity, VMess
UUID, Trojan password, Shadowsocks password, Hysteria2 auth and MASQUE Basic
password increases the impact of any one leaked client configuration.

Nexus now provisions protocol-isolated secrets for all **new** user accounts:

| Protocol | Credential | Size / representation |
|---|---|---|
| VLESS | `xrayId` | random UUID v4 |
| VMess | `vmessId` | separate random UUID v4 |
| Trojan | `trojanPassword` | independent 32 random bytes, 64 lowercase hex characters |
| Hysteria2 | `hysteriaPassword` | independent 32 random bytes, 64 lowercase hex characters |
| MASQUE | `masquePassword` | independent 32 random bytes, 64 lowercase hex characters |
| Shadowsocks pre-2022 | `ssLegacyPassword` | independent 32 random bytes, 64 lowercase hex characters |
| Shadowsocks 2022 | `ssPassword128`, `ssPassword` | independent 128/256-bit Base64 PSKs, paired with the server PSK |
| HTTP proxy | `httpPassword` | independent 32 random bytes, 64 lowercase hex characters |
| SOCKS / mixed proxy | `socksPassword` | independent 32 random bytes, 64 lowercase hex characters |

The user is provisioned once by the server-side CSPRNG. The authoritative
managed node desired configuration and all server-generated subscriptions
obtain the same persisted secret, not a freshly generated password on each
download. Generic record patches cannot replace credential fields.

## Non-disruptive upgrade of existing users

Existing accounts are **not** silently rekeyed during a software upgrade,
because previously imported client VPN configurations would stop working.
For records missing the new credential fields, the node and subscription
temporarily fall back to the previous shared `xrayId`. This explicit
compatibility mode is indicated by `credentialsSeparated: false` in
`GET /api/v1/users/{id}/subscription`, and the user drawer shows a warning.

To isolate an existing account, the **owner** must select **Rotate VPN
access** in that user's subscription actions. This is an explicitly
disruptive action: a single PostgreSQL transaction reissues the subscription
URL, the VLESS UUID, VMess UUID, Trojan/SS/Hysteria/MASQUE/HTTP/SOCKS passwords,
and both SS2022 PSKs. The client must import the new URL and config.

Rotating the **subscription URL alone** does NOT change any VPN password.
Rekeying on the panel is immediate, but remote node revocation is eventual:
verify every online node's signed desired revision and remember disconnected
nodes may still enforce their last signed offline lease until expiry.

The old subscription URLs retain their indefinite lifetime until manually
rotated/revoked or their user is deleted. Deploying this change alone never
alters pre-existing URLs or working VPN passwords.

## Implementation notes

For an existing user, a missing independent field denotes compatibility
mode. A present-but-invalid field does **not** fall back to VLESS UUID;
it fails closed, to prevent an accidental security downgrade.

Secrets remain visible to authenticated administrators who can export
client configurations and to nodes provisioned with their authorized subset.
They are withheld from viewer accounts by the field whitelist.
Operators should protect PostgreSQL backups and avoid logging full client
configs or subscription URLs.
