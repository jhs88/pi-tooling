// Adaptation tests for davis7dotsh/my-pi-setup@797eaf6d6f178759cf7aabde927ef15c91346e7e.
import assert from "node:assert/strict";
import test from "node:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import fileSearchTools from "./index.ts";
import {
  buildFdArgs,
  buildRgArgs,
  FD_DEFAULT_LIMIT,
  normalizeSearchPath,
} from "./src/args.ts";
import {
  InstallError,
  releaseAsset,
  resolveBinary,
  TOOL_SPECS,
  type BinaryEnv,
  type ReleaseAsset,
} from "./src/binaries.ts";
import { formatOutput } from "./src/output.ts";
import { executeSearchProcess } from "./src/process.ts";

function makeEnv(options: {
  available?: string[];
  installShouldFail?: boolean;
}): BinaryEnv & { installs: ReleaseAsset[]; probes: string[] } {
  const installs: ReleaseAsset[] = [];
  const probes: string[] = [];
  const installed = new Set<string>();
  return {
    installs,
    probes,
    probe: (command) =>
      Effect.sync(() => {
        probes.push(command);
        return (options.available ?? []).includes(command) || installed.has(command);
      }),
    install: (asset, destination) => {
      if (options.installShouldFail) {
        return Effect.fail(new InstallError({ message: "network down" }));
      }
      return Effect.sync(() => {
        installs.push(asset);
        installed.add(destination);
      });
    },
  };
}

const linuxX64 = { os: "linux", arch: "x64" } as const;

test("extension registers typed fd and rg tools without resolving binaries", () => {
  const registered: string[] = [];
  fileSearchTools({
    on: () => undefined,
    registerTool: (tool: { name: string }) => registered.push(tool.name),
  } as unknown as ExtensionAPI);
  assert.deepEqual(registered, ["fd", "rg"]);
});

test("fd arguments keep untrusted patterns after the option separator", () => {
  assert.deepEqual(buildFdArgs({ pattern: "--exec", path: "@src" }), [
    "--color=never",
    "--max-results",
    String(FD_DEFAULT_LIMIT),
    "--",
    "--exec",
    "src",
  ]);
});

test("rg arguments keep untrusted patterns after the option separator", () => {
  assert.deepEqual(buildRgArgs({ pattern: "--help" }), [
    "--line-number",
    "--color=never",
    "--no-heading",
    "--with-filename",
    "--smart-case",
    "--max-count",
    "100",
    "--",
    "--help",
  ]);
});

test("search paths strip @ and expand the home shortcut", () => {
  assert.equal(normalizeSearchPath("@src/lib"), "src/lib");
  assert.equal(normalizeSearchPath("~/projects"), join(homedir(), "projects"));
});

test("binary resolution prefers system commands without downloading", async () => {
  const env = makeEnv({ available: ["fdfind"] });
  const resolved = await Effect.runPromise(
    resolveBinary(TOOL_SPECS.fd, "/agent/bin", linuxX64, env),
  );
  assert.deepEqual(resolved, {
    tool: "fd",
    command: "fdfind",
    source: "system",
  });
  assert.equal(env.installs.length, 0);
});

test("official fallback assets are HTTPS and checksum-pinned", () => {
  for (const tool of ["fd", "rg"] as const) {
    const asset = releaseAsset(tool, linuxX64);
    assert.ok(asset);
    assert.match(asset.url, /^https:\/\/github\.com\//);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  }
});

test("fallback install errors remain useful and typed", async () => {
  const env = makeEnv({ installShouldFail: true });
  await assert.rejects(
    Effect.runPromise(resolveBinary(TOOL_SPECS.rg, "/agent/bin", linuxX64, env)),
    (error: unknown) =>
      error instanceof InstallError && error.message === "network down",
  );
});

test("search process execution observes cancellation", async () => {
  const controller = new AbortController();
  const running = Effect.runPromise(
    executeSearchProcess({
      command: process.execPath,
      args: ["-e", "setInterval(() => undefined, 1000)"],
      cwd: process.cwd(),
      tempPrefix: "pi-file-search-cancel-test-",
    }).pipe(Effect.provide(NodeServices.layer)),
    { signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 25);
  await assert.rejects(running);
});

test("oversized model output is bounded and the full result is persisted", async () => {
  const output = Array.from({ length: 3000 }, (_, index) => `file-${index}.ts`).join("\n");
  let persisted: string | undefined;
  const formatted = await formatOutput(output, {
    tempPrefix: "pi-file-search-test-",
    persistFullOutput: async (full) => {
      persisted = full;
      return "/tmp/pi-file-search-test/output.txt";
    },
  });
  assert.equal(formatted.truncated, true);
  assert.equal(persisted, output);
  assert.match(formatted.text, /Output truncated: 2000 of 3000 lines/);
});
