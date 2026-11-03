// Tool-discovery fixture only. Real child-thread/UI proof uses unmodified T3.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { T3_NATIVE_TOOLS } from "../t3.ts";

export default function bridge(pi: ExtensionAPI): void {
  for (const name of T3_NATIVE_TOOLS) pi.registerTool({
    name, label: name, description: "Fixture native T3 tool",
    parameters: Type.Object({}, { additionalProperties: true }),
    async execute() {
      return { content: [{ type: "text", text: "Native delegation fixture invoked" }], details: { fixture: true } };
    },
  });
}
