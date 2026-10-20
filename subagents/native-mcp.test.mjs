import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const exec = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dependency = join(root, "node_modules/@tintinweb/pi-subagents");

for (const scenario of ["direct", "isolated", "no-extensions", "builtin-disabled", "plain-name", "denylist", "hidden", "deferred", "codemode", "codemode-deferred", "nested-native-scope"]) {
  test(`unmodified upstream native MCP child: ${scenario}`, { timeout: 30000 }, async (t) => {
    const workspace = await mkdtemp(join(tmpdir(), "pi-subagents-native-mcp-"));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    const packageDir = join(workspace, "package");
    await cp(dependency, packageDir, { recursive: true });
    await symlink(join(root, "node_modules"), join(workspace, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    try {
      await exec(process.execPath, [join(root, "subagents/fixtures/mcp-child-session.mjs"), packageDir, workspace, scenario], {
        cwd: root, timeout: 25000, maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      assert.fail(`Real child ${scenario} failed:\n${error.stdout ?? ""}\n${error.stderr ?? error.message}`);
    }
  });
}
