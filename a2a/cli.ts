import { ensurePiCodingAgentResolution } from "./host-package.ts";

const HELP = `Usage: pi-a2a-server [--check]

Run the authenticated Pi A2A bridge as a headless foreground process.
The current working directory becomes the Pi coding workspace.

Required environment:
  PI_A2A_BEARER_TOKEN       Private bearer token shared with the A2A client

Optional environment:
  PI_CODING_AGENT_DIR       Pi agent directory
  PI_A2A_PI_PACKAGE         Absolute Pi coding-agent package directory if pi is not on PATH
  PI_A2A_HOST               Loopback host (default: 127.0.0.1)
  PI_A2A_PORT               Listener port (default: 10000)
  PI_A2A_EXECUTION_TIMEOUT_MS
  PI_A2A_MAX_CONTEXTS       Persistent contexts per workspace (default: 256, max: 1024)
`;

async function loadHeadlessServer() {
  await ensurePiCodingAgentResolution();
  return import("./headless.ts");
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(HELP);
} else if (args.length === 1 && args[0] === "--check") {
  try {
    await loadHeadlessServer();
    process.stdout.write("Pi A2A headless runtime is ready\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "runtime check failed";
    process.stderr.write(`pi-a2a-server: ${message}\n`);
    process.exitCode = 1;
  }
} else if (args.length > 0) {
  process.stderr.write(`${HELP}\nError: pi-a2a-server does not accept positional arguments.\n`);
  process.exitCode = 2;
} else {
  const shutdown = new AbortController();
  const requestShutdown = () => shutdown.abort();
  const installSignalHandlers = () => {
    process.removeListener("SIGINT", requestShutdown);
    process.removeListener("SIGTERM", requestShutdown);
    process.once("SIGINT", requestShutdown);
    process.once("SIGTERM", requestShutdown);
  };
  installSignalHandlers();

  try {
    const { runHeadlessA2AServer } = await loadHeadlessServer();
    // Reinstall after loading the Pi host so host initialization cannot replace
    // the foreground server's shutdown handlers.
    installSignalHandlers();
    await runHeadlessA2AServer({
      signal: shutdown.signal,
      onReady(message) {
        process.stdout.write(`${message}\n`);
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "A2A server failed";
    process.stderr.write(`pi-a2a-server: ${message}\n`);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", requestShutdown);
    process.removeListener("SIGTERM", requestShutdown);
  }
}
