//! PR02: library-backed, isolated OpenSSL 3.5 ML-DSA-65 + Ed25519 proof.
//! NEVER link this test-only crate into the live API without protocol review.
#[cfg(test)]
mod tests {
    use openssl::{
        pkey::{Id, KeyType, PKey},
        sign::{Signer, Verifier},
        version,
    };
    use serde::Deserialize;
    use sha2::{Digest, Sha256};
    use std::fs;

    #[derive(Deserialize)]
    struct Record {
        id: String,
        ed_seed_hex: String,
        mldsa_seed_hex: String,
        ed_public_sha256: String,
        ed_signature_sha256: String,
        mldsa_public_sha256: String,
        mldsa_signature_sha256: String,
    }

    #[derive(Deserialize)]
    struct CryptoVectors {
        schema: String,
        context: String,
        records: Vec<Record>,
    }

    #[derive(Deserialize)]
    struct WireVector {
        id: String,
        signing_input_hex: String,
    }

    #[derive(Deserialize)]
    struct WireDocument {
        vectors: Vec<WireVector>,
    }

    fn sha_hex(raw: &[u8]) -> String {
        hex::encode(Sha256::digest(raw))
    }

    fn decode_hex(text: &str, expected: usize) -> Vec<u8> {
        let bytes = hex::decode(text).expect("fixture must be valid hex");
        assert_eq!(bytes.len(), expected, "fixture length");
        bytes
    }

    // Intentionally independent of production APIs. "AND" means any missing,
    // corrupted, wrong-key or wrong-message signature causes rejection.
    fn verify_both(
        ed_pub: &openssl::pkey::PKeyRef<openssl::pkey::Public>,
        pq_pub: &openssl::pkey::PKeyRef<openssl::pkey::Public>,
        input: &[u8],
        ed_sig: &[u8],
        pq_sig: &[u8],
    ) -> bool {
        if ed_sig.len() != 64 || pq_sig.len() != 3309 {
            return false;
        }
        let Ok(mut ed) = Verifier::new_without_digest(ed_pub) else {
            return false;
        };
        if !matches!(ed.verify_oneshot(ed_sig, input), Ok(true)) {
            return false;
        }
        let Ok(mut pq) = Verifier::new_without_digest(pq_pub) else {
            return false;
        };
        matches!(pq.verify_oneshot(pq_sig, input), Ok(true))
    }

    #[test]
    fn test_hybrid_signatures_and_cross_language_public_vectors() {
        assert!(
            version::number() >= 0x3050_0000,
            "requires OpenSSL 3.5 or newer; actual {}",
            version::version()
        );
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../docs/");
        let crypto: CryptoVectors =
            serde_json::from_slice(&fs::read(format!("{dir}XSP_V2_CRYPTO_POC.json")).unwrap())
                .unwrap();
        let wire: WireDocument =
            serde_json::from_slice(&fs::read(format!("{dir}XSP_V2_VECTORS.json")).unwrap())
                .unwrap();
        assert_eq!(crypto.schema, "xsp2-crypto-poc-1");
        assert!(crypto.context.is_empty());
        assert_eq!(crypto.records.len(), 2);

        for row in crypto.records {
            let wire_row = wire.vectors.iter().find(|v| v.id == row.id).unwrap();
            let input = hex::decode(&wire_row.signing_input_hex).unwrap();
            let ed_seed = decode_hex(&row.ed_seed_hex, 32);
            let pq_seed = decode_hex(&row.mldsa_seed_hex, 32);

            let ed_private = PKey::private_key_from_raw_bytes(&ed_seed, Id::ED25519).unwrap();
            let pq_private = PKey::private_key_from_seed(None, KeyType::ML_DSA_65, None, &pq_seed)
                .expect("OpenSSL 3.5 ML-DSA-65 provider missing");
            assert!(pq_private.is_a(KeyType::ML_DSA_65));

            let ed_raw_pub = ed_private.raw_public_key().unwrap();
            let pq_public_der = pq_private.public_key_to_der().unwrap();
            assert_eq!(ed_raw_pub.len(), 32);
            // SubjectPublicKeyInfo: the final 1952 octets hold the pure
            // ML-DSA-65 public encoding that crypto/mldsa returns in Go.
            assert_eq!(pq_public_der.len(), 1974);
            let pq_raw_pub = &pq_public_der[pq_public_der.len() - 1952..];
            assert_eq!(sha_hex(&ed_raw_pub), row.ed_public_sha256, "{}", row.id);
            assert_eq!(sha_hex(pq_raw_pub), row.mldsa_public_sha256, "{}", row.id);

            let mut ed_signer = Signer::new_without_digest(&ed_private).unwrap();
            let ed_sig = ed_signer.sign_oneshot_to_vec(&input).unwrap();
            assert_eq!(sha_hex(&ed_sig), row.ed_signature_sha256);
            let mut pq_signer = Signer::new_without_digest(&pq_private).unwrap();
            // The default OpenSSL signature is hedged/randomized. Do NOT
            // assert a fixed digest for this fresh signature.
            let pq_sig = pq_signer.sign_oneshot_to_vec(&input).unwrap();
            assert_eq!(pq_sig.len(), 3309);

            let ed_public = PKey::public_key_from_raw_bytes(&ed_raw_pub, Id::ED25519).unwrap();
            let pq_public = PKey::public_key_from_der(&pq_public_der).unwrap();
            assert!(verify_both(
                &ed_public, &pq_public, &input, &ed_sig, &pq_sig
            ));
            let mut changed = input.clone();
            changed[0] ^= 1;
            assert!(!verify_both(
                &ed_public, &pq_public, &changed, &ed_sig, &pq_sig
            ));
            assert!(!verify_both(&ed_public, &pq_public, &input, &[], &pq_sig));
            assert!(!verify_both(&ed_public, &pq_public, &input, &ed_sig, &[]));
            let mut bad_ed = ed_sig.clone();
            bad_ed[0] ^= 1;
            assert!(!verify_both(
                &ed_public, &pq_public, &input, &bad_ed, &pq_sig
            ));
            let mut bad_pq = pq_sig.clone();
            bad_pq[0] ^= 1;
            assert!(!verify_both(
                &ed_public, &pq_public, &input, &ed_sig, &bad_pq
            ));
            let mut wrong_ed = ed_raw_pub.clone();
            wrong_ed[0] ^= 1;
            if let Ok(other) = PKey::public_key_from_raw_bytes(&wrong_ed, Id::ED25519) {
                assert!(!verify_both(&other, &pq_public, &input, &ed_sig, &pq_sig));
            }

            // The independently generated deterministic ML-DSA signature in
            // the shared fixture is verified by Go. Its hash is preserved as
            // a separate interoperability checkpoint; randomized Rust
            // signatures intentionally don't match it byte-for-byte.
            assert_eq!(row.mldsa_signature_sha256.len(), 64);
        }
    }
}
