/**
 * Adapted with repository-owner authorization from davis7dotsh/my-pi-setup
 * commit 797eaf6d6f178759cf7aabde927ef15c91346e7e. Local hardening adds private
 * quota-bounded spill storage, stale cleanup, and best-effort secret redaction.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { OutputView } from "./domain.ts";

export const RETAINED_PER_STREAM = 2 * 1024 * 1024;
export const DEFAULT_SPILL_PER_STREAM = 8 * 1024 * 1024;
export const DEFAULT_SPILL_PER_SESSION = 32 * 1024 * 1024;
export const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function utf8Tail(text: string, maxBytes: number): { text: string; dropped: number } {
  const raw = Buffer.from(text, "utf8");
  if (raw.length <= maxBytes) return { text, dropped: 0 };
  let start = raw.length - maxBytes;
  while (start < raw.length && (raw[start] & 0xc0) === 0x80) start++;
  return { text: raw.subarray(start).toString("utf8"), dropped: start };
}

function utf8Prefix(text: string, maxBytes: number): Buffer {
  if (maxBytes <= 0) return Buffer.alloc(0);
  const raw = Buffer.from(text, "utf8");
  if (raw.length <= maxBytes) return raw;
  let end = maxBytes;
  while (end > 0 && (raw[end] & 0xc0) === 0x80) end--;
  return raw.subarray(0, end);
}

export class OutputBuffer {
  private chunks: string[] = [];
  private retainedBytes = 0;
  private cachedText = "";
  private dirty = false;
  private readonly maxRetainedBytes: number;
  totalBytes = 0;
  truncatedBytes = 0;
  spillPath?: string;
  spillBytes = 0;
  spillTruncated = false;

  constructor(maxRetainedBytes = RETAINED_PER_STREAM) {
    this.maxRetainedBytes = maxRetainedBytes;
  }

  push(chunk: string): void {
    if (!chunk) return;
    let bytes = Buffer.byteLength(chunk, "utf8");
    this.totalBytes += bytes;
    if (bytes > this.maxRetainedBytes) {
      this.truncatedBytes += this.retainedBytes;
      this.chunks = [];
      this.retainedBytes = 0;
      const tail = utf8Tail(chunk, this.maxRetainedBytes);
      this.truncatedBytes += tail.dropped;
      chunk = tail.text;
      bytes = Buffer.byteLength(chunk, "utf8");
    }
    this.chunks.push(chunk);
    this.retainedBytes += bytes;
    while (this.retainedBytes > this.maxRetainedBytes && this.chunks.length > 1) {
      const removed = this.chunks.shift();
      if (removed === undefined) break;
      const removedBytes = Buffer.byteLength(removed, "utf8");
      this.retainedBytes -= removedBytes;
      this.truncatedBytes += removedBytes;
    }
    this.dirty = true;
  }

  view(): OutputView {
    if (this.dirty) {
      this.cachedText = this.chunks.join("");
      this.dirty = false;
    }
    return {
      text: this.cachedText,
      totalBytes: this.totalBytes,
      truncatedBytes: this.truncatedBytes,
      spillPath: this.spillPath,
      spillBytes: this.spillBytes,
      spillTruncated: this.spillTruncated,
    };
  }
}

export interface SpillWriter {
  readonly path?: string;
  write(text: string): void;
  close(): void;
  info(): { bytes: number; truncated: boolean };
}

export interface SpillSessionOptions {
  root?: string;
  maxStreamBytes?: number;
  maxSessionBytes?: number;
  staleAfterMs?: number;
  now?: () => number;
}

export class SpillSession {
  readonly directory: string;
  private readonly maxStreamBytes: number;
  private readonly maxSessionBytes: number;
  private sessionBytes = 0;
  private disposed = false;
  private writers = new Set<SpillWriter>();

  constructor(options: SpillSessionOptions = {}) {
    const root = options.root ?? path.join(os.tmpdir(), "pi-background-terminals");
    const now = options.now ?? Date.now;
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(root, 0o700);
    } catch {
      // Windows and restrictive filesystems may not implement POSIX modes.
    }
    for (const name of fs.readdirSync(root)) {
      if (!name.startsWith("session-")) continue;
      const candidate = path.join(root, name);
      try {
        const stat = fs.lstatSync(candidate);
        if (stat.isDirectory() && now() - stat.mtimeMs > staleAfterMs) {
          fs.rmSync(candidate, { recursive: true, force: true });
        }
      } catch {
        // Startup scavenging is best effort.
      }
    }
    this.directory = fs.mkdtempSync(path.join(root, "session-"));
    try {
      fs.chmodSync(this.directory, 0o700);
    } catch {
      // See mode note above.
    }
    this.maxStreamBytes = options.maxStreamBytes ?? DEFAULT_SPILL_PER_STREAM;
    this.maxSessionBytes = options.maxSessionBytes ?? DEFAULT_SPILL_PER_SESSION;
  }

  createWriter(id: string, stream: "stdout" | "stderr"): SpillWriter {
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const spillPath = path.join(this.directory, `${safeId}.${stream}.log`);
    let fd: number | undefined;
    let bytes = 0;
    let truncated = false;
    let closed = false;
    try {
      fd = fs.openSync(spillPath, "w", 0o600);
    } catch {
      truncated = true;
    }

    const writer: SpillWriter = {
      path: fd === undefined ? undefined : spillPath,
      write: (text) => {
        if (closed || fd === undefined || !text) {
          if (text) truncated = true;
          return;
        }
        const available = Math.max(
          0,
          Math.min(this.maxStreamBytes - bytes, this.maxSessionBytes - this.sessionBytes),
        );
        const originalBytes = Buffer.byteLength(text, "utf8");
        const retained = utf8Prefix(text, available);
        if (retained.length < originalBytes) truncated = true;
        if (retained.length === 0) return;
        try {
          fs.writeSync(fd, retained);
          bytes += retained.length;
          this.sessionBytes += retained.length;
        } catch {
          truncated = true;
          writer.close();
        }
      },
      close: () => {
        if (closed) return;
        closed = true;
        if (fd !== undefined) {
          try {
            fs.closeSync(fd);
          } catch {
            truncated = true;
          }
          fd = undefined;
        }
        this.writers.delete(writer);
      },
      info: () => ({ bytes, truncated }),
    };
    this.writers.add(writer);
    return writer;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const writer of [...this.writers]) writer.close();
    fs.rmSync(this.directory, { recursive: true, force: true });
  }
}

const SECRET_KEY = /(secret|token|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|authorization)/i;

export function createSecretRedactor(env: NodeJS.ProcessEnv = process.env): (text: string) => string {
  const inherited = Object.entries(env)
    .filter(([key, value]) => SECRET_KEY.test(key) && typeof value === "string" && value.length >= 4)
    .map(([, value]) => value as string)
    .sort((a, b) => b.length - a.length);

  return (text: string) => {
    let safe = text;
    for (const value of inherited) safe = safe.split(value).join("[REDACTED]");
    safe = safe
      .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
      .replace(/\b(gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, "[REDACTED]")
      .replace(/\b(api[_-]?key|token|password|passwd|secret)\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]");
    return safe;
  };
}
