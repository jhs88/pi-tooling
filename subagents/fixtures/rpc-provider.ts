// Deterministic fixture backend. No model, HTTP request, credentials or inference.
import { createAssistantMessageEventStream, type AssistantMessage, type TextContent, type ToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setTimeout as delay } from "node:timers/promises";

export default function fixtureProvider(pi: ExtensionAPI): void {
  const hookCalls: string[] = [];
  const hookParents: { name: string; parentToolCallId?: string }[] = [];
  const resultTransforms: { name: string; sawSecret: boolean }[] = [];
  const startedIds = new Set<string>();
  let childStreams = 0;
  let parentDeclarations: string[] = [];
  pi.events.on("subagents:started", (data: unknown) => {
    if (data && typeof data === "object" && "id" in data && typeof data.id === "string") startedIds.add(data.id);
  });
  pi.on("tool_call", (event) => {
    hookCalls.push(event.toolName);
    hookParents.push({ name: event.toolName, parentToolCallId: event.parentToolCallId });
    if (event.toolName === process.env.SUBAGENT_FIXTURE_DENY_NAME) return { block: true, reason: "Fixture name-based permission denied" };
  });
  pi.on("tool_result", (event) => {
    const target = process.env.SUBAGENT_FIXTURE_REDACT_NAME;
    if (!target || event.toolName !== target) return;
    resultTransforms.push({ name: event.toolName, sawSecret: JSON.stringify({ content: event.content, details: event.details }).includes("SECRET") });
    const details = event.details as Record<string, unknown> | undefined;
    // Preserve only lifecycle identity, deliberately remove all other metadata.
    return { content: [{ type: "text", text: "[REDACTED]" }], details: { status: details?.status, agentId: details?.agentId, safeMetadata: "[REDACTED]" } };
  });
  pi.registerProvider("subagent-fixture", {
    api: "subagent-fixture-api",
    apiKey: "non-secret-fixture",
    baseUrl: "http://127.0.0.1:1/never-called",
    models: [{ id: "deterministic", name: "Deterministic fixture, not a model", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        const user = [...context.messages].reverse().find((message) => message.role === "user");
        const prompt = typeof user?.content === "string" ? user.content : user?.content?.map((item) => item.type === "text" ? item.text : "").join("") ?? "";
        const isParent = prompt.includes("SMOKE_PARENT");
        if (isParent) {
          const declared = new Set<string>();
          for (const entry of context.messages) if (entry.role === "system") {
            for (const tool of entry.toolsAdded ?? []) declared.add(tool.name);
            for (const tool of entry.toolsRemoved ?? []) declared.delete(tool.name);
          }
          parentDeclarations = [...declared];
        } else childStreams++;
        const completed = context.messages.slice(context.messages.indexOf(user!) + 1).filter((message) => message.role === "toolResult");
        const names = prompt?.split(/\s+/).includes("ORIGINAL") ? ["Agent", "get_subagent_result", "steer_subagent", "SubagentWorkflow"] : ["subagent", "subagent_result", "subagent_steer", "subagent_workflow"];
        const callCount = prompt?.includes("NO_CALLS") ? 0 : prompt?.includes("REJECT_BACKGROUND") || prompt?.includes("ERROR") || prompt?.includes("PERMISSION_") || prompt?.includes("REDACT_") ? 1 : prompt?.includes("WORKFLOW") ? 4 : 3;
        const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content: [], stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: "start", partial: message });
        if (isParent && completed.length < callCount) {
          const name = names[completed.length];
          const firstDetails: unknown = completed[0]?.details;
          // Joined get_subagent_result returns its identity in processed text,
          // not details. Use only parent-visible output, never fixture registry.
          const firstText = completed[0]?.content.filter((item) => item.type === "text").map((item) => item.text).join("\n") ?? "";
          const childId = firstDetails && typeof firstDetails === "object" && "agentId" in firstDetails && typeof firstDetails.agentId === "string" ? firstDetails.agentId : /^Agent: ([^\n]+)/.exec(firstText)?.[1] ?? "";
          const argumentsByStep: ToolCall["arguments"][] = [
            { subagent_type: prompt.includes("BACKGROUND") ? "fixture-background" : "general-purpose", prompt: `SMOKE_CHILD${prompt.includes("ERROR") ? " ERROR" : ""}${prompt.includes("REDACT_") ? " REDACTION_TEST" : ""}`, description: "Deterministic fixture child", isolated: true, run_in_background: prompt.includes("REJECT_BACKGROUND") },
            { agent_id: childId, wait: true, verbose: true },
            { agent_id: childId, message: "Fixture steer after completion should be refused" },
            { script: 'export const meta = { name: "fixture-workflow", description: "Deterministic no-child workflow" }; return { fixture: true };', args: { fixture: true } },
          ];
          const call: ToolCall = { type: "toolCall", id: completed.length === 0 ? "fixture-child-call" : `fixture-alias-${completed.length}`, name, arguments: argumentsByStep[completed.length] };
          message.content.push(call); message.stopReason = "toolUse";
          stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
          stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial: message });
        } else {
          const text: TextContent = { type: "text", text: "" };
          message.content.push(text);
          stream.push({ type: "text_start", contentIndex: 0, partial: message });
          for (const delta of isParent ? ["Parent received fixture child result."] : ["Fixture child is inspecting auth.ts. ", `Fixture child verified deterministic output.${prompt.includes("REDACTION_TEST") ? " SECRET child output" : ""}`]) {
            await delay(120);
            if (options?.signal?.aborted) { message.stopReason = "aborted"; break; }
            text.text += delta;
            stream.push({ type: "text_delta", contentIndex: 0, delta, partial: message });
          }
          stream.push({ type: "text_end", contentIndex: 0, content: text.text, partial: message });
          if (!isParent && prompt?.includes("ERROR")) { message.stopReason = "error"; message.errorMessage = `${prompt.includes("REDACTION_TEST") ? "SECRET " : ""}Deterministic fixture child failure`; }
        }
        if (!isParent) message.usage = { input: 11, output: 7, cacheRead: 3, cacheWrite: 2, totalTokens: 23, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.125 } };
        if (message.stopReason === "aborted" || message.stopReason === "error") stream.push({ type: "error", reason: message.stopReason, error: message });
        else if (message.stopReason !== "pending") stream.push({ type: "done", reason: message.stopReason, message });
      })().catch((error) => { stream.end(); console.error(error); });
      return stream;
    },
  });
  pi.registerCommand("subagent-fixture-tools", {
    description: "Write fixture tool discovery to JSONL",
    handler: async () => {
      const manager = (globalThis as Record<symbol, unknown>)[Symbol.for("pi-subagents:manager")];
      const running = manager && typeof manager === "object" && "hasRunning" in manager && typeof manager.hasRunning === "function" ? manager.hasRunning() : undefined;
      pi.sendMessage({ customType: "fixture_tools", content: "Fixture tool discovery", display: false, details: { hookCalls: [...hookCalls], hookParents: [...hookParents], resultTransforms: [...resultTransforms], startedIds: [...startedIds], childStreams, parentDeclarations, active: pi.getActiveTools(), running, all: pi.getAllTools().map((tool) => ({ name: tool.name, parameters: tool.parameters, sourceInfo: tool.sourceInfo })) } }, { triggerTurn: false });
    },
  });
  pi.registerCommand("subagent-fixture-reload", { description: "Reload fixture extensions without inference", handler: async (_args, ctx) => { await ctx.reload(); } });
}
