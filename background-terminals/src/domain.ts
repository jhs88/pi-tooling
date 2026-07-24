/**
 * Adapted with repository-owner authorization from davis7dotsh/my-pi-setup
 * commit 797eaf6d6f178759cf7aabde927ef15c91346e7e. The local domain describes
 * bounded/quota-aware retention rather than an unbounded full-log promise.
 */

export type TerminalStatus = "running" | "done" | "failed" | "killed";

export interface OutputView {
  /** Newest in-memory text retained for model/TUI use. */
  readonly text: string;
  /** UTF-8 bytes observed after best-effort redaction. */
  readonly totalBytes: number;
  /** Bytes dropped from the head of the in-memory tail. */
  readonly truncatedBytes: number;
  /** Private quota-bounded spill file, when available. */
  readonly spillPath?: string;
  /** Bytes retained in the spill file. */
  readonly spillBytes: number;
  /** True when quota or an I/O failure made the spill incomplete. */
  readonly spillTruncated: boolean;
}

export interface TerminalSnapshot {
  readonly id: string;
  readonly command: string;
  readonly title: string;
  readonly cwd: string;
  readonly shell: string;
  readonly pid?: number;
  readonly status: TerminalStatus;
  readonly createdAt: number;
  readonly settledAt?: number;
  readonly exitCode?: number;
  readonly signal?: NodeJS.Signals | string;
  readonly errorText?: string;
  readonly stdout: OutputView;
  readonly stderr: OutputView;
}

export interface KillResult {
  readonly id: string;
  readonly title: string;
  readonly status: TerminalStatus;
  readonly wasRunning: boolean;
  readonly killed: boolean;
  readonly exit: string;
}

export function formatElapsed(snapshot: TerminalSnapshot): string {
  const end = snapshot.settledAt ?? Date.now();
  const seconds = Math.max(0, Math.round((end - snapshot.createdAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0
    ? `${minutes}m${String(seconds % 60).padStart(2, "0")}s`
    : `${seconds}s`;
}

export function formatExit(snapshot: TerminalSnapshot): string {
  if (snapshot.status === "running") return "running";
  if (snapshot.signal) return String(snapshot.signal);
  if (snapshot.exitCode !== undefined) return `exit ${snapshot.exitCode}`;
  return snapshot.status;
}
