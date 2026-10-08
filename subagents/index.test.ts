import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition, ToolLoadout, ExecuteToolOptions } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import register, { TOOL_ALIASES } from "./index.ts";
import { readResult, type ToolResult } from "./visible.ts";

const usage = { input: 0, output: 12, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
type Schema = TSchema & { required?: string[]; properties: Record<string, TSchema & { default?: unknown }> };
type Definition = Omit<ToolDefinition<TSchema, unknown>, "execute"> & { execute?: ToolDefinition<TSchema, unknown>["execute"] };
function schema(tool: Definition): Schema { return tool.parameters as Schema; }

type HostOptions = {
  modern?: boolean;
  callable?: boolean;
  workflow?: boolean;
  version?: string;
  originalsFirst?: boolean;
  collision?: string;
  deny?: string;
  compat?: string;
};

/** Faithful public nested dispatch fixture, including outcome errors and IDs. */
function host({ modern = true, callable = true, workflow = true, version = "0.19.0", originalsFirst = true, collision = "", deny = "", compat }: HostOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), "subagent-tools-"));
  mkdirSync(join(directory, "src"));
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "@tintinweb/pi-subagents", version }));
  const originals = Object.keys(TOOL_ALIASES).filter((name) => workflow || name !== "SubagentWorkflow");
  const tools = new Map<string, Definition>();
  const handlers = new Map<string, () => void>();
  const calls: { name: string; id: string; args: unknown; signal?: AbortSignal; onUpdate?: ExecuteToolOptions["onUpdate"] }[] = [];
  const hookCalls: string[] = [];
  let active: string[] = [];
  let declared: string[] = [];
  const api = {
    registerTool(tool: Definition) { if (tools.has(tool.name)) return; tools.set(tool.name, tool); active.push(tool.name); },
    on(event: string, handler: () => void) { handlers.set(event, handler); },
    events: { on() { return () => {}; }, emit() {} },
    getAllTools() { return [...tools.values()].map((tool) => ({ ...tool, sourceInfo: { path: originals.includes(tool.name) ? join(directory, "src/index.ts") : "/adapter/index.ts" } })); },
    getActiveTools() { return active; },
    setActiveTools(names: string[]) { active = names; prepare(); },
  };
  function prepare() {
    const hidden = new Set<string>();
    if (modern) for (const name of active) {
      const changes = tools.get(name)?.prepareLoadout?.({ registered: [...tools.values()], declared: active.map((name) => tools.get(name)), ...(callable ? { callable: active.map((name) => tools.get(name)) } : {}) } as unknown as ToolLoadout);
      for (const name of changes?.hiddenDeclarations ?? []) hidden.add(name);
    }
    declared = active.filter((name) => !hidden.has(name));
  }
  function context(parentId: string): ExtensionToolContext {
    let next = 0;
    return {
      async executeTool(name: string, args: unknown, options: ExecuteToolOptions = {}) {
        hookCalls.push(name);
        const id = `${parentId}/${++next}`;
        const toolCall = { type: "toolCall" as const, id, name, arguments: args as Record<string, unknown> };
        if (deny === name) return { toolCall, result: { content: [{ type: "text" as const, text: "Fixture permission denied" }], details: {} }, isError: true };
        const target = tools.get(name);
        if (!active.includes(name) || !target?.execute) throw new Error("fixture target unavailable");
        const result = await target.execute(id, args, options.signal, options.onUpdate, context(id));
        return { toolCall, result, isError: result.isError === true };
      },
    } as ExtensionToolContext;
  }
  function addOriginals() {
    for (const name of originals) api.registerTool({
      name, label: name, description: "Use Agent, get_subagent_result, steer_subagent and SubagentWorkflow.",
      parameters: Type.Object({ prompt: Type.String(), run_in_background: Type.Optional(Type.Boolean()), resume: Type.Optional(Type.String()), arbitrary_supported: Type.Optional(Type.Unknown()) }),
      async execute(id, args, signal, onUpdate) {
        calls.push({ name, id, args, signal, onUpdate });
        return { content: [{ type: "text", text: name }], details: { ...(name === "Agent" ? { status: "completed", agentId: "one" } : {}) }, usage };
      },
    });
  }
  const previous = process.env.PI_TOOLING_SUBAGENTS_COMPAT;
  if (compat === undefined) delete process.env.PI_TOOLING_SUBAGENTS_COMPAT;
  else process.env.PI_TOOLING_SUBAGENTS_COMPAT = compat;
  try {
    if (collision) api.registerTool({ name: collision, label: collision, description: "Unrelated first-wins tool", parameters: Type.Object({ unrelated: Type.String() }), async execute() { return { content: [], details: {} }; } });
    if (originalsFirst) addOriginals();
    register(api as unknown as ExtensionAPI);
    if (!originalsFirst) addOriginals();
  } finally {
    if (previous === undefined) delete process.env.PI_TOOLING_SUBAGENTS_COMPAT;
    else process.env.PI_TOOLING_SUBAGENTS_COMPAT = previous;
  }
  prepare();
  async function invoke(alias: string, id: string, args: unknown, signal?: AbortSignal, onUpdate?: ExecuteToolOptions["onUpdate"], ctx = context(id)): Promise<ToolResult> {
    const execute = tools.get(alias)?.execute;
    assert.ok(execute);
    return readResult(await execute(id, args, signal, onUpdate, ctx));
  }
  return { tools, handlers, calls, hookCalls, active: () => active, declared: () => declared, invoke, context, api, directory, close() { rmSync(directory, { recursive: true, force: true }); } };
}

for (const compat of [undefined, "1"]) test(`compatibility enables aliases with switch ${compat ?? "unset"}`, () => {
  const h = host({ compat });
  try {
    h.handlers.get("session_start")!();
    assert.deepEqual(h.declared().sort(), Object.values(TOOL_ALIASES).sort());
    assert.deepEqual(h.active().sort(), [...Object.keys(TOOL_ALIASES), ...Object.values(TOOL_ALIASES)].sort());
  } finally { h.close(); }
});

for (const compat of ["0", "true", "false", ""]) test(`explicit switch ${JSON.stringify(compat)} disables compatibility without changing originals`, () => {
  const h = host({ compat });
  try {
    assert.equal(h.handlers.size, 0);
    assert.deepEqual(h.declared().sort(), Object.keys(TOOL_ALIASES).sort());
    assert.deepEqual([...h.tools.keys()].sort(), Object.keys(TOOL_ALIASES).sort());
  } finally { h.close(); }
});

for (const originalsFirst of [true, false]) test(`aliases use supported nested dispatch, originals callable but hidden, load order ${originalsFirst}`, async () => {
  const h = host({ originalsFirst });
  try {
    h.handlers.get("session_start")!();
    assert.deepEqual(h.declared().sort(), Object.values(TOOL_ALIASES).sort());
    assert.deepEqual(h.active().sort(), [...Object.keys(TOOL_ALIASES), ...Object.values(TOOL_ALIASES)].sort());
    for (const [original, alias] of Object.entries(TOOL_ALIASES)) {
      const args = { prompt: "Do real work", resume: "existing", arbitrary_supported: { nested: ["a", 7] } };
      const controller = new AbortController();
      const result = await h.invoke(alias, "call-id", args, controller.signal, () => {});
      assert.equal(result.usage, undefined, "nested usage belongs to host recorder, not a duplicate outer result");
      const called = h.calls.at(-1)!;
      assert.equal(called.name, original);
      assert.equal(called.id, "call-id/1");
      assert.deepEqual(called.args, original === "Agent" ? { ...args, run_in_background: false } : args);
      if (original !== "Agent") assert.equal(called.signal, controller.signal);
      assert.equal(typeof called.onUpdate, "function");
      assert.deepEqual(schema(h.tools.get(alias)!).required, ["prompt"]);
      assert.equal(schema(h.tools.get(original)!).properties.run_in_background.default, undefined);
    }
    assert.equal(schema(h.tools.get("subagent")!).properties.run_in_background.default, false);
  } finally { h.close(); }
});

for (const original of Object.keys(TOOL_ALIASES)) test(`original-name deny blocks ${original} forwarding without executing original`, async () => {
  const h = host({ deny: original });
  try {
    h.handlers.get("session_start")!();
    const alias = TOOL_ALIASES[original as keyof typeof TOOL_ALIASES];
    const result = await h.invoke(alias, "denied", { prompt: "Inspect" });
    assert.equal(result.isError, true, "AgentToolCallOutcome.isError must survive even if result.isError is absent");
    assert.equal(result.details.results, undefined);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.hookCalls, [original]);
  } finally { h.close(); }
});

test("update conversion forwards real original partials and preserves nonthrowing outcome failures", async () => {
  const h = host();
  try {
    h.tools.get("Agent")!.execute = async (_id, _args, _signal, update) => {
      update?.({ content: [{ type: "text", text: "Real activity" }], details: { status: "running", activity: "Real activity" } });
      return { content: [{ type: "text", text: "Original failed" }], details: { status: "completed", agentId: "one" }, isError: true };
    };
    h.api.setActiveTools(h.active()); h.handlers.get("session_start")!();
    const partials: ToolResult[] = [];
    const result = await h.invoke("subagent", "call", {}, undefined, (partial) => partials.push(readResult(partial)));
    assert.equal(partials[0].details.results![0].finished, false);
    assert.equal(result.isError, true);
    assert.equal(result.details.results![0].exitCode, 1);
    assert.equal(result.details.results![0].stopReason, "error");
  } finally { h.close(); }
});

test("workflow receipt rewrites only its known final instruction", async () => {
  const h = host();
  try {
    const authored = 'Script: /work/call SubagentWorkflow again.ts\nconst steer_subagent = get_subagent_result;';
    const instruction = "To iterate, edit the script file and call SubagentWorkflow again with scriptPath.";
    h.tools.get("SubagentWorkflow")!.execute = async () => ({ content: [{ type: "text", text: `${authored}\n${instruction}` }], details: { taskId: "fixture" } });
    h.api.setActiveTools(h.active()); h.handlers.get("session_start")!();
    const receipt = await h.invoke("subagent_workflow", "call", {});
    assert.equal(receipt.content[0].type === "text" && receipt.content[0].text, `${authored}\nTo iterate, edit the script file and call subagent_workflow again with scriptPath.`);
    h.tools.get("SubagentWorkflow")!.execute = async () => ({ content: [{ type: "text", text: instruction }], details: {} });
    const output = await h.invoke("subagent_workflow", "later", {});
    assert.equal(output.content[0].type === "text" && output.content[0].text, instruction);
  } finally { h.close(); }
});

for (const options of [{ modern: false }, { callable: false }]) test(`unsupported loadout keeps original declarations, ${JSON.stringify(options)}`, () => {
  const h = host(options);
  try {
    h.handlers.get("session_start")!();
    assert.deepEqual(h.active().sort(), Object.keys(TOOL_ALIASES).sort());
    assert.deepEqual(h.declared().sort(), Object.keys(TOOL_ALIASES).sort());
  } finally { h.close(); }
});

test("missing executeTool fails closed without raw execution and restores original declarations", async () => {
  const h = host();
  try {
    h.handlers.get("session_start")!();
    await assert.rejects(h.invoke("subagent", "call", {}, undefined, undefined, {} as ExtensionToolContext), /requires.*executeTool/);
    h.handlers.get("before_agent_start")!();
    assert.deepEqual(h.declared().sort(), Object.keys(TOOL_ALIASES).sort());
    assert.equal(h.calls.length, 0);
  } finally { h.close(); }
});

for (const collision of Object.values(TOOL_ALIASES)) test(`unrelated first-wins ${collision} stays untouched, original visible`, () => {
  const h = host({ collision });
  try {
    const original = Object.entries(TOOL_ALIASES).find(([, alias]) => alias === collision)![0];
    const unrelated = h.tools.get(collision)!;
    h.handlers.get("session_start")!(); h.handlers.get("before_agent_start")!();
    assert.equal(h.declared().includes(collision), true); assert.equal(h.declared().includes(original), true);
    assert.equal(h.tools.get(collision), unrelated); assert.deepEqual(schema(unrelated).required, ["unrelated"]);
  } finally { h.close(); }
});

test("unavailable original executor leaves its declaration visible, other aliases work", () => {
  const h = host();
  try {
    h.tools.get("Agent")!.execute = undefined;
    h.api.setActiveTools(h.active()); h.handlers.get("session_start")!();
    assert.equal(h.declared().includes("Agent"), true); assert.equal(h.active().includes("subagent"), false);
    assert.equal(h.declared().includes("subagent_result"), true);
  } finally { h.close(); }
});

for (const version of ["0.20.0", "0.19.0"]) test(`unreviewed or lost metadata never hides originals, initial ${version}`, () => {
  const h = host({ version });
  try {
    h.handlers.get("session_start")!();
    writeFileSync(join(h.directory, "package.json"), JSON.stringify({ name: "@tintinweb/pi-subagents", version: "0.20.0" }));
    h.handlers.get("before_agent_start")!();
    assert.deepEqual(h.declared().sort(), Object.keys(TOOL_ALIASES).sort());
  } finally { h.close(); }
});

test("shutdown cancels foreground wrapper and clears eligibility", async () => {
  const h = host(); let seenSignal: AbortSignal | undefined; let finish: ((value: ToolResult) => void) | undefined;
  try {
    h.tools.get("Agent")!.execute = (_id, _args, signal) => { seenSignal = signal; return new Promise((resolve) => { finish = resolve; }); };
    h.api.setActiveTools(h.active()); h.handlers.get("session_start")!();
    const pending = h.invoke("subagent", "shutdown", { prompt: "Inspect" });
    assert.equal(seenSignal?.aborted, false); h.handlers.get("session_shutdown")!(); assert.equal(seenSignal?.aborted, true);
    finish?.({ content: [{ type: "text", text: "Stopped fixture" }], details: { status: "stopped" } });
    assert.equal((await pending).isError, true);
    await assert.rejects(h.invoke("subagent", "later", {}), /unavailable/);
  } finally { h.close(); }
});

test("absent or disabled workflow is not fabricated, bounded workflow separate", async () => {
  const h = host({ workflow: false });
  try {
    h.api.registerTool({ name: "workflow", label: "workflow", description: "bounded", parameters: Type.Object({}) });
    h.handlers.get("session_start")!(); assert.equal(h.active().includes("subagent_workflow"), false); assert.equal(h.active().includes("workflow"), true);
    await assert.rejects(h.invoke("subagent_workflow", "id", {}), /unavailable/);
  } finally { h.close(); }
  const disabled = host();
  try {
    disabled.api.setActiveTools(disabled.active().filter((name) => name !== "SubagentWorkflow"));
    disabled.handlers.get("session_start")!(); assert.equal(disabled.active().includes("subagent_workflow"), false);
  } finally { disabled.close(); }
});

test("disabling an original after approval withdraws its alias", () => {
  const h = host();
  try {
    h.handlers.get("session_start")!();
    h.api.setActiveTools(h.active().filter((name) => name !== "Agent")); h.handlers.get("before_agent_start")!();
    assert.equal(h.active().includes("subagent"), false);
  } finally { h.close(); }
});

for (const original of Object.keys(TOOL_ALIASES)) test(`re-enabling ${original} restores its alias without reload`, async () => {
  const h = host({ deny: original });
  try {
    h.handlers.get("session_start")!();
    const alias = TOOL_ALIASES[original as keyof typeof TOOL_ALIASES];
    h.api.setActiveTools(h.active().filter((name) => name !== original));
    h.handlers.get("before_agent_start")!();
    assert.equal(h.active().includes(alias), false);
    h.api.setActiveTools([...h.active(), original]);
    h.handlers.get("before_agent_start")!();
    assert.equal(h.active().includes(alias), true);
    assert.equal(h.declared().includes(original), false);
    assert.equal((await h.invoke(alias, "restored", { prompt: "Inspect" })).isError, true);
    assert.deepEqual(h.hookCalls, [original]);
    assert.equal(h.calls.length, 0, "restoration cannot bypass original permissions");
  } finally { h.close(); }
});

test("dependency absence withdraws aliases; reload uses new tools", async () => {
  const h = host();
  try {
    for (const name of Object.keys(TOOL_ALIASES)) h.tools.delete(name);
    h.api.setActiveTools(h.active()); h.handlers.get("session_start")!();
    assert.equal(h.active().some((name) => Object.values(TOOL_ALIASES).some((alias) => alias === name)), false);
    await assert.rejects(h.invoke("subagent", "id", {}), /unavailable/);
  } finally { h.close(); }
  const reloaded = host();
  try { reloaded.handlers.get("session_start")!(); await reloaded.invoke("subagent_result", "reload", { agent_id: "real" }); assert.equal(reloaded.calls.length, 1); }
  finally { reloaded.close(); }
});
