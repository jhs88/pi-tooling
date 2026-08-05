# Pi A2A bridge

This directory implements the authenticated loopback bridge from a Hermes A2A client to persistent Pi SDK sessions.

## Start and stop

Set the bearer token in the environment of the Pi process. Do not put it in this repository.

```bash
export PI_A2A_BEARER_TOKEN='generate-a-private-token'
```

### Interactive Pi process

Load the `@jhs88/pi-tooling` package in Pi and start it with the extension flag:

```bash
pi --a2a-server
```

The equivalent in-session controls remain available:

```text
/a2a-server start
/a2a-server status
/a2a-server stop
```

The server does not start merely because the package is loaded. A dedicated Pi process may instead set `PI_A2A_AUTO_START=true`. In both cases, its listener is stopped on Pi session shutdown.

### Headless foreground process

The package also exposes `pi-a2a-server`, a foreground executable suitable for a process supervisor such as systemd. It does not open the Pi TUI:

```bash
cd /path/to/coding/workspace
PI_A2A_BEARER_TOKEN="$(<~/.config/pi-a2a/token)" pi-a2a-server
```

From a package checkout that has not been linked or installed into the command path, invoke the executable directly:

```bash
PI_A2A_BEARER_TOKEN="$(<~/.config/pi-a2a/token)" \
  /path/to/pi-tooling/a2a/cli.mjs
```

Use `pi-a2a-server --check` to verify the installed executable can resolve the Pi host runtime without opening a listener. Managed Git packages intentionally keep Pi host packages as peers. The executable resolves that peer from the `pi` command on `PATH`; set `PI_A2A_PI_PACKAGE` to the absolute `@earendil-works/pi-coding-agent` package directory only when the supervisor has a restricted `PATH`.

The headless process logs its bound URL after startup and handles `SIGINT` and `SIGTERM` with coordinated server and Pi-session shutdown. A service supervisor should invoke the linked command or executable path directly rather than wrapping it in `npm exec`, so signals reach the server process without an intermediate npm shell. Node.js 22.19 or newer is required.

The working directory is fixed to the current directory when either server form starts. The initial implementation accepts only loopback hosts and allows one active Pi turn at a time.

## Configuration

| Variable | Default | Constraint |
|---|---:|---|
| `PI_A2A_BEARER_TOKEN` | none | Required and non-empty |
| `PI_A2A_HOST` | `127.0.0.1` | `127.0.0.1`, `::1`, or `localhost` |
| `PI_A2A_PORT` | `10000` | 1–65535 |
| `PI_A2A_MAX_BODY_BYTES` | `1048576` | Hard maximum of 1 MiB |
| `PI_A2A_MAX_TASKS` | `256` | Integer from 1 through 1024 |
| `PI_A2A_MAX_CONTEXTS` | `256` | Persistent mappings per workspace; integer from 1 through 1024 |
| `PI_A2A_EXECUTION_TIMEOUT_MS` | `300000` | Positive integer |
| `PI_A2A_AUTO_START` | unset | Starts only when exactly `true` |
| `PI_A2A_PI_PACKAGE` | automatic | Optional absolute Pi host-package directory for headless resolution |

## Persistence and lifecycle

Each validated A2A `contextId` maps to one canonical Pi JSONL session. The mapping is stored under the active `PI_CODING_AGENT_DIR`:

```text
a2a/contexts.json
sessions/--encoded-cwd--/*.jsonl
```

Sessions use Pi's standard cwd-specific location so existing session ingestion continues to discover them. One registry safely retains entries for multiple workspaces, while a context identifier remains bound to its original workspace. The directories are restricted to mode `0700`; registry and session files are restricted to `0600`. Symlinked storage-root chains, registry directories, and registry/session files fail closed. Mappings are written atomically once Pi has materialized the canonical session file, including failed, canceled, shutdown, or no-assistant turns. Missing, corrupt, escaped, or mismatched session mappings fail closed and are never silently deleted.

Concurrent workspace hosts serialize new-context initialization and registry updates through the private `contexts.json.lock` directory. This prevents stale write snapshots, duplicate canonical sessions for the same new context, and concurrent capacity overruns. Each turn also holds a context-specific `contexts.json.<sha256-context-id>.turn.lock` directory, preventing separate hosts or processes from prompting the same canonical conversation concurrently without blocking unrelated mapped contexts. Registry and turn-lock waiters remain cancellation- and shutdown-aware for the full request lifetime and never construct a session after their request is canceled. A failed lazy session that has not materialized its canonical file is closed and evicted before the initialization lock is released, so retries cannot bypass cross-process serialization through an unmapped cache entry. Locks are removed after their protected operation finishes. After a hard process crash, remove a stale registry or turn-lock directory only after confirming that no Pi A2A host using that agent directory is running.

Persistent mappings are not automatically evicted because doing so could silently detach an A2A context from its canonical Pi conversation. New contexts are rejected when the configured per-workspace capacity is reached. An operator can raise `PI_A2A_MAX_CONTEXTS` up to 1024. If mappings must be retired, stop every A2A server using the agent directory, back up `a2a/contexts.json` and the corresponding canonical JSONL files, then remove only deliberately retired entries before restarting; reusing a retired context identifier starts a new conversation and should therefore be avoided.

Cancellation, execution timeout, and a disconnected `SendMessage` client abort the underlying Pi SDK session. The single active-turn slot remains occupied until Pi finishes abort cleanup. Inbound child sessions load no package or project extensions, do not expand prompt templates, and exclude orchestration tools.

Returned and retained task text is capped at 64 KiB with UTF-8-safe truncation. The complete model response remains in the canonical Pi JSONL session.

## Verification boundary

An A2A `TASK_STATE_COMPLETED` response is not proof that a coding task is correct. Hermes must inspect repository artifacts and run the repository's tests independently. Keep ACP/delegation and Kanban available as fallback coordination paths.

Run `npm run verify:production` from a development checkout to pack the package, install it without development or Pi peer packages, and execute the headless runtime check against the host-provided Pi package.

The bridge does not write Hermes peer configuration. Configure the peer separately only after an isolated real-model validation succeeds.
