# DoS resilience

## Reviewed protection order

Nexus public subscriptions enforce URI length before query extraction (160-byte path and 2048-byte query budgets), strict 64-lowercase-hex token grammar, bounded process-local request/invalid-request ceilings, cached configuration and Redis-backed global/token budgets before subscription SQL. The global Redis counter counts requests, not distinct tokens. Disabling configurable limits does not remove the process hard ceiling. Redis evaluation errors fail closed. Format-valid random tokens can still reach token lookup within allowed budgets.

Configuration refresh uses a mutex and short cache; outage behavior and waiters require fault injection. Response fingerprint patching has a 16 MiB buffer cap; whether all expensive feed generation occurs after device authorization must still be traced. These observations are not a claim that every rejection path is storage-free.

Sub limits direct-peer IPv4 /32 and IPv6 /64 using an authenticated private Unix socket path from Caddy. It normalizes mapped addresses, caps peer state at 50,000 with idle expiry, bounds workers at 64 and read time at five seconds. Source equivalence between the standalone limiter and installer-embedded version was checked. Actual IPv6 Docker peer preservation remains untested.

## Login improvement and proof

See XMESH-AUD-001/002 and TEST_RESULTS.md. The four-slot limiter is process-local, bounds login operations and CPU workers, and does not queue excess attempts. Distributed replicas still need coordinated abuse budgets; this does not solve arbitrary volumetric DDoS. Cancellation does not prematurely free a running worker slot.

A legal 1024-byte password may expand sixfold in JSON; 8 KiB preserves that case. Global middleware retains its previous 2 MiB ceiling for other routes.

## Remaining tests

Instrument SQL/Redis command counts for malformed token, unsupported method, encoded token, long query and random format-valid token requests; prove rejection order rather than inferring it solely from source. Exercise disabled settings, Redis failure, cache stampede, multi-replica totals, IPv4-mapped and alternate IPv6 /64 identities. Measure readiness and unauthenticated machine-route costs with at most bounded local concurrency. Inspect regexes/JSON nesting and serialization separately; no completed ReDoS/fuzz campaign is claimed.
