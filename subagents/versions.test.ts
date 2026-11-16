import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { isPinnedSubagentsSource } from "./index.ts";
import { isReviewedSubagentsVersion } from "./versions.ts";

test("the development dependency upgrade has been reviewed for adapter compatibility", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const version = manifest.devDependencies["@tintinweb/pi-subagents"];
  assert.ok(
    isReviewedSubagentsVersion(version),
    `${version} is not reviewed. Inspect upstream changes, update subagents/versions.ts, and run npm run verify:subagents.`,
  );
});

test("the installed upstream package is eligible for the actual adapter", () => {
  const source = fileURLToPath(
    new URL(
      "../node_modules/@tintinweb/pi-subagents/src/index.ts",
      import.meta.url,
    ),
  );
  assert.ok(
    isPinnedSubagentsSource(source),
    "Installed upstream release is unreviewed; aliases would be inactive.",
  );
});
