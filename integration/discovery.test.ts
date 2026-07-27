import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadExtensions } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { loadSkillsFromDir } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function productionSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await productionSources(candidate));
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      paths.push(candidate);
    }
  }
  return paths;
}

test("the package extension loads without registration conflicts", async () => {
  const entryPath = join(packageRoot, "index.ts");
  const result = await loadExtensions([entryPath], packageRoot);
  assert.deepEqual(result.errors, []);

  const registrations = new Map<string, string[]>();
  const sources = await productionSources(packageRoot);
  for (const sourcePath of sources) {
    const source = await readFile(sourcePath, "utf8");
    for (const match of source.matchAll(/registerTool(?:<[^;{}]*>)?\s*\(\s*\{\s*name:\s*["']([^"']+)["']/g)) {
      const name = match[1];
      registrations.set(name, [...(registrations.get(name) ?? []), sourcePath]);
    }
  }
  const duplicates = [...registrations]
    .filter(([, registeredBy]) => registeredBy.length > 1)
    .map(([name, registeredBy]) => ({ name, registeredBy }));
  assert.deepEqual(duplicates, []);
});

test("the package exposes guidance for its specialized Pi tools as skills", async () => {
  const manifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  ) as { pi?: { skills?: string[] } };
  assert.deepEqual(manifest.pi?.skills, ["./skills"]);

  const result = loadSkillsFromDir({
    dir: join(packageRoot, "skills"),
    source: "@jhs88/pi-tooling",
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.skills.map((skill) => skill.name), [
    "background-terminals",
    "workflows",
  ]);
});
