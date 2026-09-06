//! resx-mcp — .NET .resx resource files over MCP.

mod args;
mod policy;
mod tools;

use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use mcp_toolkit::ServerOptions;

use policy::Policy;
use tools::ResxTools;

#[derive(Parser, Debug)]
#[command(name = "resx-mcp", version, about = ".NET .resx resource files as an MCP server")]
struct Cli {
    #[command(flatten)]
    server: ServerOptions,

    /// Permit `write_resx_entry` to modify files. Without this, read-only.
    #[arg(long, env = "RESX_MCP_ALLOW_WRITE")]
    allow_write: bool,

    /// Confine every path to this directory. Repeatable. Unrestricted if unset.
    #[arg(long = "root", value_name = "DIR", env = "RESX_MCP_ROOT")]
    roots: Vec<PathBuf>,

    /// Largest file the server will open, in bytes.
    #[arg(long, default_value_t = 16 * 1024 * 1024, env = "RESX_MCP_MAX_FILE_BYTES")]
    max_file_bytes: u64,
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let cli = Cli::parse();
    let policy = Policy::new(cli.allow_write, cli.roots, cli.max_file_bytes);
    let group = Arc::new(ResxTools::new(policy));

    match mcp_toolkit::run("resx", env!("CARGO_PKG_VERSION"), group, cli.server).await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("resx-mcp: {err}");
            std::process::ExitCode::FAILURE
        }
    }
}
