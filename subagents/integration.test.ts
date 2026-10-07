import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import register, { TOOL_ALIASES } from "./index.ts";
import { createChildModelRuntime, bindChildSessionExtensions, shutdownAndDisposeChildSession } from "../shared/child-session.ts";

for (const alias of Object.values(TOOL_ALIASES)) test(`real SDK first-wins ${alias} keeps unrelated registration and original active`, async () => {
  const root = await mkdtemp(join(tmpdir(), "subagent-sdk-collision-"));
  const previous = process.env.PI_TOOLING_SUBAGENTS_COMPAT;
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    process.env.PI_TOOLING_SUBAGENTS_COMPAT = "1";
    const agentDir = join(root, "agent");
    const pinnedRoot = join(root, "pinned");
    await mkdir(pinnedRoot);
    await writeFile(join(pinnedRoot, "package.json"), JSON.stringify({ name: "@tintinweb/pi-subagents", version: "0.19.0" }));
    const originalPath = join(pinnedRoot, "index.ts");
    await writeFile(originalPath, `export default function(pi) { for (const name of ${JSON.stringify(Object.keys(TOOL_ALIASES))}) pi.registerTool({ name, label: name, description: name, parameters: { type: "object", properties: {} }, async execute() { return { content: [], details: {} }; } }); }`);
    const collisionSchema = Type.Object({ unrelated: Type.String() });
    const settingsManager = SettingsManager.inMemory(undefined, { projectTrusted: false });
    const loader = new DefaultResourceLoader({
      cwd: root, agentDir, settingsManager,
      additionalExtensionPaths: [originalPath],
      extensionFactories: [(pi) => pi.registerTool({ name: alias, label: "Unrelated", description: "Unrelated first-wins tool", parameters: collisionSchema, async execute() { return { content: [], details: {} }; } }), register],
    });
    await loader.reload();
    // DefaultResourceLoader keeps both extensions and reports a diagnostic.
    // Unlike the CLI startup gate, an SDK embedder can accept first-wins tools.
    assert.ok(loader.getExtensions().errors.some((error) => error.error.includes(`Tool "${alias}" conflicts with`)));
    ({ session } = await createAgentSession({ cwd: root, agentDir, settingsManager, resourceLoader: loader, modelRuntime: await createChildModelRuntime(agentDir), sessionManager: SessionManager.inMemory(root) }));
    await bindChildSessionExtensions(session);
    const original = Object.entries(TOOL_ALIASES).find(([, value]) => value === alias)![0];
    assert.equal(session.getActiveToolNames().includes(alias), true);
    assert.equal(session.getActiveToolNames().includes(original), true);
    assert.equal(session.getAllTools().find((tool) => tool.name === alias)?.parameters, collisionSchema);
    assert.equal(session.getAllTools().find((tool) => tool.name === alias)?.description, "Unrelated first-wins tool");
  } finally {
    if (session) await shutdownAndDisposeChildSession(session);
    if (previous === undefined) delete process.env.PI_TOOLING_SUBAGENTS_COMPAT;
    else process.env.PI_TOOLING_SUBAGENTS_COMPAT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

for (const { deny, redact, scenario } of [
  { deny: "", redact: "", scenario: "" },
  { deny: "Agent", redact: "", scenario: "PERMISSION_TEST" },
  { deny: "subagent", redact: "", scenario: "PERMISSION_TEST" },
  { deny: "", redact: "Agent", scenario: "REDACT_ORIGINAL" },
  { deny: "", redact: "get_subagent_result", scenario: "REDACT_RESULT_BACKGROUND" },
  { deny: "", redact: "Agent", scenario: "REDACT_ORIGINAL_ERROR" },
  { deny: "", redact: "get_subagent_result", scenario: "REDACT_RESULT_BACKGROUND_ERROR" },
]) test(`real Pi 1.0.2 SDK + pinned extension respects ${deny || scenario || "normal execution"}`, async () => {
  const root = await mkdtemp(join(tmpdir(), "subagent-sdk-permission-"));
  const saved = new Map(["PI_TOOLING_SUBAGENTS_COMPAT", "PI_CODING_AGENT_DIR", "SUBAGENT_FIXTURE_DENY_NAME", "SUBAGENT_FIXTURE_REDACT_NAME"].map((key) => [key, process.env[key]]));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const agentDir = join(root, "agent");
    await mkdir(agentDir);
    process.env.PI_TOOLING_SUBAGENTS_COMPAT = "1";
    process.env.PI_CODING_AGENT_DIR = agentDir;
    if (deny) process.env.SUBAGENT_FIXTURE_DENY_NAME = deny; else delete process.env.SUBAGENT_FIXTURE_DENY_NAME;
    if (redact) process.env.SUBAGENT_FIXTURE_REDACT_NAME = redact; else delete process.env.SUBAGENT_FIXTURE_REDACT_NAME;
    await writeFile(join(agentDir, "subagents.json"), JSON.stringify({ workflowsEnabled: !deny && !redact, reportUsage: true, rememberAgents: false, outputTranscript: false, agentMentions: "off" }));
    await mkdir(join(agentDir, "agents"));
    await writeFile(join(agentDir, "agents/fixture-background.md"), "---\nname: fixture-background\ndescription: Fixture background\nrun_in_background: true\n---\nReturn deterministic output.\n");
    const settingsManager = SettingsManager.inMemory(undefined, { projectTrusted: false });
    const loader = new DefaultResourceLoader({
      cwd: root, agentDir, settingsManager,
      additionalExtensionPaths: [new URL("./fixtures/rpc-provider.ts", import.meta.url).pathname, new URL("../node_modules/@tintinweb/pi-subagents/src/index.ts", import.meta.url).pathname],
      extensionFactories: [register],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    ({ session } = await createAgentSession({ cwd: root, agentDir, settingsManager, resourceLoader: loader, modelRuntime: await createChildModelRuntime(agentDir), sessionManager: SessionManager.inMemory(root) }));
    await bindChildSessionExtensions(session);
    const model = session.modelRuntime.getModel("subagent-fixture", "deterministic");
    assert.ok(model);
    await session.setModel(model);
    assert.equal(session.getActiveToolNames().includes("Agent"), true);
    assert.equal(session.getActiveToolNames().includes("subagent"), true);
    await session.prompt(`SMOKE_PARENT ${scenario}`);
    const results = session.messages.filter((message) => message.role === "toolResult");
    const outer = results.find((message) => message.toolName === "subagent");
    assert.ok(outer);
    assert.equal(outer.isError, Boolean(deny) || scenario.includes("ERROR"));
    if (redact) {
      assert.deepEqual(outer.content, [{ type: "text", text: "[REDACTED]" }]);
      assert.equal(JSON.stringify({ content: outer.content, details: outer.details }).includes("SECRET"), false);
      const details = outer.details as { safeMetadata: string; results: { finished: boolean; messages: unknown; exitCode: number }[] };
      assert.equal(details.safeMetadata, "[REDACTED]");
      assert.equal(details.results[0].finished, true);
      assert.equal(details.results[0].exitCode, scenario.includes("ERROR") ? 1 : 0);
      assert.equal(JSON.stringify(details.results[0].messages).includes("[REDACTED]"), true);
    }
    if (deny === "Agent") { assert.equal(outer.nestedCalls?.calls.length, 1); assert.equal(outer.nestedCalls?.calls[0].name, "Agent"); assert.equal(outer.nestedCalls?.calls[0].status, "error"); }
    if (deny === "subagent") assert.equal(outer.nestedCalls, undefined);
    await session.prompt("/subagent-fixture-tools");
    const discovery = session.messages.find((message) => message.role === "custom" && message.customType === "fixture_tools");
    assert.ok(discovery && "details" in discovery && discovery.details && typeof discovery.details === "object");
    const details = discovery.details as Record<string, unknown>;
    assert.equal(details.running, false);
    if (redact) assert.deepEqual(details.resultTransforms, [{ name: redact, sawSecret: true }]);
    assert.equal(details.childStreams, deny ? 0 : 1);
    assert.ok(Array.isArray(details.startedIds)); assert.equal(details.startedIds.length, deny ? 0 : 1);
    assert.ok(Array.isArray(details.parentDeclarations));
    assert.equal(details.parentDeclarations.includes("Agent"), false); assert.equal(details.parentDeclarations.includes("subagent"), true);
    if (!deny) {
      assert.deepEqual(outer.nestedCalls?.calls.map((call) => call.name), scenario.includes("BACKGROUND") ? ["Agent", "get_subagent_result"] : ["Agent"]);
      assert.equal(outer.usage?.totalTokens, 23);
      const stats = session.getSessionStats(); assert.equal(stats.tokens.total, 23); assert.equal(stats.cost, 0.125);
      for (const result of results.filter((message) => message.toolName !== "subagent")) assert.equal(result.usage, undefined);
    } else { assert.equal(session.getSessionStats().tokens.total, 0); assert.equal(session.getSessionStats().cost, 0); }
    if (!deny && !redact) {
      const originalSchemas = new Map(session.getAllTools().map((tool) => [tool.name, tool.parameters]));
      for (const [original, alias] of Object.entries(TOOL_ALIASES)) {
        session.setActiveToolsByName(session.getActiveToolNames().filter((name) => name !== original));
        await session.prompt("SMOKE_PARENT NO_CALLS");
        assert.equal(session.getActiveToolNames().includes(alias), false, `${alias} withdrawn`);
        session.setActiveToolsByName([...session.getActiveToolNames(), original]);
        await session.prompt("SMOKE_PARENT NO_CALLS");
        assert.equal(session.getActiveToolNames().includes(alias), true, `${alias} restored without reload`);
        assert.equal(session.getAllTools().find((tool) => tool.name === original)?.parameters, originalSchemas.get(original));
      }
      // No active alias hooks remain, but all registered originals can recover.
      session.setActiveToolsByName(session.getActiveToolNames().filter((name) => !Object.keys(TOOL_ALIASES).includes(name)));
      await session.prompt("SMOKE_PARENT NO_CALLS");
      for (const alias of Object.values(TOOL_ALIASES)) assert.equal(session.getActiveToolNames().includes(alias), false);
      session.setActiveToolsByName([...session.getActiveToolNames(), ...Object.keys(TOOL_ALIASES)]);
      await session.prompt("SMOKE_PARENT NO_CALLS");
      for (const alias of Object.values(TOOL_ALIASES)) assert.equal(session.getActiveToolNames().includes(alias), true);
    }
  } finally {
    if (session) await shutdownAndDisposeChildSession(session);
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(root, { recursive: true, force: true });
  }
});
