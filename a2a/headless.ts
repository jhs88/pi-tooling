import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { PiSessionHost } from "./pi-session-host.ts";
import {
  createConfiguredPiA2AServer,
  type A2AExecutionInput,
  type A2AExecutionResult,
} from "./server.ts";

interface HeadlessA2AHost {
  execute(input: A2AExecutionInput): Promise<A2AExecutionResult>;
  close(): Promise<void>;
}

interface HeadlessA2AServer {
  readonly isRunning: boolean;
  readonly url: string | undefined;
  start(): Promise<string>;
  stop(): Promise<void>;
}

export interface HeadlessA2ADependencies {
  createHost(options: { cwd: string; agentDir: string }): HeadlessA2AHost;
  createServer(
    execute: (input: A2AExecutionInput) => Promise<A2AExecutionResult>,
    env: NodeJS.ProcessEnv,
  ): HeadlessA2AServer;
}

export interface HeadlessA2AOptions {
  cwd?: string;
  agentDir?: string;
  env?: NodeJS.ProcessEnv;
  signal: AbortSignal;
  onReady?: (message: string) => void;
}

function defaultDependencies(): HeadlessA2ADependencies {
  return {
    createHost(options) {
      return new PiSessionHost(options);
    },
    createServer(execute, env) {
      const server = createConfiguredPiA2AServer(execute, env);
      const serverUrl = () => {
        const address = server.address();
        if (!address || typeof address === "string") return undefined;
        const host = address.address === "::1" ? "[::1]" : address.address;
        return `http://${host}:${address.port}`;
      };
      return {
        get isRunning() {
          return server.isRunning();
        },
        get url() {
          return serverUrl();
        },
        async start() {
          await server.start();
          return serverUrl()!;
        },
        stop() {
          return server.stop();
        },
      };
    },
  };
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export async function runHeadlessA2AServer(
  options: HeadlessA2AOptions,
  dependencies: HeadlessA2ADependencies = defaultDependencies(),
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? getAgentDir();
  const env = options.env ?? process.env;
  const host = dependencies.createHost({ cwd, agentDir });
  let server: HeadlessA2AServer;
  try {
    server = dependencies.createServer((input) => host.execute(input), env);
  } catch (error) {
    await host.close().catch(() => {});
    throw error;
  }

  let started = false;
  try {
    const url = await server.start();
    started = true;
    options.onReady?.(`A2A server is running at ${url} for ${cwd}`);
    await waitForAbort(options.signal);
  } finally {
    try {
      if (started) await server.stop();
    } finally {
      await host.close();
    }
  }
}
