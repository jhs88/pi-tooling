import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isReviewedSubagentsVersion } from "../subagents/versions.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const dependency = join(root, "node_modules/@tintinweb/pi-subagents");
const manifest = JSON.parse(readFileSync(join(dependency, "package.json"), "utf8"));
if (manifest.name !== "@tintinweb/pi-subagents" || !isReviewedSubagentsVersion(manifest.version)) {
  throw new Error(`Unreviewed subagent release ${manifest.version}. Review upstream changes and update subagents/versions.ts before accepting this upgrade.`);
}
console.log(`Verifying @tintinweb/pi-subagents ${manifest.version} against the Pi Tooling adapter`);
const tests = readdirSync(join(root, "subagents")).filter((name) => /\.test\.(ts|mjs)$/.test(name)).sort().map((name) => join(root, "subagents", name));
for (const args of [
  ["--test", "--experimental-strip-types", ...tests],
  ["--experimental-strip-types", join(root, "subagents/rpc-smoke.mjs"), `--pi=${join(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js")}`, `--package-dir=${dependency}`],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: root, stdio: "inherit", timeout: 180_000,
    env: { ...process.env, PI_OFFLINE: "1", PI_TELEMETRY: "0" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
