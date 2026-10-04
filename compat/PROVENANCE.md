# Provenance

The patch targets the MIT-licensed [`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) npm release 0.19.0. The package remains separately installed and managed by Pi. The pinned development dependency supplies the unmodified release for tests; no full third-party application is copied into this repository.

Reviewed runner: `src/agent-runner.ts`, SHA-256 `88e61481fd627254ff3ac0a27e1991136c41e103fac847dd06444c8ac3d3eab1`.

The versioned specification contains short source-match fragments and replacements for SDK native factory registration and tool exposure handling. It also corrects host-package peer declarations in the upstream manifest. Original and resulting source hashes, plus semantic manifest hashes, are checked before application.

Factory registration follows the installed Pi 0.99.1 SDK documentation and `examples/sdk/14-codemode-mcp.ts`. This repository's implementation and tests retain the project's existing licensing and attribution policy. Updating this patch requires reviewing a new upstream release rather than accepting approximate source matches.
