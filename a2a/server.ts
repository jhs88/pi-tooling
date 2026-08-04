import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { loadA2AServerConfig, MAX_A2A_TASKS } from "./config.ts";
import {
  buildAgentCard,
  extractUserText,
  jsonRpcError,
  jsonRpcResult,
  taskFromExecution,
  type A2AMessage,
  type A2ATask,
  type JsonRpcId,
  type TaskState,
} from "./protocol.ts";

export interface A2AExecutionInput {
  taskId: string;
  contextId: string;
  messageId: string;
  message: string;
  signal: AbortSignal;
}

export interface A2AExecutionResult {
  state: TaskState;
  text: string;
}

export interface PiA2AServerOptions {
  host: string;
  port: number;
  bearerToken: string;
  maxBodyBytes: number;
  maxTasks: number;
  executionTimeoutMs: number;
  execute(input: A2AExecutionInput): Promise<A2AExecutionResult>;
}

export function createConfiguredPiA2AServer(
  execute: PiA2AServerOptions["execute"],
  env: Record<string, string | undefined> = process.env,
): PiA2AServer {
  return new PiA2AServer({ ...loadA2AServerConfig(env), execute });
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

class PayloadTooLargeError extends Error {}
class TaskCapacityError extends Error {}
class ExecutionTimeoutError extends Error {}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const MAX_BODY_BYTES = 1_048_576;

const TERMINAL_STATES = new Set<TaskState>([
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED",
]);

const EXECUTION_RESULT_STATES = new Set<TaskState>([
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_AUTH_REQUIRED",
  ...TERMINAL_STATES,
]);

const TASK_STATES = new Set<TaskState>([
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_AUTH_REQUIRED",
  ...TERMINAL_STATES,
]);

function asJsonRpcId(value: unknown): JsonRpcId {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function taskIdentifier(params: unknown): string | null {
  const values = objectValue(params);
  const candidate = values?.taskId ?? values?.id;
  if (
    typeof candidate !== "string"
    || candidate.length === 0
    || candidate.length > 200
    || !/^[A-Za-z0-9._:-]+$/.test(candidate)
  ) return null;
  return candidate;
}

function unauthorized(res: http.ServerResponse): void {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("WWW-Authenticate", "Bearer");
  res.writeHead(401);
  res.end(JSON.stringify({ error: "Unauthorized" }));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export class PiA2AServer {
  readonly #options: PiA2AServerOptions;
  readonly #expectedAuthorization: Buffer;
  readonly #tasks = new Map<string, A2ATask>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #executionSettlements = new Map<string, Promise<void>>();
  #server: http.Server | null = null;

  constructor(options: PiA2AServerOptions) {
    if (!LOOPBACK_HOSTS.has(options.host)) {
      throw new Error("host must be a loopback host in the first milestone");
    }
    if (!options.bearerToken.trim()) {
      throw new Error("bearerToken is required");
    }
    if (
      !Number.isSafeInteger(options.maxBodyBytes)
      || options.maxBodyBytes <= 0
      || options.maxBodyBytes > MAX_BODY_BYTES
    ) {
      throw new Error("maxBodyBytes must be a positive integer no greater than 1 MiB");
    }
    if (
      !Number.isSafeInteger(options.maxTasks)
      || options.maxTasks <= 0
      || options.maxTasks > MAX_A2A_TASKS
    ) {
      throw new Error(`maxTasks must be a positive integer no greater than ${MAX_A2A_TASKS}`);
    }
    if (!Number.isSafeInteger(options.executionTimeoutMs) || options.executionTimeoutMs <= 0) {
      throw new Error("executionTimeoutMs must be a positive integer");
    }
    this.#options = options;
    this.#expectedAuthorization = digest(`Bearer ${options.bearerToken}`);
  }

  async start(): Promise<void> {
    if (this.#server) throw new Error("A2A server is already running");
    const server = http.createServer((req, res) => {
      void this.#handleRequest(req, res);
    });
    this.#server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        this.#server = null;
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.#options.port, this.#options.host);
    });
  }

  address(): AddressInfo | string | null {
    return this.#server?.address() ?? null;
  }

  isRunning(): boolean {
    return this.#server?.listening ?? false;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    if (!server) return;
    const closing = new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const controller of this.#controllers.values()) controller.abort();
    await Promise.allSettled([...this.#executionSettlements.values()]);
    await closing;
    this.#server = null;
  }

  #isAuthenticated(req: http.IncomingMessage): boolean {
    const authorization = req.headers.authorization;
    if (!authorization) return false;
    return timingSafeEqual(digest(authorization), this.#expectedAuthorization);
  }

  #interfaceUrl(): string {
    const address = this.address();
    if (!address || typeof address === "string") {
      throw new Error("A2A server has no TCP address");
    }
    const host = address.address === "::1" ? "[::1]" : address.address;
    return `http://${host}:${address.port}`;
  }

  async #handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      if (!this.#isAuthenticated(req)) {
        unauthorized(res);
        return;
      }

      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (
        req.method === "GET"
        && (
          path === "/.well-known/agent-card.json"
          || path === "/.well-known/agent-card"
          || path === "/.well-known/agent.json"
        )
      ) {
        this.#sendJson(res, 200, buildAgentCard({ interfaceUrl: this.#interfaceUrl() }));
        return;
      }

      if (req.method !== "POST" || path !== "/") {
        this.#sendJson(res, 404, { error: "Not Found" });
        return;
      }

      let body: string;
      try {
        body = await this.#readBody(req);
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          res.shouldKeepAlive = false;
          res.setHeader("Connection", "close");
          this.#sendJson(res, 413, { error: "Payload Too Large" });
          return;
        }
        throw error;
      }

      let request: JsonRpcRequest;
      try {
        request = objectValue(JSON.parse(body)) ?? {};
      } catch {
        this.#sendJson(res, 200, jsonRpcError(null, -32700, "Parse error"));
        return;
      }

      if (
        request.jsonrpc === "2.0"
        && request.method === "SendMessage"
        && this.#controllers.size >= 1
      ) {
        this.#sendJson(
          res,
          429,
          jsonRpcError(asJsonRpcId(request.id), -32051, "A2A server is busy"),
        );
        return;
      }

      const caller = new AbortController();
      const onDisconnect = () => {
        if (!res.writableEnded) caller.abort(new Error("A2A client disconnected"));
      };
      res.once("close", onDisconnect);
      let response: unknown;
      try {
        response = await this.#dispatch(request, caller.signal);
      } finally {
        res.removeListener("close", onDisconnect);
      }
      if (!res.destroyed) this.#sendJson(res, 200, response);
    } catch {
      if (!res.headersSent) {
        this.#sendJson(res, 500, { error: "Internal Server Error" });
      } else {
        res.end();
      }
    }
  }

  async #dispatch(request: JsonRpcRequest, callerSignal?: AbortSignal) {
    const id = asJsonRpcId(request.id);
    if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
      return jsonRpcError(id, -32600, "Invalid Request");
    }

    switch (request.method) {
      case "SendMessage":
        return this.#sendMessage(id, request.params, callerSignal);
      case "GetTask":
        return this.#getTask(id, request.params);
      case "ListTasks":
        return this.#listTasks(id, request.params);
      case "CancelTask":
        return this.#cancelTask(id, request.params);
      default:
        return jsonRpcError(id, -32601, "Method not found");
    }
  }

  async #sendMessage(
    id: JsonRpcId,
    params: unknown,
    callerSignal?: AbortSignal,
  ) {
    const message = objectValue(params)?.message as A2AMessage | undefined;
    let extracted: ReturnType<typeof extractUserText>;
    try {
      extracted = extractUserText(message ?? {});
    } catch (error) {
      return jsonRpcError(
        id,
        -32602,
        error instanceof Error ? error.message : "Invalid params",
      );
    }

    let taskId: string;
    let contextId: string;
    if (extracted.taskId) {
      const referenced = this.#tasks.get(extracted.taskId);
      if (!referenced) return jsonRpcError(id, -32001, "Task not found");
      if (extracted.contextId && extracted.contextId !== referenced.contextId) {
        return jsonRpcError(id, -32602, "taskId and contextId do not match");
      }
      if (TERMINAL_STATES.has(referenced.status.state)) {
        return jsonRpcError(id, -32004, "Task cannot be continued");
      }
      taskId = referenced.id;
      contextId = referenced.contextId;
    } else {
      taskId = `task-${randomUUID()}`;
      contextId = extracted.contextId ?? `ctx-${randomUUID()}`;
    }
    const controller = new AbortController();
    const workingTask = taskFromExecution({
      taskId,
      contextId,
      text: "",
      state: "TASK_STATE_WORKING",
    });
    try {
      this.#rememberTask(workingTask);
    } catch (error) {
      if (error instanceof TaskCapacityError) {
        return jsonRpcError(id, -32050, "Task capacity reached");
      }
      throw error;
    }
    this.#controllers.set(taskId, controller);
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) onCallerAbort();
    else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    let executionTimeout: NodeJS.Timeout | undefined;
    let onExecutionAbort!: () => void;
    const executionAbortPromise = new Promise<never>((_, reject) => {
      onExecutionAbort = () => {
        reject(
          controller.signal.reason instanceof Error
            ? controller.signal.reason
            : new Error("execution canceled"),
        );
      };
      controller.signal.addEventListener("abort", onExecutionAbort, { once: true });
      const timeout = new ExecutionTimeoutError("execution timed out");
      executionTimeout = setTimeout(() => {
        controller.abort(timeout);
      }, this.#options.executionTimeoutMs);
      executionTimeout.unref();
    });

    let requestSettled = false;
    let executorSettled = false;
    const releaseExecution = () => {
      this.#controllers.delete(taskId);
      this.#executionSettlements.delete(taskId);
    };
    const executionPromise = Promise.resolve().then(() => this.#options.execute({
      taskId,
      contextId,
      messageId: extracted.messageId,
      message: extracted.text,
      signal: controller.signal,
    }));
    const trackedExecution = executionPromise.finally(() => {
      executorSettled = true;
      if (requestSettled) releaseExecution();
    });
    this.#executionSettlements.set(
      taskId,
      trackedExecution.then(() => undefined, () => undefined),
    );

    let finalTask: A2ATask;
    try {
      const execution = await Promise.race([
        trackedExecution,
        executionAbortPromise,
      ]);
      if (!EXECUTION_RESULT_STATES.has(execution.state)) {
        throw new Error("executor must return a terminal task state");
      }
      const timedOut = controller.signal.reason instanceof ExecutionTimeoutError;
      finalTask = taskFromExecution({
        taskId,
        contextId,
        text: timedOut ? "execution timed out"
          : controller.signal.aborted ? "canceled"
          : execution.text,
        state: timedOut ? "TASK_STATE_FAILED"
          : controller.signal.aborted ? "TASK_STATE_CANCELED"
          : execution.state,
      });
    } catch (error) {
      const timedOut = controller.signal.reason instanceof ExecutionTimeoutError;
      finalTask = taskFromExecution({
        taskId,
        contextId,
        text: timedOut
          ? "execution timed out"
          : controller.signal.aborted ? "canceled"
          : error instanceof Error ? error.message : "Pi execution failed",
        state: timedOut ? "TASK_STATE_FAILED"
          : controller.signal.aborted ? "TASK_STATE_CANCELED"
          : "TASK_STATE_FAILED",
      });
    } finally {
      if (executionTimeout) clearTimeout(executionTimeout);
      controller.signal.removeEventListener("abort", onExecutionAbort);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }

    this.#tasks.set(taskId, finalTask);
    requestSettled = true;
    if (executorSettled) releaseExecution();
    return jsonRpcResult(id, { task: finalTask });
  }

  #getTask(id: JsonRpcId, params: unknown) {
    const requestedId = taskIdentifier(params);
    if (!requestedId) return jsonRpcError(id, -32602, "Task id is required");
    const task = this.#tasks.get(requestedId);
    return task
      ? jsonRpcResult(id, task)
      : jsonRpcError(id, -32001, "Task not found");
  }

  #listTasks(id: JsonRpcId, params: unknown) {
    const values = objectValue(params) ?? {};
    const pageSize = values.pageSize === undefined ? 50 : values.pageSize;
    if (
      !Number.isSafeInteger(pageSize)
      || (pageSize as number) < 1
      || (pageSize as number) > 100
    ) return jsonRpcError(id, -32602, "pageSize must be an integer from 1 to 100");
    if (
      values.contextId !== undefined
      && (
        typeof values.contextId !== "string"
        || values.contextId.length === 0
        || values.contextId.length > 200
        || !/^[A-Za-z0-9._:-]+$/.test(values.contextId)
      )
    ) return jsonRpcError(id, -32602, "contextId is invalid");
    if (
      values.status !== undefined
      && !TASK_STATES.has(values.status as TaskState)
    ) return jsonRpcError(id, -32602, "status is invalid");
    const after = values.statusTimestampAfter === undefined
      ? undefined
      : typeof values.statusTimestampAfter === "string"
        ? Date.parse(values.statusTimestampAfter)
        : Number.NaN;
    if (after !== undefined && !Number.isFinite(after)) {
      return jsonRpcError(id, -32602, "statusTimestampAfter is invalid");
    }
    if (values.includeArtifacts !== undefined && typeof values.includeArtifacts !== "boolean") {
      return jsonRpcError(id, -32602, "includeArtifacts must be boolean");
    }

    const matching = [...this.#tasks.values()]
      .filter((task) => values.contextId === undefined || task.contextId === values.contextId)
      .filter((task) => values.status === undefined || task.status.state === values.status)
      .filter((task) => after === undefined || Date.parse(task.status.timestamp) >= after)
      .sort((left, right) => (
        right.status.timestamp.localeCompare(left.status.timestamp)
        || right.id.localeCompare(left.id)
      ));
    let start = 0;
    if (values.pageToken !== undefined && values.pageToken !== "") {
      if (typeof values.pageToken !== "string") {
        return jsonRpcError(id, -32602, "pageToken is invalid");
      }
      let cursor: unknown;
      try {
        cursor = JSON.parse(Buffer.from(values.pageToken, "base64url").toString("utf8"));
      } catch {
        return jsonRpcError(id, -32602, "pageToken is invalid");
      }
      if (
        !Array.isArray(cursor)
        || cursor.length !== 2
        || cursor.some((value) => typeof value !== "string")
      ) return jsonRpcError(id, -32602, "pageToken is invalid");
      const cursorIndex = matching.findIndex((task) => (
        task.status.timestamp === cursor[0] && task.id === cursor[1]
      ));
      if (cursorIndex < 0) return jsonRpcError(id, -32602, "pageToken is stale");
      start = cursorIndex + 1;
    }
    const page = matching.slice(start, start + (pageSize as number));
    const hasMore = start + page.length < matching.length;
    const last = page.at(-1);
    const tasks = page.map((task) => values.includeArtifacts
      ? task
      : (({ artifacts: _artifacts, ...withoutArtifacts }) => withoutArtifacts)(task));
    return jsonRpcResult(id, {
      tasks,
      nextPageToken: hasMore && last
        ? Buffer.from(JSON.stringify([last.status.timestamp, last.id])).toString("base64url")
        : "",
      pageSize,
      totalSize: matching.length,
    });
  }

  #cancelTask(id: JsonRpcId, params: unknown) {
    const requestedId = taskIdentifier(params);
    if (!requestedId) return jsonRpcError(id, -32602, "Task id is required");
    const task = this.#tasks.get(requestedId);
    if (!task) return jsonRpcError(id, -32001, "Task not found");
    if (TERMINAL_STATES.has(task.status.state)) {
      return jsonRpcError(id, -32002, "Task is not cancelable");
    }

    const controller = this.#controllers.get(requestedId);
    if (controller && !controller.signal.aborted) controller.abort();
    const canceled = taskFromExecution({
      taskId: task.id,
      contextId: task.contextId,
      text: "canceled",
      state: "TASK_STATE_CANCELED",
    });
    this.#tasks.set(requestedId, canceled);
    return jsonRpcResult(id, canceled);
  }

  #rememberTask(task: A2ATask): void {
    if (this.#tasks.has(task.id)) {
      this.#tasks.set(task.id, task);
      return;
    }
    if (this.#tasks.size >= this.#options.maxTasks) {
      const evictable = [...this.#tasks.entries()]
        .find(([, candidate]) => TERMINAL_STATES.has(candidate.status.state));
      if (!evictable) throw new TaskCapacityError("all retained tasks are active");
      this.#tasks.delete(evictable[0]);
    }
    this.#tasks.set(task.id, task);
  }

  #readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const onData = (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > this.#options.maxBodyBytes) {
          chunks.length = 0;
          req.removeListener("data", onData);
          req.removeListener("end", onEnd);
          req.resume();
          reject(new PayloadTooLargeError("request body exceeds limit"));
          return;
        }
        chunks.push(buffer);
      };
      const onEnd = () => resolve(Buffer.concat(chunks).toString("utf8"));
      req.on("data", onData);
      req.on("end", onEnd);
      req.on("error", reject);
    });
  }

  #sendJson(res: http.ServerResponse, status: number, value: unknown): void {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(status);
    res.end(JSON.stringify(value));
  }
}
