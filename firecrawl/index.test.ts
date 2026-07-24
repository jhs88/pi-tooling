// Adaptation tests for davis7dotsh/my-pi-setup@797eaf6d6f178759cf7aabde927ef15c91346e7e.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { resolveFirecrawlConfig } from "./config.ts";
import firecrawlTools, { crawlEffect, type CrawlClient } from "./index.ts";
import { formatFirecrawlOutput } from "./output.ts";

test("extension registers search, crawl, and scrape without reading configuration", () => {
  const registered: string[] = [];
  firecrawlTools({
    registerTool: (tool: { name: string }) => registered.push(tool.name),
  } as unknown as ExtensionAPI);
  assert.deepEqual(registered, ["search", "crawl", "scrape"]);
});

test("configuration requires an explicit API URL", () => {
  assert.throws(
    () =>
      resolveFirecrawlConfig({
        env: {},
        envPath: "/missing/.env",
        globalEnvPath: "/missing/hermes.env",
      }),
    /Missing FIRECRAWL_API_URL/,
  );
});

test("configuration rejects the Firecrawl public cloud endpoint", () => {
  assert.throws(
    () =>
      resolveFirecrawlConfig({
        env: { FIRECRAWL_API_URL: "https://api.firecrawl.dev/v1" },
        envPath: "/missing/.env",
        globalEnvPath: "/missing/hermes.env",
      }),
    /self-hosted endpoint/,
  );
});

test("process environment takes precedence and the API key is optional", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-firecrawl-config-"));
  const envPath = join(directory, ".env");
  await writeFile(
    envPath,
    "FIRECRAWL_API_URL=http://from-file:3002\nFIRECRAWL_API_KEY=file-key\n",
  );

  const processConfig = resolveFirecrawlConfig({
    env: { FIRECRAWL_API_URL: "http://from-process:3002" },
    envPath,
    globalEnvPath: "/missing/hermes.env",
  });
  assert.equal(processConfig.apiUrl, "http://from-process:3002");
  assert.ok(processConfig.apiKey);

  assert.deepEqual(
    resolveFirecrawlConfig({
      env: { FIRECRAWL_API_URL: "http://keyless:3002" },
      envPath: "/missing/.env",
      globalEnvPath: "/missing/hermes.env",
    }),
    { apiUrl: "http://keyless:3002", apiKey: undefined },
  );
});

test("ignored agent .env supports export syntax and quoted values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-firecrawl-config-"));
  const envPath = join(directory, ".env");
  await writeFile(
    envPath,
    "export FIRECRAWL_API_URL='http://self-hosted:3002' # local\nFIRECRAWL_API_KEY=\"fixture-value\"\n",
  );
  const config = resolveFirecrawlConfig({
    env: {},
    envPath,
    globalEnvPath: "/missing/hermes.env",
  });
  assert.equal(config.apiUrl, "http://self-hosted:3002");
  assert.ok(config.apiKey);
});

test("configuration falls back to the global Hermes environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-firecrawl-global-config-"));
  const globalEnvPath = join(directory, ".env");
  await writeFile(
    globalEnvPath,
    "FIRECRAWL_API_URL=http://global-firecrawl:3002\nFIRECRAWL_API_KEY=fixture-value\n",
  );

  const config = resolveFirecrawlConfig({
    env: {},
    envPath: "/missing/.env",
    globalEnvPath,
  });
  assert.equal(config.apiUrl, "http://global-firecrawl:3002");
  assert.ok(config.apiKey);
});

test("oversized Firecrawl output is bounded and persisted", async () => {
  const value = Array.from({ length: 3000 }, (_, index) => `line-${index}`).join("\n");
  let persisted: string | undefined;
  const formatted = await formatFirecrawlOutput(value, "search", async (full) => {
    persisted = full;
    return "/tmp/pi-firecrawl-test/search.json";
  });
  assert.equal(persisted, value);
  assert.match(formatted, /Output truncated: 2000 of 3000 lines/);
});

test("remote crawl is cancelled when polling is interrupted", async () => {
  let pollingStarted!: () => void;
  const startedPolling = new Promise<void>((resolve) => {
    pollingStarted = resolve;
  });
  const cancelledJobs: string[] = [];
  const client: CrawlClient = {
    startCrawl: async (url) => ({ id: "crawl-123", url }),
    getCrawlStatus: async () => {
      pollingStarted();
      return new Promise(() => undefined);
    },
    cancelCrawl: async (jobId) => {
      cancelledJobs.push(jobId);
      return true;
    },
  };

  const controller = new AbortController();
  const running = Effect.runPromise(
    crawlEffect(client, "https://example.com", { limit: 1 }),
    { signal: controller.signal },
  );
  const interrupted = assert.rejects(running);
  await startedPolling;
  controller.abort();
  await interrupted;
  assert.deepEqual(cancelledJobs, ["crawl-123"]);
});
