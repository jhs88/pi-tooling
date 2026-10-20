# Pi Tooling

This repository owns the managed Pi package installed from `git:github.com/jhs88/pi-tooling`. It packages selected file-search, Firecrawl, interaction, background-process, A2A, and subagent compatibility capabilities with reproducible runtime dependencies.

## Language

**Managed package**:
A Git or npm package installed and updated through Pi's package manager. Pi owns its checkout and production dependency lifecycle.
_Avoid_: copied extension, vendored config extension

**Development checkout**:
The editable Git working tree used for development and verification.
_Avoid_: managed installation

**Managed installation**:
Pi's generated package checkout, typically stored below its agent package directory.
_Avoid_: source repository

**Extension**:
A Pi capability packaged as code and loaded into the interactive agent runtime.
_Avoid_: plugin, add-on

**Ad hoc delegation**:
A directly requested, role-based child-agent run used for a bounded task without a multi-phase graph.
_Avoid_: workflow

**Workflow**:
An explicitly requested, phased orchestration graph that can fan work out and combine structured results.
_Avoid_: automatic delegation, ultracode

**Workflow child**:
A child created by the separately installed subagents plugin. Its lifecycle, tools, and scheduling follow that plugin and the selected agent definition.
_Avoid_: nested orchestrator

## Invariants

- Third-party runtime modules belong in `dependencies`; Pi host APIs belong in `peerDependencies`.
- Firecrawl requires an explicit self-hosted HTTP(S) endpoint and never falls back to Firecrawl Cloud.
- Workflows and native MCP child initialization belong to the separate subagents plugin. Do not maintain a second workflow engine, resource cap, or source patch here.
- Standalone A2A children retain their independent tool policy; workflow ownership does not remove those restrictions.
- Background terminals are non-interactive, session-owned, output-bounded, redacted, and process-tree terminated.
- `@tintinweb/pi-subagents` remains a separate managed Pi package; this package supplements rather than replaces it.
- Hermes Kanban board `pi-tooling` owns active planning and task state. `docs/history/` is evidence, not an active tracker.
