/**
 * ask_user — one question, 2-5 choices, and an always-present custom answer.
 *
 * Adapted with repository-owner authorization from davis7dotsh/my-pi-setup
 * commit 797eaf6d6f178759cf7aabde927ef15c91346e7e for Pi 0.80.10. This version
 * avoids Effect and keeps user dismissal distinct from tool/turn abortion.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import {
  ASK_USER_PARAMETER_DESCRIPTIONS,
  ASK_USER_PROMPT_GUIDELINES,
  ASK_USER_PROMPT_SNIPPET,
  ASK_USER_TOOL_DESCRIPTION,
  MAX_OPTIONS,
  MIN_OPTIONS,
  assertValidOptionCount,
  buildAskUserResultMessage,
  type AskUserOutcome,
} from "./prompt.ts";

const OptionSchema = Type.Object({
  label: Type.String({ description: ASK_USER_PARAMETER_DESCRIPTIONS.optionLabel }),
  description: Type.Optional(
    Type.String({ description: ASK_USER_PARAMETER_DESCRIPTIONS.optionDescription }),
  ),
});

const AskUserParams = Type.Object({
  question: Type.String({ description: ASK_USER_PARAMETER_DESCRIPTIONS.question }),
  options: Type.Array(OptionSchema, {
    minItems: MIN_OPTIONS,
    maxItems: MAX_OPTIONS,
    description: ASK_USER_PARAMETER_DESCRIPTIONS.options,
  }),
});

export type AskUserInput = Static<typeof AskUserParams>;

interface AskUserDetails {
  question: string;
  options: string[];
  outcome: AskUserOutcome["kind"];
  answer: string | null;
  wasCustom: boolean;
  index?: number;
}

type Selection = { answer: string; wasCustom: boolean; index?: number } | null;
type DisplayOption = AskUserInput["options"][number] & { isOther?: boolean };

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (current && next.length > width) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export default function askUser(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description: ASK_USER_TOOL_DESCRIPTION,
    promptSnippet: ASK_USER_PROMPT_SNIPPET,
    promptGuidelines: ASK_USER_PROMPT_GUIDELINES,
    parameters: AskUserParams,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      assertValidOptionCount(params.options.length);
      const reply = (outcome: AskUserOutcome) => {
        const answered = outcome.kind === "selected" || outcome.kind === "custom";
        return {
          content: [{ type: "text" as const, text: buildAskUserResultMessage(outcome) }],
          details: {
            question: params.question,
            options: params.options.map((option) => option.label),
            outcome: outcome.kind,
            answer: answered ? outcome.answer : null,
            wasCustom: outcome.kind === "custom",
            index: outcome.kind === "selected" ? outcome.index : undefined,
          } satisfies AskUserDetails,
        };
      };

      // Pi RPC reports hasUI=true but cannot host terminal custom components.
      if (ctx.mode !== "tui") return reply({ kind: "no-ui" });
      if (signal?.aborted) return reply({ kind: "aborted" });

      const allOptions: DisplayOption[] = [
        ...params.options,
        { label: "Write my own answer…", isOther: true },
      ];
      let aborted = false;

      try {
        const result = await ctx.ui.custom<Selection>((tui, theme, _keybindings, done) => {
          let optionIndex = 0;
          let editMode = false;
          let cachedLines: string[] | undefined;
          let settled = false;

          const editorTheme: EditorTheme = {
            borderColor: (text) => theme.fg("accent", text),
            selectList: {
              selectedPrefix: (text) => theme.fg("accent", text),
              selectedText: (text) => theme.fg("accent", text),
              description: (text) => theme.fg("muted", text),
              scrollInfo: (text) => theme.fg("dim", text),
              noMatch: (text) => theme.fg("warning", text),
            },
          };
          const editor = new Editor(tui, editorTheme);

          const finish = (selection: Selection) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener("abort", abort);
            done(selection);
          };
          const abort = () => {
            aborted = true;
            finish(null);
          };
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) queueMicrotask(abort);

          const refresh = () => {
            cachedLines = undefined;
            tui.requestRender();
          };

          editor.onSubmit = (value) => {
            const answer = value.trim();
            if (answer) finish({ answer, wasCustom: true });
            else {
              editMode = false;
              editor.setText("");
              refresh();
            }
          };

          const select = (index: number) => {
            const selected = allOptions[index];
            if (selected.isOther) {
              optionIndex = index;
              editMode = true;
              refresh();
            } else {
              finish({ answer: selected.label, wasCustom: false, index: index + 1 });
            }
          };

          const handleInput = (data: string) => {
            if (editMode) {
              if (matchesKey(data, Key.escape)) {
                editMode = false;
                editor.setText("");
                refresh();
                return;
              }
              editor.handleInput(data);
              refresh();
              return;
            }
            if (matchesKey(data, Key.up)) {
              optionIndex = (optionIndex - 1 + allOptions.length) % allOptions.length;
              refresh();
              return;
            }
            if (matchesKey(data, Key.down)) {
              optionIndex = (optionIndex + 1) % allOptions.length;
              refresh();
              return;
            }
            if (data.length === 1 && data >= "1" && data <= String(allOptions.length)) {
              select(Number(data) - 1);
              return;
            }
            if (matchesKey(data, Key.enter)) {
              select(optionIndex);
              return;
            }
            if (matchesKey(data, Key.escape)) finish(null);
          };

          const render = (width: number): string[] => {
            if (cachedLines) return cachedLines;
            const lines: string[] = [];
            const add = (line: string) => lines.push(truncateToWidth(line, width));
            const title = " Question ";
            add(theme.fg("accent", `─${title}${"─".repeat(Math.max(0, width - title.length - 1))}`));
            for (const line of wrapText(params.question, Math.max(10, width - 2))) {
              add(` ${theme.fg("text", theme.bold(line))}`);
            }
            lines.push("");
            allOptions.forEach((option, index) => {
              const selected = index === optionIndex;
              const prefix = selected ? theme.fg("accent", " ❯ ") : "   ";
              const marker = option.isOther ? "✎" : `${index + 1}.`;
              const color = selected || (option.isOther && editMode)
                ? "accent"
                : option.isOther
                  ? "muted"
                  : "text";
              add(prefix + theme.fg(color, `${marker} ${option.label}`));
              if (option.description) add(`      ${theme.fg("muted", option.description)}`);
            });
            if (editMode) {
              lines.push("");
              add(theme.fg("muted", " Your answer:"));
              for (const line of editor.render(Math.max(10, width - 2))) add(` ${line}`);
            }
            lines.push("");
            add(theme.fg("dim", editMode
              ? " Enter submit • Esc back to options"
              : ` ↑↓ or 1-${allOptions.length} select • Enter confirm • Esc dismiss`));
            add(theme.fg("accent", "─".repeat(width)));
            cachedLines = lines;
            return lines;
          };

          return {
            render,
            invalidate: () => {
              cachedLines = undefined;
            },
            handleInput,
            dispose: () => signal?.removeEventListener("abort", abort),
          };
        });

        if (aborted || signal?.aborted) return reply({ kind: "aborted" });
        if (!result) return reply({ kind: "dismissed" });
        return result.wasCustom
          ? reply({ kind: "custom", answer: result.answer })
          : reply({ kind: "selected", answer: result.answer, index: result.index! });
      } catch (error) {
        if (aborted || signal?.aborted) return reply({ kind: "aborted" });
        throw error;
      }
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("ask_user "));
      text += theme.fg("muted", args.question);
      if (args.options.length > 0) {
        text += `\n${theme.fg("dim", `  ${args.options.map((option, index) => `${index + 1}. ${option.label}`).join("  ")}`)}`;
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as AskUserDetails | undefined;
      if (!details) {
        const first = result.content[0];
        return new Text(first?.type === "text" ? first.text : "", 0, 0);
      }
      if (details.outcome === "aborted") return new Text(theme.fg("warning", "■ aborted"), 0, 0);
      if (details.outcome === "dismissed") return new Text(theme.fg("warning", "✗ dismissed"), 0, 0);
      if (details.outcome === "no-ui") return new Text(theme.fg("muted", "terminal UI unavailable"), 0, 0);
      if (details.wasCustom) {
        return new Text(
          theme.fg("success", "✓ ") + theme.fg("muted", "(wrote) ") + theme.fg("accent", details.answer ?? ""),
          0,
          0,
        );
      }
      return new Text(
        theme.fg("success", "✓ ") + theme.fg("accent", `${details.index}. ${details.answer}`),
        0,
        0,
      );
    },
  });
}
