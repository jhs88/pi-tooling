---
name: workflows
description: Design and run explicit, bounded Pi workflows. Use only when the user explicitly requests a workflow, multi-agent pipeline, phased fan-out, or workflow review. Do not invoke workflows merely because a task is complex.
---

# Workflows

A workflow is an explicit, phased orchestration graph. It coordinates up to three isolated agents and returns one aggregate result.

## Choose the right mechanism

Use the regular `Agent` tool for:

- one bounded delegation;
- exploratory or conversational work;
- tasks without ordered phases;
- work where the parent should steer the child interactively.

Use `workflow` only when the user explicitly asks for a workflow and the task benefits from:

- independent research or review performed in parallel;
- ordered phases such as inspect → implement → verify;
- structured child results consumed by a later step;
- one final synthesis across several bounded tasks.

Never infer workflow permission from task size, keywords, or available context. Do not use workflows recursively.

## Design the graph first

Before writing the script:

1. Define the final result.
2. Declare all phases in `meta.phases`.
3. Assign one clear responsibility to each child.
4. Decide which children are independent and may run in parallel.
5. Use the fewest agents needed; every run is limited to three total child calls and three concurrent children.
6. Add a schema whenever later code must branch on or combine a child result.

Each child prompt must be self-contained. Include the goal, relevant paths or inputs, constraints, expected result, and verification requirements.

## Workflow primitives

A workflow script may use:

- `phase(title)` to advance the progress UI;
- `agent(prompt, options)` to run one isolated child;
- `parallel(thunks, options)` to run independent children concurrently;
- `args` for caller-provided input;
- `return` for the final JSON-serializable result.

Each `agent()` call resolves to:

```text
{ ok, output, structured?, error? }
```

It does not throw for an ordinary child failure. Always check `ok` before using `output` or `structured`.

Use `schema` when results feed another phase. Prefer small, explicit schemas over asking later agents to parse prose.

## Respect the boundary

Workflow orchestration JavaScript runs in a restricted sandbox. It has no imports, filesystem, network, process, timer, or evaluation APIs.

Agents may use their normal permitted tools, project context, skills, and `AGENTS.md`, but workflow children cannot:

- invoke another workflow;
- recursively delegate to subagents;
- ask the user questions;
- manage background terminals.

Keep user interaction and orchestration decisions in the parent session.

## Foreground and background runs

Use foreground mode when the user is waiting for the result or needs visible phase progress.

Use background mode for longer runs where the parent can continue useful work. Pi returns a run ID immediately and delivers one completion message when the workflow settles.

Do not poll repeatedly. Use `/workflows` when current progress is actually needed:

```text
/workflows
/workflows <runId>
```

Run artifacts are stored under:

```text
~/.pi/agent/workflows/<runId>/
```

## Failure handling

- Check every child result.
- Preserve successful results when another child fails.
- Return a clear partial result instead of treating missing output as valid.
- Do not create retry loops inside the workflow.
- Workflows cannot resume; correct the cause and explicitly rerun the workflow when appropriate.
- Report failed agents, available artifacts, and whether the final result is complete or partial.

## Minimal pattern

```javascript
export const meta = {
  name: "bounded-review",
  description: "Review independent areas and synthesize the findings",
  phases: [
    { title: "Review" },
    { title: "Synthesize" },
  ],
};

const FINDINGS = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["issues"],
};

phase("Review");

const reviews = await parallel([
  () => agent("Review area A.", {
    label: "area-a",
    phase: "Review",
    schema: FINDINGS,
  }),
  () => agent("Review area B.", {
    label: "area-b",
    phase: "Review",
    schema: FINDINGS,
  }),
]);

const reviewFailures = reviews.flatMap((result, index) =>
  result.ok
    ? []
    : [{
        agent: index === 0 ? "area-a" : "area-b",
        error: result.error ?? "Unknown child failure",
      }],
);

const findings = reviews
  .filter((result) => result.ok)
  .map((result) => result.structured);

phase("Synthesize");

const report = await agent(
  `Synthesize these findings: ${JSON.stringify(findings)}`,
  {
    label: "report",
    phase: "Synthesize",
  },
);

const failures = report.ok
  ? reviewFailures
  : [
      ...reviewFailures,
      {
        agent: "report",
        error: report.error ?? "Unknown synthesis failure",
      },
    ];

return {
  complete: failures.length === 0,
  findings,
  report: report.ok ? report.output : null,
  failures,
};
```
