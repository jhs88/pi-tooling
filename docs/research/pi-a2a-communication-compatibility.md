# Pi A2A communication compatibility research

Research date: 2026-08-04

## Scope

Evaluate the server side of `DrOlu/pi-a2a-communication` as a source for exposing the local Pi coding agent to Hermes through the A2A protocol. The installed Pi runtime and this repository's development dependencies are aligned at `@earendil-works/pi-coding-agent` 0.83.0. Existing ACP and Kanban routes remain unchanged.

## Pinned upstream

- Repository: <https://github.com/DrOlu/pi-a2a-communication>
- Revision: [`497ec9fe22620ee51473854cf0d7001cfe409054`](https://github.com/DrOlu/pi-a2a-communication/tree/497ec9fe22620ee51473854cf0d7001cfe409054)
- Published package: `pi-a2a-communication@1.0.1`
- Package metadata: [`package.json`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/package.json)
- License: MIT, copyright © 2026 pi-extensions. The license permits modification and redistribution when its notice is retained.

Inspected files:

- [`a2a-server.ts`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/a2a-server.ts)
- [`config.ts`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/config.ts)
- [`types.ts`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/types.ts)
- [`index.ts`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/index.ts)
- [`LICENSE`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/LICENSE)

## Decision

Do not consume the published package unchanged. Use a licensed selective adaptation of only the inbound server concepts, implemented against tests in this repository and the exact local Pi/Hermes contracts. Do not import the upstream client, broadcast, chain, OAuth, mTLS, load-balancing, or push-notification claims in the first milestone.

The local implementation targets Hermes's bundled A2A v1.0 client:

- canonical discovery at `/.well-known/agent-card.json`;
- JSON-RPC v1.0 interface advertised by the Agent Card;
- `POST /` with method `SendMessage`;
- `ROLE_*` roles and `TASK_STATE_*` states;
- `contextId` inside the incoming Message;
- a Task or Message JSON-RPC result that Hermes can unwrap.

## Decisive compatibility findings

1. **No Pi execution:** `executePiTask()` returns a placeholder string and never invokes Pi ([`a2a-server.ts#L546-L550`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/a2a-server.ts#L546-L550)).
2. **Wrong discovery endpoint:** the server routes `/.well-known/agent-card` ([`a2a-server.ts#L166`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/a2a-server.ts#L166)); Hermes requests `/.well-known/agent-card.json` and falls back to `/.well-known/agent.json`.
3. **Wrong RPC surface:** the server routes `/sendMessage` and `/sendStreamingMessage` ([`a2a-server.ts#L168-L169`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/a2a-server.ts#L168-L169)); Hermes posts `SendMessage` to the card's JSON-RPC interface URL.
4. **Pre-v1 shapes:** the source uses lowercase user/agent roles and text parts discriminated by `type` ([`types.ts#L154-L166`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/types.ts#L154-L166)); Hermes emits v1 roles and member-presence parts.
5. **Capabilities over-advertised:** the card claims push notifications and extended-card behavior ([`a2a-server.ts#L714-L719`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/a2a-server.ts#L714-L719)) that the first usable Pi bridge does not need and the server does not fully implement.
6. **Configured base path is not honored:** defaults define `basePath` ([`config.ts#L25-L31`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/config.ts#L25-L31)), while request routing hard-codes paths.
7. **In-memory task lifecycle:** tasks are inserted into a process-local map ([`a2a-server.ts#L228`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/a2a-server.ts#L228)); the extension server is created at `session_start` and stopped at `session_end` ([`index.ts#L73-L105`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/index.ts#L73-L105)).
8. **Unsafe network default:** both extension and configuration defaults bind to `0.0.0.0` ([`index.ts#L48-L54`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/index.ts#L48-L54), [`config.ts#L25-L31`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/config.ts#L25-L31)). The local first milestone is loopback-only.
9. **Authentication needs a local redesign:** the server reads `Authorization` and directly compares the raw header string with its bearer token ([`a2a-server.ts#L581-L589`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/a2a-server.ts#L581-L589)). The local implementation reads one bearer token from the process environment, fails closed when absent, never persists it, and uses timing-safe comparison.
10. **Cancellation does not abort work:** cancellation changes only task state ([`a2a-server.ts#L318-L322`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/a2a-server.ts#L318-L322)). The local executor contract must expose an `AbortSignal` and abort the actual Pi session.
11. **Unbounded request body:** `readBody()` accumulates all chunks without a size limit ([`a2a-server.ts#L673-L681`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/a2a-server.ts#L673-L681)). The local boundary must enforce a bounded body.
12. **Wildcard CORS:** the server enables `Access-Control-Allow-Origin: *` ([`a2a-server.ts#L149`](https://github.com/DrOlu/pi-a2a-communication/blob/497ec9fe22620ee51473854cf0d7001cfe409054/a2a-server.ts#L149)). No browser client is required, so the local server should not advertise wildcard CORS.

## Local adaptation boundary

The first implementation may adapt general server concepts and MIT-covered structure, but its behavior is test-first and locally shaped:

- inbound server only;
- synchronous `SendMessage` first;
- `GetTask`, `ListTasks`, and `CancelTask` after the same protocol seam is stable;
- loopback bind by default;
- explicit bearer authentication;
- injected executor for deterministic tests;
- bounded task storage and request bodies;
- no model calls in protocol tests;
- no changes to live `.pi` or Hermes configuration.

The real Pi executor and persistent `contextId -> canonical session file` mapping were implemented after the protocol boundary passed against the actual Hermes client. The completed isolated validation used a disposable `PI_CODING_AGENT_DIR` and verified a real model read, same-context follow-up, session recovery after server restart, cancellation, execution timeout, owner-only registry/session modes, and an unchanged fixture worktree. No persistent Hermes peer or production Pi configuration was written by that validation.
