# Compatibility evidence and provenance

This adapter is new code. It forwards to registered originals through the public tool pipeline at runtime and does not vendor or modify tintinweb source.

## Current baseline

Development dependencies now pin the Pi host packages to 1.1.0, which supports native llama.cpp decision models. The naming adapter is enabled when `PI_TOOLING_SUBAGENTS_COMPAT` is unset; an explicit `1` remains supported, and other explicitly set values disable it. Source-version, activation, collision, execution-context and permission checks are unchanged. The repository owner has tested T3 and confirmed that the subagent tools appear in its UI.

The older Pi versions and line references below record the original review, not the current dependency pins. The separately reviewed subagents release remains 0.19.0. Its native MCP patch still requires explicit application.

## Exact dependency reviewed

The source inspected was the npm tarball for `@tintinweb/pi-subagents@0.19.0`, obtained with `npm pack @tintinweb/pi-subagents@0.19.0`. This was not a review of the dependency's moving main branch.

| Artifact | Digest |
| --- | --- |
| npm tarball SHA-1, as reported by npm | `2af9a4b49d362d7c1e8e3769b4398b1a5b267ca6` |
| npm tarball SHA-256 | `0c4c9416750027f5e18aef663975827ecc63bd4969a207c3dd0abde7e6bd61de` |
| `src/index.ts` SHA-256 | `622d44b11e615ec0509f13e858dcad4a40789e4613c03583930327f15d9ec6a9` |
| `src/cross-extension-rpc.ts` SHA-256 | `22a02ea5881ccb4be966bf2d1cac47a00fb31321874b5e0fc0e3bd02eb53a88b` |

The tarball includes an MIT license. The following pinned source contracts were inspected:

- `src/index.ts:1581-1647`, the Agent definition and full live parameter schema.
- `src/index.ts:1767-2268`, Agent dispatch, invocation precedence, schedules, resume, foreground streaming, startup errors and terminal results.
- `src/index.ts:2284-2302`, registered executor usage reporting.
- `src/index.ts:2408-2582`, the actual `SubagentWorkflow` definition, its parameters and optional registration. The workflow exists in 0.19.0; its presence is not inferred from current upstream docs.
- `src/index.ts:2732-2874`, original result and steering tools, including handle resolution, wait cancellation and verbose output.
- `src/index.ts:738-749`, the documented global manager registry and top-level-only `getRecord`.
- `src/index.ts:789-827` and `src/cross-extension-rpc.ts`, lifecycle-gated in-process RPC, including targeted stop and consumption.
- `src/invocation-config.ts:135-143`, agent-file precedence over caller background mode.
- `src/agent-manager.ts:806-807`, the exact child session on the targeted record.
- `src/agent-manager.ts:1407-1425`, synchronous stopped status on abort, which requires awaiting the targeted run promise too.
- `docs/rpc.md`, especially the stripped spawn options, overwritten callbacks, notification-consumption race, ownership rules and registry limits.

The runtime version guard reads the nearest `package.json` associated with each original tool's `sourceInfo.path`. It accepts only the exact package name and version. It does not enforce source hashes, so an independently reviewed native-MCP patch to 0.19.0 can coexist with this naming adapter. Unknown source modifications still need their own review.

## Pi executor contract

Pi 0.83.0's `ExtensionAPI.getAllTools()` returns `ToolInfo`, a pick of metadata plus `sourceInfo`; it has no executable tool member. No invented `getAllTools().execute` path is used.

The installed Pi 1.0.3 API exposes `ToolDefinition.prepareLoadout(loadout)` and `ToolLoadout.registered: readonly AgentTool[]`. `dist/core/tools/tool-definition-wrapper.js` shows that these registered tools have already been bound to their original extension context. The adapter uses registered metadata only for schema copying and eligibility. Execution goes through `ExtensionToolContext.executeTool`, which runs the original with a nested call ID and its bound context. The public hook hides original declarations while keeping originals active and callable. Feature detection leaves aliases inactive on metadata-only hosts; a missing execution context fails closed with no raw-executor fallback.

The original adapter review used Pi 1.0.2 development packages and the Pi 1.0.3 CLI. Both exposed the loadout and nested-tool APIs described here. SHA-256 comparison found their reviewed `tool-definition-wrapper.js`, `agent-session.js` and `extensions/types.d.ts` files byte-identical.

## Permission-hook boundary

The adapter preserves both original-name and alias-name validation and permission checks. On both Pi 1.0.2 and 1.0.3:

- `dist/core/tools/tool-definition-wrapper.js:3-13` binds registered tool execution to its extension context but does not emit permission hooks.
- `dist/core/agent-session.js:302-327` installs `tool_call` interception on the agent pipeline, using the model-issued tool name. Calling a registered executor directly cannot replay handlers for its original name.
- `dist/core/extensions/types.d.ts:254-280` exposes `ExtensionToolContext.executeTool()`, the supported way to run another tool with validation, hooks and permissions. It assigns a nested call ID and emits nested `tool_call`, `tool_result` and `tool_execution_*` events with `parentToolCallId`.
- `dist/core/agent-session.js:375-403` confirms that nested execution uses the full pipeline and emits its events. It is not a hooks-only API. Originals therefore remain callable rather than being removed from the active set.
- `dist/core/extensions/runner.js:957-971` owns hook dispatch. `ExtensionAPI` has no supported hooks-only dispatcher or original-name permission-equivalence mapping. `pi.events` is the extension bus, not this dispatcher.

Preserving authorization takes priority over retaining only one host lifecycle. All four aliases use the public nested execution API. Original-name rules receive the original arguments, including the foreground override for `Agent`. The outer alias can be denied before dispatch; the original can be denied before its executor starts. No private hook replay, invented bus events or policy migration is required. Originals stay active/callable and only their provider declarations are hidden. Nested original events carry `parentToolCallId`; the inner `Agent` is an ordinary dynamic tool in the supplied T3 contract, not another `subagent` child-card event.

The real RPC probes hard-assert that an `Agent` deny and a `subagent` deny each produce an error with zero child starts, zero child provider streams and zero usage. The original-deny run has exactly one nested `Agent` hook; alias denial has none. A separate frontmatter-background lane denies `get_subagent_result` during the joined usage read and asserts the denied outcome is returned without bypass. Enabled normal and reversed-load-order runs start exactly one child, verify hidden parent declarations, and bound nested original start/end pairs with matching `parentToolCallId`.

## Result transformations and availability

Final visible output uses only the original-name pipeline outcome. A foreground call normalizes the returned `Agent` content and details, not `record.result` or `record.error`. A joined call uses the returned `get_subagent_result` content and details, without merging the earlier receipt's metadata. The registry supplies lifecycle status, cancellation and subscription ownership only. A missing pipeline result reader fails closed.

Real SDK and RPC regressions install original-name `tool_result` hooks for `Agent` and `get_subagent_result`. Successful and failed children emit a dummy `SECRET` marker. The hook confirms it saw the marker and replaces content with `[REDACTED]`, removing non-lifecycle metadata. Tests inspect both final tool events and the persisted parent tool message, including T3 `details.results` messages and all error/metadata fields, and verify once-only usage and terminal liveness. These checks do not claim streaming redaction: original activity and owned-session events precede final-result hooks.

Registered-original eligibility survives deactivation. Reconciliation checks the current source pin, schema identity and active originals independently of active alias hooks. Real SDK regressions disable and re-enable each original, then all originals together, and require alias restoration without reload. Unit regressions also verify restored aliases still run original-name deny hooks.

## Joined usage accounting and collisions

Pinned `src/index.ts:410-417,641-647,2284-2297` gates reporting with `reportUsage` and drains a shared pending pool on registered tool results. `src/usage.ts:94-127` confirms each drain clears the pool. A frontmatter-background receipt can drain before its child produces usage. The terminal wrapper therefore performs one targeted non-verbose, non-waiting read through `ctx.executeTool("get_subagent_result", ...)` after awaiting the owned child. A denied read is returned as an error, not replaced by unguarded output. After cancellation only, the settled accounting read uses a fresh signal but retains the full validation/hooks pipeline. Pi's `nested-tool-calls.js` records nested deltas, and `agent-session.js:696-705` adds them to the outer transcript message. The wrapper omits nested usage from its outer return to avoid a second charge. It never charges `record.lifetimeUsage` or the lifecycle event's cumulative usage, which would double-charge resumed or concurrently reported work. The shared pool may include other children's pending spend, exactly as upstream's original executor does. Those deltas are drained once, not charged to subsequent alias calls.

`visible.test.ts` exercises the exact pinned `PendingUsagePool` source in memory without modifying it, including receipt spend and concurrent unreported spend. The real RPC fixture supplies nonzero child usage and checks the single nested usage-bearing outcome, the outer message's host-recorded usage and `get_session_stats`, followed by result and steering aliases with no repeated charge.

Pi's `dist/core/extensions/runner.js:410-420` uses first-wins registration. The adapter checks its alias schema object identity before changing the active set, hiding originals or copying schemas. SDK integration tests exercise all four collisions against the actual 1.0.2 host. `dist/core/resource-loader.js:578-584,969-986` keeps both extensions and reports a collision diagnostic; the 1.0.3 CLI treats that diagnostic as a startup failure. The RPC collision probe verifies that fail-closed CLI behavior. The adapter does not suppress host diagnostics or promise CLI startup with colliding extensions.

## T3 reference

The reviewed T3 contract is PiAdapterV2 at `0678e4e23d8675ef88f9ac08e1ae90cfe7d6ef2e`. No T3 source was changed. The repository owner has confirmed subagent tool visibility in T3's UI.
