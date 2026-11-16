# Agent guidance

## Scope

This repository is the canonical source for the managed `jhs88/pi-tooling` Pi package. Read `CONTEXT.md` before architecture, debugging, or implementation work.

Do not edit Pi's generated package checkout. Edit this repository, verify it, and let Pi update the managed installation.

## Verification

For source changes, run:

```bash
npm ci
npm run verify
```

For packaging changes, also verify the production dependency shape:

```bash
npm ci --omit=dev --ignore-scripts
test -f node_modules/@effect/platform-node/package.json
```

A real package-lifecycle change must be exercised through an isolated `pi install` or `pi update --extensions`, not only through a development checkout.

## Change policy

- Preserve the explicit self-hosted-only Firecrawl policy.
- Keep workflow invocation explicit and bounded; do not enable recursive orchestration.
- Keep Pi host packages in peer dependencies and third-party runtime modules in dependencies.
- Keep upstream source attribution and license notices in the root README when adapting code.
- Do not commit, push, open pull requests, merge, or release without explicit user direction.

## Project management

Hermes Kanban board `pi-tooling` is the active tracker and audit trail. Do not create tracked `.scratch/` issue trees. Historical local-Markdown planning artifacts are read-only under `docs/history/`.

Kanban and Pi are development coordination tools, not runtime components of this package.

For board commands, routing, and triage states, read [the tracker guide](docs/agents/issue-tracker.md) before creating or updating cards.

## Domain docs

Use the vocabulary in `CONTEXT.md`. Read relevant [ADRs](docs/adr/README.md) before architectural changes and surface conflicts with existing decisions. Create ADRs for durable decisions; keep task state on Kanban.
