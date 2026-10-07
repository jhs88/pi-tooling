import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { TSchema } from "typebox";

import type { AgentToolResult, AgentToolUpdateCallback, EventBus } from "@earendil-works/pi-coding-agent";
import type { TextContent, Usage } from "@earendil-works/pi-ai";

export interface SubagentArgs extends Record<string, unknown> {
  subagent_type?: string;
  prompt?: string;
  model?: string;
  resume?: string;
  run_in_background?: boolean;
  schedule?: string;
}
interface ChildMessage { role: "assistant"; content: TextContent[] }
interface ChildResult {
  agent?: string;
  task?: string;
  model?: string;
  step: number;
  messages: ChildMessage[];
  finished: boolean;
  exitCode?: number;
  stopReason?: "stop" | "error" | "aborted";
  errorMessage?: string;
  stderr: string;
}
export interface SubagentDetails extends Record<string, unknown> {
  status?: string;
  activity?: string;
  agentId?: string;
  subagentType?: string;
  modelName?: string;
  error?: string;
  taskId?: string;
  results?: ChildResult[];
}
export type ToolResult = AgentToolResult<SubagentDetails>;
export interface ExecutableTool {
  name: string;
  description: string;
  parameters: TSchema;
  execute(id: string, args: SubagentArgs, signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback<SubagentDetails>): Promise<ToolResult>;
}
interface RecordView {
  id: string;
  type: string;
  status: string;
  session?: { subscribe?(handler: (event: unknown) => void): () => void };
  abortController?: AbortController;
  promise?: Promise<unknown>;
}
interface Registry { getRecord(id: string): unknown }

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function optionalStrings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => value[key] === undefined || typeof value[key] === "string");
}
export function readArgs(value: unknown): SubagentArgs {
  if (!object(value) || !optionalStrings(value, ["subagent_type", "prompt", "model", "resume", "schedule"])
    || value.run_in_background !== undefined && typeof value.run_in_background !== "boolean") {
    throw new Error("Invalid subagent arguments.");
  }
  return value as SubagentArgs;
}
export function readResult(value: AgentToolResult<unknown>): ToolResult {
  const details = value.details ?? {};
  if (!object(details) || !optionalStrings(details, ["status", "activity", "agentId", "subagentType", "modelName", "error", "taskId"])) {
    throw new Error("Invalid pinned subagent result details.");
  }
  return { ...value, details: details as SubagentDetails };
}
function registry(): Registry | undefined {
  const value: unknown = (globalThis as Record<symbol, unknown>)[Symbol.for("pi-subagents:manager")];
  return object(value) && typeof value.getRecord === "function" ? value as unknown as Registry : undefined;
}
function getRecord(id: string): RecordView | undefined {
  const value = registry()?.getRecord(id);
  if (value === undefined) return undefined;
  if (!object(value) || typeof value.id !== "string" || typeof value.type !== "string" || typeof value.status !== "string"
    || value.session !== undefined && (!object(value.session) || value.session.subscribe !== undefined && typeof value.session.subscribe !== "function")
    || value.abortController !== undefined && !(value.abortController instanceof AbortController)
    || value.promise !== undefined && !(value.promise instanceof Promise)) throw new Error("Invalid pinned subagent record.");
  return value as unknown as RecordView;
}
function eventActivity(event: unknown): string | undefined {
  if (!object(event)) return undefined;
  if (object(event.message) && event.message.role === "assistant" && Array.isArray(event.message.content)) {
    return event.message.content.filter((item: unknown): item is TextContent => object(item) && item.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n");
  }
  if (event.type === "tool_execution_start" && typeof event.toolName === "string") return `Running ${event.toolName}`;
  return undefined;
}

/** Sum only drained deltas; never attach a record's cumulative lifetime usage. */
function sumUsage(first: Usage | undefined, second: Usage | undefined): Usage | undefined {
  if (!first) return second;
  if (!second) return first;
  return {
    input: first.input + second.input, output: first.output + second.output,
    cacheRead: first.cacheRead + second.cacheRead, cacheWrite: first.cacheWrite + second.cacheWrite,
    totalTokens: first.totalTokens + second.totalTokens,
    cost: { input: first.cost.input + second.cost.input, output: first.cost.output + second.cost.output,
      cacheRead: first.cost.cacheRead + second.cost.cacheRead, cacheWrite: first.cost.cacheWrite + second.cost.cacheWrite,
      total: first.cost.total + second.cost.total },
  };
}
const terminal = new Set(["completed", "steered", "aborted", "stopped", "error"]);
const failed = new Set(["error", "aborted", "stopped"]);

function textMessage(text: string): ChildMessage[] {
  return text ? [{ role: "assistant", content: [{ type: "text", text }] }] : [];
}

/** Normalize only this call's real upstream activity and targeted child output. */
function normalize(result: ToolResult, args: SubagentArgs, finished: boolean, record?: RecordView): ToolResult {
  const details = result.details ?? {};
  const status = finished ? record?.status ?? details.status : details.status;
  // Rewrite only the pinned control rejection in full, with the caller's
  // resume ID intact. Arbitrary outputs, errors and type names are not prose
  // to translate. A rejection did not create a child lifecycle.
  if (!status) {
    if (!args.resume || details.agentId) return result;
    const guidance = "Use steer_subagent to send it a message mid-run, or get_subagent_result to wait for it.";
    const expected = ["running", "queued"].map((state) => `Agent "${args.resume}" is still ${state} — it can only be resumed once its current run finishes.\n${guidance}`);
    return { ...result, content: result.content.map((item) => item.type === "text" && expected.includes(item.text)
      ? { ...item, text: item.text.slice(0, -guidance.length) + "Use subagent_steer to send it a message mid-run, or subagent_result to wait for it." }
      : item) };
  }
  if (finished && !terminal.has(status)) throw new Error(`Child returned non-terminal status: ${status}`);
  const isFailure = finished && (failed.has(status) || result.isError === true);
  const output = finished
    ? result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n")
    : details.activity ?? "";
  return {
    ...result,
    ...(finished ? { isError: result.isError === true || isFailure } : {}),
    details: {
      ...details,
      results: [{
        agent: details.subagentType ?? args.subagent_type,
        task: args.prompt,
        model: details.modelName ?? args.model,
        step: 0,
        messages: textMessage(output),
        finished,
        ...(finished ? { exitCode: isFailure ? 1 : 0, stopReason: isFailure ? status === "aborted" || status === "stopped" ? "aborted" : "error" : "stop" } : {}),
        errorMessage: details.error,
        stderr: details.error ?? "",
      }],
    },
  };
}

/** Reuse the pinned original tool, keeping its call open through child termination. */
export async function executeVisibleSubagent(
  tool: ExecutableTool,
  id: string,
  args: SubagentArgs,
  signal: AbortSignal | undefined,
  onUpdate: ((result: ToolResult) => void) | undefined,
  events: EventBus,
  usageReader?: ExecutableTool,
): Promise<ToolResult> {
  if (args.run_in_background === true) throw new Error("subagent is foreground-only; run_in_background: true is not supported.");
  if (args.schedule) throw new Error("subagent is foreground-only; scheduled execution is not supported.");
  if (signal?.aborted) throw signal.reason ?? new Error("Subagent cancelled");
  const controller = new AbortController();
  let childId: string | undefined;
  let updateError: unknown;
  let childRecord: RecordView | undefined;
  let subscribedSession: RecordView["session"];
  let unsubscribeSession: (() => void) | undefined;
  let liveActivity = "";
  const owned = () => childId ? getRecord(childId) : undefined;
  const emit = (event: string, data: unknown) => {
    // A broken third-party bus listener must not skip targeted cancellation or
    // prevent our finally block from releasing the other subscriptions.
    try { events.emit(event, data); } catch { /* targeted abort remains available */ }
  };
  const consume = () => {
    if (childId) emit("subagents:rpc:consume", { requestId: randomUUID(), agentId: childId });
  };
  const abort = () => {
    controller.abort(signal?.reason ?? updateError);
    const record = owned();
    if (childId && (!record || !terminal.has(record.status))) {
      emit("subagents:rpc:stop", { requestId: randomUUID(), agentId: childId });
      // The exact pinned registry exposes a targeted record. Never abortAll or
      // waitForAll: other tools and workflows may own simultaneous children.
      record?.abortController?.abort();
    }
  };
  const forward = (result: ToolResult) => {
    if (updateError) return;
    try { onUpdate?.(result); }
    catch (error) { updateError = error; abort(); }
  };
  const subscribe = (record: RecordView, base: ToolResult) => {
    if (!record.session || record.session === subscribedSession) return;
    unsubscribeSession?.();
    subscribedSession = record.session;
    unsubscribeSession = record.session.subscribe?.((event) => {
      const activity = eventActivity(event);
      if (activity === undefined) return;
      liveActivity = activity;
      // Subscription is scoped to a settled resume or the returned spawn id.
      // The event proves child activity; never borrow another agent's state.
      childId = record.id;
      forward(normalize({ ...base, content: [{ type: "text", text: liveActivity }], details: { ...base.details, status: "running", activity: liveActivity } }, args, false));
    });
  };
  // Effective background mode can come from agent frontmatter, which outranks
  // caller params. Consume synchronously on settle, before upstream schedules
  // its follow-up, and join below rather than returning the detached receipt.
  const settled = (data: unknown) => {
    if (object(data) && data.id === childId) consume();
  };
  const unsubscribe: (() => void)[] = [];
  try {
    unsubscribe.push(events.on("subagents:completed", settled));
    unsubscribe.push(events.on("subagents:failed", settled));
    signal?.addEventListener("abort", abort, { once: true });
    const resumeRecord = args.resume ? getRecord(args.resume) : undefined;
    if (resumeRecord && terminal.has(resumeRecord.status)) {
      subscribe(resumeRecord, { content: [], details: { subagentType: resumeRecord.type, agentId: resumeRecord.id } });
    }
    const result = await tool.execute(id, { ...args, run_in_background: false }, controller.signal,
      (partial) => forward(normalize(readResult(partial), args, false)));
    // Permission and validation failures are outcomes, not promise rejections.
    // Do not join or fabricate a child lifecycle for a denied call.
    if (result.isError && !result.details?.agentId) return result;
    childId = result.details?.agentId ?? childId;
    const status = result.details?.status;
    if (status === "background" || status === "queued" || status === "running") {
      childRecord = owned();
      if (!childRecord) throw new Error("Cannot join child: pinned manager record is unavailable.");
      if (controller.signal.aborted) abort();
      while (!terminal.has(childRecord.status)) {
        subscribe(childRecord, result);
        forward(normalize({ ...result, content: [{ type: "text", text: liveActivity }], details: { ...result.details, status: childRecord.status, activity: liveActivity } }, args, false));
        await delay(80);
      }
      // Pinned abort() marks the record stopped synchronously. Its prompt may
      // still be unwinding; wait on this child only before ending the tool.
      if (childRecord.promise) await childRecord.promise.catch(() => {});
      consume();
      if (updateError) throw updateError;
      // The background receipt drained the pool before this child completed.
      // A targeted read through ctx.executeTool drains only the
      // still-pending deltas, with upstream's reportUsage gate and shared-pool
      // accounting intact, including the result tool's permission hooks.
      // This is a settled, non-waiting accounting read. After cancellation,
      // allow it to finish with a fresh signal, but never skip its hooks.
      if (!usageReader) throw new Error("Cannot join child: pipeline result reader is unavailable.");
      const drained = await usageReader.execute(id, { agent_id: childRecord.id, wait: false, verbose: false }, controller.signal.aborted ? new AbortController().signal : controller.signal);
      if (drained.isError) return drained;
      const usage = sumUsage(result.usage, drained.usage);
      const final: ToolResult = {
        // The latest pipeline outcome owns both content and metadata. Neither
        // private registry output nor receipt details may undo result hooks.
        ...drained,
        ...(usage ? { usage } : {}),
      };
      return normalize(final, args, true, childRecord);
    }
    if (updateError) throw updateError;
    childRecord = owned();
    return normalize(result, args, true, childRecord);
  } catch (error) {
    abort();
    const record = childRecord ?? owned();
    if (record?.promise) await record.promise.catch(() => {});
    throw error;
  } finally {
    try { unsubscribeSession?.(); } catch { /* release the remaining listeners too */ }
    signal?.removeEventListener("abort", abort);
    for (const off of unsubscribe) { try { off(); } catch { /* independent cleanup */ } }
  }
}
