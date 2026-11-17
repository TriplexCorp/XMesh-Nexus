# Telemetry reassignment audit — 2026-11-17

Baseline: 4db12eccf75488d6305a59fc68e715d7d07b20d0. The merged telemetry_scope verifier evaluates current node/profile/user/Squad relationships before metric persistence. Existing tests cover unrelated users, inbound tags and mixed-batch rejection.

This continuation adds a disposable integration scenario: establish valid counters; move that user into an unrelated Squad; submit a delayed mixed batch and an old inbound sample; require 403 and unchanged hold/expiry/presence/usage for both users; restore membership and require legitimate lower counters and first-contact activation to remain accepted. It uses generated CI-only identities and the existing loopback-only test harness. No production requests or runtime changes are introduced.

Status: test prepared, execution pending. A successful result would cover sequential reassignment, not concurrent permission changes, exact SQL ledger rollback, cross-node quota reservation or prolonged offline recovery. Those remain open.

Operational issue to investigate next: rejecting a complete mixed packet can delay valid users' accounting until the agent refreshes its assignments. Measure actual agent filtering/retry/watermark behavior before choosing a compatibility fix. Do not accept stale authorization merely to avoid the accounting delay.
