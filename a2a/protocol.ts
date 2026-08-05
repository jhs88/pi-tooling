export type JsonRpcId = string | number | null;

export type TaskState =
  | "TASK_STATE_SUBMITTED"
  | "TASK_STATE_WORKING"
  | "TASK_STATE_INPUT_REQUIRED"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_FAILED"
  | "TASK_STATE_CANCELED"
  | "TASK_STATE_REJECTED"
  | "TASK_STATE_AUTH_REQUIRED";

export const MAX_A2A_TASK_TEXT_BYTES = 65_536;
const TASK_TEXT_TRUNCATION_NOTICE =
  "\n\n[Output truncated for A2A transport; the full response remains in the canonical Pi session.]";

export interface TextPart {
  text: string;
  mediaType?: string;
}

export interface A2AMessage {
  messageId?: string;
  contextId?: string;
  taskId?: string;
  role?: string;
  parts?: Array<Record<string, unknown>>;
}

export interface A2ATask {
  id: string;
  contextId: string;
  status: {
    state: TaskState;
    timestamp: string;
    message?: {
      messageId: string;
      contextId: string;
      taskId: string;
      role: "ROLE_AGENT";
      parts: TextPart[];
    };
  };
  artifacts: Array<{
    artifactId: string;
    name: string;
    parts: TextPart[];
  }>;
}

export interface AgentCardOptions {
  interfaceUrl: string;
}

export function buildAgentCard({ interfaceUrl }: AgentCardOptions) {
  return {
    name: "pi-coding-agent",
    description: "Pi coding agent exposed through an authenticated A2A v1.0 interface",
    version: "0.1.0",
    supportedInterfaces: [{
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
      url: interfaceUrl,
    }],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain", "text/markdown"],
    skills: [
      {
        id: "code",
        name: "Code",
        description: "Perform bounded coding and code-review tasks in the configured workspace",
        tags: ["code", "review"],
      },
    ],
    securitySchemes: {
      bearer: {
        type: "http",
        scheme: "bearer",
      },
    },
    security: [{ bearer: [] }],
  };
}

function boundedIdentifier(name: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    throw new Error(`${name} must be a non-empty string no longer than 200 characters`);
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new Error(`${name} contains unsupported characters`);
  }
  return value;
}

export function extractUserText(message: A2AMessage) {
  if (message.role !== "ROLE_USER") {
    throw new Error("message role must be ROLE_USER");
  }
  const contextId = message.contextId === undefined
    ? undefined
    : boundedIdentifier("contextId", message.contextId);
  const taskId = message.taskId === undefined
    ? undefined
    : boundedIdentifier("taskId", message.taskId);
  const messageId = boundedIdentifier("messageId", message.messageId);
  const text = (message.parts ?? [])
    .filter((part): part is Record<string, unknown> & { text: string } => (
      typeof part.text === "string" && part.text.length > 0
    ))
    .map((part) => part.text)
    .join("\n");
  if (!text) {
    throw new Error("message must contain at least one non-empty text part");
  }
  return {
    ...(contextId ? { contextId } : {}),
    ...(taskId ? { taskId } : {}),
    messageId,
    text,
  };
}

function boundedTaskText(text: string): string {
  const encoded = Buffer.from(text, "utf8");
  if (encoded.length <= MAX_A2A_TASK_TEXT_BYTES) return text;
  const noticeBytes = Buffer.byteLength(TASK_TEXT_TRUNCATION_NOTICE, "utf8");
  let end = MAX_A2A_TASK_TEXT_BYTES - noticeBytes;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end--;
  return `${encoded.subarray(0, end).toString("utf8")}${TASK_TEXT_TRUNCATION_NOTICE}`;
}

export function taskFromExecution(options: {
  taskId: string;
  contextId: string;
  text: string;
  state: TaskState;
}): A2ATask {
  const timestamp = new Date().toISOString();
  const textPart: TextPart = {
    text: boundedTaskText(options.text),
    mediaType: "text/plain",
  };
  return {
    id: options.taskId,
    contextId: options.contextId,
    status: {
      state: options.state,
      timestamp,
      ...(
        options.state === "TASK_STATE_INPUT_REQUIRED"
        || options.state === "TASK_STATE_FAILED"
        || options.state === "TASK_STATE_CANCELED"
        || options.state === "TASK_STATE_REJECTED"
        || options.state === "TASK_STATE_AUTH_REQUIRED"
          ? {
              message: {
                messageId: `${options.taskId}-status`,
                contextId: options.contextId,
                taskId: options.taskId,
                role: "ROLE_AGENT" as const,
                parts: [textPart],
              },
            }
          : {}
      ),
    },
    artifacts: options.state === "TASK_STATE_COMPLETED"
      ? [{
          artifactId: `${options.taskId}-result`,
          name: "result",
          parts: [textPart],
        }]
      : [],
  };
}

export function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

export function jsonRpcError(id: JsonRpcId, code: number, message: string) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: { code, message },
  };
}
