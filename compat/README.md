# Subagents native MCP patch

Supported third-party package: `@tintinweb/pi-subagents@0.19.0`. Verified host: Pi 1.0.2. The command requires Pi 0.99.1 or newer; newer host releases still need compatibility testing.

This is a small reviewed patch to a separately managed package. It does not replace the package, install dependencies, or run automatically during installation or session startup.

## Apply and check

Pin the package in Pi settings:

```json
"npm:@tintinweb/pi-subagents@0.19.0"
```

From the development checkout:

```bash
npm run compat:subagents -- --check
npm run compat:subagents
```

From a managed pi-tooling checkout, invoke its packaged script explicitly:

```bash
node ~/.pi/agent/git/github.com/jhs88/pi-tooling/scripts/patch-pi-subagents.mjs
```

If npm's bin directory is on PATH, the same script is available as `pi-subagents-compat`. The default target is the subagents package under `$PI_CODING_AGENT_DIR/npm/node_modules`, or `~/.pi/agent/npm/node_modules` when that variable is unset. Use `--package-dir PATH` for another installation. The Pi executable on PATH supplies the host version.

Exit codes:

- `0`: applied, or already patched.
- `1`: `--check` found an installation needing the patch. No writes.
- `2`: unsupported version, changed source/manifest, or application error.

Reviewed source and semantic manifest hashes must match before any writes. The earlier manifest-only TypeBox warning fix is accepted too. Changed files are backed up in a private `.pi-tooling-subagents-backup-*` directory inside the target package. Repeating a successful application does not rewrite files or make new backups.

After application, run `/reload` or restart Pi. Running sessions cache extension modules and should not be assumed to pick up an on-disk patch immediately.

## Behavior and configuration

The patch adds Pi's native MCP, codemode, and tool-search factories to the third-party SDK resource loader as named built-ins. Children read the normal Pi `agent/mcp.json` and trust-gated project MCP configuration; no adapter or shared config import is added.

Named built-ins preserve `noExtensions`, `isolated`, and `-builtin:mcp` exclusions. The patch preserves native exposure and authorized search activation during subagent scope changes. Codemode and tool search remain available as model-only entry points; unrequested tools are not promoted to direct exposure. Native `tool_call` handlers enforce the same live selector rules for nested codemode calls, which do not pass through the third-party agent's outer call guard. Host-provided packages move to wildcard peer dependencies to avoid the TypeBox manifest warning.

Subagents' plain `tools:` entries name Pi built-in file/shell tools. MCP tools require extension selectors, for example:

```yaml
tools: read, grep, find, ls, ext:builtin:mcp/mcp__grepika__toc, ext:builtin:mcp/mcp__grepika__search, ext:session-name
extensions: true
```

Use explicit selectors for restricted agents. To allow the native MCP extension's tools and codemode together, use `ext:builtin:mcp, ext:builtin:codemode/codemode`. This broader scope permits the MCP server tools in the child's config, including mutating tools. It is not appropriate for a read-only agent without additional restrictions. Tool scope still excludes the third-party package's recursive delegation tools.

## Reinstall, update, and removal

Pi package reconciliation or a reinstall can overwrite the patch. Run `--check` and reapply explicitly afterward. Pinning the subagents version prevents an unreviewed release from becoming an implicit patch target; it does not make local edits permanent.

For a new subagents release, review its source and manifest, update the versioned specification and pinned test dependency, and rerun the CLI safety tests and real SDK child tests. Do not relax the hashes to accommodate unknown edits.

Remove this workaround once upstream initializes native MCP correctly and the release is verified. To restore the original package now, reinstall the pinned package through Pi, or restore the saved files. Reinstallation also restores the original manifest warning until upstream fixes its dependency declarations.

```bash
npm run test:compat
npm run verify
```

The tests use a pinned development-only upstream package and a local stdio MCP fixture. They do not call a model, Firecrawl, or external MCP services. Provenance is recorded in [PROVENANCE.md](PROVENANCE.md).
