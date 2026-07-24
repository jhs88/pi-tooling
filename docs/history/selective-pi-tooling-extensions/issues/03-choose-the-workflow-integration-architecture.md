# Choose the workflow integration architecture

Type: grilling
Status: resolved
Blocked by: 02

## Question

Given the two tested workflow prototypes, which architecture should become the maintained production workflow extension, and which trade-offs or rejected design should be recorded for future maintainers?

## Decision

Maintain an independent workflow engine under `agent/extensions/pi-tooling/workflows/`. Keep `@tintinweb/pi-subagents` as the separate ad hoc delegation mechanism.

The independent engine is intentionally responsible for strict graph/script execution, sandboxing, structured phase results, run persistence/artifacts, dashboard state, background completion, and a workflow-specific child tool policy. Building those semantics on `@tintinweb` would couple deterministic workflow guarantees to a plugin whose responsibility is interactive/ad hoc Agent delegation, complicate cancellation and persistence ownership, and create a broader recursive-tool surface. The cost is a separate child-session implementation; that duplication is constrained by shared local child-session/activity/timeout helpers and focused tests.
