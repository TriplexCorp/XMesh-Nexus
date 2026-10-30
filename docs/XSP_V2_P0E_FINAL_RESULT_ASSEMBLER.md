# XSP-v2 P0-E final result assembler

This helper assembles the already-collected real #138 evidence on the Nexus qualification host into the topology-aware KVM VPS durability v2 result. It does not run new crash tests, rotate keys, enable strict-pq, or authorize production activation.

Expected inputs in `/root`:

- `node13-final-five-run-index.json`
- `node13-final-five-run-evidence.tar.gz`
- `xspv2-postgres-crash-recovery-node13.json`
- `xspv2-provider-storage-acceptance.json`

Run:

```bash
python3 scripts/assemble-xsp-v2-kvm-vps-durability-result-v2.py --dir /root
python3 scripts/verify-xsp-v2-kvm-vps-durability-v2.py --result /root/kvm-vps-durability-result-v2.json
```

A successful verifier result qualifies the durability release gate only. It must still report `physicalPowerLossQualified=false`, `strictPQEnabled=false`, and `productionActivation=false`.
