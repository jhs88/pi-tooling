---
name: workflows
description: Run explicitly requested multi-agent workflows with the installed subagents plugin. Use for phased pipelines, fan-out, or reusable workflow scripts.
---

# Workflows

Use `subagent_workflow`, the Pi Tooling alias for the separate subagents plugin's `SubagentWorkflow`. If compatibility is disabled, use its advertised original name. Do not use the retired `workflow` tool or `/workflows` command.

Use ordinary `subagent` for one delegation or a few independent tasks. Use a workflow when explicitly requested and useful for stages, runtime-discovered fan-out, structured results, or reusable scripts. Include self-contained child prompts and use the fewest agents needed. The plugin owns scheduling and resource limits; there is no Pi Tooling three-child cap.

Inspect the live tool schema. Supply inline `script`, `scriptPath`, or a saved workflow `name`, plus optional JSON `args`. Scripts start with a literal `export const meta = { name, description, phases }`. The body supports top-level await and return.

- `agent(prompt, { agentType, label, phase, schema, gate, ... })` returns text, or a validated object with `schema`. Terminal failure or an operator skip returns `null`. Check for it before consuming results. Preflight `agentType`; unknown types may fall back to a default.
- `parallel([() => agent(...), ...])` waits for all branches. `pipeline(items, ...stages)` lets independent items advance without a barrier. Use explicit phase options inside parallel stages.
- `phase(title)` and `log(text)` report progress. Return one JSON-shaped result.
- Runs are background-only. The tool returns a task ID; completion arrives through the plugin. Do not poll or sleep waiting for it.
- Inspect or stop runs in `/agents` → Workflows. Save reusable scripts in project `.pi/workflows`, `.agents/workflows`, or the global agent directory's `workflows` folder.
- `resumeFromRunId` replays an unchanged leading sequence within the same session. It does not recover a run after restarting Pi.

Use the installed plugin's `docs/workflows.md` for the current options and recipes. Old Pi Tooling scripts need migration: upstream does not return `{ ok, output, structured }`, accept `parallel` concurrency options, or offer foreground workflow mode. Existing artifacts from the retired engine are historical, not resumable plugin runs.
