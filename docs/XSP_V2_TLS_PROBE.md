# XSP-v2 — hybrid TLS transport and dedicated ingress proof

> **Experimental / test-only. Do not enable `strict-pq`, edit production TLS/Nginx, expose the ACK route, or change live Nodes based on this file.**

## Target transport invariant

For the future XSP-v2 Node control plane, transport succeeds only when all of the following are true:

- TLS **1.3**;
- the **actually negotiated** key-exchange group is exactly `X25519MLKEM768`;
- the certificate chain is trusted and the intended hostname/SNI is verified;
- the proof is a fresh full handshake, not a resumed session standing in for new hybrid key agreement;
- there is no automatic fallback to TLS 1.2, X25519-only, insecure verification or legacy `XMESH1`;
- every protected network hop is accounted for independently.

Hybrid TLS key agreement is separate from XSP/2 message authentication. Security-critical XSP/2 messages still require **Ed25519 AND ML-DSA-65**. User VPN traffic remains the Xray data-plane.

## Current production reality

The normal Nexus public HTTPS vhost and production Node Agent have **not** been migrated to this transport. The working production control plane remains legacy `XMESH1`/Ed25519 and `strict-pq` remains OFF.

A chain such as `Node → CDN/LB → Nginx → Nexus` contains multiple independent hops. A PQ handshake at one edge does not make an unreviewed plaintext or classical origin hop post-quantum confidential.

## Existing laboratory proof

The repository already contains two independent diagnostics:

1. `scripts/check-xsp-nginx-isolated.py` starts a throwaway Nginx/OpenSSL 3.5+ listener and verifies TLS 1.3, negotiated `X25519MLKEM768`, certificate/hostname checks and downgrade rejection.
2. `scripts/check-xsp-hybrid-tls.py` uses OpenSSL `s_server`/`s_client` plus the separately built XMesh-Node Go 1.27 `tlsprobe` and checks that a valid classical TLS 1.3/X25519 control server is rejected by the strict Node probe.

The Node `tlsprobe.DialStrict` constructor:

- sets minimum and maximum TLS version to TLS 1.3;
- offers only `tls.X25519MLKEM768`;
- performs normal certificate/hostname verification;
- disables the session cache;
- rejects `DidResume`;
- reads `tls.ConnectionState.CurveID` and rejects any negotiated group other than `X25519MLKEM768`;
- has no `InsecureSkipVerify`, compatibility curve or legacy fallback parameter.

These tests prove a laboratory handshake only.

## P0-C1 — dedicated process/container ingress E2E

The current P0 adds a **dedicated disposable ingress runtime** under `deploy/xsp-v2-ingress/` and a process-level E2E test. It intentionally has no backend application hop.

### Runtime boundary

The test runtime:

- uses a dedicated non-root UID/GID;
- listens only on container port `8444`;
- is started on a Docker `--internal` network with **no published host port**;
- runs with a read-only root filesystem, dropped capabilities and `no-new-privileges`;
- receives only throwaway TLS certificate material;
- disables access logging, TLS session tickets/cache and early data;
- contains no `proxy_pass` or `upstream`;
- returns HTTP **404** for every path.

Neither `compose.yaml` nor `install.sh` activates this runtime. `POST /api/v2/node/keys/rotation/ack` remains unmounted from the Rust API.

### Process E2E contract

`scripts/test-xsp-v2-ingress-process.py` builds and starts the real ingress image and proves:

- one persistent container exists on the isolated internal network and there is no Nexus/API backend container on that network;
- the strict Go 1.27 Node probe reports exactly TLS1.3, `X25519MLKEM768`, verified certificate and full handshake;
- an independent OpenSSL 3.5+ client observes the same TLS version and negotiated group;
- TLS 1.2 fails;
- TLS 1.3 with only X25519 fails;
- wrong hostname fails;
- an unrelated trust anchor fails;
- HTTP `/`, the future ACK path and a legacy Node API path all remain inert 404 and do not redirect;
- server-side session reuse cannot substitute for a fresh hybrid proof;
- an unavailable/invalid mandatory group makes Nginx configuration fail instead of silently selecting a classical group.

All certificates/keys, containers, networks and volumes are throwaway and are removed after the test. No production API, DB, DNS, certificate, key or VPS is contacted.

`.github/workflows/xsp-hybrid-tls.yml` keeps the earlier laboratory tests and adds a separate **Dedicated PQ-only ingress container and network E2E** job. Passing CI is required before this P0 may be called complete.

## What this still does NOT prove

Even a green process E2E does not yet prove a deployed production Node↔Nexus path. In particular it does not provide:

- a public/production listener, DNS or ACME lifecycle;
- application-level Node authentication/authorization;
- the XSP-v2 ACK HTTP handler;
- a secure terminator→Nexus origin hop;
- production Agent integration;
- production key enrollment/rotation/retirement;
- full snapshot anti-rollback;
- independent penetration/security review.

## Next gate after this transport P0

Only after the dedicated ingress proof passes review, merge and post-merge CI may the project design the narrow `POST /api/v2/node/keys/rotation/ack` route behind that proven boundary.

That later route must independently authenticate Node identity and bind it to the exact dual-signed ACK, permit, request ID, nonce, epoch, candidate and immutable receipt outbox. A successful HTTP status is never a substitute for the signed receipt, and a failed PQ handshake must never create a legacy authenticated session.

**Activation remains disabled.**
