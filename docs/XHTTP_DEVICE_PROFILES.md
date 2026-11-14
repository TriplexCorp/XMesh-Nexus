# XHTTP Device Profiles

XMesh Nexus differentiates client XHTTP transport profiles by platform without requiring multiple subscription URLs. It does **not** assume every VPN application supports all XHTTP options.

## Configure
Open **XRAY STUDIO** → choose an XHTTP inbound → **XHTTP** → **Профили устройств**.

Select iOS, Android, Windows, macOS, Linux, or Auto. Choose a preset (mobile packet-up, desktop stream-up, neutral auto) or edit the saved profile; inspect the HTTP method, packet-up POST size/interval and six explicit XMUX controls. A reset removes only that platform's override.

Profiles are persisted at `inbounds[].xmesh.xhttpDeviceProfiles`; the underlying server-side `streamSettings.xhttpSettings` remains independent. Host-level `clientXhttpSettings` overrides platform profiles. Unknown user agents use Auto or the inherited inbound settings, never guess a platform.

### Output precedence
Server XHTTP shared client projection → inbound platform override → host-specific `clientXhttpSettings`.

The platform is taken from a recognized client User-Agent or explicit `?device=ios|android|windows|macos|linux|auto`. Unrecognized or ambiguous User-Agents use Auto. The query override selects a transport profile, **not** an authorization identity. The subscription token retains its normal access controls.

### Safety
- Profile fields are validated server-side when saving XRAY STUDIO profiles, including allowed fields, modes, numeric ranges, XMUX keys, GET/packet-up constraints, and `maxConnections` vs `maxConcurrency` conflict.
- Client-only profile metadata is **removed** before the signed desired Xray node configuration is compiled; the profile is used only by the subscription generator.
- Client Xray JSON and advanced XHTTP fields in VLESS links use the same projection; other client formats may not support XHTTP, so do not silently downgrade them.
- The built-in **Auto** profile inherits from shared XHTTP if no explicit defaults exist.
- Values are preset suggestions, not empirically optimal on every network. Test on representative iOS/Android/desktop clients and your Xray release.

See `docs/XRAY_CLIENT_EXPORT_MATRIX.md` for client/server field boundaries.
