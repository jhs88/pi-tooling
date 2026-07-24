# Establish upstream compatibility and provenance

Type: research
Status: resolved
Blocked by:

## Question

What licensing, attribution, source files, dependencies, Pi API assumptions, and version-compatibility constraints govern adapting Ben Davis's current `file-search`, `firecrawl-search`, shared child-session support, and `workflows` extensions into this repository's Pi 0.80.10-era configuration?

## Context

Research output: [Upstream compatibility and provenance](../research/upstream-compatibility-and-provenance.md)

## Answer

The pinned Ben Davis repository contains no explicit license; [Resolve the upstream source licensing strategy](09-resolve-the-upstream-source-licensing-strategy.md) records the repository owner's later explicit direction to copy and adapt the selected source with provenance. Pi 0.80.10 retains the needed extension APIs but replaces the workflow runner's `modelRegistry` session option with `modelRuntime`. Firecrawl 4.30 supports explicit self-hosted `apiUrl` and optional keys. Ben's current `fd`/`rg` downloads already verify embedded SHA-256 values. Workflow children must additionally deny our `Agent`, `get_subagent_result`, and `steer_subagent` tools. The local dependency/test layout also requires a prototype before production integration.

Full evidence and pinned primary-source citations are in [Upstream compatibility and provenance](../research/upstream-compatibility-and-provenance.md).
