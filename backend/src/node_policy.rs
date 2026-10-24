//! Persisted panel identity for autonomous node-policy envelopes.
//! Only the public key is returned over authenticated TLS; the private key
//! stays in the persistent Control Plane volume and must be backed up.
use anyhow::{Context, Result};
use ed25519_dalek::{Signer, SigningKey};
use rand_core::{OsRng, RngCore};
use serde_json::Value;
use std::{
    fs,
    fs::OpenOptions,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
};

pub struct PolicySigner(SigningKey);

impl PolicySigner {
    pub fn load(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let bytes = match fs::read(path) {
            Ok(value) => {
                // Do not follow a substituted key symlink.
                anyhow::ensure!(
                    fs::symlink_metadata(path)?.file_type().is_file(),
                    "Invalid policy key file type"
                );
                anyhow::ensure!(
                    fs::metadata(path)?.permissions().mode().trailing_zeros() >= 6,
                    "Policy signing key must not be readable by group/others"
                );
                value
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let mut secret = [0u8; 32];
                OsRng.fill_bytes(&mut secret);
                // Atomic first initialization: a second process must never
                // overwrite an already established panel signing identity.
                match OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(path)
                {
                    Ok(mut f) => {
                        f.write_all(&secret)?;
                        f.sync_all()?;
                        secret.to_vec()
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                        fs::read(path).context("Read concurrent policy key initialization")?
                    }
                    Err(e) => return Err(e.into()),
                }
            }
            Err(e) => return Err(e.into()),
        };
        let key: [u8; 32] = bytes
            .try_into()
            .map_err(|_| anyhow::anyhow!("Invalid policy signing key size"))?;
        Ok(Self(SigningKey::from_bytes(&key)))
    }
    pub fn public_key(&self) -> String {
        hex::encode(self.0.verifying_key().to_bytes())
    }
    pub fn sign(&self, data: &Value) -> Result<String> {
        let canonical = serde_json::to_vec(data)?;
        Ok(hex::encode(self.0.sign(&canonical).to_bytes()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier};
    use serde_json::json;

    #[test]
    fn signed_policy_binds_identity_and_config_hash() {
        let secret = [7u8; 32];
        let signer = PolicySigner(SigningKey::from_bytes(&secret));
        let policy = json!({"version":1,"nodeId":42,"configSha256":"a".repeat(64),
            "users":[{"userId":1,"expireAtMs":1_800_000_000_000_i64}]});
        let signature = Signature::from_bytes(
            &hex::decode(signer.sign(&policy).unwrap())
                .unwrap()
                .try_into()
                .unwrap(),
        );
        let key = signer.0.verifying_key();
        key.verify(&serde_json::to_vec(&policy).unwrap(), &signature)
            .unwrap();
        let mut altered = policy.clone();
        altered["nodeId"] = json!(43);
        assert!(
            key.verify(&serde_json::to_vec(&altered).unwrap(), &signature)
                .is_err()
        );
    }
}
