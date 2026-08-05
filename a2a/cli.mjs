#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const packageRootUrl = new URL("../", import.meta.url).href;

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith(packageRootUrl) && url.endsWith(".ts")) {
      const source = readFileSync(fileURLToPath(url), "utf8");
      return {
        format: "module",
        shortCircuit: true,
        source: stripTypeScriptTypes(source, {
          mode: "strip",
          sourceUrl: url,
        }),
      };
    }
    return nextLoad(url, context);
  },
});

await import("./cli.ts");
