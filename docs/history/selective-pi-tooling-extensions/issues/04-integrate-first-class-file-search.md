# Integrate first-class file search

Type: task
Status: resolved
Blocked by: 10

## Question

Implement and verify locally maintained first-class `fd` and `rg` tools using system binaries first and checksum-verified official fallbacks, with bounded model output, cancellation, useful errors, and no unrelated configuration changes.

## Answer

Implemented typed `fd` and `rg` tools in the shared package. Resolution prefers system binaries and falls back only to checksum-pinned official HTTPS assets. Arguments use option separators, paths are normalized, cancellation is propagated, and oversized results are bounded for the model with full output persisted to a temporary artifact.
