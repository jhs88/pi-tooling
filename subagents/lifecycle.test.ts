import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { executeVisibleSubagent, type ToolResult } from "./visible.ts";

test("foreground resume forwards only current child session events and releases its subscription", async () => {
  const key = Symbol.for("pi-subagents:manager"); const globals = globalThis as Record<symbol, unknown>; const previous = globals[key];
  let handler: ((event: unknown) => void) | undefined;
  let sessionListeners = 0;
  const record = { id: "resume-one", type: "Explore", status: "completed", result: "Old result must not become new progress", session: { state: { messages: [] }, subscribe(callback: (event: unknown) => void) { handler = callback; sessionListeners++; return () => { handler = undefined; sessionListeners--; }; } } };
  globals[key] = { getRecord(id: string) { assert.equal(id, record.id); return record; } };
  const updates: ToolResult[] = [];
  try {
    const final = await executeVisibleSubagent({ name: "Agent", description: "original", parameters: Type.Object({}), async execute() {
      record.status = "running";
      handler?.({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "New resume activity" }] } });
      record.status = "completed"; record.result = "New resume result";
      return { content: [{ type: "text", text: record.result }], details: { status: record.status, agentId: record.id } };
    } }, "resume-call", { resume: record.id, subagent_type: "Explore", prompt: "Continue investigation" }, undefined, (result) => updates.push(result), { on() { return () => {}; }, emit() {} });
    assert.equal(updates.length, 1);
    assert.equal(updates[0].details.results![0].messages[0].content[0].text, "New resume activity");
    assert.equal(final.details.results![0].messages[0].content[0].text, "New resume result");
    assert.equal(sessionListeners, 0);
  } finally { if (previous === undefined) delete globals[key]; else globals[key] = previous; }
});

test("a stopped joined child keeps the tool open until its targeted run promise settles", async () => {
  const key = Symbol.for("pi-subagents:manager"); const globals = globalThis as Record<symbol, unknown>; const previous = globals[key];
  let settle: (() => void) | undefined;
  const record = { id: "settle-owned", type: "Explore", status: "stopped", promise: new Promise<void>((resolve) => { settle = resolve; }) };
  globals[key] = { getRecord(id: string) { assert.equal(id, record.id); return record; } };
  let ended = false;
  try {
    const pending = executeVisibleSubagent({ name: "Agent", description: "original", parameters: Type.Object({}), async execute() {
      return { content: [{ type: "text", text: "receipt" }], details: { status: "background", agentId: record.id } };
    } }, "call", { subagent_type: "Explore", prompt: "Inspect" }, undefined, undefined, { on() { return () => {}; }, emit() {} },
      { name: "get_subagent_result", description: "reader", parameters: Type.Object({}), async execute() { return { content: [{ type: "text", text: "Stopped child" }], details: { status: "stopped" } }; } }).then((result) => { ended = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(ended, false);
    settle?.();
    const final = await pending;
    assert.equal(final.details.results![0].finished, true);
    assert.equal(final.isError, true);
  } finally { if (previous === undefined) delete globals[key]; else globals[key] = previous; }
});

test("partial bus-subscription failure cleans already installed listeners without spawning", async () => {
  let listeners = 0;
  await assert.rejects(executeVisibleSubagent({ name: "Agent", description: "original", parameters: Type.Object({}), async execute() { assert.fail("spawned"); } }, "id", {}, undefined, undefined, {
    on(event) { if (event === "subagents:failed") throw new Error("Subscription unavailable"); listeners++; return () => { listeners--; }; }, emit() {},
  }), /Subscription unavailable/);
  assert.equal(listeners, 0);
});

test("a throwing stop-channel listener cannot skip targeted child cancellation or cleanup", async () => {
  const key = Symbol.for("pi-subagents:manager"); const globals = globalThis as Record<symbol, unknown>; const previous = globals[key];
  const childController = new AbortController();
  const record = { id: "stop-failure", type: "Explore", status: "running", abortController: childController };
  globals[key] = { getRecord(id: string) { assert.equal(id, record.id); return record; } };
  let listeners = 0;
  const controller = new AbortController();
  childController.signal.addEventListener("abort", () => { record.status = "stopped"; });
  try {
    const final = await executeVisibleSubagent({ name: "Agent", description: "original", parameters: Type.Object({}), async execute() {
      // Cancellation arrives while startup is in progress, before the receipt.
      controller.abort();
      return { content: [{ type: "text", text: "receipt" }], details: { status: "background", agentId: record.id } };
    } }, "call", { subagent_type: "Explore", prompt: "Inspect" }, controller.signal, undefined, {
      on() { listeners++; return () => { listeners--; }; },
      emit(event) { if (event === "subagents:rpc:stop") throw new Error("Broken stop extension"); },
    }, { name: "get_subagent_result", description: "reader", parameters: Type.Object({}), async execute() { return { content: [{ type: "text", text: "Stopped child" }], details: { status: "stopped" } }; } });
    assert.equal(childController.signal.aborted, true);
    assert.equal(final.details.results![0].finished, true);
    assert.equal(final.details.results![0].stopReason, "aborted");
    assert.equal(final.isError, true);
    assert.equal(listeners, 0);
  } finally { if (previous === undefined) delete globals[key]; else globals[key] = previous; }
});
