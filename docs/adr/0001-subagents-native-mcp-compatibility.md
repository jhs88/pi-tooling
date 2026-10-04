# Explicit native MCP compatibility for subagents

## Status

Accepted for `@tintinweb/pi-subagents` 0.19.0 with Pi 0.99.1.

## Context

Pi's CLI initializes native MCP extensions, but SDK sessions must provide their factories. The separately managed subagents package creates its own resource loader without those factories. Changes to pi-tooling's workflow child helper cannot change that third-party loader.

A manually edited installed package is not reproducible and package reconciliation can replace the edits. Maintaining a full fork would add unnecessary release and merge work for this small compatibility gap.

## Decision

Keep a versioned, source-hash-checked compatibility patch and an explicitly invoked application command in pi-tooling. Pin the separately managed subagents release and the development-only test fixture. Register native factories as built-ins so isolation, settings exclusions, and extension selectors retain their meaning. Preserve native non-direct exposure and authorized search activation during child tool scoping. Enforce selectors through native tool-call permission events as well as the third-party outer call guard, so nested codemode calls cannot bypass scope.

Verify both patch-command behavior and a real third-party SDK child's ability to use a local MCP tool without a model request. Package or source drift causes rejection before writes. No install or session-start hook changes the third-party package silently.

## Consequences

The workaround is reviewable and repeatable without owning a fork. A reinstall can still replace it, so checking and reapplication remain explicit maintenance steps. Each new upstream release needs review and verification before the version and hashes change. Remove the workaround when a verified upstream release supports native MCP initialization.

Existing A2A isolation and pi-tooling workflow behavior are unchanged. The third-party package remains a separate managed package rather than a runtime dependency of pi-tooling.
