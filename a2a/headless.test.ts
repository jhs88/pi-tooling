import assert from "node:assert/strict";
import test from "node:test";
import {
  runHeadlessA2AServer,
  type HeadlessA2ADependencies,
} from "./headless.ts";

function fixture() {
  let starts = 0;
  let stops = 0;
  let closes = 0;
  let createdMaxContexts: number | undefined;
  const ready: string[] = [];
  const dependencies: HeadlessA2ADependencies = {
    createHost(options) {
      createdMaxContexts = options.maxContexts;
      return {
        async execute() {
          return { state: "TASK_STATE_COMPLETED", text: "ok" };
        },
        async close() {
          closes++;
        },
      };
    },
    createServer() {
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
  return {
    dependencies,
    ready,
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
      get createdMaxContexts() {
        return createdMaxContexts;
      },
    },
  };
}

test("the headless runner serves until aborted and then closes cleanly", async () => {
  const app = fixture();
  const controller = new AbortController();
  const running = runHeadlessA2AServer({
    cwd: "/fixture/workspace",
    agentDir: "/fixture/agent",
    env: {
      PI_A2A_BEARER_TOKEN: "fixture-token",
      PI_A2A_MAX_CONTEXTS: "512",
    },
    signal: controller.signal,
    onReady(message) {
      app.ready.push(message);
    },
  }, app.dependencies);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.counts.starts, 1);
  assert.equal(app.counts.createdMaxContexts, 512);
  assert.deepEqual(app.ready, [
    "A2A server is running at http://127.0.0.1:10000 for /fixture/workspace",
  ]);

  controller.abort();
  await running;
  assert.equal(app.counts.stops, 1);
  assert.equal(app.counts.closes, 1);
});
