import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  OutputBuffer,
  SpillSession,
  createSecretRedactor,
} from "./src/output.ts";

test("OutputBuffer retains a UTF-8-safe bounded tail", () => {
  const output = new OutputBuffer(5);
  output.push("ééééé");
  assert.equal(output.view().text, "éé");
  assert.equal(output.view().totalBytes, 10);
  assert.equal(output.view().truncatedBytes, 6);
  assert.ok(!output.view().text.includes("�"));
});

test("secret redaction covers inherited values and credential-shaped output", () => {
  const redact = createSecretRedactor({ API_TOKEN: "top-secret-value" });
  const redacted = redact(
    "API_TOKEN=top-secret-value Authorization: Bearer abcdefghijklmnop ghp_abcdefghijklmnopqrstuvwxyz123456",
  );
  assert.ok(!redacted.includes("top-secret-value"));
  assert.ok(!redacted.includes("abcdefghijklmnop"));
  assert.ok(!redacted.includes("ghp_abcdefghijklmnopqrstuvwxyz123456"));
  assert.match(redacted, /\[REDACTED\]/);
});

test("spill files are private and bounded by per-stream and session quotas", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-output-test-"));
  try {
    const session = new SpillSession({ root, maxStreamBytes: 8, maxSessionBytes: 12 });
    const stdout = session.createWriter("bt-1", "stdout");
    const stderr = session.createWriter("bt-1", "stderr");
    stdout.write("abcdefghijk");
    stderr.write("12345678");
    stdout.close();
    stderr.close();

    assert.equal(fs.readFileSync(stdout.path!, "utf8"), "abcdefgh");
    assert.equal(fs.readFileSync(stderr.path!, "utf8"), "1234");
    assert.equal(stdout.info().truncated, true);
    assert.equal(stderr.info().truncated, true);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(session.directory).mode & 0o777, 0o700);
      assert.equal(fs.statSync(stdout.path!).mode & 0o777, 0o600);
    }
    session.dispose();
    assert.equal(fs.existsSync(session.directory), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("creating a spill session removes only stale session directories", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-stale-test-"));
  try {
    const stale = path.join(root, "session-stale");
    const fresh = path.join(root, "session-fresh");
    const unrelated = path.join(root, "keep-me");
    fs.mkdirSync(stale);
    fs.mkdirSync(fresh);
    fs.mkdirSync(unrelated);
    const now = Date.now();
    fs.utimesSync(stale, new Date(now - 10_000), new Date(now - 10_000));
    fs.utimesSync(fresh, new Date(now), new Date(now));

    const session = new SpillSession({ root, staleAfterMs: 5_000, now: () => now });
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(fresh), true);
    assert.equal(fs.existsSync(unrelated), true);
    session.dispose();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
