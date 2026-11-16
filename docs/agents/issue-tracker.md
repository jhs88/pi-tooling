# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `jhs88/pi-tooling`. Use the `gh` CLI from this checkout.

## Conventions

- Before creating issues, verify the target with `gh repo view --json nameWithOwner`.
- Create an issue with `gh issue create --repo jhs88/pi-tooling --title "<title>" --body-file <file>`.
- Read an issue with `gh issue view <number> --json number,title,body,labels,comments`.
- List issues with `gh issue list --state open --json number,title,labels,assignees`. Add `--label` to filter by role.
- Comment with `gh issue comment <number> --body-file <file>`.
- Apply or remove labels with `gh issue edit <number> --add-label "<label>"` or `--remove-label "<label>"`. Use [the triage labels](triage-labels.md).
- To close an issue, post the explanation first, then run `gh issue close <number>`.

Use files with actual newlines for multiline issue bodies and comments. Keep task status and implementation checklists in issues; use [ADRs](../adr/README.md) for durable architectural decisions.

## Parent tickets and blockers

Use GitHub sub-issues for parent-child relationships and native issue dependencies for blockers. Read the installed CLI's help for supported commands. When those features are unavailable, put `Part of #<parent>` and `Blocked by: #<number>` at the top of the child body, and link children in the parent's task list. A ticket is ready only when all its blockers are closed.

For `/wayfinder`, keep one map issue labelled `wayfinder:map` with Notes, Decisions-so-far, and Fog sections. Link child issues to the map and use `wayfinder:<type>` labels for `research`, `prototype`, `grilling`, or `task`. Claim work by assigning yourself. Choose the first unassigned, unblocked child in map order. On completion, comment, close the child, and add the result and issue link to the map's Decisions-so-far.

## Pull requests as a triage surface

**PRs as a request surface: no.**

Triage issues by default. Change this flag to `yes` if external pull requests should enter the same triage queue.

## Skill instructions

When a skill says "publish to the issue tracker", create a GitHub issue. When it says "fetch the relevant ticket", read the GitHub issue.
