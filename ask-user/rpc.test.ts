import assert from "node:assert/strict";
import test from "node:test";
import { loadExtensions } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

const loaded = await loadExtensions([new URL("./index.ts", import.meta.url).pathname], process.cwd());
assert.deepEqual(loaded.errors, []);
const tool = loaded.extensions[0].tools.get("ask_user")!.definition;
type ExtensionToolContext = Parameters<typeof tool.execute>[4];
const params = {
  question: "Where should answers appear?",
  options: [
    { label: "Native cards (Recommended)", description: "Use the host question UI." },
    { label: "Terminal" },
  ],
};

function context(ui: Partial<ExtensionToolContext["ui"]>, mode: ExtensionToolContext["mode"] = "rpc") {
  return { mode, hasUI: mode === "rpc", ui } as ExtensionToolContext;
}

async function execute(ctx: ExtensionToolContext, signal?: AbortSignal) {
  const result = await tool.execute("test-call", params, signal, undefined, ctx);
  const details = result.details;
  assert.ok(details && typeof details === "object");
  assert.ok("outcome" in details && "answer" in details && "index" in details);
  return { ...result, details };
}

test("RPC opens a native select dialog and preserves selected label and index", async () => {
  let shown = false;
  const result = await execute(context({
    async select(title, options) {
      shown = true;
      assert.equal(title, params.question);
      assert.match(options[0], /Native cards.*Use the host question UI\./s);
      return options[0];
    },
    async custom() { throw new Error("RPC cannot render terminal components"); },
  }));
  assert.equal(shown, true);
  assert.equal(result.details.outcome, "selected");
  assert.equal(result.details.answer, params.options[0].label);
  assert.equal(result.details.index, 1);
});

test("RPC accepts a custom answer returned directly by the host", async () => {
  const result = await execute(context({ async select() { return "Use a sidebar"; } }));
  assert.equal(result.details.outcome, "custom");
  assert.equal(result.details.answer, "Use a sidebar");
});

test("RPC custom-answer fallback opens input with the same abort signal", async () => {
  const controller = new AbortController();
  const result = await execute(context({
    async select(_title, options, opts) {
      assert.equal(opts?.signal, controller.signal);
      return options.at(-1);
    },
    async input(title, _placeholder, opts) {
      assert.equal(title, params.question);
      assert.equal(opts?.signal, controller.signal);
      return "  Inline answers  ";
    },
  }), controller.signal);
  assert.equal(result.details.outcome, "custom");
  assert.equal(result.details.answer, "Inline answers");
});

test("RPC cancellation and blank replies never imply the highlighted answer", async () => {
  for (const reply of [undefined, "", "   "]) {
    const result = await execute(context({ async select() { return reply; } }));
    assert.equal(result.details.outcome, "dismissed");
    assert.equal(result.details.answer, null);
  }
  const result = await execute(context({
    async select(_title, options) { return options.at(-1); },
    async input() { return undefined; },
  }));
  assert.equal(result.details.outcome, "dismissed");
});

test("RPC turn abortion wins over dialog cancellation or a late answer", async () => {
  for (const lateAnswer of [undefined, params.options[1].label]) {
    const controller = new AbortController();
    const result = await execute(context({ async select() {
      controller.abort();
      return lateAnswer;
    } }), controller.signal);
    assert.equal(result.details.outcome, "aborted");
  }
  const result = await execute(context({ async select() { throw new Error("must not open"); } }), AbortSignal.abort());
  assert.equal(result.details.outcome, "aborted");
});

test("headless modes retain the plain-text fallback", async () => {
  for (const mode of ["print", "json"] as const) {
    const result = await execute(context({}, mode));
    assert.equal(result.details.outcome, "no-ui");
  }
});
