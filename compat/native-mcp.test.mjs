import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const exec = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dependency = join(root, 'node_modules/@tintinweb/pi-subagents');
const originalHash = '88e61481fd627254ff3ac0a27e1991136c41e103fac847dd06444c8ac3d3eab1';
const digest = (text) => createHash('sha256').update(text).digest('hex');

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), 'pi-subagents-compat-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const packageDir = join(workspace, 'package');
  // Copy the published artifact from the pinned devDependency, never ~/.pi or /tmp sources.
  await cp(dependency, packageDir, { recursive: true });
  await symlink(join(root, 'node_modules'), join(workspace, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
  assert.equal(manifest.version, '0.19.0', 'fixture must be published pi-subagents 0.19.0');
  assert.equal(digest(await readFile(join(packageDir, 'src/agent-runner.ts'))), originalHash, 'fixture must be original upstream runner');
  return { workspace, packageDir };
}

async function patch(packageDir) {
  const { applySubagentsPatch } = await import('./subagents-patch.mjs');
  return applySubagentsPatch(packageDir, '0.99.1');
}

for (const scenario of ['direct', 'isolated', 'no-extensions', 'builtin-disabled', 'plain-name', 'denylist', 'hidden', 'deferred', 'codemode', 'codemode-deferred', 'nested-native-scope']) {
  test(`real upstream SDK child: ${scenario}`, { timeout: 30000 }, async (t) => {
    const { workspace, packageDir } = await fixture(t);
    await patch(packageDir);
    try {
      await exec(process.execPath, [join(root, 'compat/fixtures/child-session.mjs'), packageDir, workspace, scenario], {
        cwd: root, timeout: 25000, maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      assert.fail(`Real child ${scenario} failed:\n${error.stdout ?? ''}\n${error.stderr ?? error.message}`);
    }
  });
}
