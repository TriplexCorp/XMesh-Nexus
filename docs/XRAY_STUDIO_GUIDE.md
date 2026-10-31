# XRAY STUDIO — Operator Guide

XRAY STUDIO is the configuration workspace inside XMesh Nexus. It combines guided editing with direct Xray JSON access and is designed for both ordinary profiles and advanced transport/security work.

## Design principles

1. **The JSON is real.** Guided controls edit actual Xray configuration instead of maintaining an unrelated shadow model.
2. **Do not silently invent security.** TLS/REALITY/NONE is an explicit operator decision.
3. **Do not rewrite unrelated custom state.** Randomization is for newly generated/rebuilt defaults unless the operator explicitly rotates a value.
4. **Validate instead of guessing.** Unsupported combinations should produce a useful error/disabled state rather than a hidden mutation.
5. **Separate server and client concerns.** Some settings belong only to inbound Xray, some only to exported clients, and some must match on both sides.

---

## Workspace modes

The Studio contains several complementary workflows:

- **Composer / guided construction** for assembling a profile quickly;
- **structured form editing** for common inbound/transport/security values;
- **manual JSON** for expert control;
- **semantic diagnostics** and targeted repair helpers;
- **tool dialogs** for complex feature families such as FinalMask and XHTTP.

A saved configuration should still be validated against the actual Xray-core used on the target node.

---

## Security selector

`streamSettings.security` is authoritative.

| Selected Security | Studio behavior |
| --- | --- |
| `TLS` | keeps/creates `tlsSettings` and activates certificate TLS |
| `REALITY` | Reality is selected; certificate TLS is not automatically activated |
| `NONE` | stream certificate TLS is not activated |

### Important

XRAY STUDIO does **not** automatically switch security just because you choose VLESS, XHTTP, WebSocket, gRPC or another transport.

This is intentional. Advanced configurations may validly require, for example:

```json
{
  "protocol": "vless",
  "streamSettings": {
    "network": "xhttp",
    "security": "none"
  }
}
```

The Studio may validate whether a complete configuration is supported, but it should not silently replace the operator's security selection.

Dormant `tlsSettings` can remain in the JSON when TLS is not selected. Keeping them avoids destroying certificate paths if the profile later returns to TLS.

---

## TLS configuration

When TLS is selected, the Studio exposes/preserves TLS-specific configuration including certificate material paths and ALPN-related settings where applicable.

Certificate paths are paths **inside the Xray runtime environment on the node**, not paths on the administrator's desktop browser.

Panel HTTPS and Xray inbound TLS are separate systems:

- the Nexus panel uses Nginx/Certbot on the control-plane VPS;
- Xray profile TLS is part of the node/inbound configuration.

---

## REALITY

REALITY configuration remains explicit and should not be replaced by TLS merely because a transport often appears together with TLS.

When exporting clients, required REALITY values must be present and valid. Subscription generation should fail closed rather than fabricate missing cryptographic/identity material.

---

# XHTTP

The XHTTP tool is a wide card-based constructor matching the FinalMask interaction style.

## XHTTP modes

The constructor supports the current mode family:

- `auto`
- `packet-up`
- `stream-up`
- `stream-one`

Changing the XHTTP mode does not change `streamSettings.security`.

## Random Path generation

A newly created XHTTP profile receives a cryptographically generated URL-safe path rather than the fixed sample `/xhttp`.

Example shape:

```text
/9A7ckVJOX0QxBy3W8MEGC0jEsjfNnJNrSjunMVtvhG28YFjVBeeeiM25tOP2F6mE
```

Rules:

- the token is generated with the browser cryptographic RNG;
- a new XHTTP profile gets a new path;
- explicit Composer rebuild can rotate a placeholder path;
- an existing custom path is preserved on unrelated edits;
- the XHTTP menu has an explicit **New random Path** action.

## Basic settings

The basic card covers:

- `path`
- `host`
- `mode`

## Browser headers

The headers card supports browser-like starting profiles and custom JSON.

A rich profile may include fields such as:

```json
{
  "Accept": "*/*",
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3",
  "Cache-Control": "no-cache",
  "Content-Type": "application/octet-stream",
  "Pragma": "no-cache",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent": "Mozilla/5.0 (...)"
}
```

The `Host` HTTP header is special in Xray SplitHTTP and should be configured using the dedicated `host` setting rather than hidden in the headers map.

## Padding and HTTP disguise

The constructor exposes:

- `xPaddingBytes`
- `xPaddingObfsMode`
- `xPaddingKey`
- `xPaddingHeader`
- `xPaddingPlacement`
- `xPaddingMethod`
- `noGRPCHeader`
- `noSSEHeader`

Known placement/method values are validated against Xray behavior rather than accepted blindly.

Typical example:

```json
{
  "xPaddingBytes": "32-1024",
  "xPaddingObfsMode": true,
  "xPaddingKey": "x-token",
  "xPaddingHeader": "X-Request-Token",
  "xPaddingPlacement": "header",
  "xPaddingMethod": "tokenish"
}
```

## Session ID and sequence

The Session/Sequence card covers:

- `sessionIDPlacement`
- `sessionIDKey`
- `sessionIDTable`
- `sessionIDLength`
- `seqPlacement`
- `seqKey`

Example:

```json
{
  "sessionIDPlacement": "cookie",
  "sessionIDKey": "session_id",
  "sessionIDTable": "Base62",
  "sessionIDLength": "16-48",
  "seqPlacement": "query",
  "seqKey": "segment"
}
```

Xray validates Session ID table/length entropy. Do not reduce the table/length to tiny values merely to shorten URLs.

## Uplink layout

The Uplink card covers:

- `uplinkHTTPMethod`
- `uplinkDataPlacement`
- `uplinkDataKey`
- `uplinkChunkSize`

Mode-aware constraints are enforced. For example:

- `GET` is valid for uplink only with `packet-up`;
- `cookie`/`header` uplink-data placement is restricted to `packet-up` by Xray-core.

## packet-up tuning

The constructor includes:

- `scMaxEachPostBytes`
- `scMinPostsIntervalMs`
- `scMaxBufferedPosts`

These may accept integer/range forms where the Xray schema permits ranges.

## stream-up tuning

The constructor includes:

- `scStreamUpServerSecs`

## XMUX

The XMUX card exposes:

- `maxConcurrency`
- `maxConnections`
- `cMaxReuseTimes`
- `hMaxRequestTimes`
- `hMaxReusableSecs`
- `hKeepAlivePeriod`

Xray does not allow active `maxConnections` and `maxConcurrency` at the same time. The Studio treats that as a configuration error instead of emitting a known-invalid profile.

Example:

```json
{
  "xmux": {
    "cMaxReuseTimes": "64-128",
    "hKeepAlivePeriod": 0,
    "hMaxRequestTimes": "600-900",
    "hMaxReusableSecs": "1800-3000",
    "maxConcurrency": "1",
    "maxConnections": 0
  }
}
```

## Server/download/H2 advanced settings

The UI also provides access to:

- `serverMaxHeaderBytes`
- `downloadSettings`
- `h2Params`

These objects are advanced and may require manual JSON knowledge of the Xray schema.

## Full randomized profile

The **Full randomized profile** action creates a rich starting profile and presents it for review before application.

It can randomize or generate, as appropriate:

- Path;
- browser-oriented headers/User-Agent;
- padding parameters;
- Session ID/sequence keys and ranges;
- uplink behavior;
- XMUX ranges.

This is intentionally a starting profile, not a promise that one randomized preset is optimal for every CDN, proxy, network or client.

## Advanced JSON

The complete XHTTP JSON editor remains available for fields that are not practical to model as guided controls.

The constructor can normalize advanced fields through `extra` while preserving the outer `path`, `host` and `mode` semantics expected by Xray's SplitHTTP parser.

---

# FinalMask

FinalMask is exposed as a wide card catalog with transport/direction compatibility logic.

## Catalog

### TCP

- Sudoku
- Header Custom
- Fragment
- XMC (Minecraft)
- Filter

### UDP

- Salamander / Gecko
- Sudoku
- Header Custom
- mKCP Legacy
- Noise
- Port Hopping (`udphop`)
- XDNS
- XICMP
- Realm
- Filter

### QUIC

- client `quicParams`

## Compatibility behavior

Cards remain discoverable, but incompatible choices can be disabled with an explanation.

Examples:

- XDNS is tied to mKCP-style usage;
- QUIC client parameters require compatible QUIC/H3 transport;
- Gecko is represented through Salamander packet-size behavior rather than an unrelated `gecko` type;
- some masks are inbound/server-only;
- several client-side layers belong in `xmesh.clientFinalmask` rather than the inbound `finalmask` object.

See `FINALMASK_COMPATIBILITY.md` for the complete matrix.

## Randomized defaults

New basic presets avoid identical sample fingerprints across every generated configuration.

- Fragment: randomized ranges/delays;
- Noise: randomized ranges/delays;
- TCP Header Custom: random URL-safe payloads instead of `HELLO/WELCOME`;
- UDP Header Custom: random hex payloads;
- Sudoku/Salamander: cryptographic secrets.

An existing customized FinalMask is not randomly regenerated during unrelated edits.

---

# Fingerprints and client export

## Host fingerprint

New hosts default to Chrome.

## Per-user fingerprint

The user card can override the host fingerprint.

```text
Default → inherit host → fallback chrome
Custom  → use the selected value only for this user
```

Client TLS/REALITY export uses the effective user/host fingerprint; changing a user override does not modify the host.

---

# Subscription projection

A valid inbound profile still has to be projected into a client configuration.

The exporter handles the supported protocol/transport families and must keep server-only data out of client JSON while copying required symmetric/client-side values.

Important examples:

- REALITY client parameters must be complete;
- Shadowsocks 2022 credentials use the required server/user key composition;
- FinalMask client layers must be explicitly compatible;
- XHTTP advanced fields are exported only where the projection implementation supports them;
- missing required material should fail closed rather than emit a deceptive broken profile.

See `XRAY_CLIENT_EXPORT_MATRIX.md` and `SUBSCRIPTION_SECURITY.md`.

---

# Safe editing checklist

Before saving/applying a profile:

1. verify protocol and transport;
2. explicitly choose Security;
3. validate certificate/REALITY material;
4. inspect generated/randomized XHTTP values;
5. inspect client/server FinalMask direction;
6. run Studio diagnostics;
7. save/assign the profile;
8. wait for the node to report applied runtime state;
9. test with a real client.

A valid editor JSON is necessary but is not proof of network reachability, firewall/NAT correctness, DNS correctness or third-party client compatibility.
