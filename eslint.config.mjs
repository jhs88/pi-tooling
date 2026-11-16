import js from "@eslint/js";
import { defineConfig, includeIgnoreFile } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";

export default defineConfig(
  includeIgnoreFile(fileURLToPath(new URL(".gitignore", import.meta.url)), {
    gitignoreResolution: true,
  }),
  {
    name: "pi-tooling/node",
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.nodeBuiltin },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    name: "pi-tooling/typescript",
    files: ["**/*.{ts,mts,cts}"],
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true },
      ],
    },
  },
  {
    name: "pi-tooling/commonjs",
    files: ["**/*.{cjs,cts}"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.commonjs,
    },
  },
  {
    name: "pi-tooling/terminal-control-patterns",
    // These sanitizers and their assertions deliberately match terminal control bytes.
    files: [
      "shared/terminal-text.ts",
      "background-terminals/src/prompt.ts",
      "ask-user/index.test.ts",
    ],
    rules: { "no-control-regex": "off" },
  },
  prettier,
);
