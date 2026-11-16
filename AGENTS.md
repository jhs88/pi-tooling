# Agent guidance

## Scope

This repository is the canonical source for the managed `jhs88/pi-tooling` Pi package.

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
- Keep background terminals non-interactive, session-owned, output-bounded, redacted, and process-tree terminated.
- Keep `@tintinweb/pi-subagents` a separate managed Pi package. It owns workflow scheduling and native MCP child initialization; do not add a second engine, resource cap, or source patch here.
- Preserve standalone A2A child tool restrictions independently of workflow ownership.
- In verified T3 sessions, use T3-owned delegation and task/thread controls so children are openable. Hide and block private Pi orchestration there. Standalone Pi retains the upstream engine. See [ADR 0003](docs/adr/0003-t3-native-delegation.md).

## Agent skills

### Issue tracker

Track issues and specs in GitHub Issues for `jhs88/pi-tooling`. Before reading, creating, or updating tickets, read [the issue tracker guide](docs/agents/issue-tracker.md).

### Triage labels

Use the five default triage labels. Before triaging tickets, read [the label mapping](docs/agents/triage-labels.md).

### Domain docs

Use a single root [glossary](GLOSSARY.md) and [ADRs](docs/adr/README.md). Before architecture, debugging, or implementation work, read [the domain guide](docs/agents/domain.md).
