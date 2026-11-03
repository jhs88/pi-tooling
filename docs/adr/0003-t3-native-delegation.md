# ADR 0003: Use T3-owned delegation for openable child conversations

Status: accepted

## Context

T3's Pi adapter recognizes `subagent` progress, but both the original reviewed adapter and T3 stable v0.1.6 emit `childThreadId: null` for those observations. Formatting a Pi child result cannot create a T3 thread. T3 already injects native delegation and task/thread tools into Pi through its session-authenticated bridge.

## Decision

When the three direct native delegation tools are callable and their provenance matches `T3_PI_MCP_EXTENSION_PATH`, prefer that existing interface. Hide the reviewed private Pi orchestration tools and owned aliases from model declarations, block stale calls with native-tool guidance, and leave native T3 calls to the bridge and its permission hooks.

Do not wrap native delegation, create another MCP client, manufacture thread IDs, duplicate progress cards, translate Pi agent policies into prose, or reimplement T3 task/result/cancellation handling. Native tools own their identity, bounded waits, pending approvals, and `next` instructions.

Standalone Pi retains the upstream subagents engine and compatibility aliases. Review and accept 0.23.0 alongside 0.22.0 rather than admitting untested future versions. Pi 1.5.0 is the development baseline; host packages remain peers. The existing compatibility opt-out also disables native preference.

## Consequences

New T3-owned children have openable conversations without changing T3 source. Existing private Pi children cannot be adopted. Pi-specific agent definitions, tool restrictions, memory, and workflow scripts require standalone Pi rather than silent loss of policy. This refines ADR 0002 only for verified T3 sessions; it does not introduce a second workflow engine.

## Evidence

Source contract: T3 stable v0.1.6, commit `2359643cffa6ba9ee84d6f2694b935de54a8013e`, `packages/provider-pi/src/server/{adapter,mcpExtensionSource}.ts` and `apps/web/src/components/chat/V2LifecycleRow.tsx`.

Tests cover reviewed-version eligibility, bridge provenance and availability, provider declarations, native permission denials, and rejection of stale private-tool calls. The unmodified v0.1.6 Linux release was exercised in an isolated data directory with Pi 1.5.0 and a deterministic provider. A running child and a completed child opened their actual T3 conversations, and the child conversation survived reload. This proves the native route, not a migration of old Pi children or execution of Pi workflow scripts.
