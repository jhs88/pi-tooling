# Pi Tooling

A managed [Pi package](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md) that adds file search, self-hosted web research, focused user interaction, background processes, and T3-compatible subagent tools.

## Tools

| Capability | Tools | Notes |
| --- | --- | --- |
| File search | `fd`, `rg` | Uses system binaries when available, with checksum-verified official fallbacks |
| Web research | `search`, `scrape`, `crawl` | Requires an explicitly configured self-hosted Firecrawl endpoint |
| User interaction | `ask_user` | Presents one focused question with selectable and custom-answer paths |
| Background processes | `bg_start`, `bg_status`, `bg_list`, `bg_kill` | Runs non-interactive, session-scoped processes with bounded output |
| Workflows | `subagent_workflow` | Forwards to the separately installed subagents plugin |

The package supplements rather than replaces [`@tintinweb/pi-subagents`](https://www.npmjs.com/package/@tintinweb/pi-subagents).

The [subagent compatibility layer](subagents/README.md) exposes `subagent`, `subagent_result`, `subagent_steer`, and an upstream-enabled `subagent_workflow` by default on supported hosts. No environment switch is needed, including when T3 launches Pi. It requires the pinned subagents 0.22.0 package and Pi's public loadout and `ctx.executeTool` APIs. It preserves permissions and supplies foreground progress fields for T3 without editing either dependency. Set `PI_TOOLING_SUBAGENTS_COMPAT=0` to disable it. T3 tool visibility was owner-confirmed on the earlier baseline; this upgrade has SDK/RPC coverage, not a new UI verification.

It also bundles `background-terminals` and `workflows` skills so Pi receives operational guidance alongside the specialized tools they describe.

## Requirements

- Pi 1.1.0 or newer with managed Git-package support
- Node.js and npm available to Pi's package manager
- A self-hosted Firecrawl endpoint if the web-research tools will be used

Development dependencies pin the Pi host packages to 1.3.0. This baseline supports native llama.cpp decision models. Their router must be llama.cpp 0.6.0 or newer and advertise `decisions` in `architecture.output_modalities`. Pi host packages remain wildcard peers, as required for managed packages.

## Install

```bash
pi install git:github.com/jhs88/pi-tooling
```

Pi clones the repository and installs its production dependencies beside the extension. Do not copy the repository into `~/.pi/agent/extensions`; auto-discovered source directories do not receive the same managed dependency lifecycle.

## Update

Update managed extensions only:

```bash
pi update --extensions
```

Or update Pi and all managed packages:

```bash
pi update --all
```

See [`docs/package-lifecycle.md`](docs/package-lifecycle.md) for dependency reconciliation and repair instructions.

## Subagent native MCP compatibility

Use `@tintinweb/pi-subagents@0.22.0` with Pi 1.1.0 or newer. Native MCP, codemode, tool search, project trust, and nested tool scoping are supplied by upstream. No source patch is needed. The development and RPC verification baseline is Pi 1.3.0.

Children with extensions enabled can start their own MCP servers. Use `extensions: false`, `isolated: true`, or `exclude_extensions: builtin:mcp` when they should not. Restricted MCP access uses explicit `ext:builtin:mcp/<tool>` selectors. The obsolete native MCP patch and command have been removed. Use explicit extension selectors for restricted agents; bare MCP tool names are not an authorization boundary.

## Configure Firecrawl

Set the self-hosted endpoint in the process environment or in `~/.pi/agent/.env`:

```dotenv
FIRECRAWL_API_URL=https://firecrawl.example.com
# Optional when the self-hosted service requires authentication:
FIRECRAWL_API_KEY=<optional-key>
```

Configuration precedence is:

1. process environment;
2. Pi's `agent/.env`.

Only explicit HTTP(S) endpoints are accepted. The public Firecrawl Cloud endpoint is never selected as a fallback.

## Safety defaults

- Workflow execution uses the upstream subagents plugin, including its scheduling, limits, progress UI, and same-session replay. Pi Tooling does not impose a separate three-child cap.
- Background processes are non-interactive, session-owned, output-bounded, redacted, and terminated as process trees.
- Firecrawl output is bounded, persisted when oversized, and cancellable.
- Downloaded `fd` and `rg` fallbacks use pinned checksums from official release assets.

## Development

```bash
npm ci
npm run verify
```

The verification command runs TypeScript checks and the complete test suite. For packaging changes, also verify a production-only installation:

```bash
rm -rf node_modules
npm ci --omit=dev --ignore-scripts
test -f node_modules/@effect/platform-node/package.json
```

Read [`CONTEXT.md`](CONTEXT.md) and [`AGENTS.md`](AGENTS.md) before changing architecture or runtime behavior. Runtime state such as `node_modules`, downloaded binaries, workflow artifacts, and terminal logs is not committed.

## Attribution

The implementation is adapted from [`davis7dotsh/my-pi-setup@797eaf6`](https://github.com/davis7dotsh/my-pi-setup/tree/797eaf6d6f178759cf7aabde927ef15c91346e7e). Component-specific adaptation notes are recorded in the `PROVENANCE.md` files and supporting historical research under `docs/history/`.

The pinned upstream snapshot had no detected license. The provenance records document that limitation and the scope of the adaptations.
