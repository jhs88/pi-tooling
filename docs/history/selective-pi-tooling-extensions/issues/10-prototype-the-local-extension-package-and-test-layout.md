# Prototype the local extension package and test layout

Type: prototype
Status: resolved
Blocked by: 09

## Question

Which local layout gives `agent/extensions` reliable access to pinned npm dependencies and a reproducible test/typecheck workflow without coupling production configuration to generated `node_modules`: a shared package root adjacent to the extensions, per-extension packages, or another minimal arrangement supported by Pi 0.80.10?

The prototype must remain disposable and must not launch the Pi client.

## Answer

Use a single self-contained package at `agent/extensions/pi-tooling/` with one `package.json`, tracked `package-lock.json`, `tsconfig.json`, `index.ts` composition root, tool subdirectories, and tests. Pi 0.80.10 successfully loaded both per-extension and shared-wrapper packages, but the shared wrapper gives this selected suite one pinned dependency closure and one `npm run verify`; dependencies installed only under sibling `agent/npm/node_modules` failed resolution as expected. Ignore the package's generated `node_modules`, keep `agent/npm` unchanged, and perform loader-only verification before any live Pi smoke test.

Prototype and exact verification output: [Local extension package and test layout prototype](../prototypes/local-extension-package-layout.md).
