import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition, ToolLoadout } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { executeVisibleSubagent, readResult, readArgs, type ExecutableTool, type ToolResult } from "./visible.ts";

export const TOOL_ALIASES = {
  Agent: "subagent",
  get_subagent_result: "subagent_result",
  steer_subagent: "subagent_steer",
  SubagentWorkflow: "subagent_workflow",
} as const;

type RegisteredTool = ToolLoadout["registered"][number];
type SchemaNode = TSchema & { description?: string; default?: unknown; properties?: Record<string, SchemaNode> };

/** Forward through the supported pipeline, never a raw registered executor. */
function executable(tool: RegisteredTool, ctx: ExtensionToolContext): ExecutableTool {
  return {
    name: tool.name, description: tool.description, parameters: tool.parameters,
    async execute(_id, args, signal, onUpdate) {
      const outcome = await ctx.executeTool(tool.name, args, {
        signal,
        onUpdate: onUpdate ? (partial) => onUpdate(readResult(partial)) : undefined,
      });
      return readResult({ ...outcome.result, isError: outcome.isError });
    },
  };
}

/** The host records nested usage on the outer message. Do not count it twice. */
function withoutNestedUsage(result: ToolResult): ToolResult {
  const { usage: _usage, ...rest } = result;
  return rest;
}

function rename(text: string): string {
  return text.replace(/\b(Agent|get_subagent_result|steer_subagent|SubagentWorkflow)\b/g,
    (name) => TOOL_ALIASES[name as keyof typeof TOOL_ALIASES]);
}

function renameSchemaDescriptions(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const schema = value as Record<string, unknown>;
  for (const [key, value] of Object.entries(schema)) {
    if ((key === "description" || key === "title") && typeof value === "string") schema[key] = rename(value);
    else renameSchemaDescriptions(value);
  }
}

const descriptions: Record<string, string> = {
  Agent: "Run one delegated task and wait for its result. Foreground only; background and scheduled requests are rejected. Do not duplicate delegated work.",
  get_subagent_result: "Read a subagent's status and result by ID or handle. Set wait to wait for completion and verbose for the conversation.",
  steer_subagent: "Send a steering message to a running subagent by ID or handle.",
  SubagentWorkflow: "Start a subagent workflow script in the background. Accepts inline source, a script path, a saved name, arguments and a previous run ID.",
};

/** Only metadata from the exact separate npm package is an eligible target. */
export function isPinnedSubagentsSource(path: string): boolean {
  let directory = dirname(path);
  for (;;) {
    try {
      const pkg: unknown = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
      return pkg !== null && typeof pkg === "object" && "name" in pkg && "version" in pkg && pkg.name === "@tintinweb/pi-subagents" && pkg.version === "0.19.0";
    } catch { /* walk to the package root */ }
    const parent = dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

export default function registerSubagentCompatibility(pi: ExtensionAPI): void {
  const compatibility = process.env.PI_TOOLING_SUBAGENTS_COMPAT;
  if (compatibility !== undefined && compatibility !== "1") return;

  const candidates = new Map<string, RegisteredTool>();
  const approved = new Set<string>();
  const aliasSchemas = new Map<string, TSchema>();
  let usageReader: RegisteredTool | undefined;
  let loadoutSupported = false;
  let executionUnsupported = false;
  let shutDown = false;
  const calls = new Set<AbortController>();

  function refreshRegisteredOriginals(loadout: ToolLoadout): void {
    // Registration survives deactivation. Cache the entire registered inventory,
    // not only callable tools or the original paired with this active hook.
    // Reconciliation below independently checks current activation and ownership.
    loadoutSupported = Array.isArray(loadout.callable);
    candidates.clear();
    for (const original of Object.keys(TOOL_ALIASES)) {
      const tool = loadout.registered.find((entry) => entry.name === original);
      if (tool && typeof tool.execute === "function") candidates.set(original, tool);
    }
    usageReader = candidates.get("get_subagent_result");
  }

  for (const [original, alias] of Object.entries(TOOL_ALIASES)) {
    const parameters = Type.Object({}, { additionalProperties: true });
    aliasSchemas.set(alias, parameters);
    const definition: ToolDefinition<TSchema, unknown> = {
      name: alias,
      label: alias,
      description: descriptions[original],
      parameters,
      prepareLoadout(loadout) {
        // callable is part of the nested-tool API. Metadata-only hosts must
        // leave originals visible, not enable raw-executor forwarding.
        refreshRegisteredOriginals(loadout);
        // A first-wins alias from another extension must never be changed here.
        if (loadout.registered.find((entry) => entry.name === alias)?.parameters !== parameters) {
          return {};
        }
        const tool = candidates.get(original);
        if (tool) {
          // Change our schema object in place, never the original definition.
          const schema = structuredClone(tool.parameters) as SchemaNode;
          renameSchemaDescriptions(schema);
          if (original === "Agent" && schema.properties?.run_in_background) {
            schema.properties.run_in_background.description = "Foreground only. Defaults to false. Explicit true is rejected before starting a child.";
            schema.properties.run_in_background.default = false;
          }
          if (original === "Agent" && schema.properties?.resume) schema.properties.resume.description = "Resume a settled child by ID and wait for its result. Use subagent_steer for a running child.";
          if (original === "Agent" && schema.properties?.schedule) schema.properties.schedule.description = "Not supported by foreground subagent. Omit this field.";
          for (const key of Reflect.ownKeys(parameters)) Reflect.deleteProperty(parameters, key);
          Object.assign(parameters, schema);
        }
        return {
          hiddenDeclarations: loadoutSupported && !executionUnsupported && approved.has(original) && candidates.has(original)
            && loadout.callable.some((entry) => entry.name === original) ? [original] : [],
          descriptions: { [alias]: descriptions[original] },
        };
      },
      async execute(id, rawArgs, signal, onUpdate, ctx) {
        const args = readArgs(rawArgs);
        const candidate = candidates.get(original);
        if (typeof ctx?.executeTool !== "function") {
          executionUnsupported = true;
          approved.clear();
          // No raw-executor fallback, even if the host advertised a modern
          // loadout shape. Withdraw owned aliases and unhide all originals.
          const all = pi.getAllTools();
          const ownedAliases = new Set([...aliasSchemas].filter(([name, schema]) => all.find((tool) => tool.name === name)?.parameters === schema).map(([name]) => name));
          pi.setActiveTools(pi.getActiveTools().filter((name) => !ownedAliases.has(name)));
          throw new Error(`${alias} requires ExtensionToolContext.executeTool.`);
        }
        if (shutDown || !approved.has(original) || !candidate) throw new Error(`${alias} is unavailable in this session.`);
        const tool = executable(candidate, ctx);
        // Controls and workflow retain their original execution semantics.
        if (original !== "Agent") {
          const result = await tool.execute(id, args, signal, onUpdate);
          if (original !== "SubagentWorkflow" || !result.details?.taskId) return withoutNestedUsage(result);
          return withoutNestedUsage({ ...result, content: result.content.map((item) => item.type === "text"
            ? { ...item, text: item.text.replace(/\nTo iterate, edit the script file and call SubagentWorkflow again with scriptPath\.$/, "\nTo iterate, edit the script file and call subagent_workflow again with scriptPath.") }
            : item) });
        }
        const controller = new AbortController();
        const abort = () => controller.abort(signal?.reason);
        if (signal?.aborted) abort();
        signal?.addEventListener("abort", abort, { once: true });
        calls.add(controller);
        try {
          return withoutNestedUsage(await executeVisibleSubagent(tool, id, args, controller.signal, onUpdate, pi.events, usageReader ? executable(usageReader, ctx) : undefined));
        } finally {
          signal?.removeEventListener("abort", abort);
          calls.delete(controller);
        }
      },
    };
    pi.registerTool(definition);
  }

  function reconcile(): void {
    const all = pi.getAllTools();
    const active = new Set(pi.getActiveTools());
    const reader = usageReader;
    approved.clear();
    for (const [original, alias] of Object.entries(TOOL_ALIASES)) {
      if (all.find((tool) => tool.name === alias)?.parameters !== aliasSchemas.get(alias)) continue;
      const current = all.find((tool) => tool.name === original);
      const source = current?.sourceInfo.path;
      // Respect upstream collision resolution and user-disabled originals.
      if (loadoutSupported && !executionUnsupported && candidates.has(original) && current?.parameters === candidates.get(original)?.parameters && source && isPinnedSubagentsSource(source)
        && (original !== "Agent" || reader && active.has(reader.name)
          && all.find((tool) => tool.name === reader.name)?.parameters === reader.parameters
          && isPinnedSubagentsSource(all.find((tool) => tool.name === reader.name)?.sourceInfo.path ?? ""))
        && active.has(original)) {
        approved.add(original);
        // Originals must stay active and callable for ctx.executeTool. Only
        // their declarations are hidden from provider requests by the hook.
        active.add(alias);
      } else active.delete(alias);
    }
    pi.setActiveTools([...active]);
  }

  pi.on("session_start", () => { shutDown = false; reconcile(); });
  pi.on("before_agent_start", () => { reconcile(); });
  pi.on("session_shutdown", () => {
    shutDown = true;
    approved.clear();
    candidates.clear();
    for (const controller of calls) controller.abort(new Error("Session shut down"));
  });
}
