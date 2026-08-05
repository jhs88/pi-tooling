import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolvePiCodingAgentPackageRoot } from "./host-package.ts";

const packageRoot = fileURLToPath(
  new URL("../node_modules/@earendil-works/pi-coding-agent/", import.meta.url),
);

test("the headless resolver accepts an explicit Pi host package", async () => {
  assert.equal(
    await resolvePiCodingAgentPackageRoot({ PI_A2A_PI_PACKAGE: packageRoot }),
    path.resolve(packageRoot),
  );
});

test("the headless resolver rejects relative or invalid host package overrides", async () => {
  await assert.rejects(
    resolvePiCodingAgentPackageRoot({ PI_A2A_PI_PACKAGE: "relative/pi" }),
    /must be an absolute package directory/,
  );
  await assert.rejects(
    resolvePiCodingAgentPackageRoot({ PI_A2A_PI_PACKAGE: path.dirname(packageRoot) }),
    /is not a Pi coding-agent package directory/,
  );
});
