import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import registerPromptTokens from "../prompt-tokens/index.ts";
import { estimateProviderRequest } from "../prompt-tokens/request.ts";

test("real Pi lifecycle captures provider rewrites, dynamic tools, history, and input usage without extra requests", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-prompt-request-"));
  let session:
    Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let requests = 0;
  let captured: unknown;
  const reports: string[] = [];
  t.mock.method(console, "log", (value: string) => reports.push(value));
  const fixture = (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "prompt_fixture",
      label: "Fixture",
      description: "STATIC_DESCRIPTION",
      parameters: Type.Object({}),
      prepareLoadout: () => ({
        descriptions: { prompt_fixture: "ACTUAL_EXPANDED_DESCRIPTION" },
      }),
      execute: async () => ({ content: [], details: undefined }),
    });
    pi.on("before_agent_start", () => ({
      systemPrompt: "PER_TURN_EXTENSION_RULE",
    }));
    pi.on("before_provider_request", (event) => {
      assert.ok(event.payload && typeof event.payload === "object");
      return { ...event.payload, instructions: "PROVIDER_REWRITTEN_RULE" };
    });
    pi.registerProvider("prompt-fixture", {
      api: "prompt-fixture-api",
      apiKey: "non-secret-fixture",
      baseUrl: "http://127.0.0.1:1/never-called",
      models: [
        {
          id: "model",
          name: "Fixture, no inference",
          reasoning: false,
          input: ["text"],
          contextWindow: 100000,
          maxTokens: 1000,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
      streamSimple(model, context, options) {
        requests++;
        const stream = createAssistantMessageEventStream();
        const output: AssistantMessage = {
          role: "assistant",
          content: [{ type: "text", text: "Fixture reply" }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          stopReason: "stop",
          timestamp: Date.now(),
          usage: {
            input: 128,
            cacheRead: 64,
            cacheWrite: 32,
            output: 99,
            totalTokens: 323,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
        };
        void (async () => {
          const payload = {
            instructions: getCurrentSystemPrompt(context.messages),
            input: context.messages.filter(
              (message) => message.role !== "system",
            ),
            tools: getCurrentTools(context.messages),
          };
          const changed = await options?.onPayload?.(payload, model);
          captured = changed ?? payload;
          stream.push({ type: "done", reason: "stop", message: output });
          stream.end();
        })().catch((error: unknown) => {
          output.stopReason = "error";
          output.errorMessage = String(error);
          stream.push({ type: "error", reason: "error", error: output });
          stream.end();
        });
        return stream;
      },
    });
  };
  try {
    const settingsManager = SettingsManager.inMemory(undefined, {
      projectTrusted: false,
    });
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir: root,
      settingsManager,
      extensionFactories: [fixture, registerPromptTokens],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const modelRuntime = await ModelRuntime.create({
      authPath: join(root, "auth.json"),
      modelsPath: join(root, "models.json"),
      allowModelNetwork: false,
    });
    ({ session } = await createAgentSession({
      cwd: root,
      agentDir: root,
      resourceLoader: loader,
      settingsManager,
      modelRuntime,
      sessionManager: SessionManager.inMemory(root),
    }));
    await session.bindExtensions({ mode: "print" });
    const model = session.modelRuntime.getModel("prompt-fixture", "model");
    assert.ok(model);
    await session.setModel(model);
    await session.prompt("/prompt-tokens");
    assert.equal(requests, 0);
    assert.match(reports.at(-1) ?? "", /First observed startup: pending/);
    await session.prompt("PRIVATE_FIRST_MESSAGE");
    assert.equal(requests, 1);
    assert.match(JSON.stringify(captured), /ACTUAL_EXPANDED_DESCRIPTION/);
    assert.match(JSON.stringify(captured), /PROVIDER_REWRITTEN_RULE/);
    const first = estimateProviderRequest(captured);
    assert.ok(first);
    assert.match(
      first.startupPreview,
      /ACTUAL_EXPANDED_DESCRIPTION|PROVIDER_REWRITTEN_RULE/,
    );
    assert.doesNotMatch(first.startupPreview, /PRIVATE_FIRST_MESSAGE/);
    const messages = session.messages.length;
    await session.prompt("/prompt-tokens");
    assert.equal(requests, 1);
    assert.equal(session.messages.length, messages);
    assert.match(
      reports.at(-1) ?? "",
      /Provider-reported input total: 224 tokens/,
    );
    assert.match(
      reports.at(-1) ?? "",
      new RegExp(
        `Combined provider input JSON: ~${first.totalTokens.toLocaleString("en-US")} tokens`,
      ),
    );
    await session.prompt("PRIVATE_SECOND_MESSAGE");
    assert.equal(requests, 2);
    const second = estimateProviderRequest(captured);
    assert.ok(second);
    assert.ok(second.conversationTokens > first.conversationTokens);
    await session.prompt("/prompt-tokens");
    assert.equal(requests, 2);
    assert.match(
      reports.at(-1) ?? "",
      new RegExp(
        `First observed startup: ~${first.startupTokens.toLocaleString("en-US")} tokens`,
      ),
    );
    assert.doesNotMatch(
      reports.join("\n"),
      /PRIVATE_FIRST_MESSAGE|PRIVATE_SECOND_MESSAGE/,
    );
  } finally {
    session?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
