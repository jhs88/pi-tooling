import assert from "node:assert/strict";
import test from "node:test";
import {
  loadA2AHostConfig,
  loadA2AServerConfig,
  MAX_A2A_CONTEXTS,
} from "./config.ts";

test("loadA2AServerConfig is loopback-only and requires an environment token", () => {
  assert.throws(() => loadA2AServerConfig({}), /PI_A2A_BEARER_TOKEN/);

  assert.deepEqual(loadA2AServerConfig({
    PI_A2A_BEARER_TOKEN: "secret",
  }), {
    host: "127.0.0.1",
    port: 10000,
    bearerToken: "secret",
    maxBodyBytes: 1_048_576,
    maxTasks: 256,
    executionTimeoutMs: 300_000,
  });
});

test("loadA2AServerConfig validates numeric values and rejects non-loopback binds", () => {
  assert.throws(() => loadA2AServerConfig({
    PI_A2A_BEARER_TOKEN: "secret",
    PI_A2A_HOST: "0.0.0.0",
  }), /loopback/);

  assert.throws(() => loadA2AServerConfig({
    PI_A2A_BEARER_TOKEN: "secret",
    PI_A2A_PORT: "not-a-port",
  }), /PI_A2A_PORT/);

  assert.throws(() => loadA2AServerConfig({
    PI_A2A_BEARER_TOKEN: "secret",
    PI_A2A_MAX_BODY_BYTES: "0",
  }), /PI_A2A_MAX_BODY_BYTES/);

  assert.throws(() => loadA2AServerConfig({
    PI_A2A_BEARER_TOKEN: "secret",
    PI_A2A_MAX_BODY_BYTES: "1048577",
  }), /PI_A2A_MAX_BODY_BYTES/);

  assert.throws(() => loadA2AServerConfig({
    PI_A2A_BEARER_TOKEN: "secret",
    PI_A2A_EXECUTION_TIMEOUT_MS: "0",
  }), /PI_A2A_EXECUTION_TIMEOUT_MS/);

  assert.throws(() => loadA2AServerConfig({
    PI_A2A_BEARER_TOKEN: "secret",
    PI_A2A_MAX_TASKS: "1025",
  }), /PI_A2A_MAX_TASKS/);
});

test("loadA2AHostConfig exposes a bounded persistent-context capacity", () => {
  assert.deepEqual(loadA2AHostConfig({}), { maxContexts: 256 });
  assert.deepEqual(loadA2AHostConfig({ PI_A2A_MAX_CONTEXTS: "512" }), {
    maxContexts: 512,
  });
  assert.throws(
    () => loadA2AHostConfig({
      PI_A2A_MAX_CONTEXTS: String(MAX_A2A_CONTEXTS + 1),
    }),
    /PI_A2A_MAX_CONTEXTS/,
  );
});
