import {
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { loadA2AHostConfig } from "./config.ts";
import { PiSessionHost } from "./pi-session-host.ts";
import {
  createConfiguredPiA2AServer,
  type A2AExecutionInput,
  type A2AExecutionResult,
} from "./server.ts";

interface A2AHostHandle {
  execute(input: A2AExecutionInput): Promise<A2AExecutionResult>;
  close(): Promise<void>;
}

interface A2AServerHandle {
  readonly isRunning: boolean;
  readonly url: string | undefined;
  start(): Promise<string>;
  stop(): Promise<void>;
}

export interface A2AExtensionDependencies {
  env: NodeJS.ProcessEnv;
  agentDir: string;
  createHost(options: {
    cwd: string;
    agentDir: string;
    maxContexts: number;
  }): A2AHostHandle;
  createServer(
    execute: (input: A2AExecutionInput) => Promise<A2AExecutionResult>,
  ): A2AServerHandle;
}

interface RunningA2A {
  cwd: string;
  host: A2AHostHandle;
  server: A2AServerHandle;
}

function defaultDependencies(): A2AExtensionDependencies {
  return {
    env: process.env,
    agentDir: getAgentDir(),
    createHost(options) {
      return new PiSessionHost(options);
    },
    createServer(execute) {
      const server = createConfiguredPiA2AServer(execute, process.env);
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

export function createA2ARegistration(
  dependencies: A2AExtensionDependencies = defaultDependencies(),
) {
  return function registerA2A(pi: ExtensionAPI): void {
    let running: RunningA2A | undefined;
    let transition: Promise<void> = Promise.resolve();

    const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
      const result = transition.then(operation, operation);
      transition = result.then(() => undefined, () => undefined);
      return result;
    };

    const start = (cwd: string) => serialize(async () => {
      if (running?.server.isRunning) return running;
      const host = dependencies.createHost({
        cwd,
        agentDir: dependencies.agentDir,
        maxContexts: loadA2AHostConfig(dependencies.env).maxContexts,
      });
      const server = dependencies.createServer((input) => host.execute(input));
      try {
        await server.start();
      } catch (error) {
        await host.close().catch(() => {});
        throw error;
      }
      running = { cwd, host, server };
      return running;
    });

    const stop = () => serialize(async () => {
      const current = running;
      if (!current) return;
      running = undefined;
      try {
        await current.server.stop();
      } finally {
        await current.host.close();
      }
    });

    const status = () => {
      if (!running?.server.isRunning) return "A2A server is stopped";
      return `A2A server is running at ${running.server.url ?? "unknown URL"} for ${running.cwd}`;
    };

    pi.registerCommand("a2a-server", {
      description: "Start, stop, or inspect the authenticated Pi A2A server",
      getArgumentCompletions(prefix) {
        const options = ["start", "stop", "status"];
        return options
          .filter((value) => value.startsWith(prefix.trim()))
          .map((value) => ({ value, label: value }));
      },
      handler: async (rawArgs, ctx) => {
        const action = rawArgs.trim() || "status";
        try {
          if (action === "start") {
            await start(ctx.cwd);
            ctx.ui.notify(status(), "info");
            return;
          }
          if (action === "stop") {
            await stop();
            ctx.ui.notify(status(), "info");
            return;
          }
          if (action === "status") {
            ctx.ui.notify(status(), "info");
            return;
          }
          ctx.ui.notify("Usage: /a2a-server start|stop|status", "warning");
        } catch (error) {
          ctx.ui.notify(
            error instanceof Error ? error.message : "A2A server operation failed",
            "error",
          );
        }
      },
    });

    pi.registerFlag("a2a-server", {
      description: "Start the authenticated Pi A2A server",
      type: "boolean",
      default: false,
    });

    pi.on("session_start", async (_event, ctx) => {
      if (
        dependencies.env.PI_A2A_AUTO_START !== "true" &&
        pi.getFlag("a2a-server") !== true
      ) return;
      try {
        await start(ctx.cwd);
        ctx.ui.notify(status(), "info");
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : "A2A server auto-start failed",
          "error",
        );
      }
    });

    pi.on("session_shutdown", async () => {
      await stop();
    });
  };
}

export default createA2ARegistration();
