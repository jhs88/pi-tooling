#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { applySubagentsPatch } from "../compat/subagents-patch.mjs";

function parseArgs(args) {
  let packageDir = path.join(process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent"), "npm", "node_modules", "@tintinweb", "pi-subagents");
  let checkOnly = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--check") checkOnly = true;
    else if (args[index] === "--package-dir" && args[index + 1] && !args[index + 1].startsWith("--")) packageDir = args[++index];
    else throw new Error(`Unknown or incomplete argument: ${args[index]}`);
  }
  if (packageDir === "~" || packageDir.startsWith("~/")) packageDir = path.join(homedir(), packageDir.slice(2));
  return { packageDir, checkOnly };
}

if (process.argv.slice(2).some((arg) => arg === "--help" || arg === "-h")) {
  console.log("Usage: node scripts/patch-pi-subagents.mjs [--package-dir PATH] [--check]\n\nPatches the managed @tintinweb/pi-subagents 0.19.0 installation for native MCP.\nUses the Pi executable on PATH. No automatic install, update, or startup hook.\n--check is read-only; exits 1 when a patch is needed, 0 when already patched.\nUnsupported versions or modified source exit 2 without changing package files.");
} else {
  try {
    const { packageDir, checkOnly } = parseArgs(process.argv.slice(2));
    const hostVersion = execFileSync("pi", ["--version"], { encoding: "utf8", timeout: 10_000 }).trim();
    const result = applySubagentsPatch(packageDir, hostVersion, { checkOnly });
    console.log(`Subagents ${result.version}: ${result.status.replaceAll("-", " ")}.`);
    if (result.backupDir) console.log(`Original files: ${result.backupDir}`);
    if (result.status === "needs-patch") process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
