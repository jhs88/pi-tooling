# Replace Questionnaire with focused Ask User

Type: task
Status: resolved
Blocked by: 10, 11

## Question

Implement and verify the adapted upstream `ask_user` tool following the map's single-question contract, then delete `agent/extensions/questionnaire.ts` in the same change. A repository-wide search found no callers outside the existing extension itself, so do not retain a compatibility alias, dual registration, batch IDs, opaque option values, or `allowOther: false`. Preserve Dracula-compatible styling, distinguish dismissal from tool abort, guard custom UI with `ctx.mode === "tui"`, and produce clear fallbacks/results in non-TUI modes.

## Answer

Implemented `ask_user` under the shared `pi-tooling` package with one question, 2–5 labelled options, an always-present custom-answer editor, explicit dismissal/abort/non-TUI outcomes, and Pi/TUI 0.80.10 theme APIs. Deleted `agent/extensions/questionnaire.ts`; no alias or compatibility registration remains. Provenance is recorded beside the module.
