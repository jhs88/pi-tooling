#!/usr/bin/env -S node --experimental-strip-types
import { runHeadlessA2AServer } from "./headless.ts";

const HELP = `Usage: pi-a2a-server

Run the authenticated Pi A2A bridge as a headless foreground process.
The current working directory becomes the Pi coding workspace.

Required environment:
  PI_A2A_BEARER_TOKEN       Private bearer token shared with the A2A client

Optional environment:
  PI_CODING_AGENT_DIR       Pi agent directory
  PI_A2A_HOST               Loopback host (default: 127.0.0.1)
  PI_A2A_PORT               Listener port (default: 10000)
  PI_A2A_EXECUTION_TIMEOUT_MS
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(HELP);
} else if (process.argv.length > 2) {
  process.stderr.write(`${HELP}\nError: pi-a2a-server does not accept positional arguments.\n`);
  process.exitCode = 2;
} else {
  const shutdown = new AbortController();
  process.once("SIGINT", () => shutdown.abort());
  process.once("SIGTERM", () => shutdown.abort());

  try {
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
  }
}
