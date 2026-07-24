# Local extension package and test layout prototype

Date: 2026-07-24
Pi: `@earendil-works/pi-coding-agent` 0.80.10
Node: 22.23.1
Disposable artifact: `<prototype-workdir>`

## Question

Which layout gives `agent/extensions` reliable access to pinned npm dependencies and one reproducible typecheck/test workflow without relying on generated `node_modules` outside the extension package?

## Candidates exercised

The prototype loaded extension factories through Pi 0.80.10's exported `discoverAndLoadExtensions()` API. It did not launch the Pi client or any model.

| Layout | Loader result | Operational result |
| --- | --- | --- |
| One package per extension, with its own `node_modules` | PASS | Supported by Pi, but duplicates manifests, locks, installs, and dev dependencies across this tightly coupled extension set. |
| One shared extension package containing the selected tools | PASS | One manifest, lock, dependency closure, typecheck, and test command. |
| Dependencies only under sibling `agent/npm/node_modules` | Expected failure | Pi/jiti could not resolve the probe dependency from `agent/extensions/demo/index.ts`; sibling `agent/npm` is not a dependency root for local extension source. |

Pi's loader aliases bundled host APIs such as `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `@earendil-works/pi-ai`, and `typebox`, while ordinary third-party packages resolve through normal nearest-ancestor `node_modules` lookup. Pi's own source test explicitly covers per-extension `node_modules`; the shared wrapper exercises the same supported package boundary with multiple internal tool modules.

## Verification

Clean reinstall and verification:

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
```

Results:

```text
tsc --noEmit: PASS
node --test --experimental-strip-types test/*.test.ts: 1 pass, 0 fail
shared-wrapper loader: PASS (extension and command loaded)
per-extension loader: PASS (extension and command loaded)
sibling agent/npm loader: PASS (expected resolution failure observed)
```

The expected negative result was:

```text
Cannot find module 'layout-probe-dependency'
Require stack: .../sibling-agent-npm/agent/extensions/demo/index.ts
```

## Decision

Use one self-contained local Pi extension package:

```text
agent/extensions/pi-tooling/
├── package.json
├── package-lock.json
├── tsconfig.json
├── index.ts
├── shared/
├── file-search/
├── firecrawl/
├── workflows/
├── ask-user/
├── background-terminals/
└── test/
```

`index.ts` composes the selected extension factories. Runtime third-party packages are pinned in this package's `dependencies`; Pi 0.80.10 and TypeScript/test tooling are pinned in `devDependencies`. Track `package-lock.json`, ignore only `agent/extensions/pi-tooling/node_modules/`, and expose one `npm run verify` command that runs typecheck and tests. Production installation uses `npm ci` after reviewing dependency lifecycle scripts; the prototype used `--ignore-scripts` because its dependency was inert.

This package is a selective integration boundary, not a replacement for `agent/npm`, existing top-level extension files, or `@tintinweb/pi-subagents`.

## Implementation gates

1. Copy only the selected upstream modules into the package and preserve pinned provenance.
2. Adapt imports and Pi 0.80.10 API differences inside the package boundary.
3. Add direct dependencies as imports are introduced; do not rely on accidental transitive packages.
4. Keep `node_modules` generated and ignored while tracking the lockfile.
5. Require `npm ci && npm run verify` before the live Pi smoke-test ticket.
6. Re-run loader-only verification through `discoverAndLoadExtensions()` without starting Pi before requesting live smoke-test approval.

## Limits

This proves package resolution, clean installation, typechecking, Node tests, and Pi loader registration on Linux. It does not yet prove the copied extensions' full dependency closure, TUI interaction, background process lifecycle, Windows behavior, or live Pi behavior; those remain in their implementation and verification tickets.
