# Establish Ask User and background-terminal compatibility

Type: research
Status: resolved
Blocked by: 01

## Question

What Pi 0.80.10 API, packaging, process-lifecycle, security, output-bounding, notification, and existing-extension compatibility constraints govern replacing our `questionnaire` with a focused `ask_user` tool and adding session-scoped background terminals?

Compare against the existing `agent/extensions/questionnaire.ts`, `notify.ts`, shell override, and installed extension environment. Do not copy unlicensed Ben Davis source.

## Context

Research output: [Ask User and background-terminal compatibility](../research/ask-user-and-background-terminal-compatibility.md)

## Answer

Both designs are compatible with the public Pi/TUI 0.80.10 surface. [Resolve the upstream source licensing strategy](09-resolve-the-upstream-source-licensing-strategy.md) records the owner's later direction to copy and adapt the selected upstream source, so implementation should preserve provenance while applying the compatibility and hardening changes below. `ask_user` deliberately narrows the current questionnaire contract. A repository-wide search found no `questionnaire` callers outside the extension itself, and the user chose direct replacement; implementation should therefore add `ask_user` and delete `questionnaire.ts` in the same change with no shim. Background terminals require explicit shell selection, no stdin, bounded memory and quota-bounded private spill storage, stale-log cleanup, process-tree termination, best-effort completion follow-ups, deterministic normal shutdown, and honest crash/Windows limitations. Workflow and in-process child registries must exclude `ask_user`, all four `bg_*` tools, and recursive orchestrators.

Full evidence, risks, and the verification matrix are in [Ask User and background-terminal compatibility](../research/ask-user-and-background-terminal-compatibility.md).
