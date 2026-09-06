//! What this server is allowed to touch.
//!
//! A hex editor that can rewrite arbitrary bytes anywhere on disk is a large
//! capability to hand a language model. Writing is off unless the operator asks
//! for it, and `--root` confines every path to a set of directories.

use std::path::{Component, Path, PathBuf};

use mcp_toolkit::{ToolFailure, ToolResult};

#[derive(Debug, Clone, Default)]
pub struct Policy {
    allow_write: bool,
    roots: Vec<PathBuf>,
    max_file_bytes: u64,
}

impl Policy {
    pub fn new(allow_write: bool, roots: Vec<PathBuf>, max_file_bytes: u64) -> Self {
        // Canonicalise once so a symlinked root (`/tmp` on macOS, `/home` on
        // many Linux setups) still matches paths resolved through it.
        let roots = roots.into_iter().map(|root| root.canonicalize().unwrap_or(root)).collect();
        Self { allow_write, roots, max_file_bytes }
    }

    /// Refuses a file larger than the configured cap.
    ///
    /// `hex_patch` reads the whole file into memory to rewrite it, so without
    /// this a caller could point it at a multi-gigabyte image and exhaust RAM.
    pub fn check_size(&self, path: &Path) -> ToolResult<u64> {
        let length = std::fs::metadata(path)
            .map_err(|e| ToolFailure::Failed(format!("could not stat {}: {e}", path.display())))?
            .len();
        if length > self.max_file_bytes {
            return Err(ToolFailure::Denied(format!(
                "{} is {length} bytes, over the {} byte limit; raise --max-file-bytes to proceed",
                path.display(),
                self.max_file_bytes
            )));
        }
        Ok(length)
    }

    /// Fails unless writing was enabled.
    pub fn require_write(&self) -> ToolResult<()> {
        if self.allow_write {
            return Ok(());
        }
        Err(ToolFailure::Denied(
            "this server is read-only; start it with --allow-write to permit patching".into(),
        ))
    }

    /// Resolves a caller-supplied path, rejecting anything outside the roots.
    /// With no roots configured, any absolute path is permitted.
    pub fn resolve(&self, raw: &str) -> ToolResult<PathBuf> {
        if raw.trim().is_empty() {
            return Err(ToolFailure::InvalidArguments("path must not be empty".into()));
        }
        let requested = Path::new(raw);
        if requested.is_relative() {
            return Err(ToolFailure::InvalidArguments(format!(
                "path {raw:?} must be absolute; the server has no meaningful working directory"
            )));
        }

        // Canonicalise when the path exists so symlinks cannot escape a root;
        // otherwise normalise lexically so writing a new file still works.
        let resolved = requested.canonicalize().unwrap_or_else(|_| normalize(requested));

        if self.roots.is_empty() || self.roots.iter().any(|root| resolved.starts_with(root)) {
            return Ok(resolved);
        }
        Err(ToolFailure::Denied(format!("path {raw:?} is outside the configured --root set")))
    }
}

/// Collapses `.` and `..` without touching the filesystem.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn readonly() -> Policy {
        Policy::new(false, Vec::new(), 1 << 20)
    }

    #[test]
    fn writing_is_denied_by_default() {
        let err = readonly().require_write().unwrap_err();
        assert!(matches!(err, ToolFailure::Denied(_)));
        assert!(err.to_string().contains("--allow-write"), "{err}");
    }

    #[test]
    fn writing_is_permitted_once_enabled() {
        assert!(Policy::new(true, Vec::new(), 1 << 20).require_write().is_ok());
    }

    #[test]
    fn without_roots_any_absolute_path_resolves() {
        assert!(readonly().resolve("/etc/hostname").is_ok());
    }

    #[test]
    fn relative_and_empty_paths_are_rejected() {
        assert!(readonly().resolve("relative/file").is_err());
        assert!(readonly().resolve("  ").is_err());
    }

    #[test]
    fn paths_inside_a_root_are_allowed_and_outside_denied() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("f.bin"), b"x").unwrap();

        let policy = Policy::new(true, vec![root.clone()], 1 << 20);
        assert!(policy.resolve(root.join("f.bin").to_str().unwrap()).is_ok());
        assert!(matches!(policy.resolve("/etc/passwd"), Err(ToolFailure::Denied(_))));
    }

    #[test]
    fn dot_dot_cannot_escape_a_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let policy = Policy::new(true, vec![root.clone()], 1 << 20);

        let escape = format!("{}/../../../../etc/passwd", root.display());
        assert!(matches!(policy.resolve(&escape), Err(ToolFailure::Denied(_))));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_pointing_outside_a_root_is_denied() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let link = root.join("escape");
        std::os::unix::fs::symlink("/etc/passwd", &link).unwrap();

        let policy = Policy::new(true, vec![root], 1 << 20);
        assert!(matches!(policy.resolve(link.to_str().unwrap()), Err(ToolFailure::Denied(_))));
    }

    #[test]
    fn a_not_yet_existing_file_inside_a_root_is_allowed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let policy = Policy::new(true, vec![root.clone()], 1 << 20);
        assert!(policy.resolve(root.join("new.bin").to_str().unwrap()).is_ok());
    }

    #[test]
    fn a_file_over_the_size_cap_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let path = root.join("big.bin");
        std::fs::write(&path, vec![0u8; 4096]).unwrap();

        let tight = Policy::new(true, vec![root.clone()], 1024);
        let err = tight.check_size(&path).unwrap_err();
        assert!(matches!(err, ToolFailure::Denied(_)));
        assert!(err.to_string().contains("--max-file-bytes"), "{err}");

        let roomy = Policy::new(true, vec![root], 1 << 20);
        assert_eq!(roomy.check_size(&path).unwrap(), 4096);
    }

    #[test]
    fn a_missing_file_reports_the_stat_failure() {
        assert!(readonly().check_size(Path::new("/nonexistent/omni/x.bin")).is_err());
    }

    #[test]
    fn normalisation_collapses_dot_segments() {
        assert_eq!(normalize(Path::new("/a/b/../c/./d")), PathBuf::from("/a/c/d"));
    }
}
