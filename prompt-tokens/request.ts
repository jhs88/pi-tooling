import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ObjectValue = Record<string, unknown>;

export interface RequestEstimate {
  startupTokens: number;
  conversationTokens: number;
  totalTokens: number;
  structureTokens: number;
  mediaOmitted: boolean;
  continuation: boolean;
  startupPreview: string;
}

export interface ObservedRequest {
  model: string;
  estimate?: RequestEstimate;
  reportedInputTokens?: number;
  outcome?: string;
}

const PREVIEW_LIMIT = 100_000;

function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Project only known input fields, never credentials, headers, or generation
 * options.
 */
function inputFields(payload: ObjectValue): ObjectValue | undefined {
  if (object(payload.context) && Array.isArray(payload.context.messages))
    return { messages: payload.context.messages };
  const result: ObjectValue = {};
  let hasConversation = false;
  for (const key of ["messages", "input", "contents"]) {
    if (Array.isArray(payload[key]) || typeof payload[key] === "string") {
      result[key] = payload[key];
      hasConversation = true;
    }
  }
  if (!hasConversation) return undefined;
  for (const key of ["system", "instructions", "tools", "toolConfig"])
    if (payload[key] !== undefined) result[key] = payload[key];
  if (object(payload.config)) {
    const config: ObjectValue = {};
    for (const key of ["systemInstruction", "tools", "toolConfig"])
      if (payload.config[key] !== undefined) config[key] = payload.config[key];
    if (Object.keys(config).length > 0) result.config = config;
  }
  return result;
}

/** Do not mistake encoded images or audio for text tokens. */
function withoutMedia(
  value: unknown,
  state: { omitted: boolean; nodes: number },
  ancestors = new Set<unknown>(),
  depth = 0,
): Json {
  if (++state.nodes > 200_000 || depth > 100 || ancestors.has(value))
    throw new Error("Unsupported payload structure");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    state.omitted = true;
    return "[binary omitted]";
  }
  if (!Array.isArray(value) && !object(value))
    throw new Error("Non-JSON payload");
  if (object(value)) {
    const mediaType =
      typeof value.type === "string" &&
      /^(?:image|input_image|image_url|input_audio|audio|document|file|input_file)$/.test(
        value.type,
      );
    const googleMedia = object(value.inlineData) || object(value.fileData);
    const bedrockMedia = ["image", "audio", "video", "document"].some(
      (key) => object(value[key]) && object(value[key].source),
    );
    if (mediaType || googleMedia || bedrockMedia) {
      state.omitted = true;
      return "[media omitted]";
    }
  }
  ancestors.add(value);
  const next = (child: unknown): Json =>
    withoutMedia(child, state, ancestors, depth + 1);
  const result: Json = Array.isArray(value)
    ? value.map(next)
    : Object.fromEntries(
        Object.entries(value)
          .filter(([, child]) => child !== undefined)
          .map(([key, child]) => [key, next(child)]),
      );
  ancestors.delete(value);
  return result;
}

function startupFields(input: Record<string, Json>): Record<string, Json> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      ["messages", "input", "contents"].includes(key)
        ? Array.isArray(value)
          ? value.filter(
              (item) =>
                object(item) &&
                (item.role === "system" || item.role === "developer"),
            )
          : ""
        : value,
    ]),
  );
}

function valueCharacters(value: Json): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value))
    return value.reduce<number>(
      (total, child) => total + valueCharacters(child),
      0,
    );
  if (value !== null && typeof value === "object")
    return Object.values(value).reduce<number>(
      (total, child) => total + valueCharacters(child),
      0,
    );
  return JSON.stringify(value).length;
}

/**
 * A JSON-size heuristic for common Pi provider bodies, not a provider
 * tokenizer.
 */
export function estimateProviderRequest(
  payload: unknown,
): RequestEstimate | undefined {
  try {
    if (!object(payload)) return undefined;
    const fields = inputFields(payload);
    if (!fields) return undefined;
    const state = { omitted: false, nodes: 0 };
    const input = withoutMedia(fields, state) as Record<string, Json>;
    const startup = startupFields(input);
    const fullJson = JSON.stringify(input);
    const startupJson = JSON.stringify(startup);
    const totalTokens = Math.ceil(fullJson.length / 4);
    const startupTokens = Math.ceil(startupJson.length / 4);
    const pretty = JSON.stringify(startup, null, 2);
    return {
      startupTokens,
      conversationTokens: Math.max(0, totalTokens - startupTokens),
      totalTokens,
      structureTokens: Math.ceil(
        (fullJson.length - valueCharacters(input)) / 4,
      ),
      mediaOmitted: state.omitted,
      continuation:
        typeof payload.previous_response_id === "string" ||
        (object(payload.thread) && payload.thread.type === "continue"),
      startupPreview:
        pretty.length <= PREVIEW_LIMIT
          ? pretty
          : `${pretty.slice(0, PREVIEW_LIMIT)}\n[Preview truncated; estimates used all input fields.]`,
    };
  } catch {
    // Observing a custom or malformed body must never fail a model request.
    return undefined;
  }
}

/** Pi normalizes cached input into separate, non-overlapping usage counters. */
export function reportedInputTokens(usage: Usage): number | undefined {
  const counts = [usage.input, usage.cacheRead, usage.cacheWrite];
  if (!counts.every((value) => Number.isSafeInteger(value) && value >= 0))
    return undefined;
  const total = counts.reduce((sum, value) => sum + value, 0);
  return total > 0 && Number.isSafeInteger(total) ? total : undefined;
}

/**
 * Session-local numeric observations. Never retain conversation bodies or write
 * logs.
 */
export class RequestTracker {
  first: ObservedRequest | undefined;
  latest: ObservedRequest | undefined;
  private active = false;

  reset(): void {
    this.first = undefined;
    this.latest = undefined;
    this.active = false;
  }

  begin(model: string): void {
    this.active = true;
    this.latest = { model };
  }

  observe(payload: unknown): void {
    if (!this.active || !this.latest) return;
    this.latest.estimate = estimateProviderRequest(payload);
    this.latest.reportedInputTokens = undefined;
    this.latest.outcome = undefined;
    if (
      !this.first &&
      this.latest.estimate &&
      !this.latest.estimate.continuation
    ) {
      this.first = {
        model: this.latest.model,
        estimate: { ...this.latest.estimate },
      };
    }
  }

  response(message: AssistantMessage): void {
    if (!this.active || !this.latest) return;
    this.latest.model = `${message.provider}/${message.model}`;
    this.latest.reportedInputTokens = reportedInputTokens(message.usage);
    this.latest.outcome = message.stopReason;
  }

  end(): void {
    this.active = false;
  }
}
