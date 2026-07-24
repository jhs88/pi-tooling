# Domain docs

This is a single-context repository.

## Before exploring

Read these when present:

- root `CONTEXT.md`;
- relevant ADRs under `docs/adr/`;
- `AGENTS.md` for verification and tracking rules.

Create ADRs only for durable architectural decisions. Active work state belongs on Hermes Kanban board `pi-tooling`, not in domain docs or tracked `.scratch/` files.

## Layout

```text
/
├── CONTEXT.md
└── docs/
    └── adr/
```

Use the glossary's canonical vocabulary in cards, tests, documentation, and implementation discussions. Surface conflicts with existing ADRs rather than silently overriding them.
