use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use serde_json::Value;
use sqlx::PgPool;
use std::{
    io::{Cursor, Read},
    os::unix::fs::{symlink, PermissionsExt},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::{
    fs,
    process::Command,
    sync::{Mutex, RwLock},
    time::timeout,
};
use uuid::Uuid;
use zip::ZipArchive;

const RELEASES_URL: &str = "https://api.github.com/repos/XTLS/Xray-core/releases?per_page=30";
const MAX_RELEASE_BYTES: usize = 120 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
pub struct CoreStatus {
    pub desired_version: String,
    pub installed_version: Option<String>,
    pub latest_version: Option<String>,
    pub status: String,
    pub progress: Option<String>,
    pub last_error: Option<String>,
    pub updated_at: Option<String>,
    pub runtime: String,
    pub architecture: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReleaseInfo {
    pub version: String,
    pub published_at: Option<String>,
    pub prerelease: bool,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    published_at: Option<String>,
    html_url: String,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Clone, Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

#[derive(Clone)]
pub struct CoreManager {
    pool: PgPool,
    root: PathBuf,
    state: Arc<RwLock<CoreStatus>>,
    update_lock: Arc<Mutex<()>>,
    client: reqwest::Client,
}

impl CoreManager {
    pub async fn new(pool: PgPool, root: PathBuf) -> anyhow::Result<Self> {
        fs::create_dir_all(root.join("versions")).await?;
        let desired = sqlx::query_scalar::<_, serde_json::Value>(
            "SELECT value FROM app_settings WHERE key = 'xray_core_version'",
        )
        .fetch_optional(&pool)
        .await?
        .and_then(|v| v.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| "latest".to_owned());

        let installed = read_installed_version(&root).await;
        let client = reqwest::Client::builder()
            .user_agent(concat!("XMesh-Nexus/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(12))
            .timeout(Duration::from_secs(300))
            .build()?;

        Ok(Self {
            pool,
            root,
            state: Arc::new(RwLock::new(CoreStatus {
                desired_version: desired,
                installed_version: installed.clone(),
                latest_version: None,
                status: if installed.is_some() { "ready" } else { "not_installed" }.to_owned(),
                progress: None,
                last_error: None,
                updated_at: None,
                runtime: "binary-managed; traffic-plane-not-started".to_owned(),
                architecture: std::env::consts::ARCH.to_owned(),
            })),
            update_lock: Arc::new(Mutex::new(())),
            client,
        })
    }

    pub async fn status(&self) -> CoreStatus {
        self.state.read().await.clone()
    }

    pub async fn launch_startup_update(&self) {
        let manager = self.clone();
        tokio::spawn(async move {
            let target = manager.status().await.desired_version;
            if let Err(error) = manager.install_or_update(target).await {
                tracing::warn!(error = %error, "Initial Xray-core installation/update failed; API remains online");
            }
        });
    }

    pub async fn set_desired_version(&self, requested: &str) -> Result<String, String> {
        let target = normalize_version(requested)?;
        sqlx::query(
            "INSERT INTO app_settings (key, value) VALUES ('xray_core_version', $1) \
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
        )
        .bind(serde_json::Value::String(target.clone()))
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Could not persist Xray-core version setting: {e}"))?;
        let mut state = self.state.write().await;
        state.desired_version = target.clone();
        state.status = "updating".to_owned();
        state.progress = Some("Обновление поставлено в очередь".to_owned());
        state.last_error = None;
        Ok(target)
    }

    pub async fn install_or_update(&self, requested: String) -> Result<CoreStatus, String> {
        let target = normalize_version(&requested)?;
        let _guard = self.update_lock.lock().await;
        {
            let mut state = self.state.write().await;
            state.desired_version = target.clone();
            state.status = "updating".to_owned();
            state.progress = Some("Resolving official GitHub release".to_owned());
            state.last_error = None;
        }

        let result = self.install_inner(&target).await;
        match result {
            Ok((version, latest)) => {
                let mut state = self.state.write().await;
                state.installed_version = Some(version.clone());
                state.latest_version = Some(latest);
                state.status = "ready".to_owned();
                state.progress = None;
                state.last_error = None;
                state.updated_at = Some(chrono_free_timestamp());
                tracing::info!(version = %version, "Xray-core binary installed and verified");
                Ok(state.clone())
            }
            Err(error) => {
                let mut state = self.state.write().await;
                state.status = "error".to_owned();
                state.progress = None;
                state.last_error = Some(error.clone());
                tracing::error!(error = %error, target = %target, "Xray-core installation failed");
                Err(error)
            }
        }
    }

    /// Generate both supported VLESS Encryption authentication pairs using the installed official Xray binary.
    /// Secret material is returned only to the authenticated caller and is never written to logs or disk.
    pub async fn generate_vless_encryption(&self) -> Result<Value, String> {
        let binary = self.root.join("current").join("xray");
        if !binary.is_file() {
            return Err("Xray-core ещё не установлен. Установите ядро в разделе «Настройки → Xray-core» и повторите.".to_owned());
        }

        // Official Xray syntax is exactly xray vlessenc. It prints two text key pairs:
        // one for X25519 authentication and one for ML-KEM-768; there is no JSON flag.
        let output = timeout(
            Duration::from_secs(20),
            Command::new(&binary)
                .arg("vlessenc")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .output(),
        )
        .await
        .map_err(|_| "Команда xray vlessenc превысила лимит 20 секунд.".to_owned())?
        .map_err(|error| format!("Не удалось запустить Xray-core: {error}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail = stderr.trim().chars().take(320).collect::<String>();
            return Err(if detail.is_empty() {
                format!("Xray-core завершился с кодом {}.", output.status)
            } else {
                format!("xray vlessenc завершился с ошибкой: {detail}")
            });
        }

        let stdout = String::from_utf8(output.stdout)
            .map_err(|_| "Xray-core вернул невалидный UTF-8 из vlessenc.".to_owned())?;
        parse_vless_encryption_output(&stdout)
    }

    pub async fn available_releases(&self) -> Result<Vec<ReleaseInfo>, String> {
        let releases = self.fetch_releases().await?;
        Ok(releases
            .into_iter()
            .filter(|release| !release.draft)
            .map(|release| ReleaseInfo {
                version: release.tag_name,
                published_at: release.published_at,
                prerelease: release.prerelease,
                url: release.html_url,
            })
            .collect())
    }

    async fn install_inner(&self, target: &str) -> Result<(String, String), String> {
        let releases = self.fetch_releases().await?;
        let latest = releases
            .iter()
            .find(|release| !release.draft && !release.prerelease)
            .ok_or_else(|| "GitHub did not return a usable Xray-core release".to_owned())?
            .tag_name
            .clone();

        let release = if target == "latest" {
            releases
                .iter()
                .find(|release| !release.draft && !release.prerelease)
                .cloned()
                .ok_or_else(|| "No public Xray-core release was found".to_owned())?
        } else {
            let exact = normalize_version(target)?;
            releases
                .iter()
                .find(|release| !release.draft && release.tag_name == exact)
                .cloned()
                .ok_or_else(|| format!(
                    "Release {exact} is not present in the latest 30 releases returned by GitHub"
                ))?
        };

        if read_installed_version(&self.root).await.as_deref() == Some(release.tag_name.as_str()) {
            let mut state = self.state.write().await;
            state.progress = Some("Requested version is already installed".to_owned());
            return Ok((release.tag_name, latest));
        }

        let asset_name = match std::env::consts::ARCH {
            "x86_64" => "Xray-linux-64.zip",
            "aarch64" => "Xray-linux-arm64-v8a.zip",
            "arm" => "Xray-linux-arm32-v7a.zip",
            arch => return Err(format!("Automatic Xray-core installation is not supported for architecture {arch}")),
        };
        let asset = release.assets.iter().find(|asset| asset.name == asset_name)
            .ok_or_else(|| format!("Release {} does not publish expected asset {asset_name}", release.tag_name))?;
        if asset.size as usize > MAX_RELEASE_BYTES {
            return Err("Release asset exceeds the 120 MiB safety limit".to_owned());
        }
        let parsed_url = reqwest::Url::parse(&asset.browser_download_url)
            .map_err(|e| format!("Invalid GitHub asset URL: {e}"))?;
        if parsed_url.scheme() != "https"
            || parsed_url.host_str() != Some("github.com")
            || !parsed_url.path().starts_with("/XTLS/Xray-core/releases/download/")
        {
            return Err("Refusing to download an asset from a non-official Xray-core URL".to_owned());
        }

        {
            let mut state = self.state.write().await;
            state.latest_version = Some(latest.clone());
            state.progress = Some(format!("Downloading {}", release.tag_name));
        }
        let response = timeout(
            Duration::from_secs(300),
            self.client.get(asset.browser_download_url.clone()).send(),
        )
        .await
        .map_err(|_| "Timed out downloading Xray-core release".to_owned())?
        .map_err(|e| format!("GitHub download request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub refused the release download: {e}"))?;
        let bytes = response.bytes().await.map_err(|e| format!("Could not read release archive: {e}"))?;
        if bytes.is_empty() || bytes.len() > MAX_RELEASE_BYTES {
            return Err("Downloaded release archive is empty or exceeds 120 MiB".to_owned());
        }
        if let Some(digest) = asset.digest.as_deref() {
            if let Some(expected) = digest.strip_prefix("sha256:") {
                let actual = hex::encode(Sha256::digest(&bytes));
                if !actual.eq_ignore_ascii_case(expected) {
                    return Err("GitHub asset SHA-256 digest did not match".to_owned());
                }
            } else {
                return Err("GitHub returned an unsupported asset digest algorithm".to_owned());
            }
        }

        let versions_dir = self.root.join("versions");
        fs::create_dir_all(&versions_dir).await.map_err(|e| e.to_string())?;
        let stage = versions_dir.join(format!(".staging-{}", Uuid::new_v4().simple()));
        fs::create_dir_all(&stage).await.map_err(|e| e.to_string())?;

        if let Err(error) = unpack_release(&bytes, &stage).await {
            let _ = fs::remove_dir_all(&stage).await;
            return Err(error);
        }

        let binary = stage.join("xray");
        {
            let mut permissions = fs::metadata(&binary).await.map_err(|e| e.to_string())?.permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&binary, permissions).await.map_err(|e| e.to_string())?;
        }
        {
            let mut state = self.state.write().await;
            state.progress = Some("Verifying downloaded binary".to_owned());
        }
        let output = timeout(
            Duration::from_secs(15),
            Command::new(&binary)
                .arg("version")
                .stdin(Stdio::null())
                .output(),
        )
        .await
        .map_err(|_| "Downloaded Xray-core binary did not respond to the version command".to_owned())?
        .map_err(|e| format!("Could not execute downloaded Xray-core binary: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let _ = fs::remove_dir_all(&stage).await;
            return Err(format!("Downloaded Xray-core binary verification failed: {}", stderr.trim()));
        }
        let version_output = format!(
            "{} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let reported = version_output.trim();
        if !reported.contains(release.tag_name.trim_start_matches('v')) {
            let _ = fs::remove_dir_all(&stage).await;
            return Err(format!(
                "Downloaded binary reports an unexpected version; expected {}, received {}",
                release.tag_name, reported
            ));
        }

        let target_dir = versions_dir.join(&release.tag_name);
        if fs::try_exists(&target_dir).await.unwrap_or(false) {
            fs::remove_dir_all(&target_dir).await.map_err(|e| e.to_string())?;
        }
        fs::rename(&stage, &target_dir).await.map_err(|e| format!("Could not finalize release directory: {e}"))?;

        let temporary_link = self.root.join(format!(".current-{}", Uuid::new_v4().simple()));
        let relative_target = PathBuf::from("versions").join(&release.tag_name);
        symlink(&relative_target, &temporary_link)
            .map_err(|e| format!("Could not create atomic Xray-core version link: {e}"))?;
        let current = self.root.join("current");
        if let Err(error) = fs::rename(&temporary_link, &current).await {
            let _ = fs::remove_file(&temporary_link).await;
            return Err(format!("Could not switch installed Xray-core version atomically: {error}"));
        }

        Ok((release.tag_name, latest))
    }

    async fn fetch_releases(&self) -> Result<Vec<GithubRelease>, String> {
        self.client
            .get(RELEASES_URL)
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("Could not reach GitHub releases API: {e}"))?
            .error_for_status()
            .map_err(|e| format!("GitHub releases API returned an error: {e}"))?
            .json::<Vec<GithubRelease>>()
            .await
            .map_err(|e| format!("Could not parse GitHub release metadata: {e}"))
    }
}

fn parse_vless_encryption_output(output: &str) -> Result<Value, String> {
    let mut authentication: Option<&str> = None;
    let mut x25519 = serde_json::Map::new();
    let mut mlkem768 = serde_json::Map::new();

    for line in output.lines().map(str::trim) {
        if line.starts_with("Authentication: X25519") {
            authentication = Some("x25519");
            continue;
        }
        if line.starts_with("Authentication: ML-KEM-768") {
            authentication = Some("mlkem768");
            continue;
        }

        let Some((key, value)) = line.split_once("\": \"") else {
            continue;
        };
        let Some(key) = key.strip_prefix('"') else {
            continue;
        };
        let Some(value) = value.strip_suffix('"') else {
            continue;
        };
        if !matches!(key, "decryption" | "encryption") || value.trim().is_empty() {
            continue;
        }

        let target = match authentication {
            Some("x25519") => &mut x25519,
            Some("mlkem768") => &mut mlkem768,
            _ => continue,
        };
        target.insert(key.to_owned(), Value::String(value.to_owned()));
    }

    for (mode, pair) in [("x25519", &x25519), ("mlkem768", &mlkem768)] {
        for field in ["decryption", "encryption"] {
            if pair.get(field).and_then(Value::as_str).is_none_or(str::is_empty) {
                return Err(format!(
                    "xray vlessenc: не удалось прочитать {field} для {mode}. Проверьте версию Xray-core и формат его вывода."
                ));
            }
        }
    }

    Ok(serde_json::json!({
        "x25519": x25519,
        "mlkem768": mlkem768
    }))
}

fn normalize_version(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.eq_ignore_ascii_case("latest") {
        return Ok("latest".to_owned());
    }
    if value.is_empty()
        || value.len() > 64
        || !value.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        || value.contains("..")
    {
        return Err("Version must be latest or a valid Xray-core release tag such as v26.10.10".to_owned());
    }
    let normalized = if value.starts_with('v') { value.to_owned() } else { format!("v{value}") };
    Ok(normalized)
}

async fn read_installed_version(root: &Path) -> Option<String> {
    let target = fs::read_link(root.join("current")).await.ok()?;
    target.file_name()?.to_str().map(ToOwned::to_owned)
}

async fn unpack_release(bytes: &[u8], destination: &Path) -> Result<(), String> {
    let data = bytes.to_vec();
    let destination = destination.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut archive = ZipArchive::new(Cursor::new(data))
            .map_err(|e| format!("Downloaded Xray-core archive is not a valid ZIP: {e}"))?;
        let mut found_binary = false;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index)
                .map_err(|e| format!("Could not read ZIP entry: {e}"))?;
            let name = entry.name().to_owned();
            if !entry.is_file() || name.contains('/') || name.contains('\\') {
                continue;
            }
            if !matches!(name.as_str(), "xray" | "geoip.dat" | "geosite.dat" | "LICENSE" | "README.md") {
                continue;
            }
            if let Some(mode) = entry.unix_mode()
                && mode & 0o170000 == 0o120000
            {
                continue;
            }
            let mut contents = Vec::new();
            entry.read_to_end(&mut contents)
                .map_err(|e| format!("Could not extract {name}: {e}"))?;
            if name == "xray" {
                if contents.is_empty() || contents.len() > 100 * 1024 * 1024 {
                    return Err("Extracted Xray-core binary has an invalid size".to_owned());
                }
                found_binary = true;
            }
            std::fs::write(destination.join(&name), contents)
                .map_err(|e| format!("Could not write extracted file {name}: {e}"))?;
        }
        if !found_binary {
            return Err("Official release archive did not contain the xray executable".to_owned());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("ZIP extraction task failed: {e}"))?
}

fn chrono_free_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

#[cfg(test)]
mod tests {
    use super::{normalize_version, parse_vless_encryption_output};

    #[test]
    fn latest_is_the_default_alias() {
        assert_eq!(normalize_version("latest").unwrap(), "latest");
        assert_eq!(normalize_version(" latest ").unwrap(), "latest");
    }

    #[test]
    fn version_tags_are_normalized() {
        assert_eq!(normalize_version("26.10.10").unwrap(), "v26.10.10");
        assert_eq!(normalize_version("v26.10.10").unwrap(), "v26.10.10");
    }

    #[test]
    fn invalid_versions_are_rejected() {
        assert!(normalize_version("../xray").is_err());
        assert!(normalize_version("https://example.com/xray").is_err());
        assert!(normalize_version("").is_err());
    }

    #[test]
    fn parses_official_vlessenc_text_output_for_both_authentication_modes() {
        let output = r#"Choose one Authentication to use, do not mix them. Ephemeral key exchange is Post-Quantum safe anyway.

Authentication: X25519, not Post-Quantum
"decryption": "mlkem768x25519plus.native.600s.server-x25519"
"encryption": "mlkem768x25519plus.native.0rtt.client-x25519"

Authentication: ML-KEM-768, Post-Quantum
"decryption": "mlkem768x25519plus.native.600s.server-mlkem"
"encryption": "mlkem768x25519plus.native.0rtt.client-mlkem"
"#;
        let parsed = parse_vless_encryption_output(output).unwrap();
        assert_eq!(parsed["x25519"]["decryption"], "mlkem768x25519plus.native.600s.server-x25519");
        assert_eq!(parsed["x25519"]["encryption"], "mlkem768x25519plus.native.0rtt.client-x25519");
        assert_eq!(parsed["mlkem768"]["decryption"], "mlkem768x25519plus.native.600s.server-mlkem");
        assert_eq!(parsed["mlkem768"]["encryption"], "mlkem768x25519plus.native.0rtt.client-mlkem");
    }

    #[test]
    fn rejects_partial_vlessenc_output() {
        assert!(parse_vless_encryption_output("Authentication: X25519\n\"decryption\": \"server\"").is_err());
    }

}
