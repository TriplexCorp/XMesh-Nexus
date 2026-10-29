use crate::{ApiError, AppState, node_auth};
use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::Response,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::path::{Path, PathBuf};

const ARTIFACT_ROUTE: &str = "/api/v1/node/agent/releases/artifact";
const MAX_AGENT_ARTIFACT_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentArtifactRequest {
    node_id: i64,
    version: String,
}

fn staging_agent_migration_enabled() -> bool {
    std::env::var("XSP_V2_P0D_AGENT_MIGRATION").ok().as_deref() == Some("staging-only")
}

fn valid_release_version(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().enumerate().all(|(index, byte)| {
            if index == 0 {
                byte.is_ascii_alphanumeric()
            } else {
                byte.is_ascii_alphanumeric() || b"._+-".contains(&byte)
            }
        })
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn artifact_filename(digest: &str) -> Option<String> {
    valid_digest(digest).then(|| format!("{digest}.bin"))
}

fn configured_artifact_root() -> Result<PathBuf, ApiError> {
    let value = std::env::var("XSP_V2_P0D_AGENT_ARTIFACT_DIR").map_err(|_| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "Staged Agent artifact source is not configured.",
        )
    })?;
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Staged Agent artifact source must be an absolute path.",
        ));
    }
    Ok(path)
}

async fn read_verified_artifact(root: &Path, digest: &str) -> Result<Vec<u8>, ApiError> {
    let filename = artifact_filename(digest).ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "Approved Agent artifact digest is invalid.",
        )
    })?;

    let root_meta = tokio::fs::symlink_metadata(root).await.map_err(|_| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "Staged Agent artifact source is unavailable.",
        )
    })?;
    if root_meta.file_type().is_symlink() || !root_meta.is_dir() {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Staged Agent artifact source is not a real directory.",
        ));
    }
    let canonical_root = tokio::fs::canonicalize(root).await.map_err(|_| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "Staged Agent artifact source is unavailable.",
        )
    })?;

    let candidate = canonical_root.join(filename);
    let metadata = tokio::fs::symlink_metadata(&candidate).await.map_err(|_| {
        ApiError::new(StatusCode::NOT_FOUND, "Approved Agent artifact is unavailable.")
    })?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > MAX_AGENT_ARTIFACT_BYTES
    {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Approved Agent artifact file is invalid.",
        ));
    }
    let canonical_candidate = tokio::fs::canonicalize(&candidate).await.map_err(|_| {
        ApiError::new(StatusCode::NOT_FOUND, "Approved Agent artifact is unavailable.")
    })?;
    if canonical_candidate.parent() != Some(canonical_root.as_path()) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Approved Agent artifact escaped the configured source.",
        ));
    }

    let bytes = tokio::fs::read(&canonical_candidate).await.map_err(|_| {
        ApiError::new(StatusCode::NOT_FOUND, "Approved Agent artifact is unavailable.")
    })?;
    let actual = hex::encode(Sha256::digest(&bytes));
    if actual != digest {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Approved Agent artifact digest does not match immutable manifest.",
        ));
    }
    Ok(bytes)
}

/// Authenticated, staging-only artifact delivery for a command that is already
/// claimed and bound to an immutable release manifest. The caller chooses only
/// the version from its signed poll identity; filesystem paths and URLs are
/// always server controlled and the content-addressed bytes are re-hashed before
/// they leave Nexus.
pub async fn download(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    if !staging_agent_migration_enabled() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "Staging Agent migration mode is disabled.",
        ));
    }
    let request: AgentArtifactRequest = serde_json::from_slice(&body)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid Agent artifact request."))?;
    if request.node_id <= 0 || !valid_release_version(&request.version) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Invalid Agent artifact request.",
        ));
    }

    node_auth::authenticate_for(
        &state,
        &headers,
        request.node_id,
        &body,
        ARTIFACT_ROUTE,
    )
    .await?;

    let row = sqlx::query(
        "SELECT m.version,m.source_revision,m.artifact_sha256
         FROM node_restart_commands c
         JOIN node_xsp_agent_release_manifests m ON m.id=c.release_manifest_id
         WHERE c.node_id=$1 AND c.action='update_agent' AND c.state='claimed'
           AND c.target_version=$2 AND m.version=$2
         ORDER BY c.id DESC LIMIT 1",
    )
    .bind(request.node_id)
    .bind(&request.version)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "No claimed Agent migration is bound to this release.",
        )
    })?;

    let version = row.try_get::<String, _>("version")?;
    let source_revision = row.try_get::<String, _>("source_revision")?;
    let digest = row.try_get::<String, _>("artifact_sha256")?;
    if version != request.version
        || source_revision.len() != 40
        || !source_revision
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        || !valid_digest(&digest)
    {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "Bound Agent release manifest is invalid.",
        ));
    }

    let root = configured_artifact_root()?;
    let artifact = read_verified_artifact(&root, &digest).await?;
    let mut response = Response::new(Body::from(artifact));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        "application/octet-stream"
            .parse()
            .expect("static content type is valid"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        "no-store".parse().expect("static cache control is valid"),
    );
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn artifact_filename_is_content_addressed_only() {
        let digest = "a".repeat(64);
        assert_eq!(artifact_filename(&digest), Some(format!("{digest}.bin")));
        for invalid in ["", "A", "../artifact", &"A".repeat(64), &"g".repeat(64)] {
            assert_eq!(artifact_filename(invalid), None);
        }
    }

    #[test]
    fn release_version_does_not_allow_paths_or_whitespace() {
        for valid in ["p0d2-agent", "control-v5.2.0", "agent_1+pq"] {
            assert!(valid_release_version(valid));
        }
        for invalid in ["", "-bad", ".bad", "../bad", "bad/path", "bad value"] {
            assert!(!valid_release_version(invalid));
        }
    }
}
