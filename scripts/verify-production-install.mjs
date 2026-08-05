import { execFile as execFileCallback, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const piHostPackage = path.join(
  packageRoot,
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
);
const root = await mkdtemp(path.join(tmpdir(), "pi-tooling-production-"));

try {
  await access(path.join(piHostPackage, "package.json"));
  const packed = await execFile(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", root],
    { cwd: packageRoot },
  );
  const packResult = JSON.parse(packed.stdout);
  const packedFilename = packResult?.[0]?.filename;
  if (typeof packedFilename !== "string") {
    throw new Error("npm pack did not return a package filename");
  }
  const tarball = path.join(root, packedFilename);
  const installRoot = path.join(root, "install");
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ private: true })}\n`,
  );
  await execFile(
    "npm",
    [
      "install",
      "--omit=dev",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      "--prefix",
      installRoot,
      tarball,
    ],
    { cwd: root },
  );

  const installedPackage = path.join(
    installRoot,
    "node_modules",
    "@jhs88",
    "pi-tooling",
  );
  const manifest = JSON.parse(
    await readFile(path.join(installedPackage, "package.json"), "utf8"),
  );
  assertPeer(manifest.peerDependencies, "@earendil-works/pi-coding-agent");

  try {
    await access(path.join(
      installRoot,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
    ));
    throw new Error("production fixture unexpectedly installed the Pi host peer");
  } catch (error) {
    if (error instanceof Error && error.message.includes("unexpectedly")) throw error;
  }

  const executable = path.join(installRoot, "node_modules", ".bin", "pi-a2a-server");
  const checked = await execFile(executable, ["--check"], {
    cwd: installRoot,
    env: {
      ...process.env,
      PI_A2A_PI_PACKAGE: piHostPackage,
    },
  });
  if (!checked.stdout.includes("headless runtime is ready")) {
    throw new Error("production headless runtime check did not complete");
  }
  await smokeHeadlessServer(executable, piHostPackage, root);
  console.log("Production package and headless runtime verified");
} finally {
  await rm(root, { recursive: true, force: true });
}

function assertPeer(peers, name) {
  if (!peers || !(name in peers)) {
    throw new Error(`${name} must remain a peer dependency`);
  }
}

async function smokeHeadlessServer(executable, hostPackage, fixtureRoot) {
  const workspace = path.join(fixtureRoot, "workspace");
  const agentDir = path.join(fixtureRoot, "agent");
  await mkdir(workspace);
  const port = await availablePort();
  const token = "production-package-fixture-token";
  const child = spawn(executable, [], {
    cwd: workspace,
    env: {
      ...process.env,
      PI_A2A_PI_PACKAGE: hostPackage,
      PI_CODING_AGENT_DIR: agentDir,
      PI_A2A_BEARER_TOKEN: token,
      PI_A2A_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForReady(child);
    const response = await fetch(
      `http://127.0.0.1:${port}/.well-known/agent-card.json`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      throw new Error(`production headless Agent Card returned HTTP ${response.status}`);
    }
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await waitForExit(child);
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolve, reject) => server.close((error) => {
    if (error) reject(error);
    else resolve();
  }));
  if (!port) throw new Error("unable to reserve a production smoke-test port");
  return port;
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(
      () => reject(new Error(`production headless server did not start: ${stderr}`)),
      15_000,
    );
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes("A2A server is running at")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`production headless server exited ${code}: ${stderr}`));
    });
  });
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("production headless server did not stop")),
      15_000,
    );
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0 && signal === null) resolve();
      else reject(new Error(`production headless server exited ${code ?? signal}`));
    });
  });
}
