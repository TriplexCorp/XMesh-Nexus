# Host client overrides

The normal host editor provides security-layer selection (inbound default,
TLS or None), ALPN presets, Use SNI as Host, certificate verification and XHTTP
mode selectors. A custom previously saved ALPN value remains available.
TLS and XHTTP selectors update their corresponding metadata objects, preserving
other expert properties. Clearing a selector removes its explicit override.
Security-layer overrides are rejected for REALITY; the inbound mode is required.

Open **Hosts → Edit → Client settings → Expert JSON settings** for additional
client parameters. These objects
change generated client configurations, not the node's inbound or TLS certificate.
Only controls relevant to the selected transport/security are shown. Other values
are preserved when switching profiles so they can be edited again later.

- **XHTTP JSON**: documented client XHTTP settings such as `mode`, `headers`,
  `xmux`, padding, upload parameters and explicit `downloadSettings`.
- **HTTP headers JSON**: client request headers for WebSocket / HTTPUpgrade.
- **TLS JSON**: client certificate verification, certificate pinning,
  session resumption, TLS versions, cipher/curve preferences and ECH metadata.
- **MASQUE JSON**: client `host`, `headers` and `xmux`.

Each field must contain a JSON object. Leave it blank to inherit profile metadata;
use `{}` to explicitly replace inherited metadata with an empty object. The API
stores cleared overrides as `null`; serializers treat that as inheritance.

Example XHTTP settings:

```json
{"mode":"auto","xmux":{"maxConcurrency":4}}
```

Example HTTP headers:

```json
{"User-Agent":"ExampleClient/1.0"}
```

Example TLS settings:

```json
{"minVersion":"1.3","enableSessionResumption":true}
```

Existing dedicated host/path overrides take precedence over XHTTP metadata.
Only client-applicable documented fields are projected into output. Server-only
settings and certificate private keys are not exported. Actual parameter support
still depends on the receiving client and its Xray-core version.
