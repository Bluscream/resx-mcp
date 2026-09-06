//! What this server is allowed to touch.
//!
//! A hex editor that can rewrite arbitrary bytes anywhere on disk is a large
//! capability to hand a language model. Writing is off unless the operator asks
//! for it, and `--root` confines every path to a set of directories.

use std::path::{Path, PathBuf};

use mcp_toolkit::{Sandbox, ToolFailure, ToolResult};

#[derive(Debug, Clone, Default)]
pub struct Policy {
    allow_write: bool,
    sandbox: Sandbox,
}

impl Policy {
    pub fn new(allow_write: bool, roots: &[PathBuf], max_file_bytes: u64) -> Self {
        Self { allow_write, sandbox: Sandbox::new(roots, max_file_bytes) }
    }

    /// Fails unless editing was enabled.
    pub fn require_write(&self) -> ToolResult<()> {
        if self.allow_write {
            return Ok(());
        }
        Err(ToolFailure::Denied(
            "this server is read-only; start it with --allow-write to permit editing".into(),
        ))
    }

    /// Resolves a caller-supplied path within the permitted roots.
    pub fn resolve(&self, raw: &str) -> ToolResult<PathBuf> {
        self.sandbox.resolve(raw)
    }

    /// Refuses a file larger than the configured ceiling.
    pub fn check_size(&self, path: &Path) -> ToolResult<u64> {
        self.sandbox.check_size(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn readonly() -> Policy {
        Policy::new(false, &[], 1 << 20)
    }

    #[test]
    fn writing_is_denied_by_default() {
        let err = readonly().require_write().unwrap_err();
        assert!(matches!(err, ToolFailure::Denied(_)));
        assert!(err.to_string().contains("--allow-write"), "{err}");
    }

    #[test]
    fn writing_is_permitted_once_enabled() {
        assert!(Policy::new(true, &[], 1 << 20).require_write().is_ok());
    }
}
