import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applySubagentsPatch } from "./subagents-patch.mjs";

const require = createRequire(import.meta.url);
const upstream = path.dirname(require.resolve("@tintinweb/pi-subagents/package.json"));
const script = fileURLToPath(new URL("../scripts/patch-pi-subagents.mjs", import.meta.url));

async function withPackage(run) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-subagents-patch-"));
  const target = path.join(root, "package");
  await mkdir(path.join(target, "src"), { recursive: true });
  await cp(path.join(upstream, "package.json"), path.join(target, "package.json"));
  await cp(path.join(upstream, "src/agent-runner.ts"), path.join(target, "src/agent-runner.ts"));
  try {
    await run(target);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function runCli(target, ...args) {
  return spawnSync(process.execPath, [script, "--package-dir", target, ...args], {
    encoding: "utf8",
    timeout: 15_000,
  });
}

async function fileHashes(target) {
  const entries = await Promise.all(["package.json", "src/agent-runner.ts"].map(async (name) => [
    name,
    createHash("sha256").update(await readFile(path.join(target, name))).digest("hex"),
  ]));
  return Object.fromEntries(entries);
}

test("the patch CLI updates a supported installation and repeating it is a no-op", async () => {
  await withPackage(async (target) => {
    const before = await fileHashes(target);
    const first = runCli(target);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.match(first.stdout, /patched/i);
    const after = await fileHashes(target);
    assert.notEqual(after["src/agent-runner.ts"], before["src/agent-runner.ts"]);
    const backupDir = first.stdout.split("\n").find((line) => line.startsWith("Original files: ")).slice("Original files: ".length);
    assert.deepEqual(await fileHashes(backupDir), before);
    const manifest = JSON.parse(await readFile(path.join(target, "package.json"), "utf8"));
    for (const name of ["@sinclair/typebox", "typebox", "@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
      assert.equal(manifest.peerDependencies[name], "*");
      assert.equal(manifest.dependencies[name], undefined);
    }
    const second = runCli(target);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.match(second.stdout, /already patched/i);
    assert.deepEqual(await fileHashes(target), after);
    const checked = runCli(target, "--check");
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    assert.deepEqual(await fileHashes(target), after);
  });
});

test("checking an unpatched installation is read-only and reports that work is needed", async () => {
  await withPackage(async (target) => {
    const before = await fileHashes(target);
    const result = runCli(target, "--check");
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /needs patch/i);
    assert.deepEqual(await fileHashes(target), before);
  });
});

test("wrong versions and modified source are rejected before either input changes", async () => {
  for (const change of [
    async (target) => {
      const file = path.join(target, "package.json");
      const manifest = JSON.parse(await readFile(file, "utf8"));
      manifest.version = "0.20.0";
      await writeFile(file, JSON.stringify(manifest));
    },
    async (target) => {
      const file = path.join(target, "src/agent-runner.ts");
      await writeFile(file, `${await readFile(file, "utf8")}\n// unreviewed change\n`);
    },
    async (target) => {
      const file = path.join(target, "package.json");
      const manifest = JSON.parse(await readFile(file, "utf8"));
      manifest.dependencies.croner = "unreviewed";
      await writeFile(file, JSON.stringify(manifest));
    },
  ]) {
    await withPackage(async (target) => {
      await change(target);
      const before = await fileHashes(target);
      const result = runCli(target);
      assert.equal(result.status, 2, result.stderr || result.stdout);
      assert.deepEqual(await fileHashes(target), before);
    });
  }
});

test("source symlinks are rejected without changing either file", { skip: process.platform === "win32" }, async () => {
  await withPackage(async (target) => {
    const source = path.join(target, "src/agent-runner.ts");
    const outside = path.join(path.dirname(target), "outside.ts");
    await cp(source, outside);
    await rm(source);
    await symlink(outside, source);
    const before = await fileHashes(target);
    const result = runCli(target);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /symlink/);
    assert.deepEqual(await fileHashes(target), before);
    assert.equal(await readFile(outside, "utf8"), await readFile(source, "utf8"));
  });
});

test("older hosts are rejected without writing files", async () => {
  await withPackage(async (target) => {
    const before = await fileHashes(target);
    assert.throws(() => applySubagentsPatch(target, "0.98.0"), /requires Pi 0.99.1/);
    assert.deepEqual(await fileHashes(target), before);
  });
});

test("the known manifest-only warning fix can receive the native MCP patch", async () => {
  await withPackage(async (target) => {
    const file = path.join(target, "package.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    for (const name of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "@sinclair/typebox", "typebox"]) {
      manifest.peerDependencies[name] = "*";
      delete manifest.dependencies[name];
    }
    await writeFile(file, JSON.stringify(manifest));
    const result = applySubagentsPatch(target, "0.99.1");
    assert.equal(result.status, "patched");
    assert.deepEqual(result.files, ["src/agent-runner.ts"]);
  });
});
