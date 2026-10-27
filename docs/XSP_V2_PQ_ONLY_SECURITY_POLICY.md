# XSP-v2 — mandatory post-quantum control-plane policy

**Product security invariant (27 October 2026).** XMesh has **one** target
control-plane security policy, not a user-configurable compatibility mode.
For a deployed XSP-v2 Node, either the **complete** required cryptographic
protocol succeeds, or **no control-plane connection is established**.
Fail-closed is a functional requirement, not a log warning or preference.

## 1. Required properties (ALL, never OR)

1. **Transport:** genuine **TLS 1.3** with negotiated key exchange group
   `X25519MLKEM768` (classical X25519 **plus** FIPS 203 ML-KEM-768).
   Check the **actual negotiated group** and a trusted certificate with the
   correct hostname/SNI. Offering/supporting the group is insufficient.
   Ordinary X25519, TLS 1.2, insecure certificate validation and TLS
   fallback **must all fail**. The Node client is not given an alternate
   curve/suite, a permissive dialer, or an `--insecure` escape hatch.
   Independently assess every TLS termination hop; merely securing a CDN
   edge does not make an HTTP origin connection post-quantum confidential.
2. **Authenticated control messages:** the canonical `XSP/2` envelope is
   signed and verified by **Ed25519 AND ML-DSA-65** against independently
   enrolled, purpose-bound and pinned public keys. Never accept one
   signature alone; never accept old `XMESH1` authentication or unsigned
   server config/command/ACK/no-command replies as the equivalent.
3. **Binding/state:** authenticate Node/panel identity, intended recipient,
   method/path, message type/direction, exact payload/revision, key epoch,
   unique nonce, request ID and expiry. Persist replay protection and
   monotonic key/suite state before acting; reject wrong/stale state.
   Signed applied ACK, signed server commit receipt and durable idempotent
   retry are mandatory before key retirement.
4. **Key custody and enrollment:** provisioning requires verified owner
   authorization and genuine possession of **both** Node private keys.
   The Node must have trustworthy pinned panel verification keys before
   processing its first security-critical response. Missing keys, PQ
   runtime, protected signer, trusted TLS endpoint or durable state =
   **reject enrollment/connection**, not bootstrap through legacy and
   silently continue.

## 2. Absolutely no user-selectable fallback

- No UI dropdown, checkbox, environment variable, command-line flag or
  per-Node setting to choose `XMESH1`, `Ed25519-only`,
  `X25519-only`, "compatibility mode", "prefer PQ" or "disable PQ"
  on the **future XSP-v2 product control plane**.
- No automatic retry over a weaker TLS curve/version, older HTTP API,
  legacy signing scheme, unsigned response, or different trust anchor.
- No ability for a failed PQ handshake, missing PQ signature, expired
  key, unknown epoch or database inconsistency to turn into an
  **authenticated** legacy session. Telemetry must report failure;
  retries may use only the same full PQ requirements.
- `strict-pq` and `minimum_suite` may remain **internal** migration and
  audit labels in legacy database/code. They are **not** a user choice
  in the target design; new PQ-only instances have the requirement
  intrinsically, not as a preference. Likewise, a rollout mechanism is
  not permission to leave weak connections available.
- On failure the Node must refuse the **control-plane connection and any
  new remote state**; an already applied, independently verified offline
  Xray policy may remain governed by its separately reviewed local
  safety/expiry rules. This requirement does not modify Xray user-VPN
  data-plane encryption.

## 3. Migration from current reality (non-disruptive engineering)

**As of 27 October 2026, production is still legacy `XMESH1`.**
The existing Go 1.23 Agent and public Nexus HTTPS ingress cannot yet
meet this invariant: Go 1.27 PQ research code, verified Rust DB helper
and hybrid TLS probe are separate from deployed infrastructure. The
isolated Go `tlsprobe.DialStrict` is an initial fail-closed **client
construction boundary**, not an integrated secure agent.

The old deployment must **not** be mislabelled "post-quantum".
Engineering may keep this currently operating legacy deployment running
until an explicitly authorized replacement is deployed and validated.
That is **not** a new user-visible legacy choice in the resulting product.
Do not covertly disable live Node 13 "Poland-2" during development.

The safe cutover is: finish protected panel signer + signed receipt,
wire trusted signed commands/configs, integrate a PQ-capable Node Agent,
provision both verified keypairs/pins, create an authenticated
TLS 1.3 / X25519MLKEM768 **node-only** ingress with no insecure
intermediate hops, prove recovery/downgrade rejection on a disposable
Node, obtain independent security review, then authorize an explicit
production replacement. If the required PQ capability is unavailable
at cutover, **do not connect** and do not silently fall back.
Do not offer a user-facing "stay on classical" option in that release.

## 4. Minimum acceptance tests

- Valid complete TLS 1.3 `X25519MLKEM768`, valid certificate/SNI and
  both message signatures succeeds, with correct response correlation.
- TLS 1.2, TLS 1.3 `X25519` only, wrong hostname, untrusted
  certificate, incomplete/resumed handshake, missing `ML-DSA-65`,
  Ed-only ACK, replay/expired nonce, wrong epoch/request ID and
  unsigned responses **each fail before acting**.
- Bootstrap without verified owner-approved dual public-key bindings
  or correct pinned panel keys **fails closed**.
- A connection fails when its PQ provider is unavailable; restart,
  network interruptions, loss of signed receipt, backup restore and
  rejected downgrade never initiate an insecure secondary session.
- End-to-end canary demonstrates **actual** negotiated TLS group on
  every protected hop, authenticated and applied configs, signed ACK
  and receipt, durable recovery and no silent v1 route access.

## 5. Status and scope

This is the binding **target product security requirement**, **not** a
claim of deployed enforcement. Existing `XMESH1` endpoints,
PostgreSQL `minimum_suite=1` staging fixtures, optional experimental
routes and the deployed Go 1.23 Node must be migrated or retired
**before** the finished XSP-v2 product can be called PQ-only.
Do not change live servers, flip DB floors or delete old keys merely
because this policy was documented.

See [Enterprise Roadmap](ENTERPRISE_ROADMAP.md),
[XSP-v2 wire specification](XSP_V2_WIRE_SPEC.md) and
[hybrid TLS probe](XSP_V2_TLS_PROBE.md).
