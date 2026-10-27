# XSP-v2 cutover persistence gate — staging-only ledger

The migration `0103_node_xsp_cutover_permit_ledger.sql` adds a **passive**, durable PostgreSQL record for signed cutover permit issuance and eventual authenticated ACKs. It has **no live routes, signers, triggers or epoch advancement**. Applying this migration alone MUST NOT authorize a rotation.

The proposed fields deliberately include full signed permit bytes and their canonical SHA-256 rather than reconstructing signed data from mutable model fields; a per-node request ID, nonce and permit-input digest each enforce unique identity. A partial unique index prevents two simultaneous `issued` rows for the same node. A bounded `issued_at/expires_at` check and explicit state/ACK consistency checks reject several malformed writes.

**Important limitation:** a CHECK constraint is not cryptographic verification. Existing SQL doesn't prove owner approval, recompute candidate digest, bind the prepared public pair, authenticate signatures, prevent deletion or arbitrary manual updates, validate chronological ACK timestamps, or make a terminal state irreversible. The table is an audit/persistence scaffold, not an active anti-replay implementation.

Next independent implementation PR must:
1. Freeze a canonical approved-candidate SHA-256 serializer including the precise 0102 public key bytes and both key IDs; derive it from locked DB rows and expose Rust/Go vectors.
2. Under per-node `SELECT FOR UPDATE`, transactionally check expected old epoch, proved/unexpired pending pair, owner approval, signer purpose and signer pin; construct, double-sign, then record the **exact bytes and nonce** atomically. Same request returns the same permit; conflicting request fails.
3. Validate the two signatures from pending new keys on a submitted ACK, compare to the **DB-loaded** permit and pending keys, and atomically record ACK plus server-side epoch advancement while retaining previous public keys pending separate retirement. Only owner-approved retirement may remove previous trust.
4. Fail-closed after crashes: persist ACK identity and floor on Node before signing; duplicate retries get identical results; include unique nonce registry, signed commit receipt, missing receipt recovery and end-to-end failure injection.
5. Run disposable-node staging and independent security review before any production cutover.

**Do not apply this as an out-of-band production DB hotfix.** Normal migration governance and backup policies apply. `XMESH1` remains active and `strict-pq` stays OFF.
