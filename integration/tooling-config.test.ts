import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { format, getFileInfo, resolveConfig } from "prettier";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const eslint = new ESLint({ cwd: root });

async function lint(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  assert.ok(result);
  return result.messages.map((message) => message.ruleId);
}

test("ESLint checks JavaScript and TypeScript without enforcing formatting", async () => {
  const messages = await lint(
    "const value: any = 1;\n",
    "integration/example.ts",
  );
  assert.deepEqual(
    new Set(messages),
    new Set([
      "@typescript-eslint/no-explicit-any",
      "@typescript-eslint/no-unused-vars",
    ]),
  );
  assert.deepEqual(await lint("missing();\n", "integration/example.mjs"), [
    "no-undef",
  ]);
  assert.deepEqual(
    await lint("export const value:number=1\n", "integration/example.ts"),
    [],
  );
});

test("ESLint distinguishes Node ESM and CommonJS globals", async () => {
  const source = 'module.exports = require("node:fs");\n';
  assert.deepEqual(await lint(source, "integration/example.cjs"), []);
  assert.deepEqual(await lint(source, "integration/example.mjs"), [
    "no-undef",
    "no-undef",
  ]);
  assert.deepEqual(
    await lint("console.log(process.pid);\n", "integration/example.mjs"),
    [],
  );
  assert.deepEqual(
    await lint("window.alert(1);\n", "integration/example.mjs"),
    ["no-undef"],
  );
  for (const extension of ["cjs", "cts"]) {
    const config = await eslint.calculateConfigForFile(
      `integration/example.${extension}`,
    );
    assert.equal(config.languageOptions.sourceType, "commonjs");
  }
});

test("unused ESLint suppressions are errors", async () => {
  const [result] = await eslint.lintText(
    "// eslint-disable-next-line no-debugger\nexport const value = 1;\n",
    { filePath: "integration/example.mjs" },
  );
  assert.ok(result);
  assert.equal(result.errorCount, 1);
  assert.match(result.messages[0].message, /Unused eslint-disable directive/);
});

test("lint and format skip generated and session-owned files", async () => {
  for (const path of [
    "node_modules/example/index.js",
    ".scratch/example.ts",
    "file-search/bin/example.js",
  ]) {
    assert.equal(await eslint.isPathIgnored(join(root, path)), true, path);
    const info = await getFileInfo(join(root, path), {
      ignorePath: [join(root, ".gitignore"), join(root, ".prettierignore")],
    });
    assert.equal(info.ignored, true, path);
  }
  const lockfile = await getFileInfo(join(root, "package-lock.json"), {
    ignorePath: join(root, ".prettierignore"),
  });
  assert.equal(lockfile.ignored, true);
});

test("Prettier formats code and JSDoc but preserves Markdown prose wrapping", async () => {
  const options = await resolveConfig(join(root, "index.ts"));
  assert.ok(options);
  assert.equal(
    await format("export const value:number=1\n", {
      ...options,
      filepath: "example.ts",
    }),
    "export const value: number = 1;\n",
  );
  const comment = await format(
    "/** @param {  string   } name description */\n",
    {
      ...options,
      filepath: "example.js",
    },
  );
  assert.match(comment, /@param \{string\} name Description/);
  assert.equal(
    await format(comment, { ...options, filepath: "example.js" }),
    comment,
  );
  const markdown = `${"A long prose sentence that should keep its original wrapping. ".repeat(3).trim()}\n\nA manually wrapped\nparagraph.\n`;
  assert.equal(
    await format(markdown, { ...options, filepath: "example.md" }),
    markdown,
  );
});
