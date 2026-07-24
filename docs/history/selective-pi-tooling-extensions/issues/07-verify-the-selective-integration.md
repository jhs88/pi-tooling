# Verify the selective integration

Type: task
Status: resolved
Blocked by: 04, 05, 06, 12, 13

## Question

Run the complete static and unit-test verification matrix, prove existing settings and subagent behavior were not unintentionally changed, inspect the final diff for secrets or generated artifacts, commit only effort-related files, push `feat/pi-tooling-extensions`, and produce a concise human smoke-test checklist. Do not launch Pi or local inference.

## Answer

Verified a clean `npm ci`, TypeScript no-emit compilation, 70 focused tests, and Pi 0.80.10's real extension loader registering all 11 tools plus `/ps` and `/workflows`. The final source scan found no committed credentials; matches were explicit test fixtures. `agent/settings.json`, `agent/models-store.json`, and `backups/` remain local and uncommitted. Pi and local inference were not launched. The branch was pushed to `origin/feat/pi-tooling-extensions`, and the owner smoke-test checklist is `docs/pi-tooling-smoke-test.md`.
