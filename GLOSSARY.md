# Pi Tooling

Pi Tooling is a managed Pi package for file search, self-hosted web research, user questions, background processes, A2A, and subagent compatibility.

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
