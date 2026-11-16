# XMesh security audit — current-main continuation

**State: evidence collection and manual triage, NOT a security sign-off.**

This directory contains a **new assessment** of the exact reviewed `main` commits of:

- [XMesh-Nexus](https://github.com/TriplexCorp/XMesh-Nexus/commit/5f2e6cc7c9f07102849906faca312908b20261ae) — `5f2e6cc7c9f07102849906faca312908b20261ae`
- [XMesh-Node](https://github.com/TriplexCorp/XMesh-Node/commit/647adcf7af326b205fce12545fb5d75a20bb8191) — `647adcf7af326b205fce12545fb5d75a20bb8191`
- [XMesh-Sub](https://github.com/TriplexCorp/XMesh-Sub/commit/17be0aab84ec04412ef490fcaa0953181b3e4262) — `17be0aab84ec04412ef490fcaa0953181b3e4262`

The evidence workflow is [security-audit-current.yml](../../.github/workflows/security-audit-current.yml). Its checkouts and tool downloads are pinned, the reports are redacted, and the scanner exit codes remain visible. GitHub Actions artifacts expire after 14 days. New findings must be recorded against **these exact commits** and their original tool versions.

The entire previous [#493 audit snapshot](archive/2026-11-16/EXECUTIVE_SUMMARY.md), including its original evidence index, methodology and unfinished tests, is preserved in [archive/2026-11-16](archive/2026-11-16). The archive is **historical** and must not be mistaken for the present vulnerability state.

The old [PR #493](https://github.com/TriplexCorp/XMesh-Nexus/pull/493) contains conflicting login and node-metrics test changes already superseded in current `main`. **Do not merge that branch to release the report.** This continuation contains documentation and source-scanning scripts only; it makes no functional changes to production Nexus, Node or Sub.

Read [CURRENT_STATUS.md](CURRENT_STATUS.md) for the triage ledger, assurance limits and outstanding tests.

**Excluded project:** ProjectHimera. No production VPS, database, secrets, users or live VPN traffic were accessed.
