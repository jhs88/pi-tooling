# Pi Tooling

A managed [Pi package](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md) containing selected file-search, web-research, interaction, background-process, and workflow tools.

The implementations are adapted from [`davis7dotsh/my-pi-setup@797eaf6`](https://github.com/davis7dotsh/my-pi-setup/tree/797eaf6d6f178759cf7aabde927ef15c91346e7e) for `@earendil-works/pi-coding-agent` 0.80.10.

## Included tools

- first-class `fd` and `rg`
- self-hosted Firecrawl `search`, `scrape`, and `crawl`
- focused `ask_user`
- session-scoped background terminals
- explicit bounded JavaScript workflows

The package preserves `@tintinweb/pi-subagents`, requires an explicit self-hosted Firecrawl endpoint, caps workflow fan-out at three children, prevents recursive orchestration, and hardens background-process output and lifecycle handling.

## Install and update

```bash
pi install git:github.com/jhs88/pi-tooling
```

Pi clones the package and runs `npm install --omit=dev`, installing its runtime dependencies next to the extension. Future package updates and dependency reconciliation are handled by:

```bash
pi update --extensions
# or update Pi and every managed package:
pi update --all
```

Do not copy this repository into `~/.pi/agent/extensions`; that bypasses Pi's package lifecycle and leaves runtime dependencies unmanaged.

## Firecrawl configuration

The package resolves `FIRECRAWL_API_URL` and optional `FIRECRAWL_API_KEY` in this order:

1. process environment;
2. `~/.pi/agent/.env`;
3. the global Hermes environment (`$HERMES_HOME/.env` or `~/.hermes/.env`).

Only explicit self-hosted HTTP(S) endpoints are accepted. Firecrawl Cloud is never used as a fallback.

## Development

```bash
npm ci
npm run verify
```

Runtime state (`node_modules`, downloaded binaries, workflow artifacts, and terminal logs) is not committed.
