import assert from "node:assert/strict";
import * as http from "node:http";
import test from "node:test";
import { createConfiguredPiA2AServer, PiA2AServer } from "./server.ts";
import {
  TEST_TOKEN,
  authenticatedFetch,
  postJson,
  sendMessageRequest,
  startOnEphemeralPort,
} from "./fixtures.ts";

function createServer(overrides: Partial<ConstructorParameters<typeof PiA2AServer>[0]> = {}) {
  return new PiA2AServer({
    host: "127.0.0.1",
    port: 0,
    bearerToken: TEST_TOKEN,
    maxBodyBytes: 1_048_576,
    maxTasks: 16,
    executionTimeoutMs: 30_000,
    execute: async ({ message }) => ({
      state: "TASK_STATE_COMPLETED",
      text: `executed:${message}`,
    }),
    ...overrides,
  });
}

test("configured server factory requires the environment token", () => {
  assert.throws(() => createConfiguredPiA2AServer(
    async () => ({ state: "TASK_STATE_COMPLETED", text: "unused" }),
    {},
  ), /PI_A2A_BEARER_TOKEN/);
});

test("server constructor rejects non-loopback hosts and bodies over one MiB", () => {
  assert.throws(() => createServer({ host: "0.0.0.0" }), /loopback/);
  assert.throws(() => createServer({ maxBodyBytes: 1_048_577 }), /1 MiB/);
  assert.throws(() => createServer({ maxTasks: 1_025 }), /maxTasks/);
});

test("concurrent server stops coalesce", async () => {
  const server = createServer();
  await startOnEphemeralPort(server);

  await Promise.all([server.stop(), server.stop()]);
  assert.equal(server.isRunning(), false);
});

test("server stop serializes against in-flight startup", async () => {
  const server = createServer();

  const starting = server.start();
  const stopping = server.stop();
  await Promise.all([starting, stopping]);

  assert.equal(server.isRunning(), false);
});

test("server startup waits for an in-flight stop", async () => {
  const server = createServer();
  await startOnEphemeralPort(server);

  const stopping = server.stop();
  const restarting = server.start();
  await Promise.all([stopping, restarting]);

  assert.equal(server.isRunning(), true);
  await server.stop();
});

test("a final stop is ordered after a restart queued during shutdown", async (t) => {
  let startedResolve!: () => void;
  const started = new Promise<void>((resolve) => { startedResolve = resolve; });
  let abortingResolve!: () => void;
  const aborting = new Promise<void>((resolve) => { abortingResolve = resolve; });
  let releaseCleanup!: () => void;
  const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve; });
  const server = createServer({
    execute: async ({ signal }) => {
      startedResolve();
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          abortingResolve();
          void cleanup.then(resolve);
        }, { once: true });
      });
      return { state: "TASK_STATE_CANCELED", text: "canceled" };
    },
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);
  const request = postJson(url, sendMessageRequest("hold", "ctx-lifecycle-order"));
  await started;

  const stopping = server.stop();
  await aborting;
  const restarting = server.start();
  const finalStop = server.stop();
  releaseCleanup();
  await Promise.allSettled([request, stopping, restarting, finalStop]);

  assert.equal(server.isRunning(), false);
});

test("server exposes an authenticated canonical Agent Card without wildcard CORS", async (t) => {
  const server = createServer();
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const unauthenticated = await fetch(`${url}/.well-known/agent-card.json`);
  assert.equal(unauthenticated.status, 401);

  const wrongToken = await authenticatedFetch(
    `${url}/.well-known/agent-card.json`,
    {},
    "wrong-token",
  );
  assert.equal(wrongToken.status, 401);

  const response = await authenticatedFetch(`${url}/.well-known/agent-card.json`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);

  const card = await response.json();
  assert.equal(card.supportedInterfaces[0].url, url);
  assert.equal(card.supportedInterfaces[0].protocolVersion, "1.0");

  for (const alias of ["/.well-known/agent-card", "/.well-known/agent.json"]) {
    const aliasResponse = await authenticatedFetch(`${url}${alias}`);
    assert.equal(aliasResponse.status, 200, alias);
    assert.equal((await aliasResponse.json()).supportedInterfaces[0].url, url);
  }
});

test("SendMessage forwards Hermes text and returns a wrapped completed task", async (t) => {
  const calls: unknown[] = [];
  const server = createServer({
    execute: async (input) => {
      calls.push(input);
      return { state: "TASK_STATE_COMPLETED", text: "PI_A2A_OK" };
    },
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const response = await postJson(url, sendMessageRequest("hello", "ctx-123"));
  assert.equal(response.status, 200);
  const payload = await response.json();

  assert.equal(payload.jsonrpc, "2.0");
  assert.equal(payload.id, "rpc-1");
  assert.equal(payload.result.task.contextId, "ctx-123");
  assert.equal(payload.result.task.status.state, "TASK_STATE_COMPLETED");
  assert.equal(payload.result.task.artifacts[0].parts[0].text, "PI_A2A_OK");
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { message: string }).message, "hello");
  assert.equal((calls[0] as { contextId: string }).contextId, "ctx-123");
  assert.ok((calls[0] as { signal: AbortSignal }).signal instanceof AbortSignal);
});

test("SendMessage continues an input-required task by taskId", async (t) => {
  const calls: Array<{ taskId: string; contextId: string; message: string }> = [];
  const server = createServer({
    execute: async (input) => {
      calls.push(input);
      return calls.length === 1
        ? { state: "TASK_STATE_INPUT_REQUIRED", text: "need more" }
        : { state: "TASK_STATE_COMPLETED", text: "continued" };
    },
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);
  const firstResponse = await postJson(url, sendMessageRequest("start", "ctx-task"));
  const firstTask = (await firstResponse.json()).result.task;

  const continuation = await postJson(url, {
    jsonrpc: "2.0",
    id: "rpc-continue",
    method: "SendMessage",
    params: {
      message: {
        messageId: "message-continue",
        taskId: firstTask.id,
        role: "ROLE_USER",
        parts: [{ text: "more" }],
      },
    },
  });
  const continuedTask = (await continuation.json()).result.task;
  assert.equal(continuedTask.id, firstTask.id);
  assert.equal(continuedTask.contextId, "ctx-task");
  assert.equal(continuedTask.status.state, "TASK_STATE_COMPLETED");
  assert.deepEqual(calls.map(({ taskId, contextId, message }) => ({
    taskId,
    contextId,
    message,
  })), [
    { taskId: firstTask.id, contextId: "ctx-task", message: "start" },
    { taskId: firstTask.id, contextId: "ctx-task", message: "more" },
  ]);

  const missing = await postJson(url, {
    jsonrpc: "2.0",
    id: "rpc-missing-task",
    method: "SendMessage",
    params: {
      message: {
        messageId: "message-missing",
        taskId: "task-missing",
        role: "ROLE_USER",
        parts: [{ text: "more" }],
      },
    },
  });
  assert.equal((await missing.json()).error.code, -32001);
});

test("SendMessage rejects continuation of a terminal task", async (t) => {
  const server = createServer();
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);
  const firstResponse = await postJson(url, sendMessageRequest("start", "ctx-terminal-send"));
  const firstTask = (await firstResponse.json()).result.task;

  const continuation = await postJson(url, {
    jsonrpc: "2.0",
    id: "rpc-terminal-send",
    method: "SendMessage",
    params: {
      message: {
        messageId: "message-terminal-send",
        taskId: firstTask.id,
        contextId: firstTask.contextId,
        role: "ROLE_USER",
        parts: [{ text: "more" }],
      },
    },
  });
  assert.equal((await continuation.json()).error.code, -32004);
});

test("SendMessage rejects a taskId paired with a different contextId", async (t) => {
  const server = createServer({
    execute: async () => ({ state: "TASK_STATE_INPUT_REQUIRED", text: "need more" }),
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);
  const firstResponse = await postJson(url, sendMessageRequest("start", "ctx-original"));
  const firstTask = (await firstResponse.json()).result.task;

  const continuation = await postJson(url, {
    jsonrpc: "2.0",
    id: "rpc-context-mismatch",
    method: "SendMessage",
    params: {
      message: {
        messageId: "message-context-mismatch",
        taskId: firstTask.id,
        contextId: "ctx-other",
        role: "ROLE_USER",
        parts: [{ text: "more" }],
      },
    },
  });
  assert.equal((await continuation.json()).error.code, -32602);
});

test("SendMessage generates a context for an identifier-free new task", async (t) => {
  const calls: Array<{ contextId: string }> = [];
  const server = createServer({
    execute: async (input) => {
      calls.push(input);
      return { state: "TASK_STATE_COMPLETED", text: "created" };
    },
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const response = await postJson(url, {
    jsonrpc: "2.0",
    id: "rpc-no-identifiers",
    method: "SendMessage",
    params: {
      message: {
        messageId: "message-no-identifiers",
        role: "ROLE_USER",
        parts: [{ text: "new task" }],
      },
    },
  });
  const task = (await response.json()).result.task;
  assert.match(task.contextId, /^ctx-[A-Za-z0-9-]+$/);
  assert.equal(calls[0].contextId, task.contextId);
});

test("SendMessage preserves an auth-required execution outcome", async (t) => {
  const server = createServer({
    execute: async () => ({
      state: "TASK_STATE_AUTH_REQUIRED",
      text: "authentication required",
    }),
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const response = await postJson(url, sendMessageRequest("authenticate", "ctx-auth"));
  const task = (await response.json()).result.task;
  assert.equal(task.status.state, "TASK_STATE_AUTH_REQUIRED");
  assert.equal(task.status.message.taskId, task.id);
  assert.equal(task.status.message.contextId, "ctx-auth");
});

test("server returns JSON-RPC errors for unknown methods and malformed requests", async (t) => {
  const server = createServer();
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const unknown = await postJson(url, {
    jsonrpc: "2.0",
    id: 7,
    method: "UnknownMethod",
    params: {},
  });
  assert.equal(unknown.status, 200);
  assert.deepEqual(await unknown.json(), {
    jsonrpc: "2.0",
    id: 7,
    error: { code: -32601, message: "Method not found" },
  });

  const malformed = await authenticatedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 200);
  const malformedPayload = await malformed.json();
  assert.equal(malformedPayload.id, null);
  assert.equal(malformedPayload.error.code, -32700);

  const nonObject = await postJson(url, null);
  assert.equal(nonObject.status, 200);
  assert.deepEqual(await nonObject.json(), {
    jsonrpc: "2.0",
    id: null,
    error: { code: -32600, message: "Invalid Request" },
  });
});

test("SendMessage rejects missing messages and malformed parts before execution", async (t) => {
  let executions = 0;
  const server = createServer({
    execute: async () => {
      executions++;
      return { state: "TASK_STATE_COMPLETED", text: "unexpected" };
    },
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const missing = await postJson(url, {
    jsonrpc: "2.0",
    id: "missing",
    method: "SendMessage",
    params: {},
  });
  assert.equal((await missing.json()).error.code, -32602);

  const malformed = {
    jsonrpc: "2.0",
    id: "malformed",
    method: "SendMessage",
    params: {
      message: {
        messageId: "msg-malformed",
        contextId: "ctx-malformed",
        role: "ROLE_USER",
        parts: [{}],
      },
    },
  };
  const malformedResponse = await postJson(url, malformed);
  assert.equal((await malformedResponse.json()).error.code, -32602);
  assert.equal(executions, 0);
});

test("server rejects oversized JSON before invoking the executor", async (t) => {
  let executions = 0;
  const server = createServer({
    maxBodyBytes: 128,
    execute: async () => {
      executions++;
      return { state: "TASK_STATE_COMPLETED", text: "unexpected" };
    },
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const response = await postJson(url, sendMessageRequest("x".repeat(512)));
  assert.equal(response.status, 413);
  assert.equal(executions, 0);
});

test("server returns 413 as soon as a streaming body crosses the limit", async (t) => {
  const server = createServer({ maxBodyBytes: 128 });
  t.after(() => server.stop());
  const url = new URL(await startOnEphemeralPort(server));
  let request!: http.ClientRequest;
  const response = new Promise<number>((resolve, reject) => {
    request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: "/",
      method: "POST",
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    }, (result) => {
      resolve(result.statusCode ?? 0);
      result.resume();
    });
    request.on("error", reject);
    request.write("x".repeat(129));
  });
  t.after(() => request.destroy());

  const outcome = await Promise.race([
    response,
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 100)),
  ]);
  request.destroy();
  assert.equal(outcome, 413);
});

test("server shutdown aborts an admitted authenticated partial body", async () => {
  let executions = 0;
  const server = createServer({
    execute: async () => {
      executions++;
      return { state: "TASK_STATE_COMPLETED", text: "unexpected" };
    },
  });
  const url = new URL(await startOnEphemeralPort(server));
  const request = http.request({
    hostname: url.hostname,
    port: url.port,
    path: "/",
    method: "POST",
    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
  });
  request.on("error", () => {});
  const connected = new Promise<void>((resolve) => {
    request.once("socket", (socket) => {
      if (socket.readyState === "open") resolve();
      else socket.once("connect", resolve);
    });
  });
  request.write(JSON.stringify(sendMessageRequest("shutdown", "ctx-shutdown")).slice(0, -1));
  await connected;

  const stopping = server.stop();
  const outcome = await Promise.race([
    stopping.then(() => "stopped" as const),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 100)),
  ]);
  request.destroy();
  await stopping;

  assert.equal(outcome, "stopped");
  assert.equal(executions, 0);
});

test("GetTask and ListTasks expose bounded completed task state", async (t) => {
  const server = createServer({ maxTasks: 2 });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const sent = await postJson(url, sendMessageRequest("one", "ctx-one", "send-1"));
  const task = (await sent.json()).result.task;

  const getResponse = await postJson(url, {
    jsonrpc: "2.0",
    id: "get-1",
    method: "GetTask",
    params: { taskId: task.id },
  });
  assert.deepEqual((await getResponse.json()).result, task);

  const listResponse = await postJson(url, {
    jsonrpc: "2.0",
    id: "list-1",
    method: "ListTasks",
    params: {},
  });
  const listed = await listResponse.json();
  assert.equal(listed.result.tasks.length, 1);
  assert.equal(listed.result.tasks[0].id, task.id);
  assert.equal("artifacts" in listed.result.tasks[0], false);
  assert.equal(listed.result.pageSize, 50);
  assert.equal(listed.result.totalSize, 1);

  const unsafeId = await postJson(url, {
    jsonrpc: "2.0",
    id: "unsafe-id",
    method: "GetTask",
    params: { taskId: "../../bad" },
  });
  assert.equal((await unsafeId.json()).error.code, -32602);
});

test("CancelTask rejects an already-terminal task", async (t) => {
  const server = createServer();
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);
  const sent = await postJson(url, sendMessageRequest("done", "ctx-terminal"));
  const taskId = (await sent.json()).result.task.id;

  const response = await postJson(url, {
    jsonrpc: "2.0",
    id: "cancel-terminal",
    method: "CancelTask",
    params: { id: taskId },
  });
  assert.equal((await response.json()).error.code, -32002);
});

test("ListTasks filters and follows cursor pagination", async (t) => {
  const server = createServer();
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);
  for (const [messageId, contextId] of [
    ["one", "ctx-page"],
    ["two", "ctx-page"],
    ["three", "ctx-other"],
  ]) {
    await postJson(url, sendMessageRequest(messageId, contextId));
  }

  const firstResponse = await postJson(url, {
    jsonrpc: "2.0",
    id: "list-first",
    method: "ListTasks",
    params: {
      contextId: "ctx-page",
      status: "TASK_STATE_COMPLETED",
      pageSize: 1,
      includeArtifacts: true,
    },
  });
  const first = (await firstResponse.json()).result;
  assert.equal(first.tasks.length, 1);
  assert.equal(first.tasks[0].artifacts.length, 1);
  assert.equal(first.totalSize, 2);
  assert.notEqual(first.nextPageToken, "");

  const secondResponse = await postJson(url, {
    jsonrpc: "2.0",
    id: "list-second",
    method: "ListTasks",
    params: {
      contextId: "ctx-page",
      pageSize: 1,
      pageToken: first.nextPageToken,
    },
  });
  const second = (await secondResponse.json()).result;
  assert.equal(second.tasks.length, 1);
  assert.notEqual(second.tasks[0].id, first.tasks[0].id);
  assert.equal(second.nextPageToken, "");
  assert.equal(second.totalSize, 2);

  const authRequiredResponse = await postJson(url, {
    jsonrpc: "2.0",
    id: "list-auth-required",
    method: "ListTasks",
    params: { status: "TASK_STATE_AUTH_REQUIRED" },
  });
  const authRequired = (await authRequiredResponse.json()).result;
  assert.deepEqual(authRequired.tasks, []);
  assert.equal(authRequired.totalSize, 0);
});

test("bounded task storage preserves an input-required task for continuation", async (t) => {
  let executions = 0;
  const server = createServer({
    maxTasks: 1,
    execute: async () => {
      executions++;
      return executions === 1
        ? { state: "TASK_STATE_INPUT_REQUIRED", text: "clarify" }
        : { state: "TASK_STATE_COMPLETED", text: "done" };
    },
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const first = await postJson(url, sendMessageRequest("one", "ctx-one", "send-1"));
  const firstTask = (await first.json()).result.task;
  assert.equal(firstTask.status.state, "TASK_STATE_INPUT_REQUIRED");

  const second = await postJson(url, sendMessageRequest("two", "ctx-two", "send-2"));
  assert.equal((await second.json()).error.code, -32050);
  assert.equal(executions, 1);

  const continuation = await postJson(url, {
    jsonrpc: "2.0",
    id: "continue-retained",
    method: "SendMessage",
    params: {
      message: {
        messageId: "continue-retained-message",
        taskId: firstTask.id,
        role: "ROLE_USER",
        parts: [{ text: "clarification" }],
      },
    },
  });
  const continuedTask = (await continuation.json()).result.task;
  assert.equal(continuedTask.id, firstTask.id);
  assert.equal(continuedTask.status.state, "TASK_STATE_COMPLETED");
  assert.equal(executions, 2);
});

test("a second active SendMessage fails clearly with HTTP 429", async (t) => {
  let startedResolve!: (taskId: string) => void;
  const started = new Promise<string>((resolve) => { startedResolve = resolve; });
  let executions = 0;
  const server = createServer({
    execute: ({ taskId, signal }) => new Promise((resolve) => {
      executions++;
      startedResolve(taskId);
      signal.addEventListener("abort", () => {
        resolve({ state: "TASK_STATE_CANCELED", text: "canceled" });
      }, { once: true });
    }),
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const first = postJson(url, sendMessageRequest("first", "ctx-first"));
  const taskId = await started;
  const second = await postJson(url, sendMessageRequest("second", "ctx-second", "send-2"));
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error.code, -32051);
  assert.equal(executions, 1);

  await postJson(url, {
    jsonrpc: "2.0",
    id: "cancel-first",
    method: "CancelTask",
    params: { taskId },
  });
  await first;
});

test("the server stays busy until canceled executor cleanup settles", async (t) => {
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  let cleanupStarted!: () => void;
  const aborting = new Promise<void>((resolve) => { cleanupStarted = resolve; });
  let releaseCleanup!: () => void;
  const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve; });
  let calls = 0;
  const server = createServer({
    execute: async ({ signal }) => {
      calls++;
      if (calls > 1) return { state: "TASK_STATE_COMPLETED", text: "next" };
      firstStarted();
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          cleanupStarted();
          void cleanup.then(resolve);
        }, { once: true });
      });
      return { state: "TASK_STATE_CANCELED", text: "stopped" };
    },
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const first = postJson(url, sendMessageRequest("first", "ctx-cleanup"));
  await started;
  const tasks = await postJson(url, {
    jsonrpc: "2.0",
    id: "list-active",
    method: "ListTasks",
    params: {},
  });
  const taskId = (await tasks.json()).result.tasks[0].id;
  await postJson(url, {
    jsonrpc: "2.0",
    id: "cancel-cleanup",
    method: "CancelTask",
    params: { taskId },
  });
  await aborting;
  await first;

  const duringCleanup = await postJson(
    url,
    sendMessageRequest("too soon", "ctx-too-soon"),
  );
  releaseCleanup();
  assert.equal(duringCleanup.status, 429);

  await new Promise<void>((resolve) => setImmediate(resolve));
  const afterCleanup = await postJson(url, sendMessageRequest("next", "ctx-next"));
  assert.equal(afterCleanup.status, 200);
  assert.equal((await afterCleanup.json()).result.task.status.state, "TASK_STATE_COMPLETED");
});

test("CancelTask aborts one active executor and settles the original task as canceled", async (t) => {
  let startedResolve!: (taskId: string) => void;
  const started = new Promise<string>((resolve) => { startedResolve = resolve; });
  let aborts = 0;
  const server = createServer({
    execute: ({ taskId, signal }) => new Promise((resolve) => {
      startedResolve(taskId);
      signal.addEventListener("abort", () => {
        aborts++;
        resolve({ state: "TASK_STATE_CANCELED", text: "canceled" });
      }, { once: true });
    }),
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const sendPromise = postJson(url, sendMessageRequest("wait", "ctx-cancel"));
  const taskId = await started;
  const cancelResponse = await postJson(url, {
    jsonrpc: "2.0",
    id: "cancel-1",
    method: "CancelTask",
    params: { taskId },
  });
  const canceled = await cancelResponse.json();
  assert.equal(canceled.result.status.state, "TASK_STATE_CANCELED");

  const original = await (await sendPromise).json();
  assert.equal(original.result.task.status.state, "TASK_STATE_CANCELED");
  assert.equal(aborts, 1);
});

test("CancelTask settles the original request when the executor ignores abort", async (t) => {
  let startedResolve!: (taskId: string) => void;
  const started = new Promise<string>((resolve) => { startedResolve = resolve; });
  let release!: (result: {
    state: "TASK_STATE_COMPLETED";
    text: string;
  }) => void;
  const server = createServer({
    execute: ({ taskId }) => new Promise((resolve) => {
      startedResolve(taskId);
      release = resolve;
    }),
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const request = postJson(url, sendMessageRequest("wait", "ctx-cancel-ignores"));
  const taskId = await started;
  await postJson(url, {
    jsonrpc: "2.0",
    id: "cancel-ignores",
    method: "CancelTask",
    params: { taskId },
  });
  const outcome = await Promise.race([
    request.then(() => "settled" as const),
    new Promise<"pending">((resolve) => {
      setTimeout(() => resolve("pending"), 100);
    }),
  ]);
  release({ state: "TASK_STATE_COMPLETED", text: "late result" });
  const task = (await (await request).json()).result.task;

  assert.equal(outcome, "settled");
  assert.equal(task.status.state, "TASK_STATE_CANCELED");
});

test("disconnecting a SendMessage client aborts its executor", async (t) => {
  let started!: () => void;
  const executionStarted = new Promise<void>((resolve) => { started = resolve; });
  let aborted!: () => void;
  const executionAborted = new Promise<void>((resolve) => { aborted = resolve; });
  const server = createServer({
    execute: ({ signal }) => new Promise((resolve) => {
      started();
      signal.addEventListener("abort", () => {
        aborted();
        resolve({ state: "TASK_STATE_CANCELED", text: "disconnected" });
      }, { once: true });
    }),
  });
  t.after(() => server.stop());
  const url = new URL(await startOnEphemeralPort(server));
  const body = JSON.stringify(sendMessageRequest("disconnect", "ctx-disconnect"));
  const request = http.request({
    hostname: url.hostname,
    port: url.port,
    path: "/",
    method: "POST",
    headers: {
      Authorization: `Bearer ${TEST_TOKEN}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  });
  request.on("error", () => {});
  request.end(body);
  await executionStarted;
  request.destroy();

  const outcome = await Promise.race([
    executionAborted.then(() => "aborted" as const),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 100)),
  ]);
  assert.equal(outcome, "aborted");
});

test("execution timeout aborts the executor once and returns a failed task", async (t) => {
  let aborts = 0;
  const server = createServer({
    executionTimeoutMs: 10,
    execute: ({ signal }) => new Promise((resolve) => {
      signal.addEventListener("abort", () => {
        aborts++;
        resolve({ state: "TASK_STATE_CANCELED", text: "executor stopped" });
      }, { once: true });
    }),
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const response = await postJson(url, sendMessageRequest("time out", "ctx-timeout"));
  const task = (await response.json()).result.task;
  assert.equal(task.status.state, "TASK_STATE_FAILED");
  assert.equal(task.status.message.parts[0].text, "execution timed out");
  assert.equal(aborts, 1);
});

test("execution timeout settles even when the executor ignores abort", async (t) => {
  let release!: (result: {
    state: "TASK_STATE_COMPLETED";
    text: string;
  }) => void;
  const server = createServer({
    executionTimeoutMs: 10,
    execute: () => new Promise((resolve) => { release = resolve; }),
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const request = postJson(url, sendMessageRequest("ignore abort", "ctx-uncooperative"));
  const outcome = await Promise.race([
    request.then(() => "settled" as const),
    new Promise<"pending">((resolve) => {
      setTimeout(() => resolve("pending"), 100);
    }),
  ]);
  release({ state: "TASK_STATE_COMPLETED", text: "late result" });
  const task = (await (await request).json()).result.task;

  assert.equal(outcome, "settled");
  assert.equal(task.status.state, "TASK_STATE_FAILED");
  assert.equal(task.status.message.parts[0].text, "execution timed out");
});

test("executor cannot return a nonterminal task state", async (t) => {
  const server = createServer({
    execute: async () => ({
      state: "TASK_STATE_WORKING",
      text: "not final",
    }),
  });
  t.after(() => server.stop());
  const url = await startOnEphemeralPort(server);

  const response = await postJson(url, sendMessageRequest("finish", "ctx-nonterminal"));
  const task = (await response.json()).result.task;
  assert.equal(task.status.state, "TASK_STATE_FAILED");
  assert.match(task.status.message.parts[0].text, /terminal task state/);
});
