import assert from "node:assert/strict";
import test from "node:test";
import type { TerminalSnapshot } from "./src/domain.ts";
import { buildStatusResult, outputRetentionNote } from "./src/prompt.ts";

const snapshot: TerminalSnapshot = {
  id: "bt-1",
  command: "demo",
  title: "demo",
  cwd: "/tmp",
  pid: 1,
  shell: "/bin/sh -c",
  status: "done",
  createdAt: Date.now() - 1000,
  settledAt: Date.now(),
  exitCode: 0,
  stdout: {
    text: "newest tail",
    totalBytes: 100,
    truncatedBytes: 89,
    spillPath: "/private/bt-1.stdout.log",
    spillBytes: 50,
    spillTruncated: true,
  },
  stderr: { text: "", totalBytes: 0, truncatedBytes: 0, spillBytes: 0, spillTruncated: false },
};

test("retention wording never calls the retained /ps tail a full log", () => {
  const note = outputRetentionNote(snapshot.stdout);
  assert.match(note, /\/ps shows only the retained tail/);
  assert.match(note, /spill retained first 50 B/);
  assert.doesNotMatch(note, /full (?:log|output).*\/ps/i);
  assert.doesNotMatch(buildStatusResult(snapshot), /full (?:log|output).*\/ps/i);
});
