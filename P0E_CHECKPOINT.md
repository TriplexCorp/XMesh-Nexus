# Current P0-E checkpoint

Authoritative live qualification/session handoff:

[`docs/XSP_V2_P0E_LIVE_QUALIFICATION_CHECKPOINT_2026-10-30.md`](docs/XSP_V2_P0E_LIVE_QUALIFICATION_CHECKPOINT_2026-10-30.md)

Latest Stage 1/Stage 2 evidence addendum:

[`docs/XSP_V2_P0E_STAGE1_STAGE2_EVIDENCE_2026-10-30.md`](docs/XSP_V2_P0E_STAGE1_STAGE2_EVIDENCE_2026-10-30.md)

Read those files together with [`docs/ENTERPRISE_ROADMAP.md`](docs/ENTERPRISE_ROADMAP.md) before resuming P0-E work.

Current recorded boundary:

```text
#137 independent external review: OPEN
#138 Node five-run matrix: COMPLETE
#138 independent PostgreSQL crash/recovery: COMPLETE
#138 protected live cutover/ACK/receipt: COMPLETE
#138 off-host production recovery witness: COMPLETE
#138 provider-storage risk acceptance: PENDING
#138 aggregate topology-aware v2 verifier: PENDING
strictPQEnabled=false
productionActivation=false
```

Latest production-path evidence for Node 13:

```text
protected permit result SHA-256  ac88343dde50076ad3779d9cb1a62b029b14c4b6d3e89fa6ba894fb16d90cba7
permit digest                     132906a49cfa7cdebb9fc0b346f93963802b73cc23aca1a333b2d449727fd642
applied ACK SHA-256               07ccd07a317b6797b637d6cd0b1cc5c79fb90ef0c771c3ee7cc2b6aab79016a9
commit receipt SHA-256            daf40d33fa63d35f6f02fbcae417c4f4a4262d31bd9a0d1f11493ca018925ae9
recovery pin SHA-256              810ab308323cc881f957b0d65b856d44420e6fa632034f94e51ccd5af1c05a07
recovery checkpoint SHA-256       bc730df3a2078027cc4cbb4982da622dc8970dd49796fd9cbc0566a6364a3069
recovery local-state SHA-256      d6dde3b05fc2fe234348b8e8219aab90ec9e772247924432ec59c535230a9b01
recovery verification SHA-256     4de873d0a5e9f85d245a9c880c0f75884117875888b5aedee4d4934cd64c5569
```

The off-host verifier returned `status=verified`, `nodeId=13`, `minimumEpoch=2`, `localEpoch=2`, bound to the exact immutable receipt above. The witness was executed in an independent container environment using OpenSSL 3.5.7 with the existing recovery binary dynamically linked to the container `libssl.so.3` / `libcrypto.so.3`; no production runtime activation flag was changed.

The next #138 boundary is explicit attributable provider-storage risk acceptance, followed by final aggregate evidence assembly and the topology-aware v2 verifier. Newer real evidence must supersede this checkpoint explicitly rather than being inferred from chat history.
