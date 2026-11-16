import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    ".scratch/**",
    ".cachebro/**",
    ".pi-workflows/**",
    ".pi-background/**",
    "file-search/bin/**",
  ]),
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.{ts,mts,cts}"],
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
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
