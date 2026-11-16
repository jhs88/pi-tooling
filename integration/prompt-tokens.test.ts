import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
  Theme,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { Type } from "typebox";
import registerPromptTokens, {
  estimatePromptTokens,
  formatPromptPreview,
} from "../prompt-tokens/index.ts";
import { PromptPreview } from "../prompt-tokens/preview.ts";

type Command = Omit<RegisteredCommand, "name" | "sourceInfo">;

function tool(
  name: string,
  exposure: ToolInfo["exposure"] = "direct",
): ToolInfo {
  return {
    name,
    description: `${name} description`,
    parameters: Type.Object({ path: Type.String() }),
    exposure,
    sourceInfo: {
      path: `builtin:${name}`,
      source: "builtin",
      scope: "temporary",
      origin: "top-level",
    },
  };
}

function fixture() {
  const commands = new Map<string, Command>();
  const handlers = new Map<
    string,
    (event: unknown, ctx: ExtensionCommandContext) => unknown
  >();
  const notifications: string[] = [];
  let systemPrompt = "<project_context>private instructions</project_context>";
  let active = ["read", "model-only", "hidden-declaration", "hidden"];
  const all = [
    tool("read"),
    tool("model-only", "model-only"),
    tool("hidden-declaration"),
    tool("hidden", "hidden"),
    tool("inactive"),
    tool("deferred", "deferred"),
    tool("codemode-only", "codemode"),
  ];
  const pi = {
    on(
      name: string,
      handler: (event: unknown, ctx: ExtensionCommandContext) => unknown,
    ) {
      handlers.set(name, handler);
    },
    registerCommand(name: string, command: Command) {
      commands.set(name, command);
    },
    getActiveTools: () => active,
    getAllTools: () => all,
  } as unknown as ExtensionAPI;
  const ctx = {
    hasUI: true,
    mode: "tui",
    getSystemPrompt: () => systemPrompt,
    getSystemPromptOptions: () => ({ hiddenTools: ["hidden-declaration"] }),
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
    },
  } as unknown as ExtensionCommandContext;
  registerPromptTokens(pi);
  const command = commands.get("prompt-tokens");
  assert.ok(command);
  return {
    command,
    commands,
    ctx,
    notifications,
    emit(name: string, event: unknown = {}) {
      const handler = handlers.get(name);
      assert.ok(handler, `Missing ${name} handler`);
      return handler(event, ctx);
    },
    setPrompt(value: string) {
      systemPrompt = value;
    },
    setActive(value: string[]) {
      active = value;
    },
  };
}

test("prompt estimates use chars/4 and omit non-schema metadata", () => {
  const read = tool("read");
  const { name, description, parameters } = read;
  const expected = Math.ceil(
    JSON.stringify({ name, description, parameters }).length / 4,
  );
  assert.deepEqual(estimatePromptTokens("12345", [read]), {
    systemTokens: 2,
    toolTokens: expected,
    toolCount: 1,
    totalTokens: expected + 2,
  });
  assert.deepEqual(estimatePromptTokens("", []), {
    systemTokens: 0,
    toolTokens: 0,
    toolCount: 0,
    totalTokens: 0,
  });
});

test("the command registers no tools and reports active declarations with pending request observations", async () => {
  const app = fixture();
  assert.equal(app.commands.size, 1);
  await app.command.handler("", app.ctx);
  assert.match(app.notifications[0], /across 2 tools/);
  assert.match(app.notifications[0], /not a model tokenizer/);
  assert.match(app.notifications[0], /loadout description rewrites/);
  assert.match(app.notifications[0], /First observed startup: pending/);
  assert.match(app.notifications[0], /Full request estimate: pending/);
  assert.doesNotMatch(app.notifications[0], /private instructions/);
  assert.ok(app.command.getArgumentCompletions?.("pre"));
  assert.equal(app.command.getArgumentCompletions?.("invalid"), null);
});

test("estimates refresh from the current configuration and handle older hosts", async () => {
  const app = fixture();
  await app.command.handler("", app.ctx);
  const original = app.notifications[0];
  app.setPrompt("x".repeat(4000));
  app.setActive(["deferred"]);
  // Before prompt options were exposed, all active declarations are counted.
  Reflect.deleteProperty(app.ctx, "getSystemPromptOptions");
  await app.command.handler("", app.ctx);
  assert.notEqual(app.notifications[1], original);
  assert.match(app.notifications[1], /System prompt: ~1,000 tokens/);
  assert.match(app.notifications[1], /across 1 tools/);
});

test("invalid arguments show usage rather than displaying prompt contents", async () => {
  const app = fixture();
  await app.command.handler("export", app.ctx);
  assert.deepEqual(app.notifications, ["Usage: /prompt-tokens [preview]"]);
});

test("the preview opens an overlay with the same prompt and filtered tool schemas", async () => {
  const app = fixture();
  let opened = false;
  app.ctx.ui.custom = async (factory, options) => {
    opened = true;
    assert.equal(options?.overlay, true);
    assert.deepEqual(options?.overlayOptions, {
      width: "90%",
      maxHeight: "80%",
    });
    let closed = false;
    let result!: Parameters<Parameters<typeof factory>[3]>[0];
    const view = await factory(
      { terminal: { rows: 40 }, requestRender() {} } as Parameters<
        typeof factory
      >[0],
      theme,
      new KeybindingsManager(),
      (value) => {
        result = value;
        closed = true;
      },
    );
    assert.ok(view instanceof PromptPreview);
    const beginning = view.render(120).join("\n");
    assert.match(beginning, /Configured prompt estimate/);
    assert.match(beginning, /First observed startup: pending/);
    view.handleInput("\u001b[F");
    const end = view.render(120).join("\n");
    assert.match(end, /model-only/);
    assert.doesNotMatch(
      end,
      /hidden-declaration|inactive|codemode-only|sourceInfo/,
    );
    view.handleInput("q");
    assert.equal(closed, true);
    return result;
  };
  await app.command.handler(" preview ", app.ctx);
  assert.equal(opened, true);
  assert.deepEqual(app.notifications, []);
});

test("RPC and headless preview requests do not dump prompt contents", async (t) => {
  const app = fixture();
  app.ctx.mode = "rpc";
  await app.command.handler("preview", app.ctx);
  assert.deepEqual(app.notifications, [
    "Prompt preview requires Pi's terminal UI.",
  ]);
  const logs: string[] = [];
  t.mock.method(console, "log", (value: string) => logs.push(value));
  app.ctx.mode = "print";
  app.ctx.hasUI = false;
  await app.command.handler("preview", app.ctx);
  assert.deepEqual(logs, ["Prompt preview requires Pi's terminal UI."]);
  await app.command.handler("", app.ctx);
  assert.match(logs[1], /Configured prompt estimate/);
  assert.doesNotMatch(logs[1], /private instructions/);
});

test("preview text contains only the report, system text, and schema fields", () => {
  const text = formatPromptPreview("estimate", "system prompt", [tool("read")]);
  assert.match(text, /estimate\n\n=== System prompt ===\nsystem prompt/);
  assert.match(text, /"parameters"/);
  assert.doesNotMatch(text, /sourceInfo|exposure/);
  assert.match(
    formatPromptPreview("estimate", "", []),
    /No active tool schemas/,
  );
});

const theme = {
  fg: (_color: string, text: string) => text,
} as unknown as Theme;

function viewer(content: string) {
  let rows = 20;
  let renders = 0;
  let closed = false;
  const view = new PromptPreview(
    content,
    theme,
    new KeybindingsManager(),
    () => rows,
    () => {
      renders++;
    },
    () => {
      closed = true;
    },
  );
  return {
    view,
    resize(value: number) {
      rows = value;
    },
    get renders() {
      return renders;
    },
    get closed() {
      return closed;
    },
  };
}

test("popup scrolls, clamps at boundaries, and closes without editing", () => {
  const app = viewer(
    Array.from({ length: 100 }, (_, n) => `line-${n}`).join("\n"),
  );
  assert.match(app.view.render(80).join("\n"), /line-0\s*│/);
  app.view.handleInput("\u001b[B");
  assert.doesNotMatch(app.view.render(80).join("\n"), /line-0\s*│/);
  app.view.handleInput("\u001b[6~");
  assert.match(app.view.render(80)[1], /lines 14-/);
  app.view.handleInput("\u001b[F");
  const end = app.view.render(80);
  assert.match(end.join("\n"), /line-99/);
  app.view.handleInput("\u001b[B");
  assert.deepEqual(app.view.render(80), end);
  app.view.handleInput("\u001b[H");
  const start = app.view.render(80);
  app.view.handleInput("x");
  assert.deepEqual(app.view.render(80), start);
  app.view.handleInput("\u001b");
  assert.equal(app.closed, true);
  assert.ok(app.renders > 0);
});

test("popup wraps Unicode safely, sanitizes controls, and respects resize bounds", () => {
  const app = viewer(
    "漢字🙂 ".repeat(100) + "\u001b]52;c;bad\u0007\u001b[31mEND",
  );
  for (const width of [80, 20, 4, 1]) {
    app.view.invalidate();
    const lines = app.view.render(width);
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
    assert.ok(lines.length <= 16);
    // Text may add its own style resets, but input terminal controls must not survive.
    assert.ok(
      lines.every((line) => !line.includes("52;") && !line.includes("[31m")),
    );
  }
  app.resize(5);
  assert.ok(app.view.render(20).length <= 4);
  app.resize(50);
  app.view.handleInput("\u001b[F");
  const end = app.view.render(20);
  assert.ok(end.length <= 40);
  assert.match(end.join("\n"), /END/);
});

test("request hooks observe rewritten inputs without modifying the request or sending messages", async () => {
  const app = fixture();
  const payload = {
    instructions: "DYNAMIC_EXTENSION_RULE",
    input: [{ role: "user", content: "PRIVATE_HISTORY" }],
    tools: [{ name: "codemode", description: "EXPANDED_TOOL_LIST" }],
  };
  const original = structuredClone(payload);
  app.emit("turn_start");
  assert.equal(app.emit("before_provider_request", { payload }), undefined);
  assert.deepEqual(payload, original);
  app.emit("message_end", {
    message: {
      role: "assistant",
      provider: "fixture",
      model: "model",
      stopReason: "stop",
      usage: { input: 128, cacheRead: 64, cacheWrite: 32, output: 900 },
    },
  });
  app.emit("turn_end");
  Object.assign(app.ctx, { getContextUsage: () => ({ tokens: 1234 }) });
  await app.command.handler("", app.ctx);
  const report = app.notifications[0];
  assert.match(report, /First observed startup: ~/);
  assert.match(report, /Latest observed request: fixture\/model, stop/);
  assert.match(report, /Messages\/history delta: ~/);
  assert.match(report, /Combined provider input JSON: ~/);
  assert.match(report, /Provider-reported input total: 224 tokens/);
  assert.match(report, /Current session context estimate from Pi: ~1,234/);
  assert.doesNotMatch(
    report,
    /PRIVATE_HISTORY|DYNAMIC_EXTENSION_RULE|EXPANDED_TOOL_LIST/,
  );
});

for (const event of ["session_start", "model_select", "session_tree"])
  test(`${event} clears observed estimates rather than showing stale totals`, async () => {
    const app = fixture();
    app.emit("turn_start");
    app.emit("before_provider_request", {
      payload: { system: "first", messages: [] },
    });
    app.emit("agent_end");
    app.emit(event);
    await app.command.handler("", app.ctx);
    assert.match(app.notifications[0], /First observed startup: pending/);
    assert.match(app.notifications[0], /Full request estimate: pending/);
  });

test("observed startup preview includes rewritten tools but never conversation bodies", () => {
  const preview = formatPromptPreview(
    "report",
    "base",
    [],
    "DYNAMIC_TOOL_DESCRIPTION",
  );
  assert.match(
    preview,
    /=== First observed provider startup ===\nDYNAMIC_TOOL_DESCRIPTION/,
  );
});
