// Adapted from davis7dotsh/my-pi-setup@797eaf6d6f178759cf7aabde927ef15c91346e7e; output remains bounded for model context.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";

export type PersistFirecrawlOutput = (output: string) => Promise<string>;

async function persistOutput(operation: string, output: string) {
  const directory = await mkdtemp(join(tmpdir(), "pi-firecrawl-"));
  const path = join(directory, `${operation}.json`);
  await writeFile(path, output, "utf8");
  return path;
}

export async function formatFirecrawlOutput(
  value: unknown,
  operation: string,
  persist: PersistFirecrawlOutput = (output) => persistOutput(operation, output),
) {
  const encoded = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const output = encoded ?? String(value);
  const truncation = truncateHead(output, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  if (!truncation.truncated) return output;

  const outputPath = await persist(output);
  return `${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${outputPath}]`;
}
