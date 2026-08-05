import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cliPath = new URL("./cli.mjs", import.meta.url);

test("the headless executable documents its command and exits without starting", () => {
  const result = spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", cliPath.pathname, "--help"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pi-a2a-server/);
  assert.match(result.stdout, /PI_A2A_BEARER_TOKEN/);
  assert.equal(result.stderr, "");
});

test("the headless executable can validate its Pi host runtime", () => {
  const result = spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", cliPath.pathname, "--check"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /headless runtime is ready/);
  assert.equal(result.stderr, "");
});
