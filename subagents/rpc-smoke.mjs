#!/usr/bin/env node
// Real Pi stdin/stdout RPC smoke with a deterministic backend, not model inference.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const index = arg.indexOf("="); if (index < 0) throw new Error("Use --option=value");
  return [arg.slice(0, index), arg.slice(index + 1)];
}));
if (!options["--package-dir"]) throw new Error("--package-dir must point to a scratch installation of @tintinweb/pi-subagents@0.19.0");
const packageDir = resolve(options["--package-dir"]);
const manifest = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
assert.equal(manifest.name, "@tintinweb/pi-subagents"); assert.equal(manifest.version, "0.19.0");
const root = options["--artifact-dir"] ? resolve(options["--artifact-dir"]) : await mkdtemp(join(tmpdir(), "pi-subagents-rpc-"));
await mkdir(root, { recursive: true });

for (const { enabled, workflows, reverse, scenario, compat } of [
  { enabled: false, workflows: false, reverse: false, scenario: "" },
  { enabled: true, workflows: false, reverse: false, scenario: "" },
  { enabled: true, workflows: false, reverse: false, scenario: "", compat: "1" },
  { enabled: true, workflows: true, reverse: true, scenario: "" },
  { enabled: true, workflows: false, reverse: false, scenario: "BACKGROUND" },
  { enabled: true, workflows: false, reverse: false, scenario: "CANCEL" },
  { enabled: true, workflows: false, reverse: false, scenario: "BACKGROUND_CANCEL" },
  { enabled: true, workflows: false, reverse: false, scenario: "ERROR" },
  { enabled: true, workflows: false, reverse: false, scenario: "REJECT_BACKGROUND" },
  { enabled: true, workflows: false, reverse: false, scenario: "COLLISION" },
  { enabled: true, workflows: false, reverse: false, scenario: "PERMISSION_ORIGINAL" },
  { enabled: true, workflows: false, reverse: false, scenario: "PERMISSION_ALIAS" },
  { enabled: true, workflows: false, reverse: false, scenario: "PERMISSION_RESULT_BACKGROUND" },
  { enabled: true, workflows: false, reverse: false, scenario: "REDACT_ORIGINAL" },
  { enabled: true, workflows: false, reverse: false, scenario: "REDACT_RESULT_BACKGROUND" },
  { enabled: true, workflows: false, reverse: false, scenario: "REDACT_ORIGINAL_ERROR" },
  { enabled: true, workflows: false, reverse: false, scenario: "REDACT_RESULT_BACKGROUND_ERROR" },
]) {
  const redacted = scenario.startsWith("REDACT_");
  const laneName = enabled ? scenario ? `enabled-${scenario.toLowerCase()}` : workflows ? "enabled-workflow-reversed" : compat ? "enabled-explicit-switch" : "enabled" : "disabled";
  const lane = join(root, laneName);
  const agentDir = join(lane, "agent"); const cwd = join(lane, "workspace");
  await mkdir(agentDir, { recursive: true }); await mkdir(cwd, { recursive: true });
  const adapter = options["--extension"] ? resolve(options["--extension"]) : join(here, "../index.ts");
  const paths = [join(here, "fixtures/rpc-provider.ts"), ...(scenario === "COLLISION" ? [join(here, "fixtures/collision.ts")] : []), ...(reverse ? [adapter, join(packageDir, "src/index.ts")] : [join(packageDir, "src/index.ts"), adapter])];
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ extensions: paths, skills: [], quietStartup: true }));
  await writeFile(join(agentDir, "subagents.json"), JSON.stringify({ workflowsEnabled: workflows, reportUsage: true, outputTranscript: false, rememberAgents: false, agentMentions: "off" }));
  await mkdir(join(agentDir, "agents"), { recursive: true });
  await writeFile(join(agentDir, "agents/fixture-background.md"), "---\nname: fixture-background\ndescription: Deterministic fixture background child\nrun_in_background: true\n---\nReturn deterministic fixture output.\n");
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_TELEMETRY: "0" };
  delete env.PI_TOOLING_SUBAGENTS_COMPAT;
  delete env.SUBAGENT_FIXTURE_DENY_NAME;
  delete env.SUBAGENT_FIXTURE_REDACT_NAME;
  if (redacted) env.SUBAGENT_FIXTURE_REDACT_NAME = scenario.includes("BACKGROUND") ? "get_subagent_result" : "Agent";
  if (scenario.startsWith("PERMISSION_")) env.SUBAGENT_FIXTURE_DENY_NAME = scenario === "PERMISSION_ALIAS" ? "subagent" : scenario === "PERMISSION_RESULT_BACKGROUND" ? "get_subagent_result" : "Agent";
  if (!enabled) env.PI_TOOLING_SUBAGENTS_COMPAT = "0";
  else if (compat !== undefined) env.PI_TOOLING_SUBAGENTS_COMPAT = compat;
  const child = spawn(options["--pi"] ?? "pi", ["--mode", "rpc", "--no-session", "--offline", "--no-skills", "--no-prompt-templates", "--no-context-files", "--model", "subagent-fixture/deterministic"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const events = []; const raw = []; let stderr = ""; const waiters = [];
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    raw.push(line);
    try { const event = JSON.parse(line); events.push(event); for (const waiter of [...waiters]) if (waiter.predicate(event)) waiter.resolve(event); } catch { /* retain non-JSON diagnostics */ }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const waitFor = (predicate, timeout = 25000) => new Promise((resolve, reject) => {
    const existing = events.find(predicate); if (existing) { resolve(existing); return; }
    const timer = setTimeout(() => { remove(); reject(new Error(`RPC smoke timeout. ${stderr}`)); }, timeout);
    const entry = { predicate, resolve(event) { remove(); resolve(event); } };
    function remove() { clearTimeout(timer); const index = waiters.indexOf(entry); if (index >= 0) waiters.splice(index, 1); }
    waiters.push(entry);
  });
  const send = (command) => child.stdin.write(`${JSON.stringify(command)}\n`);
  try {
    send({ type: "get_state", id: "state" });
    if (scenario === "COLLISION") {
      // The CLI refuses loader collision diagnostics before the RPC loop.
      // SDK embedders retain first-wins registrations; integration.test.ts
      // exercises that supported SDK path without hiding this CLI limitation.
      await new Promise((resolve) => child.once("close", resolve));
      assert.notEqual(child.exitCode, 0);
      assert.ok(stderr.includes('Tool "subagent" conflicts with'));
      assert.equal(events.some((event) => event.type.startsWith("tool_execution_")), false);
      console.log(JSON.stringify({ lane: laneName, collision: "CLI fails closed before RPC startup", backend: "no inference" }));
      continue;
    }
    const state = await waitFor((event) => event.type === "response" && event.id === "state"); assert.equal(state.success, true);
    send({ type: "prompt", message: "/subagent-fixture-tools", id: "tools" });
    await waitFor((event) => event.type === "response" && event.id === "tools");
    send({ type: "get_messages", id: "discovery" });
    const messages = await waitFor((event) => event.type === "response" && event.id === "discovery");
    const discovery = messages.data.messages.find((message) => message.customType === "fixture_tools").details;
    assert.equal(discovery.active.includes(enabled ? "subagent" : "Agent"), true);
    assert.equal(discovery.active.includes("Agent"), true, "original stays active for nested dispatch");
    if (!enabled) assert.equal(discovery.active.includes("subagent"), false);
    for (const name of enabled ? ["subagent_result", "subagent_steer"] : ["get_subagent_result", "steer_subagent"]) assert.equal(discovery.active.includes(name), true);
    assert.equal(discovery.active.includes(enabled ? "subagent_workflow" : "SubagentWorkflow"), workflows);
    send({ type: "prompt", message: `SMOKE_PARENT${enabled ? "" : " ORIGINAL"}${workflows ? " WORKFLOW" : ""} ${scenario}`, id: "run" });
    if (scenario.includes("CANCEL")) {
      await waitFor((event) => event.type === "tool_execution_update" && event.partialResult?.details?.results?.[0]?.messages?.[0]?.content?.[0]?.text?.includes("Fixture child"));
      send({ type: "abort", id: "cancel" });
    }
    await waitFor((event) => event.type === "agent_end");
    const toolName = enabled ? "subagent" : "Agent";
    const updates = events.filter((event) => event.type === "tool_execution_update" && event.toolName === toolName);
    const end = events.find((event) => event.type === "tool_execution_end" && event.toolName === toolName);
    if (!["REJECT_BACKGROUND", "PERMISSION_ALIAS", "PERMISSION_ORIGINAL"].includes(scenario)) assert.ok(updates.length > 0, "real Pi emitted tool_execution_update");
    assert.ok(end, "real Pi emitted tool_execution_end");
    const failure = ["CANCEL", "BACKGROUND_CANCEL", "ERROR", "REJECT_BACKGROUND", "PERMISSION_ALIAS", "PERMISSION_ORIGINAL", "PERMISSION_RESULT_BACKGROUND"].includes(scenario) || redacted && scenario.includes("ERROR");
    assert.equal(end.isError, failure);
    const aliasNames = failure || redacted ? [] : enabled ? ["subagent_result", "subagent_steer", ...(workflows ? ["subagent_workflow"] : [])] : ["get_subagent_result", "steer_subagent"];
    for (const name of aliasNames) {
      const aliasEnd = events.find((event) => event.type === "tool_execution_end" && event.toolName === name);
      assert.ok(aliasEnd, `${name} executed through real Pi`);
      assert.equal(aliasEnd.isError, false);
      if (name.endsWith("steer") || name === "steer_subagent") assert.ok(aliasEnd.result.content[0].text.includes("not running"));
      if (name.endsWith("result")) assert.ok(aliasEnd.result.content[0].text.includes("Fixture child verified deterministic output."));
      if (name === "subagent_workflow") { assert.ok(aliasEnd.result.details.taskId); assert.equal(aliasEnd.result.details.results, undefined); }
    }
    if (enabled && !["REJECT_BACKGROUND", "PERMISSION_ALIAS", "PERMISSION_ORIGINAL", "PERMISSION_RESULT_BACKGROUND"].includes(scenario)) {
      assert.ok(updates.some((event) => event.partialResult?.details?.results?.[0]?.messages?.[0]?.content?.[0]?.text?.includes("Fixture child")), "real child streaming text reaches T3-compatible messages");
      for (const event of updates) { assert.equal(event.partialResult.details.results[0].finished, false); assert.equal(event.partialResult.details.results[0].step, 0); }
      assert.equal(end.result.details.results[0].finished, true); assert.equal(end.result.details.results[0].exitCode, failure ? 1 : 0);
      if (!failure) assert.ok(end.result.details.results[0].messages[0].content[0].text.includes(redacted ? "[REDACTED]" : "Fixture child verified deterministic output."));
    }
    if (["REJECT_BACKGROUND", "PERMISSION_ALIAS", "PERMISSION_ORIGINAL"].includes(scenario)) { assert.equal(updates.length, 0); assert.equal(end.result.details.results, undefined); }
    if (scenario.startsWith("PERMISSION_")) assert.ok(end.result.content[0].text.includes("Fixture name-based permission denied"));
    if (!failure || redacted) {
      const nestedUsageEnds = events.filter((event) => event.type === "tool_execution_end" && event.parentToolCallId === "fixture-child-call" && event.result.usage);
      const usageEnds = enabled ? nestedUsageEnds : [end];
      assert.equal(usageEnds.length, 1, "child spend reported by exactly one nested outcome");
      assert.deepEqual(usageEnds[0].result.usage, { input: 11, output: 7, cacheRead: 3, cacheWrite: 2, totalTokens: 23, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.125 } });
      if (enabled) assert.equal(end.result.usage, undefined, "outer RPC outcome must not duplicate host-recorded nested usage");
      for (const event of events.filter((event) => event.type === "tool_execution_end" && aliasNames.includes(event.toolName))) assert.equal(event.result.usage, undefined, "later aliases must not charge the child's spend again");
    }
    if (scenario.includes("BACKGROUND") && scenario !== "REJECT_BACKGROUND") assert.equal(events.some((event) => event.message?.customType === "subagent-notification"), false);
    // Read back the exact manager's aggregate liveness, not a guessed child receipt.
    send({ type: "prompt", message: "/subagent-fixture-tools", id: "settled-tools" });
    await waitFor((event) => event.type === "response" && event.id === "settled-tools");
    send({ type: "get_messages", id: "settled-discovery" });
    const settledMessages = await waitFor((event) => event.type === "response" && event.id === "settled-discovery");
    send({ type: "get_session_stats", id: "usage-stats" });
    const statsResponse = await waitFor((event) => event.type === "response" && event.id === "usage-stats");
    assert.equal(statsResponse.success, true);
    const stats = statsResponse.data;
    const settled = settledMessages.data.messages.filter((message) => message.customType === "fixture_tools").at(-1).details;
    const outerMessage = settledMessages.data.messages.find((message) => message.role === "toolResult" && message.toolCallId === "fixture-child-call");
    assert.ok(outerMessage, "read back exact outer tool-result message");
    if (enabled && (!failure || redacted)) {
      assert.equal(outerMessage.usage?.totalTokens, 23, "host records nested spend once on outer transcript message");
      assert.equal(outerMessage.usage?.cost.total, 0.125);
      assert.equal(outerMessage.nestedCalls?.complete, true);
      assert.deepEqual(outerMessage.nestedCalls.calls.map((call) => call.name), scenario.includes("BACKGROUND") ? ["Agent", "get_subagent_result"] : ["Agent"]);
    }
    assert.equal(settled.running, false);
    if (!failure || redacted) {
      assert.deepEqual(stats.tokens, { input: 11, output: 7, cacheRead: 3, cacheWrite: 2, total: 23 });
      assert.equal(stats.cost, 0.125);
    }
    if (redacted) {
      for (const outcome of [end.result, outerMessage]) {
        assert.deepEqual(outcome.content, [{ type: "text", text: "[REDACTED]" }]);
        assert.equal(outcome.details.safeMetadata, "[REDACTED]");
        assert.equal(JSON.stringify({ content: outcome.content, details: outcome.details }).includes("SECRET"), false, "final output and all metadata respect original result transformations");
        assert.deepEqual(outcome.details.results[0].messages, [{ role: "assistant", content: [{ type: "text", text: "[REDACTED]" }] }]);
        assert.equal(outcome.details.results[0].finished, true);
        assert.equal(outcome.details.results[0].exitCode, failure ? 1 : 0);
      }
      // Final-result hooks do not govern earlier host streaming. Verify the
      // original hook received a secret without asserting streaming redaction.
      assert.deepEqual(settled.resultTransforms, [{ name: env.SUBAGENT_FIXTURE_REDACT_NAME, sawSecret: true }]);
    }
    const preSpawnFailure = ["REJECT_BACKGROUND", "PERMISSION_ORIGINAL", "PERMISSION_ALIAS"].includes(scenario);
    assert.equal(settled.childStreams, preSpawnFailure ? 0 : 1, "denied aliases never enter a child backend; normal execution starts one child");
    assert.equal(settled.startedIds.length, preSpawnFailure ? 0 : 1, "exact upstream started-child count");
    assert.equal(settled.parentDeclarations.includes(enabled ? "subagent" : "Agent"), true);
    for (const [original, alias] of Object.entries({ Agent: "subagent", get_subagent_result: "subagent_result", steer_subagent: "subagent_steer", SubagentWorkflow: "subagent_workflow" })) {
      assert.equal(settled.parentDeclarations.includes(enabled ? original : alias), false, "hidden originals never reach parent provider declarations");
    }
    if (scenario.startsWith("PERMISSION_")) {
      assert.equal(settled.hookCalls.filter((name) => name === "subagent").length, 1);
      assert.equal(settled.hookCalls.filter((name) => name === "Agent").length, scenario === "PERMISSION_ALIAS" ? 0 : 1, "original deny runs in the full nested pipeline");
      if (scenario === "PERMISSION_RESULT_BACKGROUND") {
        assert.equal(settled.hookCalls.filter((name) => name === "get_subagent_result").length, 1);
        assert.equal(end.result.details.results, undefined, "denied usage read is not replaced by unguarded output");
      } else {
        assert.deepEqual(stats.tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
        assert.equal(stats.cost, 0);
      }
    }
    if (enabled) {
      const nestedStarts = events.filter((event) => event.type === "tool_execution_start" && event.parentToolCallId);
      assert.ok(nestedStarts.length <= (workflows ? 4 : scenario.includes("BACKGROUND") ? 4 : 3), "bounded original lifecycles, not recursive delegation");
      const expectedNames = new Set(["Agent", "get_subagent_result", "steer_subagent", "SubagentWorkflow"]);
      for (const nested of nestedStarts) {
        assert.ok(expectedNames.has(nested.toolName));
        assert.ok(nested.toolCallId.startsWith(`${nested.parentToolCallId}/`));
        assert.equal(events.filter((event) => event.type === "tool_execution_end" && event.toolCallId === nested.toolCallId && event.parentToolCallId === nested.parentToolCallId).length, 1);
      }
      const nestedAgents = nestedStarts.filter((event) => event.toolName === "Agent");
      assert.equal(nestedAgents.length, ["REJECT_BACKGROUND", "PERMISSION_ALIAS"].includes(scenario) ? 0 : 1);
      if (nestedAgents.length) assert.equal(nestedAgents[0].parentToolCallId, "fixture-child-call");
      if (nestedAgents.length) assert.equal(settled.hookParents.find((hook) => hook.name === "Agent").parentToolCallId, "fixture-child-call");
      assert.equal(events.filter((event) => event.type === "tool_execution_start" && event.toolName === "subagent").length, 1, "one T3 child-card lifecycle");
    }
    if (enabled && !scenario && !workflows) {
      send({ type: "prompt", message: "/subagent-fixture-reload", id: "reload" });
      const reload = await waitFor((event) => event.type === "response" && event.id === "reload"); assert.equal(reload.success, true);
      send({ type: "prompt", message: "/subagent-fixture-tools", id: "reloaded-tools" });
      await waitFor((event) => event.type === "response" && event.id === "reloaded-tools");
      send({ type: "get_messages", id: "reloaded-discovery" });
      const reloadedMessages = await waitFor((event) => event.type === "response" && event.id === "reloaded-discovery");
      const reloaded = reloadedMessages.data.messages.filter((message) => message.customType === "fixture_tools").at(-1).details;
      assert.equal(reloaded.active.includes("subagent"), true); assert.equal(reloaded.active.includes("Agent"), true);
      const afterReloadOffset = events.length;
      send({ type: "prompt", message: "SMOKE_PARENT", id: "rerun" });
      await waitFor((event) => events.indexOf(event) >= afterReloadOffset && event.type === "agent_end");
      const rerunEvents = events.slice(afterReloadOffset);
      const rerunEnd = rerunEvents.find((event) => event.type === "tool_execution_end" && event.toolName === "subagent");
      assert.equal(rerunEnd?.isError, false, "reloaded adapter executes a real child");
      assert.equal(rerunEvents.filter((event) => event.type === "tool_execution_start" && event.toolName === "Agent").length, 1);
      send({ type: "prompt", message: "/subagent-fixture-tools", id: "rerun-tools" });
      await waitFor((event) => event.type === "response" && event.id === "rerun-tools");
      send({ type: "get_messages", id: "rerun-discovery" });
      const rerunMessages = await waitFor((event) => event.type === "response" && event.id === "rerun-discovery");
      const rerun = rerunMessages.data.messages.filter((message) => message.customType === "fixture_tools").at(-1).details;
      assert.equal(rerun.childStreams, 1, "reload creates fresh fixture counters and starts exactly one child");
      assert.equal(rerun.parentDeclarations.includes("Agent"), false);
      assert.equal(rerun.parentDeclarations.includes("subagent"), true);
    }
    console.log(JSON.stringify({ lane: laneName, compatibilitySwitch: env.PI_TOOLING_SUBAGENTS_COMPAT ?? "unset", toolName, aliasesExecuted: aliasNames, updates: updates.length, childStreams: settled.childStreams, nestedCalls: settled.hookParents.filter((hook) => hook.parentToolCallId).length, tokens: stats.tokens, cost: stats.cost, terminal: true, backend: "deterministic fixture, no inference" }));
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once("exit", resolve); });
    await writeFile(join(lane, "stdout.jsonl"), raw.join("\n") + "\n");
    await writeFile(join(lane, "stderr.log"), stderr);
  }
}
console.log(`RPC evidence: ${root}`);
