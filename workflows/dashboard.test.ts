import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { WorkflowDashboard } from "./dashboard.ts";
import { emptyUsage, type Theme, type WorkflowDetails } from "./model.ts";

const MALICIOUS = "visible\u001b]52;c;Y2xpcGJvYXJk\u0007\u001b[31mred\u001b[0m\u0001\nforged-row";

function fixture(): WorkflowDetails {
  return {
    runId: "wf_terminal-controls",
    sessionId: "session-fixture",
    name: MALICIOUS,
    description: MALICIOUS,
    background: false,
    status: "failed",
    startedAt: 1,
    finishedAt: 2,
    phases: [{ title: MALICIOUS }],
    agents: [
      {
        index: 1,
        label: MALICIOUS,
        phase: MALICIOUS,
        state: "error",
        model: MALICIOUS,
        startedAt: 1,
        finishedAt: 2,
        error: MALICIOUS,
        preview: MALICIOUS,
        usage: emptyUsage(),
        transcript: [{ role: "tool", name: MALICIOUS, text: MALICIOUS }],
      },
    ],
    error: MALICIOUS,
  };
}

function assertNoTerminalControls(lines: string[]) {
  assert.equal(lines.every((line) => !line.includes("\n")), true);
  const rendered = lines.join("\n");
  assert.doesNotMatch(rendered, /[\u001b\u009b\u009d]/);
  assert.doesNotMatch(rendered, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
  assert.match(rendered, /visiblered/);
}

test("workflow dashboard sanitizes model-controlled detail and transcript text", () => {
  const details = fixture();
  const tui = {
    terminal: { rows: 40 },
    requestRender() {},
  } as unknown as TUI;
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
  const keybindings = {
    getKeys: () => [],
    matches: (data: string, binding: string) =>
      data === "ENTER" && binding === "tui.select.confirm",
  } as unknown as KeybindingsManager;
  const agentDir = mkdtempSync(join(tmpdir(), "pi-tooling-dashboard-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  mkdirSync(join(agentDir, "workflows", details.runId), { recursive: true });
  const dashboard = new WorkflowDashboard(
    tui,
    theme,
    keybindings,
    () => new Map([[details.runId, details]]),
    details.sessionId ?? "session-fixture",
    new Set([details.runId]),
    () => {},
    details.runId,
  );

  try {
    assertNoTerminalControls(dashboard.render(100));
    dashboard.handleInput("l");
    dashboard.handleInput("ENTER");
    assertNoTerminalControls(dashboard.render(100));
  } finally {
    dashboard.dispose();
    rmSync(agentDir, { recursive: true, force: true });
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});
