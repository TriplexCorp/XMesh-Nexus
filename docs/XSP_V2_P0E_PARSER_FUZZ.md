# XSP-v2 P0-E bounded security parser fuzz boundary

This gate pins and independently re-verifies merged XMesh-Node PR #49 at exact source revision `fc1548171aad331b8a7851a895a7f18a5440e858`.

It adds test-only native Go fuzz coverage around the strict JSON parsers used by the independent owner/off-host recovery checkpoint and the owner-authorized retirement flow. Production Agent/runtime code is unchanged.

## Covered parsers

The pinned Node source fuzzes three strict decoders:

- `Decode` for signed owner/off-host recovery checkpoints;
- `DecodeRetirementRequest` for the public retirement request exported from retained Agent state;
- `DecodeRetirementAuthorization` for the dual-signed owner retirement authorization.

Each target is seeded with a structurally valid message plus malformed/partial, empty, null, array, trailing-JSON, unknown-field and non-UTF-8 inputs. The strict decoders already enforce bounded input sizes, duplicate-field rejection, unknown-field rejection and no trailing JSON.

For every input that a decoder accepts, the fuzz invariant requires canonical/schema validation to succeed, marshals the accepted semantic object back to JSON, decodes it again through the same strict parser and requires exact semantic equality. This checks that accepted wire inputs cannot move into a parser state that the canonical validation path itself rejects or that changes meaning under a strict round trip.

## Bounded execution evidence

The dedicated Node workflow runs the normal recovery unit suite and then executes each fuzz target independently on Go 1.27.3 for 15 seconds with one fuzz worker. Nexus independently checks out the exact Node merge, verifies the exact two-file PR #49 delta and re-runs the same unit/fuzz boundary.

This is a bounded CI smoke gate, not a claim of exhaustive fuzzing. Longer-running fuzz campaigns may find cases that a short deterministic CI budget does not.

## FIPS 204 remains a separate gate

This gate deliberately does **not** claim ML-DSA/FIPS 204 known-answer validation. That work must use externally sourced, version-pinned vectors rather than self-generated signatures. The intended next cryptographic validation layer is a separately reviewed gate against official NIST ACVP ML-DSA FIPS 204 vectors, with the exact upstream vector source/revision pinned and limitations of the published vector corpus documented.

## Explicit non-goals

This gate does not close P0-E4a physical-power qualification, does not constitute an independent security review, does not enable `strict-pq`, does not alter the production legacy Agent authority, and does not authorize production rollout.
