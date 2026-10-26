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

## Two distinct actions

**Rotate subscription link** replaces only the bearer URL. It immediately
prevents further downloads through the previous URL but does not invalidate
VPN connection credentials already imported into clients.

**Rotate VPN access** is deliberately owner-only and requires confirmation.
It atomically replaces the subscription bearer URL, Xray UUID used by VLESS,
VMess, Trojan, Hysteria2, MASQUE and classic Shadowsocks, and both per-user
Shadowsocks 2022 keys. Clients must reimport the new configuration.
The change is audited without recording raw credentials.

## Independent protocol credentials

New users receive a distinct VLESS UUID, a different VMess UUID, and
independent 256-bit random hex passwords for Trojan, Hysteria2, MASQUE,
classic Shadowsocks AEAD, and manual HTTP/SOCKS profile accounts. SS2022
continues to receive independently generated 128/256-bit PSKs. A credential
exposed from one protocol is not a password for any other protocol.

Historical users are deliberately **not** rekeyed automatically: accounts
that lack these new fields keep using their original `xrayId` for older
protocols until the owner explicitly chooses **Rotate VPN access**. The
owner-only rotation regenerates all separate credentials atomically along
with the subscription URL. Clients must reimport the updated feed and all
managed nodes must reconcile; offline authorization remains subject to
its previously signed policy lifetime.

The panel database changes immediately. **Revocation on remote nodes is
not instantaneous or globally atomic.** Connected managed nodes apply the
new signed desired configuration during their next reconciliation.
Disconnected nodes may retain previously signed offline authorization until
that policy expires; verify each node has applied the new revision before
considering the previous VPN credentials fully revoked.
