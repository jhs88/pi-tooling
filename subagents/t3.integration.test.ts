import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import register, { TOOL_ALIASES } from "./index.ts";
import { T3_NATIVE_TOOLS } from "./t3.ts";
import { createChildModelRuntime, bindChildSessionExtensions, shutdownAndDisposeChildSession } from "../shared/child-session.ts";

for (const scenario of ["native", "denied", "stale-private", "reader-disabled"] as const) test(`real SDK T3 declaration and permission path: ${scenario}`, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-t3-sdk-"));
  const keys = ["PI_TOOLING_SUBAGENTS_COMPAT", "PI_CODING_AGENT_DIR", "T3_PI_MCP_EXTENSION_PATH", "SUBAGENT_FIXTURE_DENY_NAME"];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const bridge = new URL("./fixtures/t3-bridge.ts", import.meta.url).pathname;
    const agentDir = join(root, "agent");
    await mkdir(agentDir);
    await writeFile(join(agentDir, "subagents.json"), JSON.stringify({ workflowsEnabled: true, rememberAgents: false, outputTranscript: false, agentMentions: "off" }));
    delete process.env.PI_TOOLING_SUBAGENTS_COMPAT;
    delete process.env.SUBAGENT_FIXTURE_DENY_NAME;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.T3_PI_MCP_EXTENSION_PATH = bridge;
    if (scenario === "denied") process.env.SUBAGENT_FIXTURE_DENY_NAME = T3_NATIVE_TOOLS[1];
    const settingsManager = SettingsManager.inMemory(undefined, { projectTrusted: false });
    const loader = new DefaultResourceLoader({
      cwd: root, agentDir, settingsManager,
      additionalExtensionPaths: [
        new URL("./fixtures/rpc-provider.ts", import.meta.url).pathname,
        new URL("../node_modules/@tintinweb/pi-subagents/src/index.ts", import.meta.url).pathname,
        bridge,
      ],
      extensionFactories: [register],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    ({ session } = await createAgentSession({ cwd: root, agentDir, settingsManager, resourceLoader: loader, modelRuntime: await createChildModelRuntime(agentDir), sessionManager: SessionManager.inMemory(root) }));
    await bindChildSessionExtensions(session);
    const model = session.modelRuntime.getModel("subagent-fixture", "deterministic");
    assert.ok(model);
    await session.setModel(model);
    if (scenario === "reader-disabled") session.setActiveToolsByName(session.getActiveToolNames().filter((name) => name !== "get_subagent_result"));
    const stalePrivate = scenario === "stale-private" || scenario === "reader-disabled";
    await session.prompt(stalePrivate ? "SMOKE_PARENT ORIGINAL PERMISSION_TEST" : "SMOKE_PARENT T3_NATIVE");
    const results = session.messages.filter((message) => message.role === "toolResult");
    assert.equal(results.length, 1, "no wrapper lifecycle or second child card");
    assert.equal(results[0].toolName, stalePrivate ? "Agent" : T3_NATIVE_TOOLS[1]);
    assert.equal(results[0].isError, scenario !== "native");
    const text = JSON.stringify(results[0].content);
    assert.match(text, scenario === "native" ? /Native delegation fixture invoked/ : scenario === "denied" ? /permission denied/ : /openable T3 conversation/);
    assert.equal((results[0].details as Record<string, unknown> | undefined)?.results, undefined);
    await session.prompt("/subagent-fixture-tools");
    const discovery = session.messages.find((message) => message.role === "custom" && message.customType === "fixture_tools");
    assert.ok(discovery && "details" in discovery);
    const details = discovery.details as { parentDeclarations: string[]; childStreams: number; startedIds: string[] };
    for (const name of [...Object.keys(TOOL_ALIASES), ...Object.values(TOOL_ALIASES)]) assert.equal(details.parentDeclarations.includes(name), false, `${name} hidden from T3 provider requests`);
    for (const name of T3_NATIVE_TOOLS) assert.ok(details.parentDeclarations.includes(name));
    assert.equal(details.childStreams, 0, "no private upstream child spawned");
    assert.deepEqual(details.startedIds, []);
    if (scenario === "reader-disabled") assert.equal(session.getActiveToolNames().includes("get_subagent_result"), false, "native suppression must not reactivate a private reader");
  } finally {
    if (session) await shutdownAndDisposeChildSession(session);
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(root, { recursive: true, force: true });
  }
});
