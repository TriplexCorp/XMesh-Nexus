# XSP-v2 P0-E ML-DSA-65 FIPS 204 external verification-vector boundary

This bounded gate pins and independently re-verifies merged XMesh-Node PR #50 at exact source revision `ffebcc30424463dd0afcdb8226bcd4b48c019bff` against an exact official NIST ACVP-Server ML-DSA FIPS 204 signature-verification corpus.

## External source pin

The vector source is `usnistgov/ACVP-Server` at exact revision `a7f283cdc87d2d6dd93c1bac59e5622c5f9f8324`, the revision that corrected the ML-DSA FIPS 204 signature-verification sample set for the `ModifyZ` disposition. The gate additionally pins the exact Git blobs for `prompt.json`, `expectedResults.json`, and `registration.json` under `gen-val/json-files/ML-DSA-sigVer-FIPS204` so a moved branch or later corpus change cannot silently alter the evidence.

## API-compatible scope

Go 1.27.3 `crypto/mldsa` exposes the FIPS 204 pure external signature interface with optional context. It does not expose the ACVP internal-interface, `externalMu`, or pre-hash interfaces as equivalent public APIs. Therefore this gate deliberately selects only groups with all of:

- parameter set `ML-DSA-65`;
- signature interface `external`;
- `preHash = pure`;
- `externalMu = false`.

The ACVP context bytes are passed through `mldsa.Options.Context`. Every selected case must have an official expected result, the public key must have the exact ML-DSA-65 length, and the result of `mldsa.Verify` must exactly match NIST's expected `testPassed` value.

## Verified corpus slice

On the pinned NIST corpus and Node PR #50 merge, the compatible slice contains exactly **1 test group / 15 cases**, including **3 expected-valid** and **12 expected-invalid** signatures. The test fails closed if the compatible slice becomes empty, loses either positive or negative cases, contains duplicate/missing result IDs, malformed hex, unexpected public-key sizes, or produces any verification result different from the pinned NIST expectation.

The Node delta is test-only: one Go test file and one dedicated workflow. Nexus independently pins the exact two-file delta from the prior reviewed Node parser-fuzz checkpoint and re-runs the external-vector proof on the exact merged Node source.

## Explicit limits

This evidence is not an ACVP certification and is not exhaustive cryptographic implementation assurance. It does not claim coverage of ACVP pre-hash, `externalMu`, or internal-interface groups because those are outside the public Go API used by XMesh. It does not replace independent security review, does not establish physical power-loss qualification, does not enable `strict-pq`, and does not authorize production rollout.
