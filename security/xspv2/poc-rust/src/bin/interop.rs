//! Test-only XSP-v2 interop binary. No production API, never deploy demo keys.
use openssl::{
    pkey::{Id, KeyType, PKey},
    sign::{Signer, Verifier},
};
use serde::{Deserialize, Serialize};
use std::io::{self, Read};

#[derive(Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct Record {
    mode: String,
    message_hex: String,
    ed_seed_hex: String,
    pq_seed_hex: String,
    ed_public_hex: String,
    pq_public_hex: String,
    ed_signature_hex: String,
    pq_signature_hex: String,
}

fn decode(text: &str, expected: usize) -> Result<Vec<u8>, String> {
    let raw = hex::decode(text).map_err(|_| "invalid hexadecimal input")?;
    if raw.len() != expected {
        return Err("invalid field length".into());
    }
    Ok(raw)
}

fn process(v: Record) -> Result<Record, String> {
    let message = hex::decode(&v.message_hex).map_err(|_| "invalid message hex")?;
    if message.is_empty() || message.len() > 524_288 {
        return Err("invalid message length".into());
    }
    match v.mode.as_str() {
        "sign" => {
            let ed_seed = decode(&v.ed_seed_hex, 32)?;
            let pq_seed = decode(&v.pq_seed_hex, 32)?;
            let ed = PKey::private_key_from_raw_bytes(&ed_seed, Id::ED25519)
                .map_err(|e| e.to_string())?;
            let pq = PKey::private_key_from_seed(None, KeyType::ML_DSA_65, None, &pq_seed)
                .map_err(|e| e.to_string())?;
            let ed_public = ed.raw_public_key().map_err(|e| e.to_string())?;
            let pq_der = pq.public_key_to_der().map_err(|e| e.to_string())?;
            if pq_der.len() != 1974 {
                return Err("incorrect provider public key format".into());
            }
            let pq_public = &pq_der[pq_der.len() - 1952..];
            let mut ed_sign = Signer::new_without_digest(&ed).map_err(|e| e.to_string())?;
            let mut pq_sign = Signer::new_without_digest(&pq).map_err(|e| e.to_string())?;
            let ed_signature = ed_sign
                .sign_oneshot_to_vec(&message)
                .map_err(|e| e.to_string())?;
            let pq_signature = pq_sign
                .sign_oneshot_to_vec(&message)
                .map_err(|e| e.to_string())?;
            if ed_signature.len() != 64 || pq_signature.len() != 3309 {
                return Err("incorrect signature size".into());
            }
            Ok(Record {
                mode: "signed".into(),
                message_hex: v.message_hex,
                ed_public_hex: hex::encode(ed_public),
                pq_public_hex: hex::encode(pq_public),
                ed_signature_hex: hex::encode(ed_signature),
                pq_signature_hex: hex::encode(pq_signature),
                ..Record::default()
            })
        }
        "verify" => {
            let ed_public = decode(&v.ed_public_hex, 32)?;
            let pq_public = decode(&v.pq_public_hex, 1952)?;
            let ed_sig = decode(&v.ed_signature_hex, 64)?;
            let pq_sig = decode(&v.pq_signature_hex, 3309)?;
            let ed = PKey::public_key_from_raw_bytes(&ed_public, Id::ED25519)
                .map_err(|e| e.to_string())?;
            let pq = PKey::public_key_from_raw_bytes_ex(None, KeyType::ML_DSA_65, None, &pq_public)
                .map_err(|e| e.to_string())?;
            let mut ed_check = Verifier::new_without_digest(&ed).map_err(|e| e.to_string())?;
            let mut pq_check = Verifier::new_without_digest(&pq).map_err(|e| e.to_string())?;
            if !ed_check
                .verify_oneshot(&ed_sig, &message)
                .map_err(|e| e.to_string())?
            {
                return Err("invalid Ed25519 signature".into());
            }
            if !pq_check
                .verify_oneshot(&pq_sig, &message)
                .map_err(|e| e.to_string())?
            {
                return Err("invalid ML-DSA-65 signature".into());
            }
            Ok(Record {
                mode: "verified".into(),
                ..Record::default()
            })
        }
        _ => Err("unknown CLI mode".into()),
    }
}

fn main() {
    let mut source = Vec::new();
    if let Err(error) = io::stdin()
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut source)
    {
        eprintln!("failed to read message: {error}");
        std::process::exit(1);
    }
    if source.len() > 2 * 1024 * 1024 {
        eprintln!("oversized message");
        std::process::exit(1);
    }
    let result = serde_json::from_slice::<Record>(&source)
        .map_err(|e| e.to_string())
        .and_then(process);
    match result {
        Ok(value) => {
            println!(
                "{}",
                serde_json::to_string(&value).expect("serialize test output")
            );
        }
        Err(error) => {
            eprintln!("XSP test-only verification failed: {error}");
            std::process::exit(1);
        }
    }
}
