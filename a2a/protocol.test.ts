import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentCard,
  extractUserText,
  jsonRpcError,
  MAX_A2A_TASK_TEXT_BYTES,
  taskFromExecution,
} from "./protocol.ts";

const interfaceUrl = "http://127.0.0.1:10000";

test("buildAgentCard advertises only the implemented JSON-RPC v1 interface", () => {
  const card = buildAgentCard({ interfaceUrl });

  assert.equal(card.name, "pi-coding-agent");
  assert.deepEqual(card.capabilities, {
    streaming: false,
    pushNotifications: false,
    extendedAgentCard: false,
  });
  assert.deepEqual(card.supportedInterfaces, [{
    protocolBinding: "JSONRPC",
    protocolVersion: "1.0",
    url: interfaceUrl,
  }]);
  assert.deepEqual(card.security, [{ bearer: [] }]);
  assert.equal(card.securitySchemes.bearer.type, "http");
  assert.equal(card.securitySchemes.bearer.scheme, "bearer");
});

test("extractUserText accepts Hermes v1 member-presence text parts", () => {
  const extracted = extractUserText({
    messageId: "message-1",
    contextId: "ctx-1",
    role: "ROLE_USER",
    parts: [
      { text: "first", mediaType: "text/plain" },
      { data: { ignored: true }, mediaType: "application/json" },
      { text: "second" },
    ],
  });

  assert.deepEqual(extracted, {
    contextId: "ctx-1",
    messageId: "message-1",
    text: "first\nsecond",
  });
});

test("extractUserText rejects non-user roles and empty text", () => {
  assert.throws(() => extractUserText({
    messageId: "m",
    contextId: "ctx",
    role: "ROLE_AGENT",
    parts: [{ text: "no" }],
  }), /ROLE_USER/);

  assert.throws(() => extractUserText({
    messageId: "m",
    contextId: "ctx",
    role: "ROLE_USER",
    parts: [{ data: {} }],
  }), /text part/);
});

test("taskFromExecution builds the wrapped A2A v1 completed task shape", () => {
  const task = taskFromExecution({
    taskId: "task-1",
    contextId: "ctx-1",
    text: "PI_A2A_OK",
    state: "TASK_STATE_COMPLETED",
  });

  assert.equal(task.id, "task-1");
  assert.equal(task.contextId, "ctx-1");
  assert.equal(task.status.state, "TASK_STATE_COMPLETED");
  assert.equal(task.artifacts[0]?.parts[0]?.text, "PI_A2A_OK");
  assert.equal(task.artifacts[0]?.parts[0]?.mediaType, "text/plain");
});

test("task status messages carry their task and context identity", () => {
  for (const state of [
    "TASK_STATE_INPUT_REQUIRED",
    "TASK_STATE_FAILED",
    "TASK_STATE_CANCELED",
    "TASK_STATE_REJECTED",
    "TASK_STATE_AUTH_REQUIRED",
  ] as const) {
    const task = taskFromExecution({
      taskId: `task-${state}`,
      contextId: "ctx-status",
      text: "status detail",
      state,
    });

    assert.equal(task.status.message?.taskId, `task-${state}`);
    assert.equal(task.status.message?.contextId, "ctx-status");
    assert.equal(task.status.message?.parts[0]?.text, "status detail");
  }
});

test("task text is UTF-8 safely bounded for retention and transport", () => {
  const task = taskFromExecution({
    taskId: "task-large",
    contextId: "ctx-large",
    text: "😀".repeat(MAX_A2A_TASK_TEXT_BYTES),
    state: "TASK_STATE_COMPLETED",
  });
  const text = task.artifacts[0]?.parts[0]?.text ?? "";

  assert.ok(Buffer.byteLength(text, "utf8") <= MAX_A2A_TASK_TEXT_BYTES);
  assert.match(text, /Output truncated.*canonical Pi session/s);
  assert.equal(text.includes("�"), false);
});

test("jsonRpcError preserves a null id for parse failures", () => {
  assert.deepEqual(jsonRpcError(null, -32700, "Parse error"), {
    jsonrpc: "2.0",
    id: null,
    error: { code: -32700, message: "Parse error" },
  });
});
