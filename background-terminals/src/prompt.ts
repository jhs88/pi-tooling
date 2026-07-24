/**
 * Model-facing strings adapted with repository-owner authorization from
 * davis7dotsh/my-pi-setup commit 797eaf6d6f178759cf7aabde927ef15c91346e7e.
 * Retention wording is intentionally honest about bounded tails and spills.
 */

import {
  formatElapsed,
  formatExit,
  type KillResult,
  type OutputView,
  type TerminalSnapshot,
} from "./domain.ts";
import { DEFAULT_SPILL_PER_SESSION, DEFAULT_SPILL_PER_STREAM } from "./output.ts";
import { MAX_RUNNING } from "./manager.ts";

export const STATUS_STDOUT_MAX = 16 * 1024;
export const STATUS_STDERR_MAX = 8 * 1024;
export const RESULT_STDOUT_MAX = 8 * 1024;
export const RESULT_STDERR_MAX = 4 * 1024;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MiB`;
}

function tailByBytes(text: string, maxBytes: number, maxLines: number): { content: string; truncated: boolean } {
  const lines = text.split("\n");
  let content = lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
  let truncated = lines.length > maxLines;
  const raw = Buffer.from(content, "utf8");
  if (raw.length > maxBytes) {
    let start = raw.length - maxBytes;
    while (start < raw.length && (raw[start] & 0xc0) === 0x80) start++;
    content = raw.subarray(start).toString("utf8");
    truncated = true;
  }
  return { content, truncated };
}

function safeModelText(text: string): string {
  return text
    .replace(/(?:\u001b\]|\u009d)(?:[^\u0007\u001b\u009c]|\u001b(?!\\))*(?:\u0007|\u001b\\|\u009c)/g, "")
    .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

export function outputRetentionNote(view: OutputView): string {
  const ps = "/ps shows only the retained tail.";
  if (!view.spillPath) return `No spill log is available. ${ps}`;
  if (view.spillTruncated) {
    return `Private spill retained first ${formatSize(view.spillBytes)} at ${view.spillPath}; newer output beyond quota or an I/O failure was not written. ${ps}`;
  }
  return `Private quota-bounded spill retained ${formatSize(view.spillBytes)} at ${view.spillPath}. ${ps}`;
}

export const BG_START_TOOL_DESCRIPTION =
  "Start a long-running non-interactive command in a session-scoped background process. " +
  "POSIX uses the same explicit non-interactive zsh policy as zsh-user-bash (-fc; PI_BACKGROUND_SHELL/PI_USER_BASH_SHELL may override); Windows uses ComSpec /d /s /c. " +
  "stdin is immediate EOF and there is no write tool. Output is best-effort redacted, held in bounded tails, and written to private quota-bounded spill files. " +
  `Spill quotas default to ${formatSize(DEFAULT_SPILL_PER_STREAM)} per stream and ${formatSize(DEFAULT_SPILL_PER_SESSION)} per session. Max ${MAX_RUNNING} processes run at once. ` +
  "POSIX process-group termination is tested. Windows taskkill support is best effort and not verified here; SIGKILL, power loss, and hard crashes cannot run teardown.";

export const BG_START_PROMPT_SNIPPET =
  "Run a long-lived non-interactive command in the background; output is captured and completion is reported";

export const BG_START_PROMPT_GUIDELINES = [
  "Use bg_start for servers, watchers, and long builds; use bash for quick commands.",
  "bg_start has no stdin. Never start a command that requires interactive input or may print secrets.",
  "After bg_start, continue working. Use bg_status only when current output is needed.",
];

export const BG_START_PARAMETER_DESCRIPTIONS = {
  command: "Command to run through the explicit background shell. It receives immediate EOF on stdin.",
  title: "Short human-readable title for listings and /ps",
  workingDir: "Working directory, relative to the current session cwd unless absolute",
};
export const BG_STATUS_PARAMETER_DESCRIPTIONS = {
  id: "Background terminal id returned by bg_start or bg_list",
};
export const BG_KILL_PARAMETER_DESCRIPTIONS = {
  ids: "One or more background terminal ids to stop",
};
export const BG_STATUS_TOOL_DESCRIPTION = "Return one terminal's current state and bounded retained output tails.";
export const BG_LIST_TOOL_DESCRIPTION = "List all tracked running and settled background terminals.";
export const BG_KILL_TOOL_DESCRIPTION =
  "Stop process trees. POSIX sends SIGTERM to the process group then SIGKILL after a grace period; Windows uses best-effort taskkill /T then /F.";

export function describeTerminal(snapshot: TerminalSnapshot): string {
  return `${snapshot.id} [${snapshot.status}] "${snapshot.title}" (pid ${snapshot.pid ?? "?"}, ${formatElapsed(snapshot)}, ${formatExit(snapshot)}, ${snapshot.cwd}, stdout ${formatSize(snapshot.stdout.totalBytes)}, stderr ${formatSize(snapshot.stderr.totalBytes)})`;
}

function outputSection(label: string, view: OutputView, maxBytes: number, maxLines: number): string {
  if (view.totalBytes === 0) return `${label}: (empty)`;
  const tail = tailByBytes(safeModelText(view.text), maxBytes, maxLines);
  let text = `${label}:\n${tail.content}`;
  if (tail.truncated || view.truncatedBytes > 0 || view.spillTruncated) {
    text += `\n[${label} retained tail: showing at most ${formatSize(maxBytes)} of ${formatSize(view.totalBytes)}. ${outputRetentionNote(view)}]`;
  }
  return text;
}

export function buildStartResult(snapshot: TerminalSnapshot): string {
  return `Started ${snapshot.id} "${snapshot.title}" (pid ${snapshot.pid ?? "?"}, shell ${snapshot.shell}, cwd ${snapshot.cwd}). It has no stdin. Completion delivery is coalesced and best effort; use bg_status, bg_list, bg_kill, or /ps.`;
}

export function buildStatusResult(snapshot: TerminalSnapshot): string {
  let text = describeTerminal(snapshot);
  if (snapshot.errorText) text += `\nError: ${snapshot.errorText}`;
  text += `\n\n${outputSection("stdout", snapshot.stdout, STATUS_STDOUT_MAX, 400)}`;
  text += `\n\n${outputSection("stderr", snapshot.stderr, STATUS_STDERR_MAX, 200)}`;
  return text;
}

export function buildTerminalResultMessage(snapshot: TerminalSnapshot): string {
  const outcome = snapshot.status === "killed" ? "was killed" : `exited (${formatExit(snapshot)})`;
  let text = `Background terminal ${snapshot.id} "${snapshot.title}" ${outcome} after ${formatElapsed(snapshot)}.`;
  if (snapshot.errorText) text += `\nError: ${snapshot.errorText}`;
  text += `\n\n${outputSection("stdout", snapshot.stdout, RESULT_STDOUT_MAX, 40)}`;
  if (snapshot.stderr.totalBytes > 0) text += `\n\n${outputSection("stderr", snapshot.stderr, RESULT_STDERR_MAX, 20)}`;
  return text;
}

export function buildKillReport(results: ReadonlyArray<KillResult>): string {
  return results.map((result) => {
    if (result.killed) return `Killed ${result.id} "${result.title}" (${result.exit}).`;
    if (result.wasRunning) return `${result.id} "${result.title}" exited before termination landed (${result.exit}).`;
    return `${result.id} "${result.title}" was already ${result.status} (${result.exit}).`;
  }).join("\n");
}
