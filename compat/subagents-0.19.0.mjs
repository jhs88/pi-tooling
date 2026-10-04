export const SUBAGENTS_VERSION = "0.19.0";
export const RUNNER_ORIGINAL_SHA256 = "88e61481fd627254ff3ac0a27e1991136c41e103fac847dd06444c8ac3d3eab1";
export const RUNNER_PATCHED_SHA256 = "2412d11bcf2d32802912ecab222fe63c3f92a0ac4bdeace02814ee25f5df3316";
// Manifest hashes ignore formatting and object-key order, but not metadata changes.
export const MANIFEST_ORIGINAL_SHA256 = "fc67e6db6be0e525c2a7467b93d60a49a5177750f45766602daae9634b669412";
export const MANIFEST_PATCHED_SHA256 = "66b37492f37721c2e103fe30867ea8afbdc4cd1fec85a178ae71b26f9cad45f0";

// Source edits are deliberately tied to the reviewed npm release, not fuzzy matches.
export const RUNNER_EDITS = [
  {
    before: "  createAgentSession,\n  DefaultResourceLoader,",
    after: "  createAgentSession,\n  createCodemodeExtension,\n  createMcpExtension,\n  createToolSearchExtension,\n  type ExtensionFactory,\n  DefaultResourceLoader,",
  },
  {
    before: "  let toolNames = getToolNamesForType(type);",
    after: "  let toolNames = getToolNamesForType(type).filter((name) => BUILTIN_TOOL_NAMES.includes(name));",
  },
  {
    before: "  const loader = new DefaultResourceLoader({",
    after: `  let nativeToolInScope: (name: string) => boolean = (name) =>
    toolNames.includes(name) && !agentConfig?.disallowedTools?.includes(name);
  const withNativeToolScope = (factory: ExtensionFactory): ExtensionFactory => (pi) => {
    // Native nested calls bypass agent.beforeToolCall but emit this permission event.
    pi.on("tool_call", (event) => {
      if (!nativeToolInScope(event.toolName)) {
        return { block: true, reason: \`Tool "\${event.toolName}" is not available to this subagent.\` };
      }
    });
    return factory(pi);
  };

  const loader = new DefaultResourceLoader({`,
  },
  {
    before: "    noExtensions,\n    additionalExtensionPaths,",
    after: `    noExtensions,
    // Native built-ins preserve settings exclusions and isolated-session behavior.
    extensionFactories: [
      { name: "codemode", builtin: true, replaceable: true, factory: withNativeToolScope(createCodemodeExtension()) },
      { name: "tool-search", builtin: true, replaceable: true, factory: withNativeToolScope(createToolSearchExtension()) },
      { name: "mcp", builtin: true, replaceable: true, factory: withNativeToolScope(createMcpExtension()) },
    ],
    additionalExtensionPaths,`,
  },
  {
    before: "    const next = session.getAllTools().map((t) => t.name).filter((n) => allowed.has(n));\n    const current = session.getActiveToolNames();",
    after: `    const current = session.getActiveToolNames();
    const alreadyActive = new Set(current);
    const next = session.getAllTools()
      .filter((tool) => allowed.has(tool.name) && tool.exposure !== "hidden" &&
        (tool.exposure === "direct" || tool.exposure === "model-only" || alreadyActive.has(tool.name)))
      .map((tool) => tool.name);`,
  },
  {
    before: "  },\n): void {\n  const { loader, toolNames, disallowedSet, extNames, narrowing, readmitToolNames } = ctx;",
    after: "  },\n): (name: string) => boolean {\n  const { loader, toolNames, disallowedSet, extNames, narrowing, readmitToolNames } = ctx;",
  },
  {
    before: "    return priorBeforeToolCall?.(context, signal);\n  };\n}",
    after: "    return priorBeforeToolCall?.(context, signal);\n  };\n  return (name) => inScope().has(name);\n}",
  },
  {
    before: "    installExtensionToolScope(session, {",
    after: "    nativeToolInScope = installExtensionToolScope(session, {",
  },
];

export const HOST_PEERS = [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "@sinclair/typebox",
  "typebox",
];
