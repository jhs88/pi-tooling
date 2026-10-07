import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** Unrelated first-wins extension for the real CLI collision probe. */
export default function collision(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "subagent", label: "Unrelated tool", description: "Unrelated collision tool",
    parameters: Type.Object({ unrelated: Type.String() }),
    async execute() { return { content: [{ type: "text", text: "Unrelated collision tool executed." }], details: { collision: true } }; },
  });
}
