/**
 * Session-scoped background process supervisor.
 *
 * Adapted with repository-owner authorization from davis7dotsh/my-pi-setup
 * commit 797eaf6d6f178759cf7aabde927ef15c91346e7e. This local implementation
 * removes Effect, aligns POSIX shell choice with zsh-user-bash, bounds spills,
 * redacts output best-effort, and installs idempotent process-exit cleanup.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import {
  formatExit,
  type KillResult,
  type TerminalSnapshot,
  type TerminalStatus,
} from "./domain.ts";
import {
  createSecretRedactor,
  OutputBuffer,
  RETAINED_PER_STREAM,
  SpillSession,
  type SpillSessionOptions,
  type SpillWriter,
} from "./output.ts";

export const MAX_RUNNING = 8;
export const MAX_TRACKED = 32;
const FORCE_KILL_AFTER_MS = 2_000;
const FINAL_CLOSE_GRACE_MS = 750;
const EXIT_PIPE_GRACE_MS = 1_000;
const ERROR_TEXT_MAX = 4_096;

export interface ShellSpec {
  executable: string;
  prefixArgs: string[];
  description: string;
}

export interface ShellInvocation {
  executable: string;
  args: string[];
  description: string;
}

export function selectShellInvocation(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ShellInvocation {
  if (platform === "win32") {
    const executable = env.ComSpec || "cmd.exe";
    return {
      executable,
      args: ["/d", "/s", "/c", command],
      description: `${executable} /d /s /c`,
    };
  }
  const configured = env.PI_BACKGROUND_SHELL || env.PI_USER_BASH_SHELL;
  const shellFromEnvironment =
    env.SHELL && basename(env.SHELL) === "zsh" ? env.SHELL : undefined;
  const executable =
    configured ||
    shellFromEnvironment ||
    (existsSync("/bin/zsh")
      ? "/bin/zsh"
      : existsSync("/bin/bash")
        ? "/bin/bash"
        : "/bin/sh");
  const flag = basename(executable) === "sh" ? "-c" : "-fc";
  return {
    executable,
    args: [flag, command],
    description: `${executable} ${flag}`,
  };
}

interface MutableSnapshot extends TerminalSnapshot {
  status: TerminalStatus;
  settledAt?: number;
  exitCode?: number;
  signal?: NodeJS.Signals | string;
  errorText?: string;
}

interface Entry {
  snapshot: MutableSnapshot;
  child: ChildProcess;
  stdout: OutputBuffer;
  stderr: OutputBuffer;
  stdoutSpill?: SpillWriter;
  stderrSpill?: SpillWriter;
  exited: boolean;
  stdioClosed: boolean;
  processErrored: boolean;
  killRequested: boolean;
  termination?: Promise<void>;
  exitCleanup?: ReturnType<typeof setTimeout>;
  settlePromise: Promise<TerminalSnapshot>;
  settleResolve: (snapshot: TerminalSnapshot) => void;
}

export interface StartOptions {
  command: string;
  title: string;
  cwd: string;
}

export interface TerminalManagerOptions {
  shell?: ShellSpec;
  env?: NodeJS.ProcessEnv;
  spill?: SpillSessionOptions;
  retainedPerStream?: number;
}

export interface TerminalManager {
  start(options: StartOptions): Promise<TerminalSnapshot>;
  get(id: string): TerminalSnapshot | undefined;
  list(): ReadonlyArray<TerminalSnapshot>;
  waitForSettlement(id: string): Promise<TerminalSnapshot>;
  kill(ids: ReadonlyArray<string>, signal?: AbortSignal): Promise<ReadonlyArray<KillResult>>;
  requestKill(id: string): void;
  subscribe(listener: () => void): () => void;
  subscribeTo(id: string, listener: () => void): () => void;
  setOnSettled(hook: ((snapshot: TerminalSnapshot, consumed: boolean) => void) | undefined): void;
  dispose(): Promise<void>;
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, ERROR_TEXT_MAX);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error("Operation was aborted."));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("Operation was aborted."));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform === "win32" && child.pid) {
    try {
      const killer = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])],
        { stdio: "ignore", windowsHide: true },
      );
      const fallback = () => {
        try {
          child.kill(signal);
        } catch {
          // The process may already have exited.
        }
      };
      killer.once("error", fallback);
      killer.once("exit", (code) => {
        if (code !== 0) fallback();
      });
      killer.unref();
      return;
    } catch {
      // Fall through to direct child signaling. Windows tree termination is
      // best effort here and remains unverified without real Windows CI.
    }
  }
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The process group may already have disappeared.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The child may already have exited.
  }
}

export function createTerminalManager(options: TerminalManagerOptions = {}): TerminalManager {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const idListeners = new Map<string, Set<() => void>>();
  const killInterest = new Map<string, number>();
  const redact = createSecretRedactor(options.env ?? process.env);
  let spillSession: SpillSession | undefined;
  try {
    spillSession = new SpillSession(options.spill);
  } catch {
    // A broken/unavailable tmpdir degrades to bounded memory-only capture.
  }
  let counter = 0;
  let reserved = 0;
  let disposed = false;
  let disposePromise: Promise<void> | undefined;
  let onSettled: ((snapshot: TerminalSnapshot, consumed: boolean) => void) | undefined;

  const notify = (id?: string) => {
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch {
        // UI listeners cannot corrupt process state.
      }
    }
    if (id) {
      for (const listener of Array.from(idListeners.get(id) ?? [])) {
        try {
          listener();
        } catch {
          // Same isolation for detail listeners.
        }
      }
    }
  };

  const runningCount = () => Array.from(entries.values()).filter((entry) => entry.snapshot.status === "running").length;

  const syncSpillInfo = (buffer: OutputBuffer, writer?: SpillWriter) => {
    if (!writer) {
      buffer.spillPath = undefined;
      buffer.spillBytes = 0;
      buffer.spillTruncated = buffer.totalBytes > 0;
      return;
    }
    const info = writer.info();
    buffer.spillPath = writer.path;
    buffer.spillBytes = info.bytes;
    buffer.spillTruncated = info.truncated;
  };

  const closeSpills = (entry: Entry) => {
    entry.stdoutSpill?.close();
    entry.stderrSpill?.close();
    syncSpillInfo(entry.stdout, entry.stdoutSpill);
    syncSpillInfo(entry.stderr, entry.stderrSpill);
  };

  const prune = () => {
    if (entries.size <= MAX_TRACKED) return;
    const settled = Array.from(entries.values())
      .filter((entry) => entry.snapshot.status !== "running" && !killInterest.has(entry.snapshot.id))
      .sort((a, b) => (a.snapshot.settledAt ?? 0) - (b.snapshot.settledAt ?? 0));
    for (const entry of settled) {
      if (entries.size <= MAX_TRACKED) break;
      entries.delete(entry.snapshot.id);
    }
  };

  const settle = (entry: Entry) => {
    if (entry.snapshot.status !== "running") return;
    if (entry.exitCleanup) clearTimeout(entry.exitCleanup);
    closeSpills(entry);
    const snapshot = entry.snapshot;
    snapshot.settledAt = Date.now();
    snapshot.status = entry.killRequested
      ? "killed"
      : entry.processErrored
        ? "failed"
        : snapshot.exitCode === 0
          ? "done"
          : "failed";
    entry.settleResolve(snapshot);
    notify(snapshot.id);
    if (!disposed) {
      try {
        onSettled?.(snapshot, (killInterest.get(snapshot.id) ?? 0) > 0);
      } catch {
        // Completion delivery is best effort; settlement itself remains final.
      }
    }
    prune();
  };

  const terminate = (entry: Entry, markKilled: boolean): Promise<void> => {
    if (entry.snapshot.status !== "running") return Promise.resolve();
    if (markKilled && !entry.exited) entry.killRequested = true;
    if (entry.termination) return entry.termination;
    entry.termination = (async () => {
      signalProcessTree(entry.child, "SIGTERM");
      await Promise.race([entry.settlePromise.then(() => undefined), delay(FORCE_KILL_AFTER_MS)]);
      if (entry.snapshot.status === "running") {
        signalProcessTree(entry.child, "SIGKILL");
        await Promise.race([entry.settlePromise.then(() => undefined), delay(FINAL_CLOSE_GRACE_MS)]);
      }
      if (entry.snapshot.status === "running") {
        entry.snapshot.errorText ??= "stdio did not close after process-tree termination; retained output may be incomplete";
        settle(entry);
      }
    })();
    return entry.termination;
  };

  const invocationFor = (command: string): ShellInvocation => {
    if (options.shell) {
      return {
        executable: options.shell.executable,
        args: [...options.shell.prefixArgs, command],
        description: options.shell.description,
      };
    }
    return selectShellInvocation(command, process.platform, options.env ?? process.env);
  };

  const start = (startOptions: StartOptions): Promise<TerminalSnapshot> => {
    if (disposed) return Promise.reject(new Error("Background terminal manager is shutting down."));
    if (runningCount() + reserved >= MAX_RUNNING) {
      return Promise.reject(
        new Error(`Max ${MAX_RUNNING} background terminals can run concurrently. Stop one with bg_kill before starting another.`),
      );
    }
    reserved++;
    try {
      const id = `bt-${++counter}`;
      const invocation = invocationFor(startOptions.command);
      const child = spawn(invocation.executable, invocation.args, {
        cwd: startOptions.cwd,
        env: options.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
      const retained = options.retainedPerStream ?? RETAINED_PER_STREAM;
      const stdout = new OutputBuffer(retained);
      const stderr = new OutputBuffer(retained);
      const stdoutSpill = spillSession?.createWriter(id, "stdout");
      const stderrSpill = spillSession?.createWriter(id, "stderr");
      stdout.spillPath = stdoutSpill?.path;
      stderr.spillPath = stderrSpill?.path;

      let settleResolve!: (snapshot: TerminalSnapshot) => void;
      const settlePromise = new Promise<TerminalSnapshot>((resolve) => {
        settleResolve = resolve;
      });
      const snapshot: MutableSnapshot = {
        id,
        command: startOptions.command,
        title: startOptions.title,
        cwd: startOptions.cwd,
        shell: invocation.description,
        pid: child.pid,
        status: "running",
        createdAt: Date.now(),
        get stdout() {
          return stdout.view();
        },
        get stderr() {
          return stderr.view();
        },
      };
      const entry: Entry = {
        snapshot,
        child,
        stdout,
        stderr,
        stdoutSpill,
        stderrSpill,
        exited: false,
        stdioClosed: false,
        processErrored: false,
        killRequested: false,
        settlePromise,
        settleResolve,
      };
      entries.set(id, entry);

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (raw: string) => {
        const chunk = redact(raw);
        stdout.push(chunk);
        stdoutSpill?.write(chunk);
        syncSpillInfo(stdout, stdoutSpill);
        notify(id);
      });
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (raw: string) => {
        const chunk = redact(raw);
        stderr.push(chunk);
        stderrSpill?.write(chunk);
        syncSpillInfo(stderr, stderrSpill);
        notify(id);
      });
      child.once("error", (error) => {
        entry.processErrored = true;
        entry.exited = true;
        snapshot.errorText ??= boundedError(error);
      });
      child.once("exit", (code, signal) => {
        entry.exited = true;
        if (!entry.processErrored) {
          snapshot.exitCode = code ?? undefined;
          snapshot.signal = signal ?? undefined;
        }
        entry.exitCleanup = setTimeout(() => {
          if (snapshot.status === "running" && !entry.stdioClosed) void terminate(entry, false);
        }, EXIT_PIPE_GRACE_MS);
      });
      child.once("close", (code, signal) => {
        entry.exited = true;
        entry.stdioClosed = true;
        if (!entry.processErrored) {
          snapshot.exitCode ??= code ?? undefined;
          snapshot.signal ??= signal ?? undefined;
        }
        settle(entry);
      });

      if (disposed) {
        void terminate(entry, true);
        return Promise.reject(new Error("Background terminal manager shut down while starting."));
      }
      notify(id);
      return Promise.resolve(snapshot);
    } catch (error) {
      return Promise.reject(new Error(`Unable to start background terminal: ${boundedError(error)}`));
    } finally {
      reserved--;
    }
  };

  const addInterest = (ids: ReadonlyArray<string>) => {
    for (const id of ids) killInterest.set(id, (killInterest.get(id) ?? 0) + 1);
  };
  const releaseInterest = (ids: ReadonlyArray<string>) => {
    for (const id of ids) {
      const count = (killInterest.get(id) ?? 1) - 1;
      if (count <= 0) killInterest.delete(id);
      else killInterest.set(id, count);
    }
    prune();
  };

  const kill = async (ids: ReadonlyArray<string>, signal?: AbortSignal): Promise<ReadonlyArray<KillResult>> => {
    const unique = Array.from(new Set(ids));
    const selected = unique.map((id) => {
      const entry = entries.get(id);
      if (!entry) throw new Error(`Unknown terminal id "${id}".`);
      return entry;
    });
    const running = selected.filter((entry) => entry.snapshot.status === "running");
    const runningIds = running.map((entry) => entry.snapshot.id);
    addInterest(runningIds);
    try {
      const work = Promise.all(running.map((entry) => terminate(entry, true)));
      await withAbort(work, signal);
      return selected.map((entry): KillResult => {
        const snapshot = entry.snapshot;
        const wasRunning = runningIds.includes(snapshot.id);
        return {
          id: snapshot.id,
          title: snapshot.title,
          status: snapshot.status,
          wasRunning,
          killed: wasRunning && snapshot.status === "killed",
          exit: formatExit(snapshot),
        };
      });
    } finally {
      releaseInterest(runningIds);
    }
  };

  const exitSafety = () => {
    for (const entry of entries.values()) {
      if (entry.snapshot.status === "running") signalProcessTree(entry.child, "SIGTERM");
    }
  };
  process.once("exit", exitSafety);

  const manager: TerminalManager = {
    start,
    get: (id) => entries.get(id)?.snapshot,
    list: () => Array.from(entries.values()).map((entry) => entry.snapshot),
    waitForSettlement: (id) => {
      const entry = entries.get(id);
      return entry ? entry.settlePromise : Promise.reject(new Error(`Unknown terminal id "${id}".`));
    },
    kill,
    requestKill: (id) => {
      const entry = entries.get(id);
      if (entry) void terminate(entry, true);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeTo: (id, listener) => {
      let set = idListeners.get(id);
      if (!set) {
        set = new Set();
        idListeners.set(id, set);
      }
      set.add(listener);
      return () => {
        set?.delete(listener);
        if (set?.size === 0) idListeners.delete(id);
      };
    },
    setOnSettled: (hook) => {
      onSettled = hook;
    },
    dispose: () => {
      if (disposePromise) return disposePromise;
      disposed = true;
      onSettled = undefined;
      process.removeListener("exit", exitSafety);
      disposePromise = (async () => {
        await Promise.all(
          Array.from(entries.values())
            .filter((entry) => entry.snapshot.status === "running")
            .map((entry) => terminate(entry, true)),
        );
        for (const entry of entries.values()) closeSpills(entry);
        entries.clear();
        listeners.clear();
        idListeners.clear();
        spillSession?.dispose();
        spillSession = undefined;
      })();
      return disposePromise;
    },
  };

  return manager;
}
