import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  HOST_PEERS, MANIFEST_ORIGINAL_SHA256, MANIFEST_PATCHED_SHA256,
  RUNNER_EDITS, RUNNER_ORIGINAL_SHA256, RUNNER_PATCHED_SHA256, SUBAGENTS_VERSION,
} from "./subagents-0.19.0.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
}

function manifestHash(manifest) {
  return sha256(JSON.stringify(sorted(manifest)));
}

function assertHostVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Cannot validate Pi version ${JSON.stringify(version)}.`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (major === 0 && (minor < 99 || (minor === 99 && patch < 1))) {
    throw new Error(`Native MCP compatibility requires Pi 0.99.1 or newer, found ${version}.`);
  }
}

function readTarget(root, relative) {
  const file = path.join(root, relative);
  const stat = lstatSync(file);
  const real = realpathSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !real.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing a symlink or non-file patch target: ${relative}.`);
  }
  return { file, relative, before: readFileSync(file, "utf8"), mode: stat.mode & 0o777 };
}

function planPatch(packageDir, hostVersion) {
  assertHostVersion(hostVersion);
  const root = realpathSync(packageDir);
  const manifestFile = readTarget(root, "package.json");
  const runnerFile = readTarget(root, "src/agent-runner.ts");
  const manifest = JSON.parse(manifestFile.before);
  if (manifest.name !== "@tintinweb/pi-subagents" || manifest.version !== SUBAGENTS_VERSION) {
    throw new Error(`Supported package is @tintinweb/pi-subagents@${SUBAGENTS_VERSION}, found ${manifest.name}@${manifest.version}.`);
  }
  const manifestDigest = manifestHash(manifest);
  if (![MANIFEST_ORIGINAL_SHA256, MANIFEST_PATCHED_SHA256].includes(manifestDigest)) {
    throw new Error("Subagents manifest differs from the reviewed release or known peer-dependency patch. No files changed.");
  }
  const runnerDigest = sha256(runnerFile.before);
  if (![RUNNER_ORIGINAL_SHA256, RUNNER_PATCHED_SHA256].includes(runnerDigest)) {
    throw new Error("Subagents runner source differs from the reviewed release or known patch. No files changed.");
  }

  let runnerAfter = runnerFile.before;
  if (runnerDigest === RUNNER_ORIGINAL_SHA256) {
    for (const { before, after } of RUNNER_EDITS) {
      if (runnerAfter.split(before).length !== 2) throw new Error("Non-unique source edit. No files changed.");
      runnerAfter = runnerAfter.replace(before, after);
    }
    if (sha256(runnerAfter) !== RUNNER_PATCHED_SHA256) throw new Error("Patch specification checksum mismatch. No files changed.");
  }
  if (manifestDigest === MANIFEST_ORIGINAL_SHA256) {
    for (const name of HOST_PEERS) {
      manifest.peerDependencies[name] = "*";
      delete manifest.dependencies[name];
    }
    if (manifestHash(manifest) !== MANIFEST_PATCHED_SHA256) throw new Error("Patched manifest checksum mismatch. No files changed.");
  }
  const manifestAfter = manifestDigest === MANIFEST_PATCHED_SHA256
    ? manifestFile.before : `${JSON.stringify(manifest, null, 2)}\n`;
  const changes = [
    { ...runnerFile, after: runnerAfter },
    { ...manifestFile, after: manifestAfter },
  ].filter((entry) => entry.before !== entry.after);
  return { root, changes };
}

/** Explicit, version/source-checked patch application. Never installs or updates packages. */
export function applySubagentsPatch(packageDir, hostVersion, options = {}) {
  const { root, changes } = planPatch(packageDir, hostVersion);
  if (changes.length === 0) return { status: "already-patched", version: SUBAGENTS_VERSION, files: [] };
  if (options.checkOnly) return { status: "needs-patch", version: SUBAGENTS_VERSION, files: changes.map((entry) => entry.relative) };

  const backupDir = mkdtempSync(path.join(root, ".pi-tooling-subagents-backup-"));
  const staged = [];
  const applied = [];
  try {
    // Complete backups/staging before changing either reviewed input.
    for (const entry of changes) {
      const backup = path.join(backupDir, entry.relative);
      mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
      writeFileSync(backup, entry.before, { flag: "wx", mode: 0o600 });
      const temporary = `${entry.file}.pi-tooling-${randomUUID()}`;
      writeFileSync(temporary, entry.after, { flag: "wx", mode: entry.mode });
      staged.push({ ...entry, temporary });
    }
    for (const entry of staged) {
      if (readFileSync(entry.file, "utf8") !== entry.before) throw new Error("Package changed while staging the patch.");
    }
    for (const entry of staged) {
      renameSync(entry.temporary, entry.file);
      applied.push(entry);
    }
  } catch (error) {
    const failures = [error];
    for (const entry of applied.reverse()) {
      try {
        const rollback = `${entry.file}.pi-tooling-${randomUUID()}`;
        writeFileSync(rollback, entry.before, { flag: "wx", mode: entry.mode });
        renameSync(rollback, entry.file);
      } catch (rollbackError) { failures.push(rollbackError); }
    }
    if (failures.length > 1) throw new AggregateError(failures, `Patch rollback failed. Originals are in ${backupDir}.`);
    throw error;
  } finally {
    for (const entry of staged) {
      try { unlinkSync(entry.temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  return { status: "patched", version: SUBAGENTS_VERSION, files: changes.map((entry) => entry.relative), backupDir };
}
