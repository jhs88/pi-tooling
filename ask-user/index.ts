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
  CURSOR_MARKER,
  type EditorTheme,
  Key,
  matchesKey,
  parseKey,
  Text,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import {
  sanitizeTerminalLine,
  sanitizeTerminalText,
} from "../shared/terminal-text.ts";
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

      if (ctx.mode !== "tui" && ctx.mode !== "rpc") return reply({ kind: "no-ui" });
      if (signal?.aborted) return reply({ kind: "aborted" });

      // T3 maps Pi's standard RPC dialogs to native user-input cards. Keep
      // terminal components out of this path; RPC cannot render them.
      if (ctx.mode === "rpc") {
        const options = params.options.map((option, index) =>
          `${index + 1}. ${sanitizeTerminalLine(option.label)}${option.description ? `\n${sanitizeTerminalLine(option.description)}` : ""}`,
        );
        const customOption = "Write my own answer…";
        try {
          const selected = await ctx.ui.select(sanitizeTerminalText(params.question), [...options, customOption], { signal });
          if (signal?.aborted) return reply({ kind: "aborted" });
          if (selected === undefined) return reply({ kind: "dismissed" });
          const index = options.indexOf(selected);
          if (index !== -1) {
            return reply({ kind: "selected", answer: params.options[index].label, index: index + 1 });
          }
          // T3 can return typed text directly. Other RPC hosts may require
          // selecting the custom option before opening a text input.
          const answer = selected === customOption
            ? await ctx.ui.input(sanitizeTerminalText(params.question), "Type your answer", { signal })
            : selected;
          if (signal?.aborted) return reply({ kind: "aborted" });
          return answer?.trim()
            ? reply({ kind: "custom", answer: answer.trim() })
            : reply({ kind: "dismissed" });
        } catch (error) {
          if (signal?.aborted) return reply({ kind: "aborted" });
          throw error;
        }
      }

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
          let cachedWidth = 0;
          let cachedHeight = 0;
          let settled = false;
          let focused = false;

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
            editor.focused = focused && editMode;
            cachedLines = undefined;
            tui.requestRender();
          };

          editor.onSubmit = (value) => {
            const answer = value.trim();
            if (answer) finish({ answer, wasCustom: true });
            else refresh();
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
            if (settled) return;
            if (matchesKey(data, Key.tab)) {
              editMode = !editMode;
              if (editMode) optionIndex = allOptions.length - 1;
              refresh();
              return;
            }
            if (editMode) {
              if (matchesKey(data, Key.escape)) {
                editMode = false;
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
            const pressedKey = parseKey(data);
            const numberIndex = allOptions.findIndex((_option, index) => pressedKey === String(index + 1));
            if (numberIndex !== -1) {
              optionIndex = numberIndex;
              refresh();
              return;
            }
            if (matchesKey(data, Key.enter)) {
              select(optionIndex);
              return;
            }
            if (matchesKey(data, Key.escape)) {
              finish(null);
              return;
            }
            // Let Editor decode the host's negotiated keyboard protocol.
            const previousText = editor.getText();
            editor.handleInput(data);
            if (data.startsWith("\x1b[200~") || editor.getText() !== previousText) {
              editMode = true;
              optionIndex = allOptions.length - 1;
              refresh();
            }
          };

          const render = (width: number): string[] => {
            // Leave room for the host's transcript, status, and footer. Scroll
            // choices independently so the custom editor stays on screen.
            const height = Math.max(1, tui.terminal.rows - 6);
            if (cachedLines && cachedWidth === width && cachedHeight === height) return cachedLines;
            const lines: string[] = [];
            let selectedLine = 0;
            const add = (line: string) => lines.push(truncateToWidth(line, width));
            const wrapped = (text: string, indent: string, color: "text" | "accent" | "muted" | "dim", bold = false) => {
              for (const line of wrapTextWithAnsi(sanitizeTerminalText(text), Math.max(1, width - indent.length - 1))) {
                add(indent + theme.fg(color, bold ? theme.bold(line) : line));
              }
            };
            wrapped("Question", " ", "muted");
            wrapped(params.question, " ", "text", true);
            lines.push("");
            allOptions.forEach((option, index) => {
              const selected = index === optionIndex;
              if (selected) selectedLine = lines.length;
              const color = selected ? "accent" : option.isOther ? "muted" : "text";
              const labelLines = wrapTextWithAnsi(sanitizeTerminalLine(option.label), Math.max(1, width - 7));
              labelLines.forEach((line, lineIndex) => {
                const prefix = lineIndex === 0
                  ? `${selected ? " ❯ " : "   "}${index + 1}. `
                  : "      ";
                add(theme.fg(color, prefix + (selected ? theme.bold(line) : line)));
              });
              if (option.description) wrapped(sanitizeTerminalLine(option.description), "      ", "muted");
              if (index < allOptions.length - 1) lines.push("");
            });
            const editorLines = editor.render(Math.max(1, width - 2));
            const editorHeight = Math.max(1, height - 4);
            const cursorLine = editorLines.findIndex((line) => line.includes(CURSOR_MARKER));
            const editorStart = Math.max(0, cursorLine - editorHeight + 1);
            const footer = [
              theme.fg("muted", " Your answer" + (editMode ? "" : " · type to write")),
              ...editorLines.slice(editorStart, editorStart + editorHeight).map((line) => ` ${line}`),
              theme.fg("dim", editMode
              ? "Enter submit · Tab/Esc choices"
              : width < 34 ? "↑↓ · Enter · Tab · Esc" : `↑↓/1-${allOptions.length} · Enter · Tab write · Esc`),
            ].map((line) => truncateToWidth(line, width));
            const choiceHeight = Math.max(1, height - footer.length);
            const start = Math.max(0, Math.min(selectedLine - Math.floor(choiceHeight / 2), lines.length - choiceHeight));
            cachedWidth = width;
            cachedHeight = height;
            cachedLines = [...lines.slice(start, start + choiceHeight), ...footer].slice(0, height);
            return cachedLines;
          };

          return {
            get focused() { return focused; },
            set focused(value: boolean) {
              focused = value;
              editor.focused = value && editMode;
              cachedLines = undefined;
            },
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
      text += theme.fg("muted", sanitizeTerminalText(typeof args?.question === "string" ? args.question : ""));
      if (Array.isArray(args?.options) && args.options.length > 0) {
        text += `\n${theme.fg(
          "dim",
          `  ${args.options
            .map(
              (option, index) =>
                `${index + 1}. ${sanitizeTerminalLine(typeof option?.label === "string" ? option.label : "")}`,
            )
            .join("  ")}`,
        )}`;
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as AskUserDetails | undefined;
      if (!details) {
        const first = result.content[0];
        return new Text(
          first?.type === "text" ? sanitizeTerminalText(first.text) : "",
          0,
          0,
        );
      }
      if (details.outcome === "aborted") return new Text(theme.fg("warning", "■ aborted"), 0, 0);
      if (details.outcome === "dismissed") return new Text(theme.fg("warning", "✗ dismissed"), 0, 0);
      if (details.outcome === "no-ui") return new Text(theme.fg("muted", "interactive UI unavailable"), 0, 0);
      if (details.wasCustom) {
        return new Text(
          theme.fg("success", "✓ ") +
            theme.fg("muted", "(wrote) ") +
            theme.fg("accent", sanitizeTerminalText(details.answer ?? "")),
          0,
          0,
        );
      }
      return new Text(
        theme.fg("success", "✓ ") +
          theme.fg(
            "accent",
            `${details.index}. ${sanitizeTerminalText(details.answer ?? "")}`,
          ),
        0,
        0,
      );
    },
  });
}
