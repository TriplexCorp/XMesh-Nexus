# Test results — pending first CI cycle

No local commands or scanners have run: the selected Cloud executor is unavailable. Source inspection through the GitHub connector is available.

| Test | Exact boundary | State |
|---|---|---|
| Repository/ref/file inventory | Three pinned GitHub snapshots, release/tag refs, branch pagination | collected; detailed content review partial |
| Sub embedded limiter consistency | installer heredoc equals canonical limiter.py | equal under direct source comparison; not a runtime test |
| Baseline login resource observation | real isolated API/Redis/PostgreSQL, 64 bounded fixture attempts, one async worker | CI queued; not yet evidence |
| Candidate login regression | work admission, cheap endpoint responsiveness, 8 KiB candidate body budget, maximum escaped-password compatibility | expected to fail before remediation |
| API authorization, Chromium XSS, quota/offline races, scanners/SBOM, clean VPS | requirements from original audit task | pending; not claimed passed |

The test harness refuses non-loopback HTTP targets, proxies and redirects; it requires XMESH_AUDIT_DISPOSABLE=1 and uses only generated fixture users. It reports aggregate statuses/latencies, never passwords, cookies, feed tokens or real identities. A passing test establishes only its stated boundary.
