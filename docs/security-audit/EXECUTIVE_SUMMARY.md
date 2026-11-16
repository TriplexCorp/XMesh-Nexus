# XMesh ecosystem security audit — in progress

Snapshot: 16 November 2026 (Europe/Moscow). This is a work-in-progress audit, not a safety certification.

Only TriplexCorp/XMesh-Nexus, XMesh-Node and XMesh-Sub are authorized. ProjectHimera is excluded: no source, endpoints, branches or infrastructure from it are accessed. Production servers, real subscriptions, DNS, user databases and deployed secrets are not tested or modified. Pull requests must not be merged automatically.

The Cloud executor failed to start (`github_connector_not_configured`), but repository access through the GitHub connector works. Static review and reproducible GitHub-hosted disposable CI are therefore used; there has been no local execution. CI is not an independent audit or clean-VPS qualification.

Initial file inventories are complete for the three pinned snapshots. Detailed endpoint/handler, crypto, quota, supply-chain and browser security review remains in progress. No P0/P1 is yet dynamically confirmed. This does not mean their count is zero.

First test cycle: measure login work admission, event-loop responsiveness and request-body budgeting against the exact baseline, then enforce a regression on the candidate. Both jobs use isolated PostgreSQL/Redis/API containers, fresh masked test secrets, a fixed loopback target, a hard request-count bound and automatic container/database destruction. Baseline observations are not a passing security result. Candidate is expected to fail until remediation is committed.

Next: verify measured evidence; remediate confirmed issues; generate the complete API/access matrix and SBOMs; expand fault-injection, cross-component and browser tests; perform a second pass over changes. See TEST_RESULTS.md and RESIDUAL_RISKS.md as those checkpoints are completed.
