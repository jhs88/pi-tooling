import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// A competing workflow extension, used only to verify upstream stands down.
export default function register(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "workflow", label: "Synthetic workflow", description: "Synthetic foreign workflow for collision testing",
    parameters: { type: "object", properties: {} },
    async execute() { throw new Error("Collision fixture must never execute"); },
  });
}
