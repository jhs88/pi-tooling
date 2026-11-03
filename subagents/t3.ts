import { resolve } from "node:path";

export const T3_NATIVE_TOOLS = [
  "mcp__t3-code__orchestrator_capabilities",
  "mcp__t3-code__delegate_task",
  "mcp__t3-code__task_status",
] as const;

interface ToolSource {
  name: string;
  sourceInfo?: { path?: string };
}

/** Require the real bridge's provenance and callable tools, not an env hint alone. */
export function hasT3DelegationBridge(
  tools: readonly ToolSource[],
  callable: readonly { name: string }[],
  extensionPath = process.env.T3_PI_MCP_EXTENSION_PATH,
): boolean {
  if (!extensionPath) return false;
  const source = resolve(extensionPath);
  return T3_NATIVE_TOOLS.every((name) => callable.some((tool) => tool.name === name)
    && tools.some((tool) => tool.name === name && tool.sourceInfo?.path
      && resolve(tool.sourceInfo.path) === source));
}

export const T3_DELEGATION_GUIDANCE = `In T3 Code, delegate through mcp__t3-code__delegate_task so each child has an openable T3 conversation. Discover supported targets and modes through mcp__t3-code__orchestrator_capabilities, and read results through mcp__t3-code__task_status. Use the bridge's tool search for thread reading, steering, continuation, waiting, or cancellation, and follow returned next instructions. A timeout does not cancel a child. Do not use Pi's Agent, subagent, SubagentWorkflow, subagent_workflow, get_subagent_result, subagent_result, steer_subagent, or subagent_steer in this session. Pi agent definitions, per-agent tool restrictions, and workflow scripts are not translated to T3 tasks. If the requested work requires those Pi-specific settings, explain that it must run in standalone Pi rather than silently dropping them. Do not invent child thread IDs or substitute a Pi agent ID for a T3 task ID.`;
