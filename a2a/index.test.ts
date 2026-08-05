import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  createA2ARegistration,
  type A2AExtensionDependencies,
} from "./index.ts";

function fixture(autoStart = false, cliStart = false, maxContexts?: string) {
  const eventHandlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }
  >();
  const notifications: Array<{ message: string; type?: string }> = [];
  const flags = new Map<string, { type: "boolean" | "string"; default?: boolean | string }>();
  let starts = 0;
  let stops = 0;
  let closes = 0;
  let executeCalls = 0;
  let createdMaxContexts: number | undefined;

  const dependencies: A2AExtensionDependencies = {
    env: {
      ...(autoStart ? { PI_A2A_AUTO_START: "true" } : {}),
      ...(maxContexts ? { PI_A2A_MAX_CONTEXTS: maxContexts } : {}),
    },
    agentDir: "/fixture/agent",
    createHost(options) {
      assert.equal(options.agentDir, "/fixture/agent");
      assert.equal(options.cwd, "/fixture/workspace");
      createdMaxContexts = options.maxContexts;
      return {
        async execute() {
          executeCalls++;
          return { state: "TASK_STATE_COMPLETED", text: "ok" };
        },
        async close() {
          closes++;
        },
      };
    },
    createServer(execute) {
      assert.equal(typeof execute, "function");
      let running = false;
      return {
        get isRunning() {
          return running;
        },
        get url() {
          return running ? "http://127.0.0.1:10000" : undefined;
        },
        async start() {
          starts++;
          running = true;
          return "http://127.0.0.1:10000";
        },
        async stop() {
          stops++;
          running = false;
        },
      };
    },
  };
  const pi = {
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
      eventHandlers.set(event, handler);
    },
    registerCommand(
      name: string,
      command: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ) {
      commands.set(name, command);
    },
    registerFlag(
      name: string,
      options: { type: "boolean" | "string"; default?: boolean | string },
    ) {
      flags.set(name, options);
    },
    getFlag(name: string) {
      return name === "a2a-server" ? cliStart : undefined;
    },
  } as unknown as ExtensionAPI;
  const ui = {
    notify(message: string, type?: string) {
      notifications.push({ message, type });
    },
  };
  const context = {
    cwd: "/fixture/workspace",
    ui,
    hasUI: true,
    mode: "tui",
  } as unknown as ExtensionCommandContext;

  createA2ARegistration(dependencies)(pi);
  return {
    commands,
    context,
    eventHandlers,
    flags,
    notifications,
    counts: {
      get starts() {
        return starts;
      },
      get stops() {
        return stops;
      },
      get closes() {
        return closes;
      },
      get executeCalls() {
        return executeCalls;
      },
      get createdMaxContexts() {
        return createdMaxContexts;
      },
    },
  };
}

test("loading the A2A extension registers commands without starting a listener", () => {
  const app = fixture();
  assert.equal(app.commands.has("a2a-server"), true);
  assert.equal(app.flags.get("a2a-server")?.type, "boolean");
  assert.equal(app.flags.get("a2a-server")?.default, false);
  assert.equal(app.counts.starts, 0);
});

test("the A2A command starts, reports, and stops one server idempotently", async () => {
  const app = fixture();
  const command = app.commands.get("a2a-server")!;

  await command.handler("start", app.context);
  await command.handler("start", app.context);
  await command.handler("status", app.context);
  assert.equal(app.counts.starts, 1);
  assert.equal(
    app.notifications.some(({ message }) =>
      message.includes("http://127.0.0.1:10000") &&
      message.includes("/fixture/workspace")
    ),
    true,
  );

  await command.handler("stop", app.context);
  await command.handler("stop", app.context);
  assert.equal(app.counts.stops, 1);
  assert.equal(app.counts.closes, 1);
});

test("auto-start requires an explicit flag and session shutdown closes the host", async () => {
  const disabled = fixture(false);
  await disabled.eventHandlers.get("session_start")!({}, disabled.context);
  assert.equal(disabled.counts.starts, 0);

  const enabled = fixture(true);
  await enabled.eventHandlers.get("session_start")!({}, enabled.context);
  assert.equal(enabled.counts.starts, 1);
  await enabled.eventHandlers.get("session_shutdown")!({}, enabled.context);
  assert.equal(enabled.counts.stops, 1);
  assert.equal(enabled.counts.closes, 1);
});

test("the --a2a-server CLI flag starts the listener on session startup", async () => {
  const app = fixture(false, true, "512");
  await app.eventHandlers.get("session_start")!({}, app.context);
  assert.equal(app.counts.starts, 1);
  assert.equal(app.counts.createdMaxContexts, 512);
  assert.equal(
    app.notifications.some(({ message }) => message.includes("http://127.0.0.1:10000")),
    true,
  );
});
