# Xray inbound → client outbound projection (XMesh Nexus)

Updated 2026-10-26. Backend implementation: `subscription_transport.rs`,
`user_subscriptions.rs`, `subscription_json.rs`; node identities:
`node_runtime.rs`.

## Safety contract

Xray inbound and outbound **are not isomorphic**. We never clone
`inbound.streamSettings` wholesale into a client profile.
`client_stream()` exports only public/shared fields or explicit client-only
metadata. Unknown inbound fields are not automatically exported. The generated
JSON must be tested by a compatible Xray-core release and a real VPN client.

The XHTTP source of truth is
[XTLS/Xray-core infra/conf/transport_method.go](https://github.com/XTLS/Xray-core/blob/main/infra/conf/transport_method.go)
(`SplitHTTPConfig`, `Build()`). Other sources: official
[Xray protocol docs](https://xtls.github.io/en/config/outbounds.html),
[transport overview](https://xtls.github.io/en/config/transport.html),
[REALITY](https://xtls.github.io/en/config/transports/reality.html),
[TLS](https://xtls.github.io/en/config/transports/tls.html),
[FinalMask](https://xtls.github.io/en/config/transports/finalmask.html).

### XHTTP (documented SplitHTTPConfig)

| Rule | Fields |
|---|---|
| Copy shared fields to the client | `host`, `path`, `mode`, `headers`, `xPaddingBytes`, `xPaddingObfsMode`, `xPaddingKey`, `xPaddingHeader`, `xPaddingPlacement`, `xPaddingMethod`, `uplinkHTTPMethod`, `sessionIDPlacement`, `sessionIDKey`, `sessionIDTable`, `sessionIDLength`, `seqPlacement`, `seqKey`, `uplinkDataPlacement`, `uplinkDataKey`, `uplinkChunkSize`, `noGRPCHeader`, `noSSEHeader`, `scMaxEachPostBytes`, `scMinPostsIntervalMs`, `xmux` |
| NEVER copy from server | `scStreamUpServerSecs`, `scMaxBufferedPosts`, `serverMaxHeaderBytes` |
| Client-side metadata only | `downloadSettings` (from `clientXhttpSettings`) |
| Effective override | `extra` is parsed as the effective XHTTP body; the outer `host`, `path` and `mode` overwrite values in `extra` as Xray-core does |

Copying `xPaddingObfsMode` alone is insufficient if associated obfuscation
and session-ID options differ between peers. The client must use the matching
values, not hardcoded defaults.

### Network transports

| Transport | Client projection | Server-only / never auto-export |
|---|---|---|
| RAW/TCP | `header` | `acceptProxyProtocol` |
| XHTTP | See full matrix above; client device profile overrides | `scStreamUpServerSecs`, `scMaxBufferedPosts`, `serverMaxHeaderBytes` |
| WebSocket | `path`, `host`, `heartbeatPeriod`; headers must be authored as client metadata | `acceptProxyProtocol` and implicit server response headers |
| HTTPUpgrade | `path`, `host`, explicit client headers | `acceptProxyProtocol` |
| gRPC | `serviceName`, `authority`, `multiMode`, `user_agent`, `idle_timeout`, `health_check_timeout`, `permit_without_stream`, `initial_windows_size` | No inbound raw config cloning |
| mKCP | `header`, `seed`, `mtu`, `tti`, `uplinkCapacity`, `downlinkCapacity`, `cwndMultiplier`, `maxSendingWindow` | Never copy server-only socket/listen fields |
| Hysteria | `version`, `udpIdleTimeout`; client `auth` derived from authorized user ID | Inbound `masquerade`, server `auth` |
| MASQUE | `path`; optional explicit client `host`, `headers`, `xmux`; Basic auth from authorized user | Server `warp.privateKey`, server credentials and local assignable IP pools |

REALITY only supports RAW, XHTTP and gRPC. Client uses
`serverName`, `fingerprint`, `password` (public-key/legacy alias input),
`shortId`, optional `mldsa65Verify`, `spiderX`.
Server-only: `target`, `privateKey`, `mldsa65Seed`, server fallback
rate limit settings, `serverNames` and `shortIds` arrays.

TLS client: `serverName`, `alpn`, `fingerprint`, optional explicit
client certificate verification options. NEVER copy server
`certificates` private keys or server-only TLS material.

FinalMask is projected through `subscription_finalmask.rs` using the
actual transport and TLS ALPN. Symmetric masks are inherited only where the
client and server use the same wire-format settings: TCP `sudoku` and
`header-custom`; UDP `sudoku`, `header-custom`, `mkcp-legacy`, and
`salamander` (Gecko `packetSize` requires QUIC). Server-only `filter`
is never copied. A mixed mask chain with a layer that cannot be safely
projected is **rejected rather than partially copied**.

For directional/client-only features (`fragment`, `xmc`, `noise`,
`udphop`, `xdns`, `xicmp`, `realm`) or per-endpoint
`quicParams`, set `inbound.xmesh.clientFinalmask` in XRAY STUDIO, or
`host.clientFinalmask` for host-specific overrides. Explicit masks are
transport-checked, replace automatic inheritance, and reject
client-side `filter` and mismatched TCP/UDP. `xdns` is mKCP-only;
QUIC params require Hysteria, MASQUE H3 or XHTTP H3. `clientSockopt`
remains explicit. See [complete FinalMask compatibility and deployment
guide](FINALMASK_COMPATIBILITY.md).

### Protocol credentials and per-user authorization

| Protocol | Node inbound | Subscription outbound |
|---|---|---|
| VLESS | `settings.clients[].id`; `settings.decryption` | `settings.vnext[].users[].id`; separate `encryption`, supported `flow` |
| VMess | `settings.users[].id` | `settings.id` |
| Trojan | `settings.users[].password` | `settings.password`; public TLS required |
| Shadowsocks non-2022 | `settings.users[].password` and `method` | `settings.password`, `method` |
| Shadowsocks 2022 | Server PSK in `settings.password`, user PSK in `settings.users[].password` (no per-user `method`) | `settings.password` = `ServerPSK:UserPSK`; required valid-length base64 keys |
| Hysteria | `settings.users[].auth` | `streamSettings.hysteriaSettings.auth` and `settings.version=2` |
| MASQUE | `settings.users[].email` and `pass` | `streamSettings.masqueSettings.user` and `pass`; `settings.address`, `port` |

The node still needs a reachable public transport port and matching TCP/UDP
exposure. Generating credentials **does not** make a UDP-only service available
through a TCP-only node gateway.

**Not automatically provisioned**: WireGuard (requires distinct client
private/public key pairs, server peer provisioning and client tunnel
addresses); non-proxy protocol inbounds such as HTTP, SOCKS, DNS, TUN, and
routing/reverse inbound types. This is deliberate: synthesizing credentials
from a VLESS UUID would be incorrect or insecure. A dedicated WireGuard
provisioning/peer lifecycle must be built separately.

## Regression coverage

`cargo test --manifest-path backend/Cargo.toml` includes checks for:
- XHTTP obfuscation, session-ID fields and `extra` precedence;
- server-only fields and REALITY secrets not appearing in the exported JSON;
- iOS/Windows transport profile overrides;
- mKCP `header`/`seed` compatibility;
- per-user protocol credentials matching node-side conventions;
- Shadowsocks 2022 combined PSK and failed invalid PSK;
- MASQUE per-user Basic auth and secret isolation.

CI workflow: `.github/workflows/backend-ci.yml`.
Validation is required before deploying; newly added schema paths may need
additional Xray-core/runtime tests as the underlying upstream schema evolves.
