import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import { PromptPreview } from "./preview.ts";
import { RequestTracker } from "./request.ts";

export type PromptTool = Pick<ToolInfo, "name" | "description" | "parameters">;

/** Estimate the configured prompt without including conversation messages. */
export function estimatePromptTokens(
  systemPrompt: string,
  tools: readonly PromptTool[],
): {
  systemTokens: number;
  toolTokens: number;
  toolCount: number;
  totalTokens: number;
} {
  const systemTokens = Math.ceil(systemPrompt.length / 4);
  const toolTokens = tools.reduce(
    (total, { name, description, parameters }) =>
      total +
      Math.ceil(JSON.stringify({ name, description, parameters }).length / 4),
    0,
  );
  return {
    systemTokens,
    toolTokens,
    toolCount: tools.length,
    totalTokens: systemTokens + toolTokens,
  };
}

/** Display only the prompt inputs counted by the estimate, never history. */
export function formatPromptPreview(
  report: string,
  systemPrompt: string,
  tools: readonly PromptTool[],
  observedStartup?: string,
): string {
  return [
    report,
    ...(observedStartup
      ? ["", "=== First observed provider startup ===", observedStartup]
      : []),
    "",
    "=== System prompt ===",
    systemPrompt,
    "",
    "=== Active tool schemas, registered metadata ===",
    tools.length > 0
      ? JSON.stringify(
          tools.map(({ name, description, parameters }) => ({
            name,
            description,
            parameters,
          })),
          null,
          2,
        )
      : "No active tool schemas.",
  ].join("\n");
}

/** Register a local estimate command, not another model-facing tool. */
export default function registerPromptTokens(pi: ExtensionAPI): void {
  const requests = new RequestTracker();
  pi.on("session_start", () => {
    requests.reset();
  });
  pi.on("session_tree", () => {
    requests.reset();
  });
  pi.on("model_select", () => {
    requests.reset();
  });
  pi.on("turn_start", (_event, ctx) => {
    requests.begin(
      ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown model",
    );
  });
  pi.on("turn_end", () => {
    requests.end();
  });
  pi.on("agent_end", () => {
    requests.end();
  });
  pi.on("before_provider_request", (event) => {
    // Returning anything here would replace the outgoing payload.
    requests.observe(event.payload);
  });
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") requests.response(event.message);
  });

  pi.registerCommand("prompt-tokens", {
    description: "Estimate prompt tokens; use preview to inspect the prompt",
    getArgumentCompletions: (prefix) =>
      "preview".startsWith(prefix)
        ? [
            {
              value: "preview",
              label: "preview",
              description: "Open prompt preview",
            },
          ]
        : null,
    handler: async (args, ctx) => {
      const action = args.trim();
      if (action !== "" && action !== "preview") {
        const usage = "Usage: /prompt-tokens [preview]";
        if (ctx.hasUI) ctx.ui.notify(usage, "warning");
        else console.log(usage);
        return;
      }
      const active = new Set(pi.getActiveTools());
      // Older hosts do not expose prompt construction options.
      const hidden = new Set(ctx.getSystemPromptOptions?.().hiddenTools ?? []);
      const tools = pi
        .getAllTools()
        .filter(
          (tool) =>
            active.has(tool.name) &&
            !hidden.has(tool.name) &&
            tool.exposure !== "hidden",
        );
      const systemPrompt = ctx.getSystemPrompt();
      const estimate = estimatePromptTokens(systemPrompt, tools);
      const number = (value: number): string => value.toLocaleString("en-US");
      const first = requests.first?.estimate;
      const latest = requests.latest;
      const observed = latest?.estimate;
      const contextTokens = ctx.getContextUsage?.()?.tokens;
      const report = [
        `Configured prompt estimate: ~${number(estimate.totalTokens)} tokens, local fallback`,
        `System prompt: ~${number(estimate.systemTokens)} tokens`,
        `Active tool schemas: ~${number(estimate.toolTokens)} tokens across ${estimate.toolCount} tools`,
        "Local fallback uses registered metadata, before loadout description rewrites.",
        "",
        first
          ? `First observed startup: ~${number(first.startupTokens)} tokens, ${requests.first?.model}`
          : "First observed startup: pending a normal request with a supported payload.",
        ...(latest
          ? [
              `Latest observed request: ${latest.model}${latest.outcome ? `, ${latest.outcome}` : ""}`,
              ...(observed
                ? [
                    `Startup prompt/tools: ~${number(observed.startupTokens)} tokens`,
                    `Messages/history delta: ~${number(observed.conversationTokens)} tokens`,
                    `Combined provider input JSON: ~${number(observed.totalTokens)} tokens`,
                    `Visible JSON structure proxy: ~${number(observed.structureTokens)} tokens, already included above`,
                    ...(observed.mediaOmitted
                      ? [
                          "Text-only estimate: media token costs are not inferred from binary/base64 data.",
                        ]
                      : []),
                    ...(observed.continuation
                      ? [
                          "Continuation payload: observed input may omit server-retained context.",
                        ]
                      : []),
                  ]
                : [
                    "Provider input estimate unavailable: payload not observed or unsupported.",
                  ]),
              latest.reportedInputTokens !== undefined
                ? `Provider-reported input total: ${number(latest.reportedInputTokens)} tokens, including cache reads/writes; output excluded`
                : "Provider-reported input total: unavailable until a response reports nonzero usage.",
            ]
          : [
              "Full request estimate: pending your next normal request. No extra request is made.",
            ]),
        typeof contextTokens === "number" &&
        Number.isFinite(contextTokens) &&
        contextTokens > 0
          ? `Current session context estimate from Pi: ~${number(contextTokens)} tokens, includes trailing messages`
          : "Current session context estimate from Pi: unavailable.",
        "",
        "Estimates use 4 characters per token, not a model tokenizer. Provider-reported usage is shown separately.",
        "Observed input includes rewritten tool descriptions, extension additions, and messages/history present at this hook.",
        "JSON structure is a proxy, not a measurement of provider-internal framing. Only reported usage can include invisible overhead.",
        "Later-loaded hooks and transport continuation changes can still alter the request. Load this extension last for the closest view.",
        "First observed startup is since load/model change/tree navigation, not an archived original session prompt. It excludes messages/history.",
        "Preview retains startup fields only, not conversation bodies. Nothing is sent, logged, or written by this command.",
      ].join("\n");
      if (action === "preview") {
        if (ctx.mode !== "tui") {
          const message = "Prompt preview requires Pi's terminal UI.";
          if (ctx.hasUI) ctx.ui.notify(message, "warning");
          else console.log(message);
          return;
        }
        const preview = formatPromptPreview(
          report,
          systemPrompt,
          tools,
          first?.startupPreview,
        );
        await ctx.ui.custom<void>(
          (tui, theme, keys, done) =>
            new PromptPreview(
              preview,
              theme,
              keys,
              () => tui.terminal.rows,
              () => tui.requestRender(),
              () => done(),
            ),
          { overlay: true, overlayOptions: { width: "90%", maxHeight: "80%" } },
        );
        return;
      }
      if (ctx.hasUI) ctx.ui.notify(report, "info");
      else console.log(report);
    },
  });
}
