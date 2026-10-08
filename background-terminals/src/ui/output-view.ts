/** Sanitized retained-tail rendering for /ps. */
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "../../../shared/terminal-text.ts";

export function buildOutputLines(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const segments = raw.split("\r");
    const segment = segments.at(-1) || [...segments].reverse().find(Boolean) || "";
    const clean = sanitizeTerminalText(segment);
    lines.push(...(clean ? wrapTextWithAnsi(clean, Math.max(10, width)) : [""]));
  }
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function createOutputLineCache() {
  let key: string | undefined;
  let lines: string[] = [];
  return {
    get(text: string, version: number, width: number): string[] {
      const next = `${version}:${width}`;
      if (key !== next) {
        key = next;
        lines = buildOutputLines(text, width);
      }
      return lines;
    },
  };
}
