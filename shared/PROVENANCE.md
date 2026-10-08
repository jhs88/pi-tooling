# Provenance

These shared child-session helpers were selectively copied and adapted at the repository owner's explicit direction from `davis7dotsh/my-pi-setup` commit `797eaf6d6f178759cf7aabde927ef15c91346e7e` (2026-07-24).

Adapted files: `activity-status.ts`, `child-session.ts`, `context-utilization.ts`, `tool-call-timeout.ts`, and their focused tests. Local changes add the complete Pi tooling recursion/background denylist and construct Pi 0.83.0's canonical `ModelRuntime` instead of passing the obsolete `modelRegistry` session option.

`terminal-text.ts` centralizes the terminal-control sanitizer previously maintained in `background-terminals/src/ui/output-view.ts`. Its application to workflow and `ask_user` rendering is local hardening informed by the selective review of upstream commit `73bf4d826f39b5cab6b7865e706ba4a2669629ca` (2026-08-05); no upstream dashboard or interaction extension was imported wholesale.

The pinned upstream repository had no detected license. This is owner-directed adaptation, not a claim that the source is open source or generally licensed for reuse. See `docs/history/selective-pi-tooling-extensions/research/upstream-compatibility-and-provenance.md`.
