import assert from "node:assert/strict";
import { chmod, readFile, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  PiSessionHost,
  type HostedPiSession,
  type PiSessionFactory,
  type PiSessionFactoryInput,
} from "./pi-session-host.ts";
import type { A2AExecutionInput } from "./server.ts";

async function withFixture(
  run: (fixture: {
    root: string;
    cwd: string;
    agentDir: string;
    registryPath: string;
    sessionsDir: string;
  }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-a2a-session-host-"));
  const fixture = {
    root,
    cwd: path.join(root, "workspace"),
    agentDir: path.join(root, "agent"),
    registryPath: path.join(root, "agent", "a2a", "contexts.json"),
    sessionsDir: path.join(root, "agent", "a2a", "sessions"),
  };
  await mkdir(fixture.cwd, { recursive: true });
  try {
    await run(fixture);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function executionInput(
  contextId: string,
  message: string,
  signal = new AbortController().signal,
): A2AExecutionInput {
  return {
    taskId: `task-${contextId}`,
    contextId,
    messageId: `message-${contextId}`,
    message,
    signal,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

interface FakeSession extends HostedPiSession {
  prompts: string[];
  abortCalls: number;
  closeCalls: number;
}

function fakeFactory(
  reply: (message: string) => string = (message) => `PI_REPLY:${message}`,
) {
  const inputs: PiSessionFactoryInput[] = [];
  const sessions: FakeSession[] = [];
  const factory: PiSessionFactory = async (input) => {
    inputs.push(input);
    const sessionFile = input.sessionFile ?? path.join(
      input.sessionsDir,
      `session-${inputs.length}.jsonl`,
    );
    await mkdir(path.dirname(sessionFile), { recursive: true });
    if (!input.sessionFile) {
      await writeFile(sessionFile, '{"type":"session"}\n', { mode: 0o600 });
    }
    const messages: unknown[] = [];
    const session: FakeSession = {
      sessionFile,
      messages,
      prompts: [],
      abortCalls: 0,
      closeCalls: 0,
      async prompt(message) {
        this.prompts.push(message);
        messages.push({ role: "user", content: message });
        messages.push({
          role: "assistant",
          content: [{ type: "text", text: reply(message) }],
          stopReason: "stop",
        });
      },
      async abort() {
        this.abortCalls++;
      },
      async close() {
        this.closeCalls++;
      },
    };
    sessions.push(session);
    return session;
  };
  return { factory, inputs, sessions };
}

test("default storage uses Pi's canonical cwd session directory", async () => {
  await withFixture(async (fixture) => {
    const fake = fakeFactory();
    const host = new PiSessionHost({
      cwd: fixture.cwd,
      agentDir: fixture.agentDir,
      registryPath: fixture.registryPath,
      sessionFactory: fake.factory,
    });
    await host.execute(executionInput("ctx-canonical", "hello"));

    const safeCwd = `--${path.resolve(fixture.cwd)
      .replace(/^[/\\]/, "")
      .replace(/[/\\:]/g, "-")}--`;
    assert.equal(
      fake.inputs[0].sessionsDir,
      path.join(fixture.agentDir, "sessions", safeCwd),
    );
    await host.close();
  });
});

test("a lazily persisted SDK session is mapped after its first assistant response", async () => {
  await withFixture(async (fixture) => {
    let sessionFile = "";
    const factory: PiSessionFactory = async (input) => {
      sessionFile = path.join(input.sessionsDir, "lazy.jsonl");
      const messages: unknown[] = [];
      return {
        sessionFile,
        messages,
        async prompt() {
          await mkdir(input.sessionsDir, { recursive: true });
          messages.push({
            role: "assistant",
            content: [{ type: "text", text: "lazy-ok" }],
            stopReason: "stop",
          });
          await writeFile(sessionFile, '{"type":"session"}\n', { mode: 0o600 });
        },
        async abort() {},
        async close() {},
      };
    };
    const host = new PiSessionHost({ ...fixture, sessionFactory: factory });

    assert.deepEqual(
      await host.execute(executionInput("ctx-lazy", "hello")),
      { state: "TASK_STATE_COMPLETED", text: "lazy-ok" },
    );
    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8"));
    assert.equal(registry.contexts["ctx-lazy"].sessionFile, sessionFile);
    await host.close();
  });
});

test("session storage is owner-only even when the SDK uses permissive modes", async () => {
  await withFixture(async (fixture) => {
    const sessionFile = path.join(fixture.sessionsDir, "permissive.jsonl");
    const factory: PiSessionFactory = async () => {
      await writeFile(sessionFile, '{"type":"session"}\n', { mode: 0o644 });
      const messages: unknown[] = [];
      return {
        sessionFile,
        messages,
        async prompt() {
          messages.push({
            role: "assistant",
            content: [{ type: "text", text: "secure" }],
            stopReason: "stop",
          });
        },
        async abort() {},
        async close() {},
      };
    };
    const host = new PiSessionHost({ ...fixture, sessionFactory: factory });

    await host.execute(executionInput("ctx-modes", "hello"));
    assert.equal((await stat(fixture.sessionsDir)).mode & 0o777, 0o700);
    assert.equal((await stat(sessionFile)).mode & 0o777, 0o600);
    await host.close();
  });
});

test("one A2A context reuses one persisted Pi session", async () => {
  await withFixture(async (fixture) => {
    const fake = fakeFactory();
    const host = new PiSessionHost({ ...fixture, sessionFactory: fake.factory });

    assert.deepEqual(
      await host.execute(executionInput("ctx-reuse", "first")),
      { state: "TASK_STATE_COMPLETED", text: "PI_REPLY:first" },
    );
    assert.deepEqual(
      await host.execute(executionInput("ctx-reuse", "second")),
      { state: "TASK_STATE_COMPLETED", text: "PI_REPLY:second" },
    );

    assert.equal(fake.inputs.length, 1);
    assert.deepEqual(fake.sessions[0].prompts, ["first", "second"]);
    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8"));
    assert.equal(
      registry.contexts["ctx-reuse"].sessionFile,
      fake.sessions[0].sessionFile,
    );
    assert.equal((await stat(fixture.registryPath)).mode & 0o777, 0o600);
    await host.close();
    assert.equal(fake.sessions[0].closeCalls, 1);
  });
});

test("different A2A contexts create different Pi session files", async () => {
  await withFixture(async (fixture) => {
    const fake = fakeFactory();
    const host = new PiSessionHost({ ...fixture, sessionFactory: fake.factory });

    await host.execute(executionInput("ctx-one", "one"));
    await host.execute(executionInput("ctx-two", "two"));

    assert.equal(fake.inputs.length, 2);
    assert.notEqual(fake.sessions[0].sessionFile, fake.sessions[1].sessionFile);
    await host.close();
  });
});

test("one registry preserves contexts from multiple canonical workspaces", async () => {
  await withFixture(async (fixture) => {
    const first = fakeFactory();
    const firstHost = new PiSessionHost({ ...fixture, sessionFactory: first.factory });
    await firstHost.execute(executionInput("ctx-workspace-one", "one"));
    await firstHost.close();

    const secondCwd = path.join(fixture.root, "workspace-two");
    const secondSessionsDir = path.join(fixture.agentDir, "a2a", "sessions-two");
    await mkdir(secondCwd);
    const second = fakeFactory();
    const secondHost = new PiSessionHost({
      cwd: secondCwd,
      agentDir: fixture.agentDir,
      registryPath: fixture.registryPath,
      sessionsDir: secondSessionsDir,
      sessionFactory: second.factory,
    });
    await secondHost.execute(executionInput("ctx-workspace-two", "two"));

    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8"));
    assert.equal(registry.contexts["ctx-workspace-one"].cwd, fixture.cwd);
    assert.equal(registry.contexts["ctx-workspace-two"].cwd, secondCwd);
    await secondHost.close();
  });
});

test("concurrent workspace hosts do not lose each other's registry mappings", async () => {
  await withFixture(async (fixture) => {
    const firstEntered = deferred();
    const firstRelease = deferred();
    const secondEntered = deferred();
    const secondRelease = deferred();
    const first = fakeFactory();
    const second = fakeFactory();
    const firstHost = new PiSessionHost({
      ...fixture,
      sessionFactory: async (input) => {
        firstEntered.resolve();
        await firstRelease.promise;
        return first.factory(input);
      },
    });
    const secondCwd = path.join(fixture.root, "workspace-two");
    await mkdir(secondCwd);
    const secondHost = new PiSessionHost({
      ...fixture,
      cwd: secondCwd,
      sessionsDir: path.join(fixture.agentDir, "a2a", "sessions-two"),
      sessionFactory: async (input) => {
        secondEntered.resolve();
        await secondRelease.promise;
        return second.factory(input);
      },
    });

    const firstRun = firstHost.execute(executionInput("ctx-concurrent-one", "one"));
    await firstEntered.promise;
    const secondRun = secondHost.execute(executionInput("ctx-concurrent-two", "two"));
    const secondFactoryState = await Promise.race([
      secondEntered.promise.then(() => "entered" as const),
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 25)),
    ]);
    assert.equal(secondFactoryState, "blocked");
    firstRelease.resolve();
    await firstRun;
    await secondEntered.promise;
    secondRelease.resolve();
    await secondRun;

    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8"));
    assert.equal(registry.contexts["ctx-concurrent-one"].cwd, fixture.cwd);
    assert.equal(registry.contexts["ctx-concurrent-two"].cwd, secondCwd);
    await Promise.all([firstHost.close(), secondHost.close()]);
  });
});

test("concurrent creation of one context reopens the first canonical session", async () => {
  await withFixture(async (fixture) => {
    const firstEntered = deferred();
    const firstRelease = deferred();
    const first = fakeFactory();
    const second = fakeFactory();
    const firstHost = new PiSessionHost({
      ...fixture,
      sessionFactory: async (input) => {
        firstEntered.resolve();
        await firstRelease.promise;
        return first.factory(input);
      },
    });
    const secondHost = new PiSessionHost({ ...fixture, sessionFactory: second.factory });

    const firstRun = firstHost.execute(executionInput("ctx-concurrent-shared", "one"));
    await firstEntered.promise;
    const secondRun = secondHost.execute(executionInput("ctx-concurrent-shared", "two"));
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(second.inputs.length, 0);
    firstRelease.resolve();
    await Promise.all([firstRun, secondRun]);

    assert.equal(second.inputs.length, 1);
    assert.equal(second.inputs[0].sessionFile, first.sessions[0].sessionFile);
    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8"));
    assert.deepEqual(Object.keys(registry.contexts), ["ctx-concurrent-shared"]);
    await Promise.all([firstHost.close(), secondHost.close()]);
  });
});

test("failed unmaterialized initialization evicts its cached session before retry", async () => {
  await withFixture(async (fixture) => {
    let factoryCalls = 0;
    let closeCalls = 0;
    const factory: PiSessionFactory = async (input) => {
      factoryCalls++;
      const factoryCall = factoryCalls;
      const sessionFile = path.join(input.sessionsDir, `retry-${factoryCall}.jsonl`);
      const messages: unknown[] = [];
      let promptCalls = 0;
      return {
        sessionFile,
        messages,
        async prompt() {
          promptCalls++;
          if (factoryCall === 1 && promptCalls === 1) {
            throw new Error("first lazy prompt failed");
          }
          await mkdir(input.sessionsDir, { recursive: true });
          await writeFile(sessionFile, '{"type":"session"}\n', { mode: 0o600 });
          messages.push({
            role: "assistant",
            content: [{ type: "text", text: "retry succeeded" }],
          });
        },
        async abort() {},
        async close() { closeCalls++; },
      };
    };
    const host = new PiSessionHost({ ...fixture, sessionFactory: factory });

    await assert.rejects(
      host.execute(executionInput("ctx-lazy-retry", "first")),
      /first lazy prompt failed/,
    );
    assert.equal(closeCalls, 1);
    const result = await host.execute(executionInput("ctx-lazy-retry", "second"));

    assert.equal(result.text, "retry succeeded");
    assert.equal(factoryCalls, 2);
    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8"));
    assert.match(registry.contexts["ctx-lazy-retry"].sessionFile, /retry-2\.jsonl$/);
    await host.close();
  });
});

test("concurrent capacity is enforced before constructing a second session", async () => {
  await withFixture(async (fixture) => {
    const firstEntered = deferred();
    const firstRelease = deferred();
    const first = fakeFactory();
    const second = fakeFactory();
    const firstHost = new PiSessionHost({
      ...fixture,
      maxContexts: 1,
      sessionFactory: async (input) => {
        firstEntered.resolve();
        await firstRelease.promise;
        return first.factory(input);
      },
    });
    const secondHost = new PiSessionHost({
      ...fixture,
      maxContexts: 1,
      sessionFactory: second.factory,
    });

    const firstRun = firstHost.execute(executionInput("ctx-capacity-first", "one"));
    await firstEntered.promise;
    const secondRun = secondHost.execute(executionInput("ctx-capacity-second", "two"));
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(second.inputs.length, 0);
    firstRelease.resolve();
    await firstRun;
    await assert.rejects(secondRun, /capacity reached/);
    assert.equal(second.inputs.length, 0);
    await Promise.all([firstHost.close(), secondHost.close()]);
  });
});

test("abort while waiting for context initialization never constructs a session", async () => {
  await withFixture(async (fixture) => {
    const firstEntered = deferred();
    const firstRelease = deferred();
    const first = fakeFactory();
    const second = fakeFactory();
    const firstHost = new PiSessionHost({
      ...fixture,
      sessionFactory: async (input) => {
        firstEntered.resolve();
        await firstRelease.promise;
        return first.factory(input);
      },
    });
    const secondHost = new PiSessionHost({ ...fixture, sessionFactory: second.factory });
    const firstRun = firstHost.execute(executionInput("ctx-lock-owner", "one"));
    await firstEntered.promise;

    const abortController = new AbortController();
    const abortReason = new Error("cancel lock wait");
    const secondRun = secondHost.execute(
      executionInput("ctx-lock-waiter", "two", abortController.signal),
    );
    abortController.abort(abortReason);
    const earlyOutcome = await Promise.race([
      secondRun.then(
        () => "fulfilled" as const,
        (error) => error,
      ),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
    ]);
    firstRelease.resolve();
    await firstRun;
    await secondRun.catch(() => {});

    assert.equal(earlyOutcome, abortReason);
    assert.equal(second.inputs.length, 0);
    await Promise.all([firstHost.close(), secondHost.close()]);
  });
});

test("host close interrupts a pending context-initialization lock wait", async () => {
  await withFixture(async (fixture) => {
    const firstEntered = deferred();
    const firstRelease = deferred();
    const first = fakeFactory();
    const second = fakeFactory();
    const firstHost = new PiSessionHost({
      ...fixture,
      sessionFactory: async (input) => {
        firstEntered.resolve();
        await firstRelease.promise;
        return first.factory(input);
      },
    });
    const secondHost = new PiSessionHost({ ...fixture, sessionFactory: second.factory });
    const firstRun = firstHost.execute(executionInput("ctx-close-owner", "one"));
    await firstEntered.promise;
    const secondRun = secondHost.execute(executionInput("ctx-close-waiter", "two"));
    const secondOutcome = secondRun.then(
      () => undefined,
      (error) => error,
    );

    const closeOutcome = Promise.race([
      secondHost.close().then(() => "closed" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
    ]);
    const earlyOutcome = await closeOutcome;
    firstRelease.resolve();
    await firstRun;
    assert.match(String(await secondOutcome), /host is closed/);

    assert.equal(earlyOutcome, "closed");
    assert.equal(second.inputs.length, 0);
    await firstHost.close();
  });
});

test("a context cannot be rebound to a different workspace", async () => {
  await withFixture(async (fixture) => {
    const first = fakeFactory();
    const firstHost = new PiSessionHost({ ...fixture, sessionFactory: first.factory });
    await firstHost.execute(executionInput("ctx-workspace-collision", "one"));
    await firstHost.close();

    const secondCwd = path.join(fixture.root, "workspace-two");
    await mkdir(secondCwd);
    const second = fakeFactory();
    const secondHost = new PiSessionHost({
      ...fixture,
      cwd: secondCwd,
      sessionsDir: path.join(fixture.agentDir, "a2a", "sessions-two"),
      sessionFactory: second.factory,
    });
    await assert.rejects(
      secondHost.execute(executionInput("ctx-workspace-collision", "two")),
      /belongs to a different workspace/,
    );
    assert.equal(second.inputs.length, 0);
    await secondHost.close();
  });
});

test("context capacity is enforced before constructing or prompting a new session", async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.dirname(fixture.registryPath), { recursive: true });
    await writeFile(fixture.registryPath, `${JSON.stringify({
      version: 1,
      contexts: {
        existing: {
          cwd: fixture.cwd,
          sessionFile: path.join(fixture.sessionsDir, "existing.jsonl"),
        },
      },
    })}\n`);
    let factoryCalls = 0;
    const host = new PiSessionHost({
      ...fixture,
      maxContexts: 1,
      sessionFactory: async () => {
        factoryCalls++;
        throw new Error("factory must not run");
      },
    });

    await assert.rejects(
      host.execute(executionInput("new-context", "hello")),
      /context capacity/,
    );
    assert.equal(factoryCalls, 0);
    await host.close();
  });
});

test("a restarted host reopens the mapped canonical Pi session", async () => {
  await withFixture(async (fixture) => {
    const first = fakeFactory();
    const firstHost = new PiSessionHost({
      cwd: fixture.cwd,
      agentDir: fixture.agentDir,
      registryPath: fixture.registryPath,
      sessionFactory: first.factory,
    });
    await firstHost.execute(executionInput("ctx-restart", "before"));
    const sessionFile = first.sessions[0].sessionFile;
    const sessionsDir = path.dirname(sessionFile!);
    await firstHost.close();
    await chmod(path.dirname(fixture.registryPath), 0o755);
    await chmod(fixture.registryPath, 0o644);
    await chmod(sessionsDir, 0o755);
    await chmod(sessionFile!, 0o644);

    const second = fakeFactory();
    const restartedHost = new PiSessionHost({
      cwd: fixture.cwd,
      agentDir: fixture.agentDir,
      registryPath: fixture.registryPath,
      sessionFactory: second.factory,
    });
    await restartedHost.execute(executionInput("ctx-restart", "after"));

    assert.equal(second.inputs.length, 1);
    assert.equal(second.inputs[0].sessionFile, sessionFile);
    assert.equal((await stat(path.dirname(fixture.registryPath))).mode & 0o777, 0o700);
    assert.equal((await stat(fixture.registryPath)).mode & 0o777, 0o600);
    assert.equal((await stat(sessionsDir)).mode & 0o777, 0o700);
    assert.equal((await stat(sessionFile!)).mode & 0o777, 0o600);
    await restartedHost.close();
  });
});

test("a corrupt context registry fails closed without deleting sessions", async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.dirname(fixture.registryPath), { recursive: true });
    const existingSession = path.join(fixture.sessionsDir, "keep.jsonl");
    await mkdir(fixture.sessionsDir, { recursive: true });
    await writeFile(existingSession, "keep\n", { mode: 0o600 });
    await writeFile(fixture.registryPath, "{not-json", { mode: 0o600 });
    const fake = fakeFactory();
    const host = new PiSessionHost({ ...fixture, sessionFactory: fake.factory });

    await assert.rejects(
      host.execute(executionInput("ctx-corrupt", "hello")),
      /context registry/i,
    );
    assert.equal(await readFile(fixture.registryPath, "utf8"), "{not-json");
    assert.equal(await readFile(existingSession, "utf8"), "keep\n");
    assert.equal(fake.inputs.length, 0);
  });
});

test("a registry symlink fails closed", async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.dirname(fixture.registryPath), { recursive: true });
    const target = path.join(fixture.root, "outside-contexts.json");
    await writeFile(target, '{"version":1,"contexts":{}}\n', { mode: 0o600 });
    await symlink(target, fixture.registryPath);
    const fake = fakeFactory();
    const host = new PiSessionHost({ ...fixture, sessionFactory: fake.factory });

    await assert.rejects(
      host.execute(executionInput("ctx-symlink", "hello")),
      /registry.*regular non-symlink file|symbolic link/i,
    );
    assert.equal(fake.inputs.length, 0);
  });
});

test("a symlinked registry directory fails closed", async () => {
  await withFixture(async (fixture) => {
    await mkdir(fixture.agentDir, { recursive: true });
    const external = path.join(fixture.root, "external-registry");
    await mkdir(external);
    await symlink(external, path.join(fixture.agentDir, "a2a"));
    const fake = fakeFactory();
    const host = new PiSessionHost({ ...fixture, sessionFactory: fake.factory });

    await assert.rejects(
      host.execute(executionInput("ctx-root-symlink", "hello")),
      /symbolic link|symlink/i,
    );
    assert.equal(fake.inputs.length, 0);
  });
});

test("a symlinked Pi agent directory fails closed", async () => {
  await withFixture(async (fixture) => {
    const realAgentDir = path.join(fixture.root, "real-agent");
    await mkdir(realAgentDir);
    await symlink(realAgentDir, fixture.agentDir);
    const fake = fakeFactory();
    const host = new PiSessionHost({ ...fixture, sessionFactory: fake.factory });

    await assert.rejects(
      host.execute(executionInput("ctx-agent-root-symlink", "hello")),
      /agent directory.*symbolic link|storage root.*symbolic link/i,
    );
    assert.equal(fake.inputs.length, 0);
  });
});

test("a symlinked canonical sessions root fails closed", async () => {
  await withFixture(async (fixture) => {
    await mkdir(fixture.agentDir, { recursive: true });
    const external = path.join(fixture.root, "external-sessions");
    await mkdir(external);
    await symlink(external, path.join(fixture.agentDir, "sessions"));
    const fake = fakeFactory();
    const host = new PiSessionHost({
      cwd: fixture.cwd,
      agentDir: fixture.agentDir,
      registryPath: fixture.registryPath,
      sessionFactory: fake.factory,
    });

    await assert.rejects(
      host.execute(executionInput("ctx-session-root-symlink", "hello")),
      /symbolic link|symlink/i,
    );
    assert.equal(fake.inputs.length, 0);
  });
});

test("a session symlink in the registry fails closed", async () => {
  await withFixture(async (fixture) => {
    const sessionsDir = path.join(fixture.agentDir, "a2a", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const target = path.join(sessionsDir, "target.jsonl");
    const linked = path.join(sessionsDir, "linked.jsonl");
    await writeFile(target, "{}\n");
    await symlink(target, linked);
    await writeFile(fixture.registryPath, JSON.stringify({
      version: 1,
      contexts: {
        "ctx-session-symlink": { cwd: fixture.cwd, sessionFile: linked },
      },
    }));
    const fake = fakeFactory();
    const host = new PiSessionHost({ ...fixture, sessionFactory: fake.factory });

    await assert.rejects(
      host.execute(executionInput("ctx-session-symlink", "hello")),
      /regular non-symlink file/i,
    );
    assert.equal(fake.inputs.length, 0);
  });
});

test("host close waits for in-flight session creation and closes the late session", async () => {
  await withFixture(async (fixture) => {
    const factoryEntered = deferred();
    let releaseFactory!: () => void;
    const factoryReady = new Promise<void>((resolve) => { releaseFactory = resolve; });
    let promptCalls = 0;
    let closeCalls = 0;
    const sessionFile = path.join(fixture.sessionsDir, "late.jsonl");
    const factory: PiSessionFactory = async () => {
      factoryEntered.resolve();
      await factoryReady;
      await writeFile(sessionFile, '{"type":"session"}\n', { mode: 0o600 });
      return {
        sessionFile,
        messages: [],
        async prompt() { promptCalls++; },
        async abort() {},
        async close() { closeCalls++; },
      };
    };
    const host = new PiSessionHost({ ...fixture, sessionFactory: factory });
    const execution = host.execute(executionInput("ctx-close-setup", "wait"));
    await factoryEntered.promise;
    const closing = host.close();

    releaseFactory();
    await assert.rejects(execution, /host is closed/);
    await closing;
    assert.equal(promptCalls, 0);
    assert.equal(closeCalls, 1);
  });
});

test("host close aborts an active prompt and preserves its canonical mapping", async () => {
  await withFixture(async (fixture) => {
    let promptStarted!: () => void;
    const started = new Promise<void>((resolve) => { promptStarted = resolve; });
    let releasePrompt!: () => void;
    const released = new Promise<void>((resolve) => { releasePrompt = resolve; });
    const fake = fakeFactory();
    fake.factory = async (input) => {
      const session = await fakeFactory().factory(input) as FakeSession;
      session.prompt = async () => {
        promptStarted();
        await released;
      };
      session.abort = async () => {
        session.abortCalls++;
        releasePrompt();
      };
      fake.sessions.push(session);
      return session;
    };
    const host = new PiSessionHost({ ...fixture, sessionFactory: fake.factory });
    const execution = host.execute(executionInput("ctx-close-prompt", "wait"));
    await started;

    const closing = host.close();
    await assert.rejects(execution, /host is closed/);
    await closing;
    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8"));
    assert.equal(
      registry.contexts["ctx-close-prompt"].sessionFile,
      fake.sessions[0].sessionFile,
    );
    assert.equal(fake.sessions[0].abortCalls, 1);
    assert.equal(fake.sessions[0].closeCalls, 1);
  });
});

test("an abort during session setup never starts the Pi prompt", async () => {
  await withFixture(async (fixture) => {
    const factoryEntered = deferred();
    let releaseFactory!: () => void;
    const factoryReady = new Promise<void>((resolve) => { releaseFactory = resolve; });
    let promptCalls = 0;
    let abortCalls = 0;
    const sessionFile = path.join(fixture.sessionsDir, "setup-abort.jsonl");
    const factory: PiSessionFactory = async (input) => {
      factoryEntered.resolve();
      await factoryReady;
      await mkdir(input.sessionsDir, { recursive: true });
      await writeFile(sessionFile, '{"type":"session"}\n', { mode: 0o600 });
      return {
        sessionFile,
        messages: [],
        async prompt() { promptCalls++; },
        async abort() { abortCalls++; },
        async close() {},
      };
    };
    const host = new PiSessionHost({ ...fixture, sessionFactory: factory });
    const controller = new AbortController();
    const execution = host.execute(executionInput("ctx-setup-abort", "wait", controller.signal));

    await factoryEntered.promise;
    controller.abort(new Error("cancel during setup"));
    releaseFactory();
    await assert.rejects(execution, /cancel during setup/);
    assert.equal(promptCalls, 0);
    assert.equal(abortCalls, 1);
    await host.close();
  });
});

test("an aborted A2A turn aborts the Pi session once and keeps cleanup idempotent", async () => {
  await withFixture(async (fixture) => {
    let promptStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      promptStarted = resolve;
    });
    let releasePrompt!: () => void;
    const released = new Promise<void>((resolve) => {
      releasePrompt = resolve;
    });
    const fake = fakeFactory();
    fake.factory = async (input) => {
      const session = await fakeFactory().factory(input) as FakeSession;
      session.prompt = async () => {
        promptStarted();
        await released;
      };
      session.abort = async () => {
        session.abortCalls++;
        releasePrompt();
      };
      fake.sessions.push(session);
      return session;
    };
    const host = new PiSessionHost({ ...fixture, sessionFactory: fake.factory });
    const controller = new AbortController();
    const execution = host.execute(executionInput("ctx-abort", "wait", controller.signal));
    await started;

    controller.abort(new Error("caller canceled"));
    await assert.rejects(execution, /caller canceled|aborted/i);
    assert.equal(fake.sessions[0].abortCalls, 1);
    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8"));
    assert.equal(
      registry.contexts["ctx-abort"].sessionFile,
      fake.sessions[0].sessionFile,
    );

    await Promise.all([host.close(), host.close()]);
    assert.equal(fake.sessions[0].closeCalls, 1);
  });
});

test("a materialized session remains mapped when prompt execution fails", async () => {
  await withFixture(async (fixture) => {
    const sessionFile = path.join(fixture.sessionsDir, "prompt-failed.jsonl");
    const factory: PiSessionFactory = async () => {
      await mkdir(fixture.sessionsDir, { recursive: true });
      await writeFile(sessionFile, '{"type":"session"}\n');
      return {
        sessionFile,
        messages: [],
        async prompt() { throw new Error("prompt failed"); },
        async abort() {},
        async close() {},
      };
    };
    const host = new PiSessionHost({ ...fixture, sessionFactory: factory });

    await assert.rejects(
      host.execute(executionInput("ctx-prompt-failed", "hello")),
      /prompt failed/,
    );
    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8"));
    assert.equal(registry.contexts["ctx-prompt-failed"].sessionFile, sessionFile);
    await host.close();
  });
});

test("a materialized session remains mapped when no assistant text is produced", async () => {
  await withFixture(async (fixture) => {
    const sessionFile = path.join(fixture.sessionsDir, "no-assistant.jsonl");
    const factory: PiSessionFactory = async () => {
      await mkdir(fixture.sessionsDir, { recursive: true });
      await writeFile(sessionFile, '{"type":"session"}\n');
      return {
        sessionFile,
        messages: [],
        async prompt() {},
        async abort() {},
        async close() {},
      };
    };
    const host = new PiSessionHost({ ...fixture, sessionFactory: factory });

    await assert.rejects(
      host.execute(executionInput("ctx-no-assistant", "hello")),
      /no assistant text/,
    );
    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8"));
    assert.equal(registry.contexts["ctx-no-assistant"].sessionFile, sessionFile);
    await host.close();
  });
});

test("the input-required marker maps to the A2A input-required state", async () => {
  await withFixture(async (fixture) => {
    const fake = fakeFactory(() => "[INPUT_REQUIRED] Which branch should I use?");
    const host = new PiSessionHost({ ...fixture, sessionFactory: fake.factory });

    assert.deepEqual(
      await host.execute(executionInput("ctx-input", "implement it")),
      {
        state: "TASK_STATE_INPUT_REQUIRED",
        text: "Which branch should I use?",
      },
    );
    await host.close();
  });
});
