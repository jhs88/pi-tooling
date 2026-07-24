/** Sanitized retained-tail rendering for /ps. */
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

const OSC_PATTERN =
  /(?:\u001b\]|\u009d)(?:[^\u0007\u001b\u009c]|\u001b(?!\\))*(?:\u0007|\u001b\\|\u009c)/g;
const CSI_PATTERN = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
const ESCAPE_PATTERN = /\u001b(?:[()][0-2A-Z]|[ -/]*[@-~])/g;

export function sanitizeText(text: string): string {
  return text
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(ESCAPE_PATTERN, "")
    .replaceAll("\t", "  ")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

export function buildOutputLines(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const segments = raw.split("\r");
    const segment = segments.at(-1) || [...segments].reverse().find(Boolean) || "";
    const clean = sanitizeText(segment);
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
