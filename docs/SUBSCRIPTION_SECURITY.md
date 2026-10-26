# Subscription secret security and credential recovery

## Long-lived links

XMesh generates **32 bytes (256 bits)** using the operating-system CSPRNG and hex-encodes
them as a 64-character bearer token. The token is not derived from the user ID,
VPN UUID, username, or password. PostgreSQL indexes only its SHA-256 digest;
a separately encrypted recovery copy allows the owner to see the same link.

**There is no token time-to-live or scheduled rotation.** The token remains
valid until its owner rotates or revokes it, or the user is deleted. A suspended,
expired, or quota-limited user cannot download an active subscription, even
when its token still exists.

Cryptanalytic guessing is not a realistic risk for 256-bit CSPRNG secrets.
The practical threat is theft of an already-issued URL from client devices,
referrer headers, access logs, monitoring systems, proxies or backups.

## Independent encryption and upgrade

`SUBSCRIPTION_ENCRYPTION_KEY` is an independent persistent 32-byte AES-256-GCM
key (64 hex characters). `./install.sh` generates it once and the updater
keeps it unchanged. It is independent of the 2FA key,
`TOTP_ENCRYPTION_KEY`. Keep a secured offline backup of both keys and the
database. Never paste them into issue reports or web forms.

Upgrades from the historical version transparently re-encrypt existing
recoverable subscription tokens using `SUBSCRIPTION_ENCRYPTION_KEY` without
changing their token values, links, hashes or expiration behavior.
The initial migration requires the **original** TOTP key to decrypt the
legacy ciphertexts. If it is missing or wrong, the API refuses to start
rather than silently losing recoverable links. Restore the original key,
not a replacement. A hash-only legacy token remains usable but cannot be
displayed until the owner intentionally issues a replacement URL.

## Logging

The managed Nginx vhost disables access logging on HTTP/80 and HTTPS/443,
and restricts its error log to critical messages. The Rust HTTP trace
records request methods, not full URI paths or query strings.
The API sends `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

If an additional proxy/CDN/WAF or custom Nginx vhost is used, its logging
is **outside the managed installer**. The operator must independently redact
or stop recording full request URIs, query strings and `Referer` values;
also review existing historical logs for accidental bearer URL disclosure.

On managed installations, the root `xmeshctl` update refreshes the
panel's Nginx vhost. If a custom host requires a manual update, review
`deploy/install-panel-host.sh` before applying it.

## Protocol credential isolation

All **new** accounts get independently generated authentication secrets:
VLESS receives a UUID v4; VMess receives a *different* UUID v4;
Trojan, Hysteria2, MASQUE and classic Shadowsocks receive their own
independent 256-bit CSPRNG passwords; Shadowsocks 2022 continues to
use independent, standards-compliant 128/256-bit PSKs.

The native client subscription JSON and the managed-node Xray runtime
both resolve these fields through the same server-side function, keeping
authentication material consistent across both sides.

Existing accounts retain their previously imported UUID-based passwords
on all legacy protocols until the owner explicitly selects
**Rotate VPN access**. This deliberate compatibility fallback prevents
a routine panel upgrade from breaking installed VPN clients. The full
rotation simultaneously provisions distinct credentials, replaces the
subscription URL, and requires remote node reconciliation. To isolate
older accounts, the owner must perform this action and have their clients
reimport the new subscription. A simple subscription-link rotation does
**not** change any protocol password.

## Two distinct actions

**Rotate subscription link** replaces only the bearer URL. It immediately
prevents further downloads through the previous URL but does not invalidate
VPN connection credentials already imported into clients.

**Rotate VPN access** is deliberately owner-only and requires confirmation.
It atomically replaces the subscription bearer URL, Xray UUID used by VLESS,
VMess, Trojan, Hysteria2, MASQUE and classic Shadowsocks, and both per-user
Shadowsocks 2022 keys. Clients must reimport the new configuration.
The change is audited without recording raw credentials.

The panel database changes immediately. **Revocation on remote nodes is
not instantaneous or globally atomic.** Connected managed nodes apply the
new signed desired configuration during their next reconciliation.
Disconnected nodes may retain previously signed offline authorization until
that policy expires; verify each node has applied the new revision before
considering the previous VPN credentials fully revoked.
