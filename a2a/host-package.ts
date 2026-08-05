import { access, readFile, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { registerHooks } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const PI_CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";

async function isPiCodingAgentRoot(candidate: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(candidate, "package.json"), "utf8"),
    ) as { name?: unknown };
    return manifest.name === PI_CODING_AGENT_PACKAGE;
  } catch {
    return false;
  }
}

async function findPackageRootFrom(start: string): Promise<string | undefined> {
  let current = path.resolve(start);
  try {
    const metadata = await realpath(current);
    current = metadata;
  } catch {
    return undefined;
  }
  try {
    const metadata = await stat(current);
    if (metadata.isFile()) {
      await access(current, constants.X_OK);
      current = path.dirname(current);
    }
  } catch {
    return undefined;
  }

  while (true) {
    if (await isPiCodingAgentRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function executableCandidates(env: NodeJS.ProcessEnv): Promise<string[]> {
  const executableName = process.platform === "win32" ? "pi.cmd" : "pi";
  return (env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, executableName));
}

export async function resolvePiCodingAgentPackageRoot(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const configured = env.PI_A2A_PI_PACKAGE?.trim();
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw new Error("PI_A2A_PI_PACKAGE must be an absolute package directory");
    }
    const root = await findPackageRootFrom(configured);
    if (root) return root;
    throw new Error("PI_A2A_PI_PACKAGE is not a Pi coding-agent package directory");
  }

  for (const executable of await executableCandidates(env)) {
    const root = await findPackageRootFrom(executable);
    if (root) return root;
  }
  throw new Error(
    "Unable to locate the Pi coding-agent host package; put pi on PATH or set PI_A2A_PI_PACKAGE",
  );
}

export async function ensurePiCodingAgentResolution(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  try {
    import.meta.resolve(PI_CODING_AGENT_PACKAGE);
    return;
  } catch {
    // Managed Git packages intentionally omit Pi peer packages.
  }

  const packageRoot = await resolvePiCodingAgentPackageRoot(env);
  const entryUrl = pathToFileURL(path.join(packageRoot, "dist", "index.js")).href;
  await access(new URL(entryUrl));
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === PI_CODING_AGENT_PACKAGE) {
        return { shortCircuit: true, url: entryUrl };
      }
      return nextResolve(specifier, context);
    },
  });
}
