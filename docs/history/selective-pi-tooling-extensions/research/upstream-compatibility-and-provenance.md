# Upstream compatibility and provenance

Research date: 2026-07-23
Ben Davis source snapshot: [`davis7dotsh/my-pi-setup@797eaf6`](https://github.com/davis7dotsh/my-pi-setup/tree/797eaf6d6f178759cf7aabde927ef15c91346e7e)
Target Pi API: [`earendil-works/pi@v0.80.10` (`8dc7883`)](https://github.com/earendil-works/pi/tree/8dc78834cde4e329284cf505f9e3f99763df5529)

## Decision summary

1. **Do not copy or adapt Ben's source yet.** The inspected repository has no `LICENSE` file and GitHub reports no detected license. Under GitHub's own guidance, absent a license the default copyright rules apply; a public repository is viewable and forkable on GitHub, but that does not grant general permission to reproduce, distribute, or create derivative code. We need either an explicit license/permission from Ben or a clean-room implementation based on behavior and independently written specifications.
2. **The designs are technically reproducible without replacing our subagent plugin.** Pi 0.80.10 exposes the extension APIs needed for first-class tools and child sessions, but Ben's current workflow runner is not source-compatible as-is because it passes the removed `modelRegistry` option to `createAgentSession`; Pi 0.80.10 uses `modelRuntime`.
3. **Firecrawl 4.30 supports our self-hosted contract.** Its client accepts `apiUrl`, honors `FIRECRAWL_API_URL`, and allows an omitted key. Ben's wrapper currently requires a key and constructs the client with only `{ apiKey }`, so ours must be independently adapted to require an explicit non-cloud URL and make the key optional.
4. **Ben's current `fd`/`rg` downloader already embeds SHA-256 checksums.** Our earlier concern that the fresh-download path was unverified was outdated. A remaining hardening choice is whether cached binaries in `bin/` should be reverified rather than merely probed.
5. **Ben's workflow recursion denylist is incompatible with our installed subagent tool names.** It excludes Ben's `subagent_spawn`, `subagent_wait`, `subagent_cancel`, `subagent_check`, and `subagent_list`, but our `@tintinweb/pi-subagents` 0.14.2 registers `Agent`, `get_subagent_result`, and `steer_subagent`. All three must be denied inside workflow children.
6. **The upstream setup has hidden packaging coupling.** `file-search` and `firecrawl-search` carry separate package manifests and install scripts, while the root setup instructions only say to run the root `npm install`. Our repo currently has dependencies under `agent/npm/package.json` but local extensions under `agent/extensions`; a deliberate local-extension package/test layout is needed before implementation.

## Provenance and licensing

### Ben Davis configuration

The pinned repository tree contains the target source but no `LICENSE`, `COPYING`, or equivalent license file, and the GitHub repository metadata reports `license: null`:

- [Pinned repository tree](https://github.com/davis7dotsh/my-pi-setup/tree/797eaf6d6f178759cf7aabde927ef15c91346e7e)
- [GitHub repository metadata](https://api.github.com/repos/davis7dotsh/my-pi-setup)
- [GitHub: Licensing a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)

**Operational conclusion:** attribution alone is insufficient. Treat direct copying, adaptation, or vendoring as blocked until Ben adds a license or grants explicit permission. We may still study public behavior and independently implement the same general ideas without copying protected expression.

### Licensed dependencies

- Pi 0.80.10 is MIT licensed: [Pi `LICENSE`](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/LICENSE).
- `@tintinweb/pi-subagents` 0.14.2 is MIT licensed: [tag source](https://github.com/tintinweb/pi-subagents/tree/1714700474849140fa94ab6b1f40b8621cbcd1ff), [license](https://github.com/tintinweb/pi-subagents/blob/1714700474849140fa94ab6b1f40b8621cbcd1ff/LICENSE).
- Firecrawl's JavaScript SDK package is MIT licensed even though the larger Firecrawl repository/server is AGPL-3.0: [SDK license](https://github.com/firecrawl/firecrawl/blob/f578c51ac76f3969072475b8cbc5f990865e981a/apps/js-sdk/firecrawl/LICENSE), [repository metadata](https://api.github.com/repos/firecrawl/firecrawl).
- `fd` is Apache-2.0/MIT dual-licensed and ripgrep is Unlicense/MIT dual-licensed in their upstream repositories: [`sharkdp/fd`](https://github.com/sharkdp/fd), [`BurntSushi/ripgrep`](https://github.com/BurntSushi/ripgrep).

## Source and dependency inventory

### File search

Runtime source under the pinned snapshot:

- [`extensions/file-search/index.ts`](https://github.com/davis7dotsh/my-pi-setup/blob/797eaf6d6f178759cf7aabde927ef15c91346e7e/extensions/file-search/index.ts)
- `extensions/file-search/src/{args,binaries,output,process,prompt}.ts`
- `extensions/file-search/package.json`, `package-lock.json`, `tsconfig.json`

Direct extension dependencies are `effect@4.0.0-beta.98` and `@effect/platform-node@4.0.0-beta.98`; its tests additionally use `@effect/vitest`, TypeScript 7, and Vitest.

The binary resolver prefers system `fd`/`fdfind` and `rg`, then an existing local fallback, then pinned official release archives. The current code maps each supported target to an embedded SHA-256 and verifies the downloaded archive before extraction: [`binaries.ts`](https://github.com/davis7dotsh/my-pi-setup/blob/797eaf6d6f178759cf7aabde927ef15c91346e7e/extensions/file-search/src/binaries.ts).

### Firecrawl

Runtime source:

- [`extensions/firecrawl-search/index.ts`](https://github.com/davis7dotsh/my-pi-setup/blob/797eaf6d6f178759cf7aabde927ef15c91346e7e/extensions/firecrawl-search/index.ts)
- [`extensions/firecrawl-search/prompt.ts`](https://github.com/davis7dotsh/my-pi-setup/blob/797eaf6d6f178759cf7aabde927ef15c91346e7e/extensions/firecrawl-search/prompt.ts)

Direct dependencies are `effect@4.0.0-beta.98` and `firecrawl@4.30.0`. The wrapper includes bounded output, cancellation-aware requests, crawl polling, and best-effort cancellation of unsuccessful remote crawl jobs.

### Workflows

The workflow extension is a substantial subsystem rather than one file. Runtime pieces include `index.ts`, `artifacts.ts`, `controller.ts`, `dashboard.ts`, `meta.ts`, `model.ts`, `prompt.ts`, `runner.ts`, `sandbox.ts`, `sandbox-child.cjs`, and `serialization.ts`, plus shared helpers `activity-status.ts`, `child-session.ts`, `context-utilization.ts`, and `tool-call-timeout.ts`: [workflow directory](https://github.com/davis7dotsh/my-pi-setup/tree/797eaf6d6f178759cf7aabde927ef15c91346e7e/extensions/workflows).

It also requires root dependencies including `@earendil-works/pi-*`, `acorn`, and `typebox`. The orchestration script runs in a permission-restricted Node child, while each `agent()` call creates an isolated in-process Pi session. Runs are session-scoped, have no resume, allow up to 32 child calls, and default to four concurrent children. Our implementation must cap concurrency at three.

## Pi 0.80.10 compatibility

Ben's root dependencies request `@earendil-works/pi-ai`, `pi-coding-agent`, and `pi-tui` at `^0.80.6`, which semver-resolves to 0.80.10. Most extension APIs used by the target tools remain publicly exported in 0.80.10, including extension registration, `DefaultResourceLoader`, `SettingsManager`, `ProjectTrustStore`, `SessionManager`, and `createAgentSession`: [Pi public exports](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/index.ts).

However, Pi changed the programmatic session API between 0.80.6 and 0.80.10. `CreateAgentSessionOptions` now accepts `modelRuntime`, not `modelRegistry`: [Pi 0.80.10 `sdk.ts`](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/sdk.ts#L33-L80). Ben's workflow runner still supplies `modelRegistry`: [`workflows/runner.ts`](https://github.com/davis7dotsh/my-pi-setup/blob/797eaf6d6f178759cf7aabde927ef15c91346e7e/extensions/workflows/runner.ts#L445-L456).

A temporary compatibility probe installed the 0.80.10 Pi packages against Ben's pinned snapshot and ran the TypeScript check. It failed with the expected concrete error:

```text
extensions/workflows/runner.ts(451,7): error TS2353:
Object literal may only specify known properties, and 'modelRegistry'
does not exist in type 'CreateAgentSessionOptions'.
```

The probe also exposed that a root-only install does not provide every extension-local `effect` dependency. Even after installing the `file-search` and `firecrawl-search` subpackage dependencies, other extensions still lacked their own dependencies under the root check. Therefore Ben's setup instructions/build layout should not be copied as our package strategy.

## Firecrawl self-hosting seam

Firecrawl SDK 4.30 defines:

- optional `apiKey`;
- optional `apiUrl`, falling back to `FIRECRAWL_API_URL`, then `https://api.firecrawl.dev`;
- keyless client construction.

Source: [Firecrawl v2 client options and constructor](https://github.com/firecrawl/firecrawl/blob/f578c51ac76f3969072475b8cbc5f990865e981a/apps/js-sdk/firecrawl/src/v2/client.ts#L103-L154).

Ben's wrapper instead reads only `FIRECRAWL_API_KEY`, fails before client construction when it is missing, and calls `new Firecrawl({ apiKey })`: [`firecrawl-search/index.ts`](https://github.com/davis7dotsh/my-pi-setup/blob/797eaf6d6f178759cf7aabde927ef15c91346e7e/extensions/firecrawl-search/index.ts).

Our independently written wrapper should:

1. read `FIRECRAWL_API_URL` from the process, then ignored `agent/.env`;
2. reject missing URLs and reject the public cloud URL rather than relying on the SDK default;
3. read an optional `FIRECRAWL_API_KEY` through the same precedence;
4. construct `new Firecrawl({ apiUrl, apiKey: apiKey || null })`;
5. retain bounded outputs and cancellation semantics through independently written tests.

## Workflow and existing-subagent interaction

Ben's shared child policy excludes:

```text
subagent_spawn
subagent_wait
subagent_cancel
subagent_check
subagent_list
workflow
ask_user
```

Source: [`extensions/shared/child-session.ts`](https://github.com/davis7dotsh/my-pi-setup/blob/797eaf6d6f178759cf7aabde927ef15c91346e7e/extensions/shared/child-session.ts#L13-L27).

Our installed `@tintinweb/pi-subagents` 0.14.2 defines its orchestration tools once as:

```text
Agent
get_subagent_result
steer_subagent
```

Source: [`agent-runner.ts`](https://github.com/tintinweb/pi-subagents/blob/1714700474849140fa94ab6b1f40b8621cbcd1ff/src/agent-runner.ts#L30-L42).

Because workflow children load normal global/package extensions, failing to add these names to the workflow child denylist would permit recursive delegation. Both workflow prototypes must prove that all workflow and `@tintinweb` orchestration tools are absent from child tool registries.

## Required adaptation and verification gates

1. Resolve the no-license blocker before copying any Ben-authored source.
2. Choose and prove a local dependency layout for extensions with npm dependencies.
3. Port child-session creation to Pi 0.80.10's `modelRuntime` API.
4. Cap workflow concurrency at three and keep invocation explicit-only.
5. Deny `Agent`, `get_subagent_result`, `steer_subagent`, `workflow`, and any workflow-management tools from workflow children.
6. Require an explicit non-cloud Firecrawl URL and optional key.
7. Preserve SHA-256 verification for fresh `fd`/`rg` downloads; decide whether cached fallback binaries also require revalidation.
8. Add focused unit tests before implementation, then run TypeScript checks and the complete extension test matrix.
9. Do not run the Pi client or local inference without separate user approval.

## Recommended route

The next decision should resolve the source strategy:

- **Preferred:** ask Ben to add a recognized license or grant explicit written permission covering adaptation and redistribution.
- **Fallback:** write clean-room specifications from observed behavior, then implement independently without copying source text, structure, comments, prompts, or tests.

After that decision, separately prototype the local dependency/test layout and the two workflow integration designs.
