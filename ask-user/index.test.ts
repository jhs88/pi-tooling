import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import askUser, { type AskUserInput } from "./index.ts";

const MALICIOUS = "visible\u001b]52;c;Y2xpcGJvYXJk\u0007\u001b[31mred\u001b[0m\u0001";
const MALICIOUS_LINE = `${MALICIOUS}\nforged-row`;

interface CapturedAskUserTool {
  name: string;
  execute: (
    toolCallId: string,
    params: AskUserInput,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    context: unknown,
  ) => Promise<unknown>;
  renderCall: (params: AskUserInput, theme: Theme) => Component;
  renderResult: (result: unknown, options: unknown, theme: Theme) => Component;
}

test("ask_user sanitizes model-controlled TUI text", async () => {
  let tool: CapturedAskUserTool | undefined;
  askUser({
    registerTool: (registered: unknown) => {
      const candidate = registered as CapturedAskUserTool;
      if (candidate.name === "ask_user") tool = candidate;
    },
  } as unknown as ExtensionAPI);
  assert.ok(tool);

  let rendered: string[] = [];
  const tui = { requestRender() {} } as unknown as TUI;
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
  const keybindings = {} as KeybindingsManager;
  const context = {
    mode: "tui",
    ui: {
      custom: async (
        factory: (
          tui: TUI,
          theme: Theme,
          keybindings: KeybindingsManager,
          done: (selection: unknown) => void,
        ) => Component,
      ) => {
        const component = factory(tui, theme, keybindings, () => {});
        rendered = component.render(100);
        return null;
      },
    },
  };

  const params: AskUserInput = {
    question: MALICIOUS,
    options: [
      { label: MALICIOUS_LINE, description: MALICIOUS_LINE },
      { label: "safe" },
    ],
  };
  const callLines = tool.renderCall(params, theme).render(100);
  await tool.execute(
    "call-fixture",
    params,
    undefined,
    undefined,
    context,
  );
  const resultLines = tool
    .renderResult(
      {
        content: [{ type: "text", text: MALICIOUS }],
        details: {
          question: MALICIOUS,
          options: [MALICIOUS, "safe"],
          outcome: "selected",
          answer: MALICIOUS,
          wasCustom: false,
          index: 1,
        },
      },
      {},
      theme,
    )
    .render(100);

  const output = [...callLines, ...rendered, ...resultLines].join("\n");
  assert.equal(rendered.every((line) => !line.includes("\n")), true);
  assert.doesNotMatch(output, /[\u001b\u009b\u009d]/);
  assert.doesNotMatch(output, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
  assert.match(output, /visiblered/);
});
