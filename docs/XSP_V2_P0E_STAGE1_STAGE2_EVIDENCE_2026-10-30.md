# XSP-v2 P0-E Stage 1 / Stage 2 evidence — 30 October 2026

Status: authoritative evidence addendum for #138 live qualification. This records completed evidence only; it does not authorize strict-PQ or production activation.

## Stage 1 — protected Node 13 epoch 1 → 2 cutover: COMPLETE

Observed completed chain:

- protected permit result SHA-256: `ac88343dde50076ad3779d9cb1a62b029b14c4b6d3e89fa6ba894fb16d90cba7`;
- permit digest: `132906a49cfa7cdebb9fc0b346f93963802b73cc23aca1a333b2d449727fd642`;
- Node committed epoch/floor: `2`;
- applied ACK SHA-256: `07ccd07a317b6797b637d6cd0b1cc5c79fb90ef0c771c3ee7cc2b6aab79016a9`;
- Nexus/C2-C commit reached epoch `2` with ledger state `ack_verified`;
- immutable commit receipt SHA-256: `daf40d33fa63d35f6f02fbcae417c4f4a4262d31bd9a0d1f11493ca018925ae9`.

The production activation flags remained false.

## Stage 2 — independent off-host recovery-floor witness: COMPLETE

The existing recovery checkpoint binary was executed off-host in the `rust:1.99-trixie` environment using OpenSSL `3.5.7`. Dynamic dependencies resolved to the container `libssl.so.3` and `libcrypto.so.3`; no backend rebuild was required for the accepted witness run.

The exact Stage 1 receipt hash was checked before checkpoint creation:

`daf40d33fa63d35f6f02fbcae417c4f4a4262d31bd9a0d1f11493ca018925ae9`

Create result:

```text
created node=13 minimumEpoch=2 receiptSha256=daf40d33fa63d35f6f02fbcae417c4f4a4262d31bd9a0d1f11493ca018925ae9
```

Verify result:

```json
{"status":"verified","nodeId":13,"localEpoch":2,"minimumEpoch":2,"checkpointReceiptSha256Hex":"daf40d33fa63d35f6f02fbcae417c4f4a4262d31bd9a0d1f11493ca018925ae9"}
```

Preserved evidence SHA-256 values:

| Artifact | SHA-256 |
| --- | --- |
| recovery panel pin | `810ab308323cc881f957b0d65b856d44420e6fa632034f94e51ccd5af1c05a07` |
| immutable commit receipt | `daf40d33fa63d35f6f02fbcae417c4f4a4262d31bd9a0d1f11493ca018925ae9` |
| production recovery checkpoint | `bc730df3a2078027cc4cbb4982da622dc8970dd49796fd9cbc0566a6364a3069` |
| production local state | `d6dde3b05fc2fe234348b8e8219aab90ec9e772247924432ec59c535230a9b01` |
| recovery verification result | `4de873d0a5e9f85d245a9c880c0f75884117875888b5aedee4d4934cd64c5569` |

Accepted Stage 2 boundary:

```text
status=verified
nodeId=13
minimumEpoch=2
localEpoch=2
```

## Remaining #138 boundary

Stage 1 and Stage 2 must not be repeated merely to advance paperwork. Remaining work is:

1. explicit attributable provider-storage risk acceptance for the relevant KVM storage trust boundaries;
2. assemble the aggregate evidence/result bundle;
3. run the final topology-aware v2 verifier.

Until the whole-result verifier passes:

```text
guestCrashConsistencyQualified=false
providerStorageDurabilityAssumed=false
physicalPowerLossQualified=false
strictPQEnabled=false
productionActivation=false
```

#137 independent external security review remains a separate OPEN blocker.
