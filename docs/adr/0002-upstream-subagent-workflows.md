# Use upstream subagent workflows and native MCP

## Status

Accepted by the owner. Supersedes ADR 0001.

## Decision

Use the separately installed `@tintinweb/pi-subagents@0.22.0` workflow engine and native MCP initialization. Remove Pi Tooling's duplicate workflow implementation, sandbox, dashboard, source patch, patch command, and legacy patch fixture dependency.

Retain the T3 compatibility adapter and its `subagent_workflow` alias. Keep file search, Firecrawl, user questions, background terminals, and A2A. Retain a model-free native MCP integration test against unmodified upstream.

Upstream owns workflow scheduling, concurrency, notifications, structured results, progress, and same-session replay. The owner accepted its concurrency above the former three-child cap. Do not add a second scheduler or limiter. Standalone A2A child restrictions remain unchanged.

## Migration

Old scripts need migration to upstream's API. Returned agent results are text or schema-validated objects, not the retired `{ ok, output, structured }` envelopes. Runs are background-only and inspected through `/agents` → Workflows. Historical workflow artifacts are not resumable upstream runs.

Enable package workflow discovery while leaving package agents disabled to preserve the curated roster. Workflow-specific agent types must be preflighted before use. This does not grant permission to run every bundled workflow.

## Verification

Run TypeScript checks, the remaining test suite including native MCP, the production install check, and deterministic RPC scenarios. RPC coverage must prove default workflow availability, collision withdrawal, and a completed four-child upstream workflow. Verify the installed package and live configuration without inference or production MCP connections. T3 UI rendering remains a separate manual check.
