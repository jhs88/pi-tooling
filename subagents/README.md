# Default-on subagent compatibility

This layer is enabled by default on supported hosts. Pi and T3 need no opt-in environment variable. Set `PI_TOOLING_SUBAGENTS_COMPAT=0` to disable it and restart Pi after changing the switch. An explicit `1` remains supported; other explicitly set values, including `true` and an empty string, disable it as before. Both alias-name and original-name permission hooks run through Pi's supported tool pipeline. Existing original-name rules still apply; an alias does not bypass an original deny rule.

Supported third-party package: `@tintinweb/pi-subagents@0.19.0`. The real SDK and RPC checks use Pi 1.1.0. The adapters require public `ToolDefinition.prepareLoadout` with registered/callable tool inventories and `ExtensionToolContext.executeTool`. Pi 0.83.0 has only tool metadata in `getAllTools()` and cannot enable these adapters. On an unsupported host, an absent dependency, an unsupported dependency version, or an unavailable original executor, the original tools remain available and the affected aliases are inactive.

| Original tool | Enabled tool | Behavior |
| --- | --- | --- |
| `Agent` | `subagent` | Runs one child and waits until it settles |
| `get_subagent_result` | `subagent_result` | Original status, wait, verbose, ID and handle behavior |
| `steer_subagent` | `subagent_steer` | Original steering behavior |
| `SubagentWorkflow` | `subagent_workflow` | Original background workflow behavior, if enabled upstream |

`subagent_workflow` is optional. Version 0.19.0 includes `SubagentWorkflow`, but `workflowsEnabled: false` in the dependency's `subagents.json` disables it. The adapter does not enable an upstream-disabled workflow or synthesize a substitute. This package's separate `workflow` tool retains its explicit invocation, three-child limit and nonrecursive child policy. The child SDK policy excludes the aliases too.

## Execution contract

The wrappers copy the live original parameter schemas and call originals through `ctx.executeTool(name, args, { signal, onUpdate })`. The returned `AgentToolCallOutcome.result` and `isError` are preserved, including denied, invalid and thrown-tool outcomes that resolve rather than reject. They do not reimplement model selection, agent discovery, resume, worktree isolation, result waiting, steering, usage reporting or workflow execution. Existing argument names remain unchanged. Human-facing schema descriptions use the enabled tool names.

Final `subagent` content and T3 messages come only from the pipeline-returned `Agent` outcome, or from the pipeline-returned `get_subagent_result` outcome after a join. Result hooks own both content and details. The wrapper never restores private record output, error text, or receipt metadata after those hooks. The pinned result reader normally returns identity and status in text rather than details; a joined final therefore does not retain the background receipt's details.

There are two exceptions on the visible `subagent` tool:

- `run_in_background` defaults to `false`. An explicit `true` fails before a child starts.
- A nonempty `schedule` fails before a child starts. Scheduled execution cannot provide a foreground child lifecycle to the current T3 adapter.

The agent file's frontmatter can outrank caller parameters and select background execution. In that case the wrapper joins the exact returned child record, streams that child's session events, suppresses its separate completion notification through the pinned consume channel, and returns its terminal output. It does not return a detached receipt as a completed child. After settlement, a targeted read of `get_subagent_result` through the same public pipeline drains completed pending usage under the upstream reporting setting. A denied result read returns the denied outcome, not an unguarded result or private usage drain. This non-waiting read uses a fresh signal after child cancellation so completed accounting can settle, but still runs every validation and permission hook. Pi records nested usage on the outer transcript message. The wrapper omits duplicate usage from its outer return, so receipt and result-read deltas are counted once by the host. As upstream uses a shared pending pool, that delta can include other children's unreported spend; subsequent alias reads do not charge it again. Cancellation stops that child only. The pinned manager marks a stopped record immediately, so the wrapper also awaits that child's run promise before ending the call. Bus and child-session subscriptions are released on success, failure and cancellation. It never calls `abortAll()`, `waitForAll()` or enumerates unrelated agents.

Original tools stay active and callable. `prepareLoadout.hiddenDeclarations` hides only their declarations from parent provider requests when replacements have callable originals, matching pinned-package metadata, and active originals to wrap. An unrelated first-wins alias is left untouched and its original remains active. SDK tests cover this collision case; the real CLI instead refuses collision diagnostics before starting RPC. The adapter does not suppress that startup failure. Registration and session hooks work in either extension load order. Reload builds new wrappers and resolves current originals. Alias hooks run first; allowed aliases then invoke original-name hooks with the original arguments and a nested call ID. This applies to result, steering, workflow and joined usage reads too. If an original is disabled, its alias is withdrawn. A missing nested execution context fails closed, withdraws owned aliases and restores original declarations, with no raw-executor fallback. See `PROVENANCE.md` for source evidence and real deny-rule assertions.

Eligibility uses registered originals independently of their active state. Disabling an original withdraws its alias. Re-enabling it restores the alias at the next agent start without reload, including when every alias was withdrawn. Current pinned-source metadata, original-schema identity, alias ownership and result-reader availability are still required.

## T3 contract and limits

T3's PiAdapterV2 at source commit `0678e4e23d8675ef88f9ac08e1ae90cfe7d6ef2e` recognizes the exact tool name `subagent`. Pi forwards `onUpdate` as `tool_execution_update.partialResult` and the returned value as `tool_execution_end.result`.

The supported forwarding path emits an additional nested original `tool_call`, `tool_result` and `tool_execution_*` lifecycle with `parentToolCallId`. There is still one actual child spawn. T3 recognizes only exact `toolName: "subagent"` as a child card; the inner `Agent` is an ordinary dynamic tool, not a second child card. Foreground calls have one nested original call, and a frontmatter-background join adds at most one targeted result read. Pi stores a bounded `nestedCalls` record on the outer result rather than separate nested transcript messages. This extra event lifecycle is an accepted tradeoff for preserving authorization.

The wrapper supplies `details.results` with a stable one-child order and `step: 0`. Entries carry `agent`, `task`, `model`, normalized assistant-text `messages`, `finished`, terminal `exitCode` and `stopReason`, `errorMessage`, and `stderr`. Foreground progress comes from the original tool's live activity. Joined-background and resumed-child progress comes from that exact child's session events. Final messages come from the real upstream output or targeted child result, not a fabricated transcript. A pre-spawn rejection has no fabricated child result. Child failures and cancellation return unsuccessful terminal entries.

This is foreground progress compatibility, not full child-thread integration. It does not create independent T3 child threads, provide detached-child UX, or render workflow children as T3 subagent cards. T3 itself truncates progress to 200 characters and final text to 10,000 characters. The wrapper retains pipeline-returned content, and Pi records nested usage on the outer transcript message. Its normalized `messages` are text observations, not a complete child conversation. Use `subagent_result` with `verbose: true` for the original conversation.

Final-result redaction is not streaming redaction. Pi emits original activity updates before `tool_result` hooks run. Joined and resumed progress also uses the owned child's session events. Permission hooks still gate original execution and the joined result read, but a result-read denial or final redaction cannot retract earlier live activity. Do not use this progress layer as a streaming confidentiality boundary.

The dependency's cross-extension RPC is an in-process `pi.events` bus, not Pi's stdin/stdout RPC protocol. Its spawn API strips internal fields, overwrites activity callbacks, and cannot express the complete original tool contract. The adapters therefore use Pi's supported `ctx.executeTool` API, not the bus spawn API or raw executors. The bus is used only for targeted stop and consumption; the pinned manager registry supplies targeted records. A broken consume listener can prevent notification suppression, but cannot skip targeted abort or subscription cleanup.

## Test on the work computer

Use a reviewed local source artifact before changing the managed Git installation. Do not install both copies into the same active Pi configuration.

1. Extract the reviewed source artifact into a development directory. It must include the new `subagents/` directory and the modified package entry point. Run `npm ci` and `npm run verify` there.
2. Use an isolated test agent directory and a test working directory that does not inherit another active pi-tooling package entry. Install the exact pinned subagents package and a locally packed pi-tooling artifact there. The package source does not patch the installed subagents files.

   ```bash
   # Run in the reviewed local pi-tooling checkout.
   PACKED_TARBALL=$(npm pack --ignore-scripts --pack-destination "$TEST_ARTIFACT_DIR" --silent)
   export PI_CODING_AGENT_DIR="$TEST_AGENT_DIR"
   pi install npm:@tintinweb/pi-subagents@0.19.0
   pi install "npm:$TEST_ARTIFACT_DIR/$PACKED_TARBALL"
   ```

   The filename follows the artifact's package version; use the actual filename printed by `npm pack`, especially after rebasing onto a newer package version. Configure provider authentication through Pi's login UI in the test configuration if needed. Do not copy credentials into an artifact or commit them.

3. Start the test Pi or T3 backend with `PI_TOOLING_SUBAGENTS_COMPAT` unset. The installed adapter enables itself when the supported original tools are available. No launcher or backend environment change is required.

4. Load the prepared local skills containing the new tool references only after confirming the aliases in this test configuration. Do not activate those skill edits globally until the adapter is verified. No naming-migration section is needed in `APPEND_SYSTEM.md` or other model instructions.
5. Confirm active/callable inventories contain aliases and originals. Confirm the actual parent provider declarations contain `subagent`, `subagent_result`, and `subagent_steer`, not the hidden originals. An active-tool listing alone does not prove declaration hiding. Confirm optional `subagent_workflow` is declared only when the upstream workflow is enabled, and the separate `workflow` still appears. Install a test deny hook for `Agent` and another for `subagent` in separate runs. Each must reject before a child starts.
6. In T3, request one bounded child task with `subagent`, foreground mode, and a read-only agent. Check live text updates, one stable child card, the real final result, and failure/cancellation behavior. A background request must fail before spawning anything. Then check `/reload` or a process restart and repeat tool discovery.

Do not merge or release on the strength of the fixture smoke alone. Actual T3 rendering and real provider behavior still need the work-computer check.

## Roll back

Set `PI_TOOLING_SUBAGENTS_COMPAT=0` and restart the Pi process and T3 backend. In PowerShell, use `$env:PI_TOOLING_SUBAGENTS_COMPAT = "0"`. Unsetting the variable enables the adapter again on supported hosts. Remove the local test artifact from the test configuration with `pi remove` using the same source passed to `pi install`, or discard the isolated test configuration. Restore the original tool references in the test skills when returning to the original tools. The separate pinned subagents package was never edited, so no dependency patch rollback is needed.

## Model-free verification

The smoke uses the real installed Pi CLI, its real JSONL RPC loop, and the real pinned subagents extension and manager. The fixture provider emits fixed tool calls and streamed text without HTTP, credentials or model inference. It is not evidence of model quality or T3 rendering. Four result-transform lanes redact `Agent` and joined `get_subagent_result`, for successful and failed children. They verify the hook received a `SECRET` marker, final tool content and all details contain no marker, T3 final messages contain `[REDACTED]`, usage is charged once, and the child is terminal. SDK regressions also disable and re-enable all four aliases individually and together without reload.

Install the pinned dependency into a disposable scratch directory, not the generated live package installation, then run:

```bash
npm install --prefix "$SCRATCH/subagents-fixture" --ignore-scripts --no-audit --no-fund @tintinweb/pi-subagents@0.19.0
node subagents/rpc-smoke.mjs \
  --package-dir="$SCRATCH/subagents-fixture/node_modules/@tintinweb/pi-subagents" \
  --artifact-dir="$SCRATCH/subagents-rpc-evidence"
```

Optional arguments are `--pi=/path/to/pi` and `--extension=/path/to/local-or-installed/pi-tooling/index.ts`. The smoke writes isolated settings, sessions and evidence only below its artifact directory. It leaves JSONL and stderr logs for review. Never pass a live agent directory as the artifact directory.

Checks cover originals under explicit opt-out, default-on aliases with no environment switch, the retained explicit `1`, reversed load order, optional workflow absence/presence, actual result and steering executors, a no-child workflow, real `/reload`, joined agent-frontmatter background mode, cancellation, child failure, explicit background rejection, nonzero usage reported once in actual session stats, original-name and alias-name deny assertions with zero child starts, a denied joined result-read assertion, bounded nested original events carrying `parentToolCallId`, hidden provider declarations versus active inventory, fail-closed CLI collision startup, terminal liveness, and T3-compatible update/end fields. Unit and SDK tests under `subagents/*.test.ts` cover failure cleanup, schemas and argument forwarding, availability, session shutdown and child exclusion. The real Pi 1.1.0 SDK tests load the exact pinned extension and deterministic provider, execute a normal child, and separately deny `Agent` and `subagent` with zero child starts. They also verify the host's bounded nested-call record and single usage charge. No fixture backend is registered by the production extension.
