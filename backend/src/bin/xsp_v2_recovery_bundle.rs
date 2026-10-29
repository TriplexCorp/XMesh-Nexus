#![forbid(unsafe_code)]

use anyhow::{Context as _, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::{
    env,
    fs::{self, File, OpenOptions},
    io::{Read as _, Write as _},
    os::unix::fs::{MetadataExt as _, OpenOptionsExt as _},
    path::Path,
};

const MANIFEST_SCHEMA: &str = "xsp2-recovery-backup-set-1";
const CHECKPOINT_SCHEMA: &str = "xsp2-owner-offhost-recovery-checkpoint-1";
const MAX_MANIFEST_BYTES: usize = 32 * 1024;
const MAX_CHECKPOINT_BYTES: usize = 32 * 1024;
const MAX_COMPONENT_BYTES: u64 = 8 * 1024 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecoveryCheckpoint {
    schema: String,
    node_id: u64,
    minimum_epoch: u64,
    receipt_sha256_hex: String,
    signed_receipt_base64: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Component {
    label: String,
    size_bytes: u64,
    sha256_hex: String,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupManifest {
    schema: String,
    node_id: u64,
    key_epoch: u64,
    checkpoint_sha256_hex: String,
    checkpoint_receipt_sha256_hex: String,
    components: Vec<Component>,
    backup_set_sha256_hex: String,
}

fn strict_hex(value: &str, count: usize, label: &str) -> Result<()> {
    ensure!(value.len() == count * 2, "{label} has invalid length");
    let raw = hex::decode(value).with_context(|| format!("{label} is not hex"))?;
    ensure!(hex::encode(raw) == value, "{label} is not canonical lowercase hex");
    Ok(())
}

fn read_small(path: &Path, limit: usize) -> Result<Vec<u8>> {
    let meta = fs::symlink_metadata(path).with_context(|| format!("stat {}", path.display()))?;
    ensure!(meta.file_type().is_file(), "{} is not a regular file", path.display());
    let len = usize::try_from(meta.len()).context("small input is too large")?;
    ensure!(len > 0 && len <= limit, "{} has invalid size", path.display());
    let raw = fs::read(path).with_context(|| format!("read {}", path.display()))?;
    ensure!(raw.len() == len, "{} changed while reading", path.display());
    Ok(raw)
}

fn component(label: &str, path: &Path) -> Result<Component> {
    let before = fs::symlink_metadata(path).with_context(|| format!("stat {label}"))?;
    ensure!(before.file_type().is_file(), "{label} is not a regular file");
    ensure!(before.len() > 0 && before.len() <= MAX_COMPONENT_BYTES, "{label} has invalid size");

    let mut file = File::open(path).with_context(|| format!("open {label}"))?;
    let opened = file.metadata().with_context(|| format!("fstat {label}"))?;
    ensure!(
        opened.dev() == before.dev() && opened.ino() == before.ino() && opened.len() == before.len(),
        "{label} changed before hashing"
    );

    let mut hash = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let count = file.read(&mut buffer).with_context(|| format!("read {label}"))?;
        if count == 0 {
            break;
        }
        total = total.checked_add(u64::try_from(count)?).context("component size overflow")?;
        ensure!(total <= MAX_COMPONENT_BYTES, "{label} exceeded size limit while hashing");
        hash.update(&buffer[..count]);
    }
    let after = file.metadata().with_context(|| format!("final fstat {label}"))?;
    ensure!(
        after.dev() == before.dev() && after.ino() == before.ino() && after.len() == before.len() && total == before.len(),
        "{label} changed while hashing"
    );
    Ok(Component {
        label: label.to_owned(),
        size_bytes: total,
        sha256_hex: hex::encode(hash.finalize()),
    })
}

fn load_checkpoint(path: &Path) -> Result<(RecoveryCheckpoint, String)> {
    let raw = read_small(path, MAX_CHECKPOINT_BYTES)?;
    let checkpoint: RecoveryCheckpoint = serde_json::from_slice(&raw).context("invalid E3a checkpoint JSON")?;
    ensure!(checkpoint.schema == CHECKPOINT_SCHEMA, "unsupported E3a checkpoint schema");
    ensure!(checkpoint.node_id > 0 && checkpoint.minimum_epoch > 0, "invalid checkpoint identity or epoch");
    strict_hex(&checkpoint.receipt_sha256_hex, 32, "checkpoint receipt digest")?;
    ensure!(!checkpoint.signed_receipt_base64.is_empty(), "checkpoint signed receipt is missing");
    Ok((checkpoint, hex::encode(Sha256::digest(raw))))
}

fn canonical_backup_set(manifest: &BackupManifest) -> Result<Vec<u8>> {
    ensure!(manifest.schema == MANIFEST_SCHEMA, "unsupported backup manifest schema");
    ensure!(manifest.node_id > 0 && manifest.key_epoch > 0, "invalid backup identity or epoch");
    strict_hex(&manifest.checkpoint_sha256_hex, 32, "checkpoint file digest")?;
    strict_hex(&manifest.checkpoint_receipt_sha256_hex, 32, "checkpoint receipt digest")?;
    ensure!(manifest.components.len() == 4, "backup set must contain exactly four required components");

    let expected = ["postgres-dump", "agent-state", "signer-identity", "mtls-identity"];
    let mut out = b"XSP2-RECOVERY-BACKUP-SET-V1\0".to_vec();
    out.extend_from_slice(&manifest.node_id.to_be_bytes());
    out.extend_from_slice(&manifest.key_epoch.to_be_bytes());
    out.extend_from_slice(&hex::decode(&manifest.checkpoint_sha256_hex)?);
    out.extend_from_slice(&hex::decode(&manifest.checkpoint_receipt_sha256_hex)?);
    for (component, label) in manifest.components.iter().zip(expected) {
        ensure!(component.label == label, "backup component order/label mismatch");
        ensure!(component.size_bytes > 0 && component.size_bytes <= MAX_COMPONENT_BYTES, "invalid {label} size");
        strict_hex(&component.sha256_hex, 32, label)?;
        let label_len = u32::try_from(label.len()).context("component label length overflow")?;
        out.extend_from_slice(&label_len.to_be_bytes());
        out.extend_from_slice(label.as_bytes());
        out.extend_from_slice(&component.size_bytes.to_be_bytes());
        out.extend_from_slice(&hex::decode(&component.sha256_hex)?);
    }
    Ok(out)
}

fn finalize(mut manifest: BackupManifest) -> Result<BackupManifest> {
    manifest.backup_set_sha256_hex.clear();
    manifest.backup_set_sha256_hex = hex::encode(Sha256::digest(canonical_backup_set(&manifest)?));
    Ok(manifest)
}

fn verify_manifest(manifest: &BackupManifest) -> Result<()> {
    strict_hex(&manifest.backup_set_sha256_hex, 32, "backup set digest")?;
    let expected = hex::encode(Sha256::digest(canonical_backup_set(manifest)?));
    ensure!(expected == manifest.backup_set_sha256_hex, "backup manifest digest mismatch");
    Ok(())
}

fn parse_flag(args: &[String], flag: &str) -> Result<String> {
    let index = args.iter().position(|arg| arg == flag).with_context(|| format!("missing {flag}"))?;
    let value = args.get(index + 1).with_context(|| format!("missing value for {flag}"))?;
    ensure!(!value.starts_with("--"), "missing value for {flag}");
    Ok(value.clone())
}

fn exact_flags(args: &[String], flags: &[&str]) -> Result<()> {
    ensure!(args.len() == flags.len() * 2, "unexpected command arguments");
    for flag in flags {
        ensure!(args.iter().filter(|arg| arg.as_str() == *flag).count() == 1, "{flag} must appear exactly once");
    }
    Ok(())
}

fn supplied_components(args: &[String]) -> Result<Vec<Component>> {
    Ok(vec![
        component("postgres-dump", Path::new(&parse_flag(args, "--postgres-dump")?))?,
        component("agent-state", Path::new(&parse_flag(args, "--agent-state")?))?,
        component("signer-identity", Path::new(&parse_flag(args, "--signer-identity")?))?,
        component("mtls-identity", Path::new(&parse_flag(args, "--mtls-identity")?))?,
    ])
}

fn create(args: &[String]) -> Result<()> {
    let flags = ["--node-id", "--key-epoch", "--checkpoint", "--postgres-dump", "--agent-state", "--signer-identity", "--mtls-identity", "--out"];
    exact_flags(args, &flags)?;
    let node_id: u64 = parse_flag(args, "--node-id")?.parse().context("invalid node ID")?;
    let key_epoch: u64 = parse_flag(args, "--key-epoch")?.parse().context("invalid key epoch")?;
    let checkpoint_path = parse_flag(args, "--checkpoint")?;
    let (checkpoint, checkpoint_sha) = load_checkpoint(Path::new(&checkpoint_path))?;
    ensure!(node_id == checkpoint.node_id, "backup Node does not match E3a checkpoint");
    ensure!(key_epoch >= checkpoint.minimum_epoch, "backup epoch is below E3a recovery floor");

    let manifest = finalize(BackupManifest {
        schema: MANIFEST_SCHEMA.to_owned(),
        node_id,
        key_epoch,
        checkpoint_sha256_hex: checkpoint_sha,
        checkpoint_receipt_sha256_hex: checkpoint.receipt_sha256_hex,
        components: supplied_components(args)?,
        backup_set_sha256_hex: String::new(),
    })?;
    let output = parse_flag(args, "--out")?;
    let mut file = OpenOptions::new().write(true).create_new(true).mode(0o600).open(&output)
        .with_context(|| format!("create backup manifest {output}"))?;
    let raw = serde_json::to_vec(&manifest).context("serialize backup manifest")?;
    file.write_all(&raw)?;
    file.sync_all()?;
    println!("{}", serde_json::json!({"status":"created","backupSetSha256Hex":manifest.backup_set_sha256_hex}));
    Ok(())
}

fn verify(args: &[String]) -> Result<()> {
    let flags = ["--manifest", "--checkpoint", "--postgres-dump", "--agent-state", "--signer-identity", "--mtls-identity"];
    exact_flags(args, &flags)?;
    let manifest_path = parse_flag(args, "--manifest")?;
    let raw = read_small(Path::new(&manifest_path), MAX_MANIFEST_BYTES)?;
    let manifest: BackupManifest = serde_json::from_slice(&raw).context("invalid backup manifest JSON")?;
    verify_manifest(&manifest)?;

    let checkpoint_path = parse_flag(args, "--checkpoint")?;
    let (checkpoint, checkpoint_sha) = load_checkpoint(Path::new(&checkpoint_path))?;
    ensure!(manifest.node_id == checkpoint.node_id, "manifest Node differs from E3a checkpoint");
    ensure!(manifest.key_epoch >= checkpoint.minimum_epoch, "manifest epoch is below E3a recovery floor");
    ensure!(manifest.checkpoint_sha256_hex == checkpoint_sha, "wrong E3a checkpoint file for backup set");
    ensure!(manifest.checkpoint_receipt_sha256_hex == checkpoint.receipt_sha256_hex, "wrong E3a receipt witness for backup set");

    let actual = supplied_components(args)?;
    ensure!(actual == manifest.components, "missing, altered or mixed-generation backup component detected");
    println!("{}", serde_json::json!({"status":"verified","nodeId":manifest.node_id,"keyEpoch":manifest.key_epoch,"backupSetSha256Hex":manifest.backup_set_sha256_hex}));
    Ok(())
}

fn run() -> Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    let Some((command, rest)) = args.split_first() else {
        bail!("expected create or verify")
    };
    match command.as_str() {
        "create" => create(rest),
        "verify" => verify(rest),
        _ => bail!("unknown recovery backup command"),
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    fn temp(name: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("xsp-p0e3b-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fixture(dir: &Path) -> (PathBuf, Vec<PathBuf>) {
        let checkpoint = dir.join("checkpoint.json");
        fs::write(&checkpoint, br#"{"schema":"xsp2-owner-offhost-recovery-checkpoint-1","nodeId":41,"minimumEpoch":7,"receiptSha256Hex":"1111111111111111111111111111111111111111111111111111111111111111","signedReceiptBase64":"eA=="}"#).unwrap();
        let files = ["db.dump", "agent.tar", "signer.tar", "mtls.tar"].into_iter().enumerate().map(|(i, name)| {
            let path = dir.join(name);
            fs::write(&path, vec![u8::try_from(i + 1).unwrap(); 64 + i]).unwrap();
            path
        }).collect();
        (checkpoint, files)
    }

    #[test]
    fn current_set_verifies_and_mixed_component_fails_closed() {
        let dir = temp("mixed");
        let (checkpoint, files) = fixture(&dir);
        let manifest = finalize(BackupManifest {
            schema: MANIFEST_SCHEMA.to_owned(), node_id: 41, key_epoch: 7,
            checkpoint_sha256_hex: hex::encode(Sha256::digest(fs::read(&checkpoint).unwrap())),
            checkpoint_receipt_sha256_hex: "11".repeat(32),
            components: vec![
                component("postgres-dump", &files[0]).unwrap(),
                component("agent-state", &files[1]).unwrap(),
                component("signer-identity", &files[2]).unwrap(),
                component("mtls-identity", &files[3]).unwrap(),
            ], backup_set_sha256_hex: String::new(),
        }).unwrap();
        verify_manifest(&manifest).unwrap();
        fs::write(&files[1], b"older agent generation").unwrap();
        assert_ne!(component("agent-state", &files[1]).unwrap(), manifest.components[1]);
    }

    #[test]
    fn lower_epoch_and_checkpoint_rebinding_are_rejected() {
        let dir = temp("floor");
        let (checkpoint, _) = fixture(&dir);
        let (trusted, sha) = load_checkpoint(&checkpoint).unwrap();
        assert_eq!(trusted.minimum_epoch, 7);
        assert!(6_u64 < trusted.minimum_epoch);
        let altered = dir.join("other-checkpoint.json");
        fs::write(&altered, br#"{"schema":"xsp2-owner-offhost-recovery-checkpoint-1","nodeId":41,"minimumEpoch":7,"receiptSha256Hex":"2222222222222222222222222222222222222222222222222222222222222222","signedReceiptBase64":"eA=="}"#).unwrap();
        let (_, altered_sha) = load_checkpoint(&altered).unwrap();
        assert_ne!(sha, altered_sha);
    }

    #[test]
    fn missing_and_symlink_components_fail_closed() {
        let dir = temp("files");
        let missing = dir.join("missing.dump");
        assert!(component("postgres-dump", &missing).is_err());
        let real = dir.join("real.dump");
        let link = dir.join("link.dump");
        fs::write(&real, b"real").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(component("postgres-dump", &link).is_err());
    }
}
