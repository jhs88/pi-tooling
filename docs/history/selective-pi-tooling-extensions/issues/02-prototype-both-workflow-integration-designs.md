# Prototype both workflow integration designs

Type: prototype
Status: resolved
Blocked by: 10

## Question

How do two rough implementations compare in behavior, safety, complexity, observability, and compatibility: (A) Ben's independent in-process workflow child sessions adapted to our recursion guards and three-agent cap, and (B) a workflow DSL/runner adapted over `@tintinweb/pi-subagents`?

The prototype must not modify production extension loading. It should leave disposable artifacts and focused test results for human comparison.

## Result

Chose the independent in-process child-session engine. `@tintinweb/pi-subagents` remains unchanged for ad hoc `Agent` delegation; adapting it into the workflow runner would combine two responsibilities and make strict workflow graph execution, artifact persistence, dashboard state, sandbox IPC, and the workflow-specific child policy depend on another plugin's lifecycle and result contract. The independent engine owns those guarantees behind the single explicit `workflow` tool while sharing only the local child-session/timeout helpers.

The selected engine was adapted from the owner-authorized pinned source and tested directly at its safety seams: three-child total/concurrency limits, sandbox request budget, recursion denylist, bounded background deadline, structured output/transcript bounds, and Pi 0.80.10 `ModelRuntime` session construction.
