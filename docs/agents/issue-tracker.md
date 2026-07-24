# Issue tracker: Hermes Kanban

This project uses Hermes Kanban board `pi-tooling` as its primary issue and work tracker.

GitHub Issues and tracked `.scratch/` Markdown are not the default management lanes. Use GitHub only when the user explicitly requests an issue, pull request, release, or other remote workflow. Historical local-Markdown planning artifacts are preserved under `docs/history/` and must not be treated as live tickets.

## Board

- **Board slug:** `pi-tooling`
- **Default work directory:** the local `pi-tooling` checkout
- **Inspect:** `hermes kanban --board pi-tooling stats`
- **List:** `hermes kanban --board pi-tooling list`
- **Set the checkout:** `hermes kanban boards set-default-workdir pi-tooling "$PWD"`
- **Create:** `hermes kanban --board pi-tooling create "<title>" --body "<acceptance criteria>" --workspace "dir:$PWD"`

Use idempotency keys for automation-created cards. Link real parent task IDs when work is genuinely dependent; do not infer dependencies from wording alone.

## Routing

Only configured profiles may be assigned. Check `hermes profile list` before creating cards and route work by capability:

- use the primary/orchestrator profile for planning, integration, verification, and final decisions;
- use a Pi-backed profile for bounded implementation or review only when the card explicitly names the workspace, allowed command scope, acceptance criteria, and no-release rules;
- use alternate coding profiles only when they are configured and explicitly appropriate for the task.

Do not invent profile names or assume that another installation has the same profile roster.

## Human and release gates

Cards that require a user decision, commit, push, merge, or release must block with a precise reason. Agents may prepare and verify changes but must not perform those actions without explicit user direction.

Kanban and Pi coordinate development; they are not runtime stages in the package.
