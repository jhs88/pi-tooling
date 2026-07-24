// Adapted from davis7dotsh/my-pi-setup@797eaf6d6f178759cf7aabde927ef15c91346e7e; requires an explicit self-hosted endpoint.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface FirecrawlConfig {
  readonly apiUrl: string;
  readonly apiKey?: string;
}

export interface FirecrawlConfigOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly envPath?: string;
  readonly globalEnvPath?: string;
}

export class FirecrawlConfigError extends Error {
  override readonly name = "FirecrawlConfigError";
}

export function agentEnvPath() {
  return join(homedir(), ".pi", "agent", ".env");
}

export function globalHermesEnvPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const hermesHome = env.HERMES_HOME?.trim();
  return join(hermesHome || join(homedir(), ".hermes"), ".env");
}

function stripInlineComment(raw: string) {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index];
    if (quote) {
      if (character === quote && raw[index - 1] !== "\\") quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "#" && (index === 0 || /\s/.test(raw[index - 1]))) {
      return raw.slice(0, index).trimEnd();
    }
  }
  return raw;
}

function parseEnvValue(raw: string) {
  const value = stripInlineComment(raw.trim()).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function readEnvFile(path: string) {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return new Map<string, string>();
  }

  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
    );
    if (!match) continue;
    values.set(match[1], parseEnvValue(match[2]));
  }
  return values;
}

export function resolveFirecrawlConfig(
  options: FirecrawlConfigOptions = {},
): FirecrawlConfig {
  const env = options.env ?? process.env;
  const fileValues = readEnvFile(options.envPath ?? agentEnvPath());
  const globalValues = readEnvFile(
    options.globalEnvPath ?? globalHermesEnvPath(env),
  );
  const readValue = (name: string) => {
    const processValue = env[name]?.trim();
    return (
      processValue ||
      fileValues.get(name)?.trim() ||
      globalValues.get(name)?.trim() ||
      undefined
    );
  };

  const apiUrl = readValue("FIRECRAWL_API_URL");
  if (!apiUrl) {
    throw new FirecrawlConfigError(
      "Missing FIRECRAWL_API_URL in the environment, ~/.pi/agent/.env, or the global Hermes environment; an explicit self-hosted endpoint is required.",
    );
  }
  if (!URL.canParse(apiUrl)) {
    throw new FirecrawlConfigError("FIRECRAWL_API_URL must be a valid URL.");
  }

  const parsed = new URL(apiUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FirecrawlConfigError(
      "FIRECRAWL_API_URL must use http or https.",
    );
  }
  if (parsed.hostname.toLowerCase() === "api.firecrawl.dev") {
    throw new FirecrawlConfigError(
      "FIRECRAWL_API_URL must identify a self-hosted endpoint, not Firecrawl public cloud.",
    );
  }

  return { apiUrl, apiKey: readValue("FIRECRAWL_API_KEY") };
}
