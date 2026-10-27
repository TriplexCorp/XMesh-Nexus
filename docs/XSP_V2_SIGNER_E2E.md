# XSP-v2 isolated signer process E2E

## Scope and status

Implemented in the working branch `test/xsp-v2-signer-process-e2e`, based on Nexus
`dceaa07d70526d3c290f9fee6ca45cf69a883123`. This is a disposable staging test,
not a deployed PQ control plane. Local validation passed; remote CI, review and
post-merge validation remain required before closing the Roadmap gate.

The test builds the real `backend/Dockerfile.xsp-signer` runtime and runs it as
UID `10002`, GID `10001`. A separate API test process runs as UID/GID `10001`.
Only the signer and trusted fixture generator mount the disposable key volume.
The API mounts public fixtures and the shared Unix socket, never the PEM volume.
Test keys must never be reused for a real enrollment or deployment.

No external ACK route, production keys, existing database, VPS, DNS, firewall,
Nginx configuration or suite activation is changed. `strict-pq` stays OFF.

## Run

From the repository root, with Docker/BuildKit available:

```bash
python3 scripts/test-xsp-v2-signer-integration.py
```

The harness builds two images, creates a randomly named private Docker network,
TimescaleDB/PostgreSQL databases, credentials, keys and volumes, and removes only
its own resources in `finally`. It prints the run's resource prefix. SIGTERM is
handled to enter cleanup; SIGKILL or an executor failure can still leave orphaned
resources. Inspect that exact run's prefix before removing any such objects.

Required final outcome: exit code `0` and `SIGNER PROCESS E2E: PASS`. Each required
Rust fixture/client test must report one executed passing test. Missing
prerequisites, an ignored test that was not explicitly executed, zero tests, or
Python optimization disabling assertions are failures, not readiness evidence.

The harness uses the development build profile to keep disposable builds small.
The Dockerfile's default runtime build remains `release`; test code is present
only in the explicitly selected `signer-tests` target.

### Managed proxy and constrained workers

Preserve Docker's managed proxy settings and TLS verification. A combined system
and managed proxy CA bundle can be supplied with `--proxy-ca /path/to/bundle.pem`;
it is a BuildKit secret, not an image layer. The optional
`--builder-image <trusted-local-image>` selects an equivalent Rust/OpenSSL builder
for workers where the official Rust image's vfs layers exceed available disk.
Do not substitute an untrusted builder or disable verification.

At least 3 GiB free is required **after** image builds for disposable containers;
building itself requires additional headroom. The harness refuses to start the
databases below that threshold. It never prunes unrelated Docker state. After
reviewed cleanup of this build's intermediate cache, `--skip-build` reuses the
prepared images.

For local test-only edits, `--test-binary /absolute/path/to/test-executable` can
mount a freshly compiled, executable Rust test runner into the fixture/API
containers. It does not replace the real signer runtime binary. This local
iteration path was used with Rust 1.99.1 and OpenSSL 3.5.7; CI builds both runners
from source without this override. `--skip-build` never proves that an image
matches subsequently modified production source: rebuild whenever signer
runtime code changes.

## What the gate checks

- Actual application migrations and genuine dual-signed committed ACK fixtures.
- Actual provisioning SQL, repeated after deliberately adding stale role
  membership and a column grant; effective object privileges are tested with
  the convenience read-only GUC disabled.
- Rejection of excessive table/column/PUBLIC grants, TEMP/DDL/write access,
  unrelated reads, privileged role attributes, writable sessions and membership.
- Approved pins; regular, root-owned, group-readable private files; rejection of
  missing files, wrong permissions/ownership, symlinks and extra hard links.
- Real socket ownership/mode and stale-socket recovery after SIGKILL. API rejects
  a fake signer UID before sending ACK bytes; signer rejects a wrong client UID.
- Malformed/unknown-field JSON, noncanonical Base64, oversized/incomplete input,
  wrong ACK/request and either missing signature. Stalled PostgreSQL and partial
  socket requests have bounded failures.
- Independent signer DB readback, both receipt signatures, API-side verification
  and immutable exact-byte persistence through the actual orchestration helper.
- Concurrent callers, discarded signer response before INSERT, repeat recovery
  after INSERT, direct signer refusal after a receipt exists, and exact-byte
  recovery with the real signer stopped. The first durable receipt and epoch
  cannot be replaced by retry.
- Corrupt durable receipt and changed epoch fail closed. A separate fresh ACK
  deterministically changes epoch **after a real signature and before INSERT**;
  the API must return an error and leave its outbox empty.
- No credentials, ACK bodies or PEM material in signer logs; existing signed
  Rust/PostgreSQL regression executes in a separate disposable database.

The harness also checks the real signer PID's socket file descriptors against
TCP LISTEN entries, excluding Docker's separate DNS listener. The image's
`test -S` healthcheck alone remains insufficient evidence of functional readiness.

## Provisioning change and limits

`20-create-xsp-v2-signer-role.sql` now removes PUBLIC database CREATE/TEMP and
PUBLIC schema CREATE privileges, because they cannot be revoked from just one
PUBLIC member. It clears stale direct column grants as well as table grants and
memberships. Review other database users before explicitly provisioning an
existing deployment; no production provisioning was performed by this work.
Signer startup rejects effective excessive grants in the checked public objects,
including column grants and executable public SECURITY DEFINER routines. This
does not claim isolation from the database administrator or a complete audit of
all extensions and schemas.

Queries have statement/lock timeouts and the signing request has an overall async
deadline. The signer is still sequential; this is bounded failure behavior, not
an availability or load certification.

These tests do not establish exactly-once signing before durable INSERT, arbitrary
multi-epoch receipt recovery, whole-disk/DB snapshot anti-rollback, production
key retirement, HSM custody or independent security review. Signing keys remain
inside the host administrator's trust boundary.

The next development stage is the separate PQ-only TLS ingress gate, **after**
this stage's required CI/review/post-merge checks. An external
`POST /api/v2/node/keys/rotation/ack` must remain unmounted until actual negotiated
TLS 1.3 `X25519MLKEM768` is proven on every hop and Node authentication is bound
independently to the signed request. See [Enterprise Roadmap](ENTERPRISE_ROADMAP.md).
