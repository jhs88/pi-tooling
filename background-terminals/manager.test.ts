import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  MAX_RUNNING,
  createTerminalManager,
  selectShellInvocation,
} from "./src/manager.ts";

const cwd = process.cwd();
const shell = { executable: "/bin/sh", prefixArgs: ["-c"], description: "/bin/sh -c" };

function processGone(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

async function pollUntil(check: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

test("shell selection matches zsh-user-bash policy and is explicit", () => {
  assert.deepEqual(
    selectShellInvocation("echo ok", "linux", { PI_USER_BASH_SHELL: "/opt/zsh" }),
    { executable: "/opt/zsh", args: ["-fc", "echo ok"], description: "/opt/zsh -fc" },
  );
  assert.deepEqual(
    selectShellInvocation("echo ok", "linux", { SHELL: "/usr/local/bin/zsh" }),
    { executable: "/usr/local/bin/zsh", args: ["-fc", "echo ok"], description: "/usr/local/bin/zsh -fc" },
  );
  assert.deepEqual(
    selectShellInvocation("echo ok", "win32", { ComSpec: "C:\\Windows\\cmd.exe" }),
    {
      executable: "C:\\Windows\\cmd.exe",
      args: ["/d", "/s", "/c", "echo ok"],
      description: "C:\\Windows\\cmd.exe /d /s /c",
    },
  );
});

test("parallel starts atomically enforce the eight-process cap", async () => {
  const manager = createTerminalManager({ shell });
  try {
    const starts = await Promise.allSettled(
      Array.from({ length: MAX_RUNNING + 1 }, (_, index) =>
        manager.start({ command: "while :; do sleep 1; done", title: `job-${index}`, cwd }),
      ),
    );
    assert.equal(starts.filter((result) => result.status === "fulfilled").length, MAX_RUNNING);
    const rejected = starts.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.match(String(rejected.reason), /Max 8 background terminals/);
  } finally {
    await manager.dispose();
  }
});

test("stdin is closed and stdout/stderr are captured separately", async () => {
  const manager = createTerminalManager({ shell });
  try {
    const started = await manager.start({
      command: "if read line; then echo input:$line; else echo eof; fi; echo err >&2",
      title: "stdin",
      cwd,
    });
    const done = await manager.waitForSettlement(started.id);
    assert.equal(done.status, "done");
    assert.equal(done.stdout.text, "eof\n");
    assert.equal(done.stderr.text, "err\n");
  } finally {
    await manager.dispose();
  }
});

test(
  "POSIX kill terminates the whole process group including descendants",
  { skip: process.platform === "win32" },
  async () => {
    const manager = createTerminalManager({ shell });
    const sentinelDir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-tree-test-"));
    const sentinel = path.join(sentinelDir, "heartbeat");
    try {
      const started = await manager.start({
        command: `node -e 'const fs=require("node:fs");const f=${JSON.stringify(sentinel)};let n=0;fs.writeFileSync(f,String(n));setInterval(()=>fs.writeFileSync(f,String(++n)),25)' & echo child:$!; wait`,
        title: "tree",
        cwd,
      });
      assert.ok(await pollUntil(() => manager.get(started.id)?.stdout.text.includes("child:") === true));
      const match = /child:(\d+)/.exec(manager.get(started.id)?.stdout.text ?? "");
      assert.ok(match);
      const descendantPid = Number(match[1]);
      assert.equal(processGone(descendantPid), false);

      const [result] = await manager.kill([started.id]);
      assert.equal(result.killed, true);
      assert.equal(result.status, "killed");
      assert.ok(await pollUntil(() => processGone(descendantPid)));
    } finally {
      await manager.dispose();
      fs.rmSync(sentinelDir, { recursive: true, force: true });
    }
  },
);

test("normal teardown is idempotent and removes session spill files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-manager-test-"));
  const manager = createTerminalManager({ shell, spill: { root } });
  const started = await manager.start({
    command: "echo ready; while :; do sleep 1; done",
    title: "dispose",
    cwd,
  });
  const pid = started.pid!;
  const spillDir = path.dirname(started.stdout.spillPath!);
  await manager.dispose();
  await manager.dispose();
  assert.ok(await pollUntil(() => processGone(pid)));
  assert.equal(fs.existsSync(spillDir), false);
  fs.rmSync(root, { recursive: true, force: true });
});
