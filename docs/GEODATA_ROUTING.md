# GeoData and routing (node-managed v1)

XMesh Nexus stores GeoData preferences on the node record; XRAY STUDIO profiles remain reusable. Only nodes fetch .dat assets and no inbound control port is opened.

## Deployment / upgrade

1. Update XMesh Nexus main so the server emits signed GeoData policies.
2. Existing nodes: use Update Agent to install control-v4.1.0 and the GeoData sync worker. Nodes older than control-v4 require a one-time manual upgrade; new XMesh-Node bootstrap installations include the helper.
3. Nodes → Edit → GeoData and routing: enable GeoData and optionally advertising blocking, then save.
4. Validate on a disposable node before rollout. Run: systemctl start xmesh-xray-sync.service
5. Check: journalctl -u xmesh-xray-sync.service -n 80 --no-pager and the runtime GeoData status on the node card.

## Sources and rules

Defaults: Loyalsoldier/v2ray-rules-dat releases for geosite.dat and geoip.dat, individually customizable.

Additional source lines: filename.dat https://example.org/filename.dat [optional SHA-256 hexadecimal digest].

Rules:

    geosite:category-ads-all => block
    geoip:private => direct
    ext:custom.dat:my-category => block

block uses reserved xmesh_geo_block blackhole outbound; direct requires an existing freedom outbound tagged direct. StatsService routing retains priority; node-level rules run before the shared XRAY STUDIO profile's catch-all routes.

## Security and state

Node authenticates desired-config using Ed25519, and the server embeds GeoData metadata into its separately signed offline-policy. The node's policy verifier checks the signature before any manifest is read. The downloader validates public DNS HTTPS targets and every redirect, enforces bounded downloads, optional SHA-256 and at most 10 files. Files are staged in /var/lib/xmesh-xray-sync/assets and mounted read-only into Docker Xray with XRAY_LOCATION_ASSET. A new dataset is verified by xray run -test and rolled back on deployment failure. If GeoData changes without config changes, the managed instance still restarts. Old verified data is retained if the remote source cannot be reached.

Updates occur at 6–168-hour intervals, independently on each node, including when the panel is temporarily offline via the cached, previously verified signed policy. The heartbeat returns per-node status and file checksums. A current status means files passed the last reconciliation, not that ads are proven blocked.

## Current limits

- Remote HTTPS sources are implemented. Uploading a binary dataset directly into the panel is not yet implemented.
- Global inheritance and mass-assignment are not implemented; configuration is per node.
- Client-side GeoData delivery and routing are unchanged.
- A plain-text domain list is not a .dat file; compile it before configuring it as an Xray asset.
- Runtime integration must be verified on a real test VPS before production rollout.

Run node downloader tests: python3 -m unittest discover -s tests -p test_geodata_sync.py
Run shell syntax checks: bash -n deploy/xmesh-xray-sync.sh bootstrap.sh
