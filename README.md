# Pi Tooling

A managed [Pi package](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md) that adds file search, self-hosted web research, focused user interaction, background processes, and bounded workflow orchestration.

## Tools

| Capability | Tools | Notes |
| --- | --- | --- |
| File search | `fd`, `rg` | Uses system binaries when available, with checksum-verified official fallbacks |
| Web research | `search`, `scrape`, `crawl` | Requires an explicitly configured self-hosted Firecrawl endpoint |
| User interaction | `ask_user` | Presents one focused question with selectable and custom-answer paths |
| Background processes | `bg_start`, `bg_status`, `bg_list`, `bg_kill` | Runs non-interactive, session-scoped processes with bounded output |
| Workflows | `workflow`, `/workflows` | Runs explicitly requested JavaScript workflows with bounded fan-out |

The package supplements rather than replaces [`@tintinweb/pi-subagents`](https://www.npmjs.com/package/@tintinweb/pi-subagents).

It also bundles a `background-terminals` skill so Pi receives usage and lifecycle guidance alongside the `bg_*` tools it describes.

## Requirements

- Pi with managed Git-package support
- Node.js and npm available to Pi's package manager
- A self-hosted Firecrawl endpoint if the web-research tools will be used

Development and compatibility checks currently use `@earendil-works/pi-coding-agent` 0.80.10.

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

- Workflow execution is explicit, limited to three children, and cannot recursively invoke orchestration tools.
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
