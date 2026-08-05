import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import * as path from "node:path";
import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  bindChildSessionExtensions,
  childToolPolicy,
  createChildModelRuntime,
  createChildResources,
  shutdownAndDisposeChildSession,
} from "../shared/child-session.ts";
import { MAX_A2A_CONTEXTS } from "./config.ts";
import type { A2AExecutionInput, A2AExecutionResult } from "./server.ts";

const REGISTRY_VERSION = 1;
const DEFAULT_MAX_CONTEXTS = 256;
const REGISTRY_LOCK_ATTEMPTS = 15_000;
const REGISTRY_LOCK_RETRY_MS = 20;
const SAFE_CONTEXT_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const INPUT_REQUIRED_MARKER = "[INPUT_REQUIRED]";

const A2A_CHILD_SYSTEM_PROMPT = `You are a controlled Pi coding session receiving authenticated requests from a remote A2A peer.
Treat each request as user input for this persistent session, but do not invoke subagents, workflows, background-agent orchestration, or A2A tools.
Work only within the configured working directory unless the request explicitly asks for a read-only inspection elsewhere.
If essential clarification is genuinely required, reply with ${INPUT_REQUIRED_MARKER} followed by one concise question. Otherwise complete the requested work and report the result directly.`;

interface RegistryEntry {
  cwd: string;
  sessionFile: string;
}

interface ContextRegistry {
  version: 1;
  contexts: Record<string, RegistryEntry>;
}

export interface PiSessionFactoryInput {
  contextId: string;
  cwd: string;
  agentDir: string;
  sessionsDir: string;
  sessionFile?: string;
}

export interface HostedPiSession {
  readonly sessionFile: string | undefined;
  readonly messages: readonly unknown[];
  prompt(message: string): Promise<void>;
  abort(): Promise<void>;
  close(): Promise<void>;
}

export type PiSessionFactory = (
  input: PiSessionFactoryInput,
) => Promise<HostedPiSession>;

export interface PiSessionHostOptions {
  cwd: string;
  agentDir: string;
  registryPath?: string;
  sessionsDir?: string;
  maxContexts?: number;
  sessionFactory?: PiSessionFactory;
  onRegistryLockWait?: () => void;
  onContextLockWait?: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new Error("A2A execution aborted");
}

function assistantResult(messages: readonly unknown[]): A2AExecutionResult {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== "assistant") continue;
    const content = Array.isArray(message.content) ? message.content : [];
    const text = content
      .filter((part): part is Record<string, unknown> => isRecord(part))
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("\n")
      .trim();
    const stopReason = message.stopReason;
    if (stopReason === "error" || stopReason === "aborted") {
      const errorMessage = typeof message.errorMessage === "string"
        ? message.errorMessage.trim()
        : "Pi execution failed";
      return {
        state: "TASK_STATE_FAILED",
        text: text || errorMessage,
      };
    }
    if (!text) continue;
    if (text.startsWith(INPUT_REQUIRED_MARKER)) {
      return {
        state: "TASK_STATE_INPUT_REQUIRED",
        text: text.slice(INPUT_REQUIRED_MARKER.length).trim() ||
          "Pi requires additional input",
      };
    }
    return { state: "TASK_STATE_COMPLETED", text };
  }
  throw new Error("Pi session produced no assistant text");
}

function parseRegistry(raw: string): ContextRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("A2A context registry is not valid JSON", { cause: error });
  }
  if (
    !isRecord(parsed) || parsed.version !== REGISTRY_VERSION ||
    !isRecord(parsed.contexts)
  ) {
    throw new Error("A2A context registry has an invalid shape");
  }
  const contexts: Record<string, RegistryEntry> = Object.create(null);
  for (const [contextId, value] of Object.entries(parsed.contexts)) {
    if (!SAFE_CONTEXT_ID.test(contextId) || !isRecord(value)) {
      throw new Error("A2A context registry contains an invalid context entry");
    }
    if (
      typeof value.cwd !== "string" ||
      !path.isAbsolute(value.cwd) ||
      path.resolve(value.cwd) !== value.cwd ||
      typeof value.sessionFile !== "string" ||
      !path.isAbsolute(value.sessionFile)
    ) {
      throw new Error("A2A context registry contains an invalid session mapping");
    }
    contexts[contextId] = {
      cwd: value.cwd,
      sessionFile: value.sessionFile,
    };
  }
  return { version: REGISTRY_VERSION, contexts };
}

function canonicalPiSessionDirectory(cwd: string, agentDir: string): string {
  const safeCwd = `--${path.resolve(cwd)
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]/g, "-")}--`;
  return path.join(path.resolve(agentDir), "sessions", safeCwd);
}

async function ensurePrivateStorageRoot(root: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const parsed = path.parse(resolvedRoot);
  let current = parsed.root;
  for (const segment of resolvedRoot.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (!isRecord(error) || error.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
      metadata = await lstat(current);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("A2A agent directory path must not contain symbolic links");
    }
  }
  await chmod(resolvedRoot, 0o700);
}

async function ensurePrivateDirectory(root: string, directory: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedDirectory = path.resolve(directory);
  const relative = path.relative(resolvedRoot, resolvedDirectory);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("A2A storage directory escapes the Pi agent directory");
  }

  await ensurePrivateStorageRoot(resolvedRoot);
  let current = resolvedRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (!isRecord(error) || error.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
      metadata = await lstat(current);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("A2A storage directories must not contain symbolic links");
    }
    await chmod(current, 0o700);
  }
}

async function writeRegistryAtomic(
  agentDir: string,
  registryPath: string,
  registry: ContextRegistry,
): Promise<void> {
  const directory = path.dirname(registryPath);
  await ensurePrivateDirectory(agentDir, directory);
  const temporary = `${registryPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, registryPath);
    await chmod(registryPath, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

type RegistryLockRelease = () => Promise<void>;

async function acquirePrivateDirectoryLock(
  agentDir: string,
  lockPath: string,
  lockDescription: string,
  staleLockMessage: string,
  signal?: AbortSignal,
  onWait?: () => void,
): Promise<RegistryLockRelease> {
  await ensurePrivateDirectory(agentDir, path.dirname(lockPath));
  let lockIdentity: { dev: bigint; ino: bigint } | undefined;
  let reportedWait = false;
  for (
    let attempt = 0;
    signal !== undefined || attempt < REGISTRY_LOCK_ATTEMPTS;
    attempt++
  ) {
    if (signal?.aborted) throw abortError(signal);
    try {
      await mkdir(lockPath, { mode: 0o700 });
      const metadata = await lstat(lockPath, { bigint: true });
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error(`${lockDescription} must be a private directory`);
      }
      lockIdentity = { dev: metadata.dev, ino: metadata.ino };
      break;
    } catch (error) {
      if (!isRecord(error) || error.code !== "EEXIST") throw error;
      const metadata = await lstat(lockPath).catch((metadataError) => {
        if (isRecord(metadataError) && metadataError.code === "ENOENT") return undefined;
        throw metadataError;
      });
      if (metadata && (!metadata.isDirectory() || metadata.isSymbolicLink())) {
        throw new Error(`${lockDescription} must be a private directory`);
      }
      if (!reportedWait) {
        reportedWait = true;
        onWait?.();
      }
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(abortError(signal!));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, REGISTRY_LOCK_RETRY_MS);
        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }
  }
  if (!lockIdentity) {
    throw new Error(staleLockMessage);
  }

  let releasePromise: Promise<void> | undefined;
  const release = () => {
    releasePromise ??= (async () => {
      const metadata = await lstat(lockPath, { bigint: true }).catch((error) => {
        throw new Error(`${lockDescription} disappeared unexpectedly`, { cause: error });
      });
      if (
        !metadata.isDirectory()
        || metadata.isSymbolicLink()
        || metadata.dev !== lockIdentity.dev
        || metadata.ino !== lockIdentity.ino
      ) {
        throw new Error(`${lockDescription} changed unexpectedly`);
      }
      await rmdir(lockPath);
    })();
    return releasePromise;
  };
  if (signal?.aborted) {
    await release();
    throw abortError(signal);
  }
  return release;
}

function acquireRegistryLock(
  agentDir: string,
  registryPath: string,
  signal?: AbortSignal,
  onWait?: () => void,
): Promise<RegistryLockRelease> {
  return acquirePrivateDirectoryLock(
    agentDir,
    `${registryPath}.lock`,
    "A2A context registry lock",
    "A2A context registry is locked; if no Pi A2A host is running, remove the stale contexts.json.lock directory",
    signal,
    onWait,
  );
}

function acquireContextTurnLock(
  agentDir: string,
  registryPath: string,
  contextId: string,
  signal: AbortSignal,
  onWait?: () => void,
): Promise<RegistryLockRelease> {
  const contextHash = createHash("sha256").update(contextId).digest("hex");
  return acquirePrivateDirectoryLock(
    agentDir,
    `${registryPath}.${contextHash}.turn.lock`,
    "A2A context turn lock",
    "A2A context turn is locked",
    signal,
    onWait,
  );
}

async function withRegistryLock<T>(
  agentDir: string,
  registryPath: string,
  run: () => Promise<T>,
): Promise<T> {
  const release = await acquireRegistryLock(agentDir, registryPath);
  try {
    return await run();
  } finally {
    await release();
  }
}

async function validateSessionFile(
  agentDir: string,
  sessionsDir: string,
  sessionFile: string,
): Promise<string> {
  if (!path.isAbsolute(sessionFile)) {
    throw new Error("Pi session path must be absolute");
  }
  await ensurePrivateDirectory(agentDir, sessionsDir);
  const candidateMetadata = await lstat(sessionFile).catch((error) => {
    throw new Error("Mapped Pi session file is missing or inaccessible", {
      cause: error,
    });
  });
  if (!candidateMetadata.isFile()) {
    throw new Error("Mapped Pi session path must be a regular non-symlink file");
  }
  const [realSessionsDir, realSessionFile] = await Promise.all([
    realpath(sessionsDir),
    realpath(sessionFile),
  ]).catch((error) => {
    throw new Error("Mapped Pi session file is missing or inaccessible", {
      cause: error,
    });
  });
  const relative = path.relative(realSessionsDir, realSessionFile);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Mapped Pi session file escapes the canonical Pi session directory");
  }
  const metadata = await lstat(realSessionFile);
  if (!metadata.isFile()) throw new Error("Mapped Pi session path is not a file");
  return realSessionFile;
}

function validateSessionPathCandidate(
  sessionsDir: string,
  sessionFile: string,
): string {
  if (!path.isAbsolute(sessionFile)) {
    throw new Error("Pi session path must be absolute");
  }
  const root = path.resolve(sessionsDir);
  const candidate = path.resolve(sessionFile);
  const relative = path.relative(root, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Pi session path escapes the A2A session directory");
  }
  return candidate;
}

export async function createSdkPiSession(
  input: PiSessionFactoryInput,
): Promise<HostedPiSession> {
  const { loader, settingsManager } = await createChildResources({
    cwd: input.cwd,
    agentDir: input.agentDir,
    projectTrusted: false,
    noExtensions: true,
    appendSystemPrompt: [A2A_CHILD_SYSTEM_PROMPT],
  });
  const modelRuntime = await createChildModelRuntime(input.agentDir);
  const sessionManager = input.sessionFile
    ? SessionManager.open(input.sessionFile)
    : SessionManager.create(input.cwd);
  const { session } = await createAgentSession({
    cwd: input.cwd,
    agentDir: input.agentDir,
    resourceLoader: loader,
    settingsManager,
    modelRuntime,
    sessionManager,
    ...childToolPolicy(),
  });
  await bindChildSessionExtensions(session);
  if (!input.sessionFile) session.setSessionName(`A2A ${input.contextId}`);

  return {
    get sessionFile() {
      return session.sessionFile;
    },
    get messages() {
      return session.messages;
    },
    prompt(message) {
      return session.prompt(message, { expandPromptTemplates: false });
    },
    abort() {
      return session.abort();
    },
    close() {
      return shutdownAndDisposeChildSession(session);
    },
  };
}

export class PiSessionHost {
  readonly #cwd: string;
  readonly #agentDir: string;
  readonly #registryPath: string;
  readonly #sessionsDir: string;
  readonly #maxContexts: number;
  readonly #sessionFactory: PiSessionFactory;
  readonly #onRegistryLockWait: (() => void) | undefined;
  readonly #onContextLockWait: (() => void) | undefined;
  readonly #sessions = new Map<string, HostedPiSession>();
  readonly #mappedSessionFiles = new Map<string, string>();
  readonly #initializationLocks = new Map<string, RegistryLockRelease>();
  readonly #closeController = new AbortController();
  #active = false;
  #activeSession: HostedPiSession | undefined;
  #activeDone: Promise<void> | undefined;
  #closed = false;
  #closePromise: Promise<void> | undefined;

  constructor(options: PiSessionHostOptions) {
    this.#cwd = path.resolve(options.cwd);
    this.#agentDir = path.resolve(options.agentDir);
    this.#registryPath = path.resolve(
      options.registryPath ?? path.join(this.#agentDir, "a2a", "contexts.json"),
    );
    this.#sessionsDir = path.resolve(
      options.sessionsDir ?? canonicalPiSessionDirectory(this.#cwd, this.#agentDir),
    );
    this.#maxContexts = options.maxContexts ?? DEFAULT_MAX_CONTEXTS;
    if (
      !Number.isSafeInteger(this.#maxContexts)
      || this.#maxContexts <= 0
      || this.#maxContexts > MAX_A2A_CONTEXTS
    ) {
      throw new Error(
        `maxContexts must be a positive integer no greater than ${MAX_A2A_CONTEXTS}`,
      );
    }
    this.#sessionFactory = options.sessionFactory ?? createSdkPiSession;
    this.#onRegistryLockWait = options.onRegistryLockWait;
    this.#onContextLockWait = options.onContextLockWait;
  }

  async execute(input: A2AExecutionInput): Promise<A2AExecutionResult> {
    if (this.#closed) throw new Error("Pi session host is closed");
    if (!SAFE_CONTEXT_ID.test(input.contextId)) {
      throw new Error("A2A context id is invalid");
    }
    if (this.#active) throw new Error("Pi session host is busy");
    if (input.signal.aborted) throw abortError(input.signal);
    this.#active = true;
    let resolveActive!: () => void;
    const activeDone = new Promise<void>((resolve) => { resolveActive = resolve; });
    this.#activeDone = activeDone;

    let session: HostedPiSession | undefined;
    let onAbort: (() => void) | undefined;
    let abortPromise: Promise<void> | undefined;
    let releaseTurn: RegistryLockRelease | undefined;
    try {
      const setupSignal = AbortSignal.any([input.signal, this.#closeController.signal]);
      releaseTurn = await acquireContextTurnLock(
        this.#agentDir,
        this.#registryPath,
        input.contextId,
        setupSignal,
        this.#onContextLockWait,
      );
      session = await this.#sessionFor(input.contextId, setupSignal);
      this.#activeSession = session;
      if (this.#closed) {
        await this.#rememberContextIfPersisted(input.contextId, session);
        throw new Error("Pi session host is closed");
      }
      const messageStart = session.messages.length;
      onAbort = () => {
        if (!abortPromise) abortPromise = session!.abort();
      };
      input.signal.addEventListener("abort", onAbort, { once: true });
      if (input.signal.aborted) {
        onAbort();
        await abortPromise!.catch(() => {});
        await this.#rememberContextIfPersisted(input.contextId, session);
        throw abortError(input.signal);
      }

      try {
        await session.prompt(input.message);
      } catch (error) {
        if (abortPromise) await abortPromise.catch(() => {});
        await this.#rememberContextIfPersisted(input.contextId, session);
        if (this.#closed) {
          throw new Error("Pi session host is closed");
        }
        if (input.signal.aborted) {
          throw abortError(input.signal);
        }
        throw error;
      }
      if (abortPromise) await abortPromise.catch(() => {});
      if (input.signal.aborted) {
        await this.#rememberContextIfPersisted(input.contextId, session);
        throw abortError(input.signal);
      }
      if (this.#closed) {
        await this.#rememberContextIfPersisted(input.contextId, session);
        throw new Error("Pi session host is closed");
      }
      await this.#rememberContext(input.contextId, session);
      const result = assistantResult(session.messages.slice(messageStart));
      return result;
    } finally {
      try {
        await this.#releaseInitializationLock(input.contextId, true);
      } finally {
        try {
          if (session && onAbort) {
            input.signal.removeEventListener("abort", onAbort);
          }
          if (releaseTurn) await releaseTurn();
        } finally {
          this.#activeSession = undefined;
          this.#active = false;
          resolveActive();
          if (this.#activeDone === activeDone) this.#activeDone = undefined;
        }
      }
    }
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#closeController.abort(new Error("Pi session host is closed"));
    this.#closePromise = (async () => {
      await this.#activeSession?.abort().catch(() => {});
      await this.#activeDone;
      await Promise.allSettled(
        [...new Set(this.#sessions.values())].map((session) => session.close()),
      );
      this.#sessions.clear();
      this.#mappedSessionFiles.clear();
    })();
    return this.#closePromise;
  }

  async #loadRegistry(): Promise<ContextRegistry> {
    const registryDirectory = path.dirname(this.#registryPath);
    await ensurePrivateDirectory(this.#agentDir, registryDirectory);
    let metadata;
    try {
      metadata = await lstat(this.#registryPath);
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") {
        return { version: REGISTRY_VERSION, contexts: Object.create(null) };
      }
      throw new Error("Unable to read A2A context registry", { cause: error });
    }
    if (!metadata.isFile()) {
      throw new Error("A2A context registry must be a regular non-symlink file");
    }
    await chmod(this.#registryPath, 0o600);
    const raw = await readFile(this.#registryPath, "utf8").catch((error) => {
      throw new Error("Unable to read A2A context registry", { cause: error });
    });
    const registry = parseRegistry(raw);
    const workspaceContextCount = Object.values(registry.contexts)
      .filter((entry) => entry.cwd === this.#cwd).length;
    if (workspaceContextCount > this.#maxContexts) {
      throw new Error("A2A context registry exceeds the configured limit");
    }
    return registry;
  }

  async #sessionFor(contextId: string, signal: AbortSignal): Promise<HostedPiSession> {
    if (signal.aborted) throw abortError(signal);
    const cached = this.#sessions.get(contextId);
    if (cached) return cached;

    const initialRegistry = await this.#loadRegistry();
    let mapped = initialRegistry.contexts[contextId];
    if (mapped && mapped.cwd !== this.#cwd) {
      throw new Error("A2A context belongs to a different workspace");
    }
    let release: RegistryLockRelease | undefined;
    let holdsInitializationLock = false;
    try {
      if (!mapped) {
        release = await acquireRegistryLock(
          this.#agentDir,
          this.#registryPath,
          signal,
          this.#onRegistryLockWait,
        );
        const registry = await this.#loadRegistry();
        mapped = registry.contexts[contextId];
        if (mapped && mapped.cwd !== this.#cwd) {
          throw new Error("A2A context belongs to a different workspace");
        }
        const knownContexts = new Set([
          ...Object.entries(registry.contexts)
            .filter(([, entry]) => entry.cwd === this.#cwd)
            .map(([id]) => id),
          ...this.#sessions.keys(),
        ]);
        if (!mapped && knownContexts.size >= this.#maxContexts) {
          throw new Error("A2A context capacity reached");
        }
      }
      if (release && mapped) {
        await release();
        release = undefined;
      } else if (release) {
        this.#initializationLocks.set(contextId, release);
        holdsInitializationLock = true;
      }
      if (signal.aborted) throw abortError(signal);
      await ensurePrivateDirectory(this.#agentDir, this.#sessionsDir);
      const sessionFile = mapped
        ? await validateSessionFile(
            this.#agentDir,
            this.#sessionsDir,
            mapped.sessionFile,
          )
        : undefined;
      if (sessionFile) await chmod(sessionFile, 0o600);
      if (signal.aborted) throw abortError(signal);
      const session = await this.#sessionFactory({
        contextId,
        cwd: this.#cwd,
        agentDir: this.#agentDir,
        sessionsDir: this.#sessionsDir,
        ...(sessionFile ? { sessionFile } : {}),
      });

      try {
        const candidateFile = validateSessionPathCandidate(
          this.#sessionsDir,
          session.sessionFile ?? "",
        );
        if (mapped && candidateFile !== sessionFile) {
          throw new Error("Reopened Pi session path does not match its registry mapping");
        }
        this.#sessions.set(contextId, session);
        if (mapped) this.#mappedSessionFiles.set(contextId, sessionFile!);
        return session;
      } catch (error) {
        await session.close().catch(() => {});
        throw error;
      }
    } catch (error) {
      if (holdsInitializationLock) {
        await this.#releaseInitializationLock(contextId, true);
      } else if (release) {
        await release();
      }
      throw error;
    }
  }

  async #rememberContext(
    contextId: string,
    session: HostedPiSession,
  ): Promise<void> {
    const canonicalFile = await validateSessionFile(
      this.#agentDir,
      this.#sessionsDir,
      session.sessionFile ?? "",
    );
    await chmod(canonicalFile, 0o600);
    const mappedFile = this.#mappedSessionFiles.get(contextId);
    if (mappedFile) {
      if (mappedFile !== canonicalFile) {
        throw new Error("A2A context is already mapped to a different Pi session");
      }
      return;
    }
    await this.#withContextRegistryLock(contextId, async () => {
      const registry = await this.#loadRegistry();
      const existing = registry.contexts[contextId];
      if (existing) {
        if (existing.cwd !== this.#cwd) {
          throw new Error("A2A context belongs to a different workspace");
        }
        if (existing.sessionFile !== canonicalFile) {
          throw new Error("A2A context is already mapped to a different Pi session");
        }
        return;
      }
      const workspaceContextCount = Object.values(registry.contexts)
        .filter((entry) => entry.cwd === this.#cwd).length;
      if (workspaceContextCount >= this.#maxContexts) {
        throw new Error("A2A context capacity reached");
      }
      registry.contexts[contextId] = {
        cwd: this.#cwd,
        sessionFile: canonicalFile,
      };
      await writeRegistryAtomic(this.#agentDir, this.#registryPath, registry);
    });
    this.#mappedSessionFiles.set(contextId, canonicalFile);
  }

  async #withContextRegistryLock<T>(
    contextId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const held = this.#initializationLocks.get(contextId);
    if (!held) {
      return withRegistryLock(this.#agentDir, this.#registryPath, run);
    }
    let mapped = false;
    try {
      const result = await run();
      mapped = true;
      return result;
    } finally {
      await this.#releaseInitializationLock(contextId, !mapped);
    }
  }

  async #releaseInitializationLock(
    contextId: string,
    discardCachedSession = false,
  ): Promise<void> {
    const release = this.#initializationLocks.get(contextId);
    if (!release) return;
    this.#initializationLocks.delete(contextId);
    if (discardCachedSession) {
      const session = this.#sessions.get(contextId);
      if (session) {
        this.#sessions.delete(contextId);
        await session.close().catch(() => {});
      }
    }
    await release();
  }

  async #rememberContextIfPersisted(
    contextId: string,
    session: HostedPiSession,
  ): Promise<void> {
    if (!session.sessionFile) return;
    const candidate = validateSessionPathCandidate(
      this.#sessionsDir,
      session.sessionFile,
    );
    let metadata;
    try {
      metadata = await lstat(candidate);
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") return;
      throw error;
    }
    if (!metadata.isFile()) {
      throw new Error("Pi session path must be a regular non-symlink file");
    }
    await this.#rememberContext(contextId, session);
  }
}
