import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { childToolPolicy, createChildModelRuntime, bindChildSessionExtensions, shutdownAndDisposeChildSession } from "../shared/child-session.ts";
import { TOOL_ALIASES } from "./index.ts";

test("real SDK child policy excludes all default-on aliases and upstream workflow without disabling ordinary extension tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "subagent-child-policy-"));
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const agentDir = join(root, "agent");
    const settingsManager = SettingsManager.inMemory(undefined, { projectTrusted: false });
    const loader = new DefaultResourceLoader({
      cwd: root, agentDir, settingsManager,
      extensionFactories: [(pi) => {
        for (const name of [...Object.values(TOOL_ALIASES), "SubagentWorkflow", "ordinary_extension_tool"]) {
          pi.registerTool({ name, label: name, description: name, parameters: Type.Object({}), async execute() { return { content: [{ type: "text", text: "fixture" }], details: {} }; } });
        }
      }],
    });
    await loader.reload();
    ({ session } = await createAgentSession({ cwd: root, agentDir, settingsManager, resourceLoader: loader, modelRuntime: await createChildModelRuntime(agentDir), sessionManager: SessionManager.inMemory(root), ...childToolPolicy() }));
    await bindChildSessionExtensions(session);
    const all = new Set(session.getAllTools().map((tool) => tool.name));
    for (const alias of [...Object.values(TOOL_ALIASES), "SubagentWorkflow"]) assert.equal(all.has(alias), false, alias);
    assert.equal(session.getActiveToolNames().includes("ordinary_extension_tool"), true);
  } finally {
    if (session) await shutdownAndDisposeChildSession(session);
    await rm(root, { recursive: true, force: true });
  }
});
