# XMesh Nexus v6 — Single Public TCP/443 Control-Plane Contract

**Status:** current production topology contract for new installs and managed upgrades after the 31 October 2026 single-port correction.

This document exists to prevent a regression back to a separately exposed public `8444/tcp` listener.

## 1. Non-negotiable public network invariant

A standard XMesh Nexus v6 host exposes only:

- `80/tcp` — ACME HTTP-01 and HTTP→HTTPS redirect;
- `443/tcp` — all public HTTPS/control-plane TLS connections.

`8443/tcp`, `8444/tcp`, the Rust application port, product gateway port, PostgreSQL and Redis are **not public firewall requirements**.

In particular:

> **TCP/8444 MUST NOT be bound on `0.0.0.0` or `[::]` in the supported v6 product topology.**

The Compose product ingress is bound to `127.0.0.1:8444` only.

## 2. Why one public 443 does not merge the TLS trust boundaries

The host uses HAProxy only as a TCP/SNI multiplexer. HAProxy does not terminate TLS and does not validate or replace either TLS policy.

```text
Internet
   |
   | TCP/443
   v
HAProxy SNI passthrough
   |
   +-- panel FQDN ------------------> 127.0.0.1:8443
   |                                  Nginx + Let's Encrypt
   |                                  panel/admin/subscriptions/enrollment
   |
   +-- node-ingress.xsp.invalid ----> 127.0.0.1:8444
                                      dedicated strict-PQ ingress
                                      TLS 1.3 X25519MLKEM768
                                      ML-DSA-65 client identity
                                      XSP-v2 operational control plane
```

The flows share one external TCP port but retain independent TLS termination and security policy.

## 3. SNI routing contract

The current routing rule is intentionally narrow:

- SNI `node-ingress.xsp.invalid` → strict-PQ backend `127.0.0.1:8444`;
- every normal panel-domain TLS connection → panel backend `127.0.0.1:8443`.

The strict-PQ SNI is part of the product enrollment metadata and is not the same as the public DNS name used to reach the VPS.

The product gateway advertises:

```text
publicAddress = <PANEL_DOMAIN>:443
serverName    = node-ingress.xsp.invalid
```

Therefore the Agent connects to the same public address/port as the panel while sending the strict-PQ SNI required for routing and certificate verification.

## 4. Runtime bindings

Current Compose/host expectations:

| Listener | Required bind | Public? |
| --- | --- | --- |
| HTTP redirect/ACME | `*:80` | Yes |
| XMesh TLS multiplexer | `*:443` | Yes |
| panel Nginx TLS backend | `127.0.0.1:8443` | No |
| strict-PQ ingress | `127.0.0.1:8444` | No |
| Rust panel | `127.0.0.1:${APP_PORT:-8080}` | No |
| product enrollment gateway | `127.0.0.1:8082` | No |

PostgreSQL and Redis remain inside the Docker network.

## 5. Installer/update requirements

`deploy/install-panel-host.sh` is responsible for the public 443 topology.

Activation must:

1. ensure HAProxy is available;
2. recreate the current `xsp-v2-product` gateway/ingress from the checked-out Compose definition;
3. reject a public `:8444` bind;
4. render/validate loopback Nginx TLS configuration;
5. render/validate the HAProxy TCP/443 multiplexer;
6. move panel TLS termination from public `:443` to loopback `:8443`;
7. start/restart the `xmesh-https-mux.service` public listener;
8. verify `:443` is listening and `:8444` remains loopback-only.

This upgrade ordering is intentional. Older installations may still have a product ingress container created from the former `0.0.0.0:8444:8444` mapping. Recreating the profile before declaring the new topology active prevents that stale public listener from surviving a managed upgrade.

## 6. Security properties that must not be weakened

Moving the public address to port 443 must **not** be implemented by terminating both web and strict-PQ traffic in the classical panel Nginx vhost.

The following properties remain required:

- strict-PQ TLS terminates only at the dedicated PQ ingress;
- the PQ ingress still requires TLS 1.3 and `X25519MLKEM768`;
- ML-DSA-65 client identity verification remains mandatory;
- no classical fallback is introduced for the operational path;
- panel HTTPS may continue to use the normal Let's Encrypt/browser-compatible TLS policy;
- HAProxy only routes raw TLS by SNI and must not decrypt either flow.

## 7. Historical 8444 references

The repository contains historical XSP-v2 staging/rollout evidence that mentions a public or test `8444` listener. Some of those files are frozen evidence for the architecture that existed when the test was performed.

Do **not** rewrite cryptographic/qualification evidence merely to make old records look like the current topology.

Interpretation rule:

- historical/frozen evidence describing `8444` remains evidence of that historical test;
- current install, Compose, README and operations documentation define the supported topology now;
- the supported current topology is **public 80/443 only, loopback 8443/8444**.

## 8. Regression requirements

CI must continue checking at minimum:

- product gateway advertises `${PANEL_DOMAIN}:443`;
- Compose maps strict-PQ ingress only as `127.0.0.1:8444:8444`;
- generated panel Nginx config does not bind public 443;
- generated HAProxy config owns public 443;
- HAProxy routes `node-ingress.xsp.invalid` to loopback 8444;
- normal panel traffic routes to loopback 8443;
- installer text explicitly states that public 8444 is forbidden.

Any future change that makes `8444/tcp` a public firewall requirement is an architecture/security regression and requires an explicit replacement design, migration plan and review — not a documentation-only edit.
