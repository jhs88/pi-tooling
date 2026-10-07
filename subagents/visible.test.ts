import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

// The pinned package ships TypeScript as CommonJS metadata. Strip this
// dependency-free module in memory rather than changing its package files.
const usageSource = readFileSync(new URL("../node_modules/@tintinweb/pi-subagents/src/usage.ts", import.meta.url), "utf8");
const usageModule = stripTypeScriptTypes(usageSource);
const { PendingUsagePool } = await import(`data:text/javascript;base64,${Buffer.from(usageModule).toString("base64")}`);
import { executeVisibleSubagent, type ExecutableTool, type ToolResult } from "./visible.ts";

function bus() {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const emitted: { event: string; data: { agentId?: string } }[] = [];
  return {
    emitted,
    on(event: string, handler: (data: unknown) => void) {
      const set = listeners.get(event) ?? new Set(); set.add(handler); listeners.set(event, set);
      return () => { set.delete(handler); };
    },
    emit(event: string, data: unknown) { emitted.push({ event, data: data as { agentId?: string } }); for (const handler of listeners.get(event) ?? []) handler(data); },
    count() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}
const args = { subagent_type: "Explore", prompt: "Inspect auth", description: "Auth audit" };
function tool(execute: ExecutableTool["execute"]): ExecutableTool {
  return { name: "Agent", description: "Run child", parameters: Type.Object({}), execute };
}
function result(status: string, text: string, extra = {}): ToolResult {
  return { content: [{ type: "text", text }], details: { status, subagentType: "Explore", modelName: "fixture", ...extra } };
}

test("foreground progress and final carry stable T3 child identity and real activity", async () => {
  const events = bus();
  const updates: ToolResult[] = [];
  const final = await executeVisibleSubagent(tool(async (_id, forwarded, _signal, onUpdate) => {
    assert.equal(forwarded.run_in_background, false);
    onUpdate?.(result("running", "1 tool use", { activity: "Reading auth.ts" }));
    onUpdate?.(result("running", "2 tool uses", { activity: "Found missing permission check" }));
    return result("completed", "Verified missing permission check");
  }), "call", args, undefined, (update) => updates.push(update), events);
  assert.equal(updates.length, 2);
  assert.equal(updates[0].details.results![0].messages[0].content[0].text, "Reading auth.ts");
  assert.equal(updates[1].details.results![0].finished, false);
  assert.equal(final.details.results![0].step, updates[0].details.results![0].step);
  assert.equal(final.details.results![0].task, "Inspect auth");
  assert.equal(final.details.results![0].messages[0].content[0].text, "Verified missing permission check");
  assert.equal(final.details.results![0].finished, true);
  assert.equal(final.details.results![0].exitCode, 0);
  assert.equal(events.count(), 0);
});

test("explicit background and schedule are rejected before original execution", async () => {
  let calls = 0;
  const original = tool(async () => { calls++; return result("background", "receipt"); });
  const events = bus();
  await assert.rejects(executeVisibleSubagent(original, "id", { ...args, run_in_background: true }, undefined, undefined, events), /foreground-only/);
  await assert.rejects(executeVisibleSubagent(original, "id", { ...args, schedule: "1h" }, undefined, undefined, events), /scheduled/);
  assert.equal(calls, 0);
  assert.equal(events.count(), 0);
});

test("child errors, max-turn abort and stopped status never read as successful completion", async () => {
  for (const status of ["error", "aborted", "stopped"]) {
    const events = bus();
    const final = await executeVisibleSubagent(tool(async () => result(status, "Partial real output", { error: "Child failed" })), "id", args, undefined, undefined, events);
    assert.equal(final.isError, true);
    assert.equal(final.details.results![0].exitCode, 1);
    assert.equal(final.details.results![0].errorMessage, "Child failed");
    assert.equal(final.details.results![0].messages[0].content[0].text, "Partial real output");
    assert.equal(events.count(), 0);
  }
});

test("pre-spawn rejection does not invent a child lifecycle and thrown startup errors clean listeners", async () => {
  const events = bus();
  const noChild: ToolResult = { content: [{ type: "text", text: "Unknown type" }], details: {} };
  assert.deepEqual(await executeVisibleSubagent(tool(async () => noChild), "id", args, undefined, undefined, events), noChild);
  await assert.rejects(executeVisibleSubagent(tool(async () => { throw new Error("Worktree failed"); }), "id", args, undefined, undefined, events), /Worktree failed/);
  assert.equal(events.count(), 0);
});

test("running resume rejection names callable aliases but preserves child text and unknown-type identifiers", async () => {
  const events = bus();
  const resume = "live-steer_subagent";
  const text = `Agent "${resume}" is still running — it can only be resumed once its current run finishes.\nUse steer_subagent to send it a message mid-run, or get_subagent_result to wait for it.`;
  const rejected = await executeVisibleSubagent(tool(async () => ({ content: [{ type: "text", text }], details: {} })), "id", { ...args, resume }, undefined, undefined, events);
  assert.equal(rejected.content[0].type === "text" && rejected.content[0].text, `Agent "${resume}" is still running — it can only be resumed once its current run finishes.\nUse subagent_steer to send it a message mid-run, or subagent_result to wait for it.`);
  assert.equal(rejected.details.results, undefined);
  const authored = await executeVisibleSubagent(tool(async () => result("completed", text)), "id", { ...args, resume }, undefined, undefined, events);
  assert.equal(authored.content[0].type === "text" && authored.content[0].text, text);
  const unknown = 'Unknown or disabled agent type: "steer_subagent". Available: get_subagent_result.';
  const unexpected = await executeVisibleSubagent(tool(async () => ({ content: [{ type: "text", text: unknown }], details: {} })), "id", { ...args, subagent_type: "steer_subagent" }, undefined, undefined, events);
  assert.equal(unexpected.content[0].type === "text" && unexpected.content[0].text, unknown);
});

test("cancellation before execution creates no child; in-flight signal reaches original", async () => {
  const before = new AbortController(); before.abort(new Error("Already cancelled"));
  await assert.rejects(executeVisibleSubagent(tool(async () => { assert.fail("spawned"); }), "id", args, before.signal, undefined, bus()), /Already cancelled/);
  const events = bus();
  const controller = new AbortController();
  const final = await executeVisibleSubagent(tool(async (_id, _args, signal) => {
    controller.abort();
    assert.equal(signal?.aborted, true);
    return result("stopped", "Cancelled child");
  }), "id", args, controller.signal, undefined, events);
  assert.equal(final.isError, true);
  assert.equal(events.count(), 0);
});

test("frontmatter background is joined, consumed synchronously, never published as a finished receipt", async () => {
  const events = bus();
  const key = Symbol.for("pi-subagents:manager");
  const globals = globalThis as Record<symbol, unknown>;
  const previous = globals[key];
  const record = { id: "owned", type: "Explore", status: "running", result: undefined as string | undefined, session: { state: { messages: [{ role: "assistant", content: [{ type: "text", text: "Inspecting real fixture activity" }] }] } } };
  const unrelated = { id: "other", status: "running" };
  globals[key] = { getRecord(id: string) { assert.equal(id, "owned"); return record; } };
  const updates: ToolResult[] = [];
  let resolved = false;
  try {
    const pending = executeVisibleSubagent(tool(async () => result("background", "Agent started in background", { agentId: "owned" })), "call", args, undefined, (update) => updates.push(update), events,
      tool(async () => result("completed", "Real terminal child output", { agentId: "owned" }))).then((final) => { resolved = true; return final; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(resolved, false);
    assert.equal(updates[0].details.results![0].finished, false);
    record.status = "completed"; record.result = "Real terminal child output";
    events.emit("subagents:completed", { id: "owned" });
    assert.equal(events.emitted.at(-1)?.event, "subagents:rpc:consume");
    const final = await pending;
    assert.equal(final.content[0].type === "text" && final.content[0].text, "Real terminal child output");
    assert.equal(final.details.results![0].messages[0].content[0].text, "Real terminal child output");
    assert.equal(unrelated.status, "running");
    assert.equal(events.count(), 0);
  } finally { if (previous === undefined) delete globals[key]; else globals[key] = previous; }
});

test("joined completion drains pinned usage deltas once, sums receipt spend, and never recharges unrelated spend", async () => {
  const pool = new PendingUsagePool();
  const key = Symbol.for("pi-subagents:manager");
  const globals = globalThis as Record<symbol, unknown>; const previous = globals[key];
  const record = { id: "usage-owned", type: "Explore", status: "running", result: "Done" };
  globals[key] = { getRecord(id: string) { assert.equal(id, record.id); return record; } };
  const events = bus();
  const readerCalls: string[] = [];
  const reader = tool(async (id, forwarded) => {
    readerCalls.push(id);
    assert.deepEqual(forwarded, { agent_id: record.id, wait: false, verbose: false });
    return { content: [], details: {}, usage: pool.drain() };
  });
  try {
    pool.add({ input: 2, output: 0, cacheWrite: 0 }); // already-pending unrelated spend
    const final = await executeVisibleSubagent(tool(async () => {
      const receipt = { ...result("background", "receipt", { agentId: record.id }), usage: pool.drain() };
      setTimeout(() => {
        pool.add({ input: 11, output: 7, cacheRead: 3, cacheWrite: 2, cost: 0.125 });
        pool.add({ input: 0, output: 5, cacheWrite: 0 }); // concurrent child's unreported spend
        record.status = "completed";
        events.emit("subagents:completed", { id: record.id });
      }, 5);
      return receipt;
    }), "usage-call", args, undefined, undefined, events, reader);
    assert.deepEqual(readerCalls, ["usage-call"]);
    assert.deepEqual(final.usage, { input: 13, output: 12, cacheRead: 3, cacheWrite: 2, totalTokens: 30, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.125 } });
    assert.equal((await reader.execute("next-call", { agent_id: record.id, wait: false, verbose: false })).usage, undefined);
    assert.equal(events.count(), 0);
  } finally { if (previous === undefined) delete globals[key]; else globals[key] = previous; }
});

for (const mode of ["disabled", "already-reported"]) test(`joined usage never reconstructs cumulative spend when reporting is ${mode}`, async () => {
  const pool = new PendingUsagePool();
  const key = Symbol.for("pi-subagents:manager");
  const globals = globalThis as Record<symbol, unknown>; const previous = globals[key];
  const record = { id: "reported-owned", type: "Explore", status: "running", result: "Done", lifetimeUsage: { input: 100, output: 50, cacheWrite: 20 } };
  globals[key] = { getRecord(id: string) { assert.equal(id, record.id); return record; } };
  let reportedElsewhere: unknown;
  try {
    const reader = tool(async () => ({ content: [], details: {}, usage: mode === "disabled" ? undefined : pool.drain() }));
    const final = await executeVisibleSubagent(tool(async () => {
      setTimeout(() => {
        if (mode === "already-reported") {
          pool.add({ input: 11, output: 7, cacheRead: 3, cacheWrite: 2, cost: 0.125 });
          reportedElsewhere = pool.drain(); // another registered alias result consumed the shared pool
        }
        record.status = "completed";
      }, 5);
      return result("background", "receipt", { agentId: record.id });
    }), "call", args, undefined, undefined, bus(), reader);
    assert.equal(final.usage, undefined);
    if (mode === "already-reported") assert.ok(reportedElsewhere);
    assert.equal(pool.drain(), undefined);
  } finally { if (previous === undefined) delete globals[key]; else globals[key] = previous; }
});

test("joined child cancellation stops only the owned child and waits for terminal status", async () => {
  const events = bus();
  const key = Symbol.for("pi-subagents:manager");
  const globals = globalThis as Record<symbol, unknown>; const previous = globals[key];
  const childController = new AbortController();
  const record = { id: "cancel-owned", type: "Explore", status: "running", abortController: childController };
  globals[key] = { getRecord(id: string) { assert.equal(id, record.id); return record; } };
  const controller = new AbortController();
  let resolved = false;
  try {
    const pending = executeVisibleSubagent(tool(async () => result("background", "receipt", { agentId: record.id })), "call", args, controller.signal, undefined, events,
      tool(async () => result("stopped", "Child stopped", { agentId: record.id }))).then((result) => { resolved = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 10)); controller.abort();
    assert.equal(childController.signal.aborted, true);
    assert.equal(events.emitted.some(({ event, data }) => event === "subagents:rpc:stop" && data.agentId === record.id), true);
    assert.equal(resolved, false);
    record.status = "stopped";
    const final = await pending;
    assert.equal(final.details.results![0].stopReason, "aborted");
    assert.equal(events.count(), 0);
  } finally { if (previous === undefined) delete globals[key]; else globals[key] = previous; }
});

test("joined usage denial returns permission outcome, not private record output, and cleans listeners", async () => {
  const key = Symbol.for("pi-subagents:manager");
  const globals = globalThis as Record<symbol, unknown>; const previous = globals[key];
  const record = { id: "denied-read", type: "Explore", status: "completed", result: "Private child output" };
  globals[key] = { getRecord(id: string) { assert.equal(id, record.id); return record; } };
  const events = bus();
  try {
    const final = await executeVisibleSubagent(tool(async () => result("background", "Receipt", { agentId: record.id })), "call", args, undefined, undefined, events,
      tool(async () => ({ content: [{ type: "text", text: "Result read permission denied" }], details: {}, isError: true })));
    assert.equal(final.isError, true);
    assert.equal(final.content[0].type === "text" && final.content[0].text, "Result read permission denied");
    assert.equal(final.details.results, undefined);
    assert.equal(final.usage, undefined);
    assert.equal(events.count(), 0);
  } finally { if (previous === undefined) delete globals[key]; else globals[key] = previous; }
});

test("onUpdate failure aborts original and releases listeners", async () => {
  const events = bus();
  await assert.rejects(executeVisibleSubagent(tool(async (_id, _args, signal, update) => {
    update?.(result("running", "progress", { activity: "Reading file" }));
    assert.equal(signal?.aborted, true);
    return result("stopped", "Stopped");
  }), "id", args, undefined, () => { throw new Error("Broken renderer"); }, events), /Broken renderer/);
  assert.equal(events.count(), 0);
});

for (const joined of [false, true]) test(`final pipeline content and erased metadata never resurrect private fields, joined ${joined}`, async () => {
  const key = Symbol.for("pi-subagents:manager");
  const globals = globalThis as Record<symbol, unknown>; const previous = globals[key];
  const record = { id: "redacted-child", type: "SECRET type", status: "error", result: "SECRET output", error: "SECRET error" };
  globals[key] = { getRecord() { return record; } };
  const processed: ToolResult = { content: [{ type: "text", text: "[REDACTED]" }], details: { agentId: record.id, safeMetadata: "[REDACTED]" } };
  try {
    const final = await executeVisibleSubagent(tool(async () => joined
      ? result("background", "SECRET receipt", { agentId: record.id, error: "SECRET receipt error", modelName: "SECRET model" }) : processed),
    "call", { subagent_type: "Explore", prompt: "Inspect" }, undefined, undefined, bus(), tool(async () => processed));
    assert.deepEqual(final.content, processed.content);
    assert.equal(final.details.safeMetadata, "[REDACTED]");
    assert.equal(JSON.stringify(final).includes("SECRET"), false);
    assert.deepEqual(final.details.results![0].messages, [{ role: "assistant", content: processed.content }]);
    assert.equal(final.details.results![0].finished, true);
    assert.equal(final.details.results![0].exitCode, 1);
    assert.equal(final.details.results![0].stderr, "");
  } finally { if (previous === undefined) delete globals[key]; else globals[key] = previous; }
});

test("joined result with no pipeline reader fails closed without exposing registry output", async () => {
  const key = Symbol.for("pi-subagents:manager");
  const globals = globalThis as Record<symbol, unknown>; const previous = globals[key];
  globals[key] = { getRecord() { return { id: "no-reader", type: "Explore", status: "completed", result: "SECRET" }; } };
  const events = bus();
  try {
    await assert.rejects(executeVisibleSubagent(tool(async () => result("background", "receipt", { agentId: "no-reader" })), "call", args, undefined, undefined, events), /pipeline result reader is unavailable/);
    assert.equal(events.count(), 0);
  } finally { if (previous === undefined) delete globals[key]; else globals[key] = previous; }
});
