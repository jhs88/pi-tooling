import assert from "node:assert/strict";
import test from "node:test";
import type { Component } from "@earendil-works/pi-tui";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { loadExtensions } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { createChatViewport } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/chat-viewport.js";
import { renderLayoutFrame } from "../node_modules/@earendil-works/pi-tui/dist/layout.js";

const loaded = await loadExtensions(
  [new URL("./index.ts", import.meta.url).pathname],
  process.cwd(),
);
assert.deepEqual(loaded.errors, []);
const tool = loaded.extensions[0].tools.get("ask_user")!.definition;
type ToolContext = Parameters<typeof tool.execute>[4];
type Factory = Parameters<ToolContext["ui"]["custom"]>[0];
const params = {
  question: "Which interface should we use for this project?",
  options: [
    {
      label: "Native cards (Recommended)",
      description:
        "Show the full explanation with enough detail to make a useful choice.",
    },
    { label: "Terminal", description: "Keep questions in the terminal." },
  ],
};

async function panel(
  exercise: (component: Component, finished: () => boolean) => void,
  signal?: AbortSignal,
  settings: { rows?: number; params?: typeof params } = {},
) {
  const custom = (factory: Factory) =>
    new Promise<unknown>((resolve, reject) => {
      let finished = false;
      let answer: unknown;
      const done = (value: unknown) => {
        finished = true;
        answer = value;
      };
      const tui = {
        requestRender() {},
        terminal: {
          get rows() {
            return settings.rows ?? 30;
          },
          columns: 80,
        },
      } as Parameters<Factory>[0];
      const theme = {
        fg: (_color: string, text: string) => text,
        bold: (text: string) => text,
      } as Parameters<Factory>[1];
      Promise.resolve(
        factory(tui, theme, {} as Parameters<Factory>[2], done),
      ).then((component) => {
        try {
          if ("focused" in component) component.focused = true;
          exercise(component, () => finished);
          assert.equal(finished, true, "test must finish the interaction");
          resolve(answer);
        } catch (error) {
          reject(error);
        } finally {
          component.dispose?.();
        }
      }, reject);
    });
  const ctx = { mode: "tui", ui: { custom } } as ToolContext;
  return tool.execute(
    "tui-test",
    settings.params ?? params,
    signal,
    undefined,
    ctx,
  );
}

const key = (component: Component, data: string) =>
  component.handleInput?.(data);

test("terminal panel wraps choices and descriptions and reflows after a resize", async () => {
  await panel((component) => {
    const wide = component.render(80);
    assert.match(wide.join(""), /useful choice\./);
    const narrow = component.render(26);
    assert.notDeepEqual(narrow, wide);
    for (const width of [26, 12]) {
      const lines = component.render(width);
      assert.ok(lines.every((line) => visibleWidth(line) <= width));
      assert.ok(lines.length <= 30, "the panel must fit the terminal height");
    }
    key(component, "\x1b");
  });
});

test("number keys highlight an answer and Enter confirms it", async () => {
  const result = await panel((component, finished) => {
    key(component, "2");
    assert.equal(finished(), false);
    assert.match(component.render(80).join("\n"), /❯ 2\. Terminal/);
    key(component, "\r");
    assert.equal(finished(), true);
  });
  assert.match(
    result.content[0].type === "text" ? result.content[0].text : "",
    /option 2: Terminal/,
  );
});

test("custom text survives returning to choices and reopening the editor", async () => {
  const result = await panel((component) => {
    key(component, "3");
    key(component, "\r");
    key(component, "Use a sidebar");
    key(component, "\x1b");
    key(component, "\r");
    assert.match(component.render(60).join("\n"), /Use a sidebar/);
    key(component, "\r");
  });
  assert.match(
    result.content[0].type === "text" ? result.content[0].text : "",
    /own answer: Use a sidebar/,
  );
});

test("terminal dismissal and turn abortion remain distinct", async () => {
  const dismissed = await panel((component) => key(component, "\x1b"));
  assert.match(
    dismissed.content[0].type === "text" ? dismissed.content[0].text : "",
    /dismissed/,
  );
  const controller = new AbortController();
  const aborted = await panel(() => controller.abort(), controller.signal);
  assert.match(
    aborted.content[0].type === "text" ? aborted.content[0].text : "",
    /turn was aborted/,
  );
});

test("custom answer is visible immediately and typing opens it without choosing Other", async () => {
  const result = await panel((component) => {
    assert.match(component.render(80).join("\n"), /Your answer/);
    key(component, "My own answer");
    const rendered = component.render(80).join("\n");
    assert.match(rendered, /My own answer/);
    assert.ok(
      rendered.includes(CURSOR_MARKER),
      "text entry must expose a cursor to the terminal",
    );
    key(component, "\r");
  });
  assert.match(
    result.content[0].type === "text" ? result.content[0].text : "",
    /own answer: My own answer/,
  );
});

test("Tab lets a custom answer start with a number", async () => {
  const result = await panel((component) => {
    key(component, "\t");
    key(component, "2");
    key(component, " weeks");
    key(component, "\r");
  });
  assert.match(
    result.content[0].type === "text" ? result.content[0].text : "",
    /own answer: 2 weeks/,
  );
});

test("number shortcuts work with Kitty keyboard events", async () => {
  const result = await panel((component) => {
    key(component, "\x1b[51u");
    key(component, "\r");
    key(component, "Custom answer");
    key(component, "\r");
  });
  assert.match(
    result.content[0].type === "text" ? result.content[0].text : "",
    /own answer: Custom answer/,
  );
});

for (const [name, input, answer] of [
  ["Kitty printable input", "\x1b[97u", "a"],
  ["modifyOtherKeys printable input", "\x1b[27;2;65~", "A"],
  ["bracketed paste", "\x1b[200~My pasted answer\x1b[201~", "My pasted answer"],
  ["Unicode input", "別の回答", "別の回答"],
]) {
  test(`${name} starts a custom answer from the choices`, async () => {
    const result = await panel((component) => {
      key(component, input);
      key(component, "\r");
    });
    assert.equal(
      result.content[0].type === "text" ? result.content[0].text : "",
      `User wrote their own answer: ${answer}`,
    );
  });
}

test("five choices keep the selected option and custom editor visible in the real fullscreen layout", async () => {
  const settings = {
    rows: 24,
    params: {
      question: "Which implementation should we use?",
      options: Array.from({ length: 5 }, (_, i) => ({
        label: `Option ${i + 1}`,
        description: "Use this approach for the project setup.",
      })),
    },
  };
  const result = await panel(
    (component) => {
      const empty = { render: () => [], invalidate() {} };
      const viewport = createChatViewport({
        document: empty,
        pendingMessages: empty,
        status: { ...empty, render: () => ["status"] },
        editor: component,
        footer: { ...empty, render: () => ["footer", "footer"] },
      });
      const frame = () =>
        renderLayoutFrame(
          viewport.root,
          40,
          settings.rows,
          () => {},
        ).lines.join("\n");
      assert.match(frame(), /Your answer/);
      assert.match(frame(), /❯ 1\./);
      key(component, "6");
      assert.match(frame(), /❯ 6\./);
      settings.rows = 14;
      assert.match(frame(), /❯ 6\./);
      assert.match(frame(), /Your answer/);
      key(component, "\t");
      key(component, "My own answer");
      assert.match(frame(), /My own answer/);
      assert.ok(frame().includes(CURSOR_MARKER));
      key(component, "\r");
    },
    undefined,
    settings,
  );
  assert.match(
    result.content[0].type === "text" ? result.content[0].text : "",
    /own answer: My own answer/,
  );
});
