# Selective Pi Tooling Extensions

## Destination

Produce a tested `feat/pi-tooling-extensions` branch that adds first-class `fd`/`rg`, self-hosted Firecrawl, explicit workflows, a focused `ask_user` replacement for the current questionnaire, and session-scoped background terminals while retaining the existing `@tintinweb/pi-subagents` system and all established routing conventions.

## Notes

- This effort explicitly carries execution through the map; task tickets may implement the destination.
- Copy and adapt only the selected extensions from pinned upstream snapshot `davis7dotsh/my-pi-setup@797eaf6d6f178759cf7aabde927ef15c91346e7e`; preserve the README credit/source link and document material local compatibility or security changes.
- Upstream synchronization is manual and selective rather than a wholesale config sync.
- Firecrawl requires an explicit self-hosted endpoint, supports an optional key, and must never silently fall back to cloud.
- Read Firecrawl configuration from process environment, then ignored `agent/.env` fallback.
- `fd`/`rg` prefer system binaries and may use only checksum-verified official fallback binaries.
- Prototype both workflow designs before choosing: an independent in-process workflow engine versus an adapter over `@tintinweb/pi-subagents`.
- Workflows run only after an explicit workflow request; remove the `ultracode` trigger and prohibit automatic fan-out.
- Preserve the shared local-inference limit of at most three agents concurrently; pause rather than overload or silently reroute.
- Replace the existing multi-question `questionnaire` directly with focused `ask_user`: one question, 2–5 model-provided options, an always-present custom-answer path, explicit dismissal behavior, and no compatibility alias or dual registration.
- Add session-scoped background terminals for long builds, servers, and watchers: no stdin, bounded/tail-truncated model output, quota-bounded private spill logs with stale cleanup, process-tree termination, best-effort completion follow-ups, and an honest retained-tail `/ps` viewer.
- Do not replace existing subagent routing, aliases, agents, prompts, notifications, or Dracula theme.
- Commit and push `feat/pi-tooling-extensions` after implementation; the repository owner explicitly authorized this branch delivery.
- Static checks and unit tests may run, but do not launch the Pi client or local inference; the owner will perform the live smoke test after pulling the branch.
- Consult `research`, `prototype`, `domain-modeling`, and `test-driven-development` skills as each ticket requires.

## Decisions so far

- [Establish upstream compatibility and provenance](issues/01-establish-upstream-compatibility-and-provenance.md) — Research found no upstream license and pinned the Pi 0.80.10, Firecrawl, binary-integrity, recursion-guard, and package-layout seams; the later source-strategy decision controls copying.
- [Resolve the upstream source licensing strategy](issues/09-resolve-the-upstream-source-licensing-strategy.md) — Per explicit owner direction, selectively copy/adapt the pinned GitHub source with README provenance and documented local changes.
- [Establish Ask User and background-terminal compatibility](issues/11-establish-ask-user-and-background-terminal-compatibility.md) — Both designs fit Pi 0.80.10; hardened terminal lifecycle, logging, delivery, and child-tool policies are required when adapting upstream.
- [Choose the questionnaire replacement policy](issues/14-choose-the-questionnaire-replacement-policy.md) — `ask_user` replaces and removes `questionnaire` directly; no callers, alias, shim, or dual registration need preserving.
- [Prototype the local extension package and test layout](issues/10-prototype-the-local-extension-package-and-test-layout.md) — Put the selected tools in one self-contained `agent/extensions/pi-tooling/` package with a tracked lockfile and one verify command; sibling `agent/npm/node_modules` does not resolve local extension dependencies.
- [Choose the workflow integration architecture](issues/03-choose-the-workflow-integration-architecture.md) — Use the independent in-process workflow engine because it can enforce explicit invocation, a hard three-child budget, artifacts, cancellation, model-runtime integration, and the complete recursive-tool denylist while preserving `@tintinweb/pi-subagents` for ordinary delegation.
- [Verify the selective integration](issues/07-verify-the-selective-integration.md) — Clean install, TypeScript, 70 focused tests, and the Pi 0.80.10 extension loader passed without launching Pi or inference; the feature branch was pushed for owner testing.

## Not yet specified

- Live TUI, provider, Firecrawl-server, and Windows behavior remains for the repository owner to smoke-test from the pushed branch.

## Out of scope

- Replacing `@tintinweb/pi-subagents` without prototype evidence and an explicit later decision.
- Importing Ben Davis's complete Pi configuration, themes, model aliases, or unrelated extensions.
- Changing Pi/OpenCode provider definitions or model aliases.
- Opening a pull request; deliver the requested pushed feature branch directly.
