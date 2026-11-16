import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
  estimateProviderRequest,
  reportedInputTokens,
  RequestTracker,
} from "../prompt-tokens/request.ts";

const tool = {
  name: "codemode",
  description: "EXPANDED_TOOL_LIST",
  parameters: { type: "object" },
};
const user = { role: "user", content: "PRIVATE_CONVERSATION" };
const system = {
  role: "system",
  content: "EXTENSION_SYSTEM",
  toolsAdded: [tool],
};

for (const [name, payload] of [
  ["OpenAI/Mistral completions", { messages: [system, user], tools: [tool] }],
  [
    "Anthropic messages",
    {
      system: [{ type: "text", text: "EXTENSION_SYSTEM" }],
      messages: [user],
      tools: [tool],
    },
  ],
  [
    "OpenAI/Azure/Codex responses",
    {
      instructions: "EXTENSION_SYSTEM",
      input: [{ role: "developer", content: "DEVELOPER_ADDITION" }, user],
      tools: [tool],
    },
  ],
  [
    "Google/Vertex",
    {
      contents: [user],
      config: {
        systemInstruction: "EXTENSION_SYSTEM",
        tools: [tool],
        toolConfig: { mode: "AUTO" },
      },
    },
  ],
  [
    "Bedrock",
    {
      system: [{ text: "EXTENSION_SYSTEM" }],
      messages: [user],
      toolConfig: { tools: [tool] },
    },
  ],
  ["Pi messages", { context: { messages: [system, user] } }],
] as const) {
  test(`provider projection counts startup and conversation separately: ${name}`, () => {
    const result = estimateProviderRequest(payload);
    assert.ok(result);
    assert.match(result.startupPreview, /EXTENSION_SYSTEM/);
    assert.match(result.startupPreview, /EXPANDED_TOOL_LIST/);
    assert.doesNotMatch(result.startupPreview, /PRIVATE_CONVERSATION/);
    assert.ok(result.startupTokens > 0);
    assert.ok(result.conversationTokens > 0);
    assert.equal(
      result.totalTokens,
      result.startupTokens + result.conversationTokens,
    );
    assert.ok(
      result.structureTokens > 0 &&
        result.structureTokens <= result.totalTokens,
    );
  });
}

test("JSON framing is counted once and non-input fields are excluded", () => {
  const payload = { messages: [system, user], tools: [tool] };
  const expected = Math.ceil(JSON.stringify(payload).length / 4);
  const result = estimateProviderRequest({
    ...payload,
    model: "model-id",
    max_tokens: 20000,
    temperature: 1,
    headers: { authorization: "PRIVATE_CREDENTIAL" },
    apiKey: "PRIVATE_CREDENTIAL",
    metadata: { tenant: "PRIVATE_CREDENTIAL" },
  });
  assert.ok(result);
  assert.equal(result.totalTokens, expected);
  assert.doesNotMatch(result.startupPreview, /PRIVATE_CREDENTIAL|max_tokens/);
  assert.deepEqual(
    estimateProviderRequest({ contents: [user], config: { temperature: 1 } }),
    estimateProviderRequest({ contents: [user] }),
  );
});

test("message patches and provider-injected developer instructions count as startup overhead", () => {
  const result = estimateProviderRequest({
    messages: [
      system,
      user,
      { role: "developer", content: "LATER_RULE" },
      { role: "tool", content: "TOOL_RESULT" },
    ],
  });
  assert.ok(result);
  assert.match(result.startupPreview, /LATER_RULE/);
  assert.doesNotMatch(
    result.startupPreview,
    /TOOL_RESULT|PRIVATE_CONVERSATION/,
  );
});

test("continuation bodies are identified without pretending to reconstruct retained history", () => {
  for (const continuation of [
    { previous_response_id: "previous" },
    { thread: { type: "continue", previous_message_id: "previous" } },
  ]) {
    const result = estimateProviderRequest({ input: [user], ...continuation });
    assert.equal(result?.continuation, true);
  }
  assert.equal(
    estimateProviderRequest({ input: "a user prompt" })?.continuation,
    false,
  );
});

test("media is not estimated by counting base64, bytes, or URLs as text", () => {
  for (const media of [
    { type: "image", source: { type: "base64", data: "X".repeat(500_000) } },
    {
      type: "input_image",
      image_url: "data:image/png;base64," + "X".repeat(500_000),
    },
    { inlineData: { mimeType: "image/png", data: "X".repeat(500_000) } },
    { image: { source: { bytes: new Uint8Array(500_000) }, format: "png" } },
    { type: "input_audio", input_audio: { data: "X".repeat(500_000) } },
  ]) {
    const result = estimateProviderRequest({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "describe this" }, media],
        },
      ],
    });
    assert.ok(result);
    assert.equal(result.mediaOmitted, true);
    assert.ok(result.totalTokens < 100);
  }
});

test("malformed, cyclic, deeply nested, and unsupported payloads fail safely", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.content = cyclic;
  let deep: unknown = "end";
  for (let n = 0; n < 110; n++) deep = { child: deep };
  for (const payload of [
    null,
    "body",
    {},
    { prompt: "custom provider" },
    { messages: [cyclic] },
    { messages: [deep] },
    { messages: [1n] },
  ])
    assert.equal(estimateProviderRequest(payload), undefined);
});

test("startup preview retention is bounded while counts use the full input", () => {
  const instructions = "x".repeat(200_000);
  const result = estimateProviderRequest({ instructions, input: [user] });
  assert.ok(result);
  assert.ok(result.startupTokens > 50_000);
  assert.ok(result.startupPreview.length < 101_000);
  assert.match(result.startupPreview, /Preview truncated/);
});

function usage(input = 12, cacheRead = 5, cacheWrite = 3): Usage {
  return {
    input,
    cacheRead,
    cacheWrite,
    cacheWrite1h: cacheWrite,
    output: 99,
    reasoning: 90,
    totalTokens: input + cacheRead + cacheWrite + 99,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function response(): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "fixture",
    model: "model",
    usage: usage(),
    stopReason: "stop",
    timestamp: 1,
  };
}

test("provider input includes caches once, excluding output and reasoning", () => {
  assert.equal(reportedInputTokens(usage()), 20);
  for (const invalid of [NaN, Infinity, -1, 1.5])
    assert.equal(reportedInputTokens(usage(invalid)), undefined);
  assert.equal(reportedInputTokens(usage(0, 0, 0)), undefined);
});

test("tracker keeps first startup stable, latest estimates fresh, and no conversation bodies", () => {
  const tracker = new RequestTracker();
  const payload = { messages: [system, user], tools: [tool] };
  tracker.observe(payload); // Idle/cache-warming requests are not normal turns.
  assert.equal(Boolean(tracker.latest), false);
  tracker.begin("fixture/model");
  tracker.observe(payload);
  const first = JSON.stringify(tracker.first);
  tracker.response(response());
  assert.equal(tracker.latest?.reportedInputTokens, 20);
  tracker.end();
  tracker.response({ ...response(), usage: usage(1000) });
  assert.equal(tracker.latest?.reportedInputTokens, 20);
  tracker.begin("fixture/model");
  assert.equal(tracker.latest?.reportedInputTokens, undefined);
  tracker.observe({
    messages: [{ ...system, content: "A changed prompt" }, user],
    tools: [tool],
  });
  assert.equal(JSON.stringify(tracker.first), first);
  assert.doesNotMatch(JSON.stringify(tracker), /PRIVATE_CONVERSATION/);
  tracker.observe(null);
  assert.equal(tracker.latest?.estimate, undefined);
  tracker.response(response());
  assert.equal(tracker.latest?.reportedInputTokens, 20);
  tracker.reset();
  assert.equal(tracker.first, undefined);
  assert.equal(tracker.latest, undefined);
});

test("a partial continuation is not saved as an original startup baseline", () => {
  const tracker = new RequestTracker();
  tracker.begin("fixture/model");
  tracker.observe({ input: [user], previous_response_id: "previous" });
  assert.equal(tracker.first, undefined);
  assert.equal(tracker.latest?.estimate?.continuation, true);
});
