# Pi Tooling

A managed [Pi package](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md) for file search, self-hosted web research, user questions, background processes, and subagent compatibility.

| Capability | Tools or entry point |
| --- | --- |
| File search | `fd`, `rg`; system binaries or checksum-verified official downloads |
| Web research | `search`, `scrape`, `crawl`; requires self-hosted Firecrawl |
| User questions | `ask_user`; selectable choices and custom answers |
| Background processes | `bg_start`, `bg_status`, `bg_list`, `bg_kill`; `/ps` in the terminal UI |
| Subagents | Compatibility tools for separately installed `@tintinweb/pi-subagents` |
| A2A bridge | Opt-in authenticated loopback server; [setup and configuration](a2a/README.md) |

## Install and update

Requires Pi 1.1.0 or newer, Node.js 22.19.0 or newer, and npm.

```bash
pi install git:github.com/jhs88/pi-tooling
pi update --extensions
```

Use `pi update --all` to update Pi as well. Pi manages the checkout and its production dependencies. See [package lifecycle and repair](docs/package-lifecycle.md); copying the source into `~/.pi/agent/extensions` bypasses that lifecycle.

## Answer questions

`ask_user` asks one question with 2–5 choices. In T3 Code it uses native question cards through Pi's RPC dialogs. Select a choice or type an answer; clients without inline entry offer **Write my own answer…**.

In Pi's terminal UI, use arrows or a number to highlight a choice and Enter to confirm. Start typing or paste to write a custom answer. Press Tab first for an answer beginning with a number. From the editor, Tab or Esc returns to the choices and preserves your draft; Enter submits nonempty text. Esc from the choices dismisses the question. Dismissal or cancellation does not select an answer. Headless modes return guidance to ask in plain text.

## Configure Firecrawl

Set the endpoint in the process environment or `~/.pi/agent/.env`; process values take precedence.

```dotenv
FIRECRAWL_API_URL=https://firecrawl.example.com
# Optional authentication for your self-hosted service:
FIRECRAWL_API_KEY=<optional-key>
```

An explicit self-hosted HTTP(S) endpoint is required. There is no Firecrawl Cloud fallback.

## Subagents

The [compatibility layer](subagents/README.md) supports `@tintinweb/pi-subagents` 0.22.0 and 0.23.0. Standalone Pi uses that package's tools, permission hooks, MCP support, and explicitly invoked workflows. Install it separately.

In verified T3 Code sessions, the layer prefers T3's native delegation tools so child conversations can be opened in T3. Pi agent definitions and workflow scripts are not translated. Set `PI_TOOLING_SUBAGENTS_COMPAT=0` to disable the layer, including native preference. See the [compatibility guide](subagents/README.md) for tool names, permissions, and child isolation settings.

## Development

Read [CONTEXT.md](CONTEXT.md) and [AGENTS.md](AGENTS.md) before changing architecture or runtime behavior.

```bash
npm ci
npm run verify
```

Verification runs TypeScript checks and the complete test suite. Packaging changes also require the production dependency checks in [AGENTS.md](AGENTS.md). `npm run verify:production` tests an isolated production install and the headless A2A runtime check.

[Architecture decisions](docs/adr/README.md) record durable choices. Hermes Kanban board `pi-tooling` tracks active work; [docs/history](docs/history/) preserves the read-only planning archive.

## Attribution

- Selected extensions, shared helpers, and skills adapt [`davis7dotsh/my-pi-setup@797eaf6`](https://github.com/davis7dotsh/my-pi-setup/tree/797eaf6d6f178759cf7aabde927ef15c91346e7e). Terminal hardening also references [`73bf4d8`](https://github.com/davis7dotsh/my-pi-setup/tree/73bf4d826f39b5cab6b7865e706ba4a2669629ca). No license was detected at `797eaf6`.
- The inbound A2A server adapts [`DrOlu/pi-a2a-communication@497ec9f`](https://github.com/DrOlu/pi-a2a-communication/tree/497ec9fe22620ee51473854cf0d7001cfe409054), under the MIT notice below.
- The subagent adapter is local integration code for [`@tintinweb/pi-subagents`](https://www.npmjs.com/package/@tintinweb/pi-subagents); its source is not vendored here.

<details>
<summary>A2A source license (MIT)</summary>

MIT License

Copyright (c) 2026 pi-extensions

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

</details>
