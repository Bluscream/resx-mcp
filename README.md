# resx-mcp

.NET `.resx` resource file reading and editing, as an MCP server.

> **Rust rewrite.** This branch replaces the earlier TypeScript implementation,
> which remains on `main`.

```bash
resx-mcp --root /path/to/project               # read-only
resx-mcp --root /project --allow-write         # editing enabled
resx-mcp --transport http --auth-token "$TOK"  # over HTTP
```

## Tools

| Tool | Does |
| --- | --- |
| `read_resx` | Reads the string entries, returning each key with its value and comment. |
| `write_resx_entry` | Adds or updates one entry, preserving the rest of the document. Creates the file with a valid header if absent. |

## Correctness

Editing is event-based rather than string surgery, which matters:

- A **new entry is written as real XML elements**. Building the element as text
  and passing it through an escaping writer produces a literal
  `&lt;data name="..."&gt;` line instead of an element — a bug the TypeScript
  version's Rust predecessor shipped with.
- **Updating a key changes only its `<value>`.** A naive implementation replaces
  the text of every child, silently destroying the entry's `<comment>`.
- **Values are escaped properly**, so `a & b <tag>` round-trips exactly.
- `<resheader>` blocks are not mistaken for entries, and CDATA values are read.
- The XML declaration and every untouched entry are preserved.

Malformed XML is reported with a byte offset rather than silently truncating.

## Safety

Read-only unless `--allow-write`; paths confined to `--root`; files capped by
`--max-file-bytes`; HTTP requires a bearer token unless
`--allow-unauthenticated`.

## Options

Everything from [`mcp-toolkit`](https://github.com/Bluscream/mcp-toolkit), plus
`--allow-write`, `--root DIR` (repeatable) and `--max-file-bytes`
(`RESX_MCP_*` env equivalents).

## Development

```bash
./scripts/build.sh --release
```

## License

[Unlicense](LICENSE) (public domain).
