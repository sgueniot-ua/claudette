// @vitest-environment happy-dom

import "../../i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../stores/useAppStore";
import type { ToolActivity } from "../../stores/useAppStore";
import type { AgentToolCall } from "../../stores/slices/chatSlice";
import { AgentsPanel } from "./AgentsPanel";

vi.mock("../../workers/highlight.worker?worker", () => ({
  default: class {
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const containers: HTMLElement[] = [];

function agent(id: string, overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    toolUseId: id,
    toolName: "Agent",
    inputJson: JSON.stringify({ description: id, subagent_type: "Explore" }),
    resultText: "",
    collapsed: true,
    summary: id,
    ...overrides,
  };
}

function call(i: number): AgentToolCall {
  return {
    toolUseId: `call-${i}`,
    toolName: "Read",
    agentId: "a",
    input: { file_path: `/repo/file-${i}.ts` },
    status: "completed",
    startedAt: "2026-10-30T00:00:00Z",
  };
}

async function render(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(<AgentsPanel workspaceId="ws-1" />);
  });
  return container;
}

function items(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button[data-agent-id]"));
}

beforeEach(() => {
  useAppStore.setState({
    selectedWorkspaceId: "ws-1",
    selectedSessionIdByWorkspaceId: { "ws-1": "s1" },
    toolActivities: {},
    completedTurns: {},
    selectedAgentBySession: {},
  });
});

afterEach(async () => {
  for (const root of roots.splice(0).reverse()) {
    await act(async () => root.unmount());
  }
  for (const c of containers.splice(0)) c.remove();
});

describe("AgentsPanel", () => {
  it("lists running then finished", async () => {
    // FR-009
    useAppStore.setState({
      toolActivities: {
        s1: [
          agent("done-1", { agentStatus: "completed" }),
          agent("run-1", { agentStatus: "running" }),
        ],
      },
    });
    const c = await render();
    expect(items(c).map((b) => b.dataset.agentId)).toEqual(["run-1", "done-1"]);
    expect(c.textContent).toContain("Running");
    expect(c.textContent).toContain("Finished");
  });

  it("detail renders the agent card expanded", async () => {
    // FR-010
    useAppStore.setState({
      toolActivities: {
        s1: [
          agent("a1", {
            agentStatus: "completed",
            agentResultText: "fini",
            agentToolCalls: [call(1)],
          }),
        ],
      },
      selectedAgentBySession: { s1: "a1" },
    });
    const c = await render();
    expect(c.textContent).toContain("fini");
    expect(c.textContent).toContain("file-1.ts");
    expect(c.textContent).toContain("All agents");
  });

  it("shows the empty state", async () => {
    // FR-011
    const c = await render();
    expect(c.textContent).toContain("No sub-agents were launched in this chat.");
  });

  it("follows the active session", async () => {
    // FR-012
    useAppStore.setState({
      toolActivities: { s1: [agent("a1")], s2: [agent("b1"), agent("b2")] },
      selectedAgentBySession: { s2: "b2" },
    });
    const c = await render();
    expect(items(c).map((b) => b.dataset.agentId)).toEqual(["a1"]);
    await act(async () => {
      useAppStore.setState({ selectedSessionIdByWorkspaceId: { "ws-1": "s2" } });
    });
    expect(items(c)).toHaveLength(0);
    expect(c.textContent).toContain("All agents");
    await act(async () => {
      useAppStore.getState().selectAgentInSidebar("s2", null);
    });
    expect(items(c).map((b) => b.dataset.agentId)).toEqual(["b1", "b2"]);
  });

  it("orphan selection shows the list", async () => {
    // FR-012 edge case: selected id no longer exists
    useAppStore.setState({
      toolActivities: { s1: [agent("a1")] },
      selectedAgentBySession: { s1: "gone" },
    });
    const c = await render();
    expect(items(c)).toHaveLength(1);
    expect(c.textContent).not.toContain("All agents");
  });

  it("list items have readable accessible names", async () => {
    // FR-015
    useAppStore.setState({
      toolActivities: {
        s1: [
          agent("scout", {
            summary: "Attendre 9",
            inputJson: JSON.stringify({ description: "Attendre 9", subagent_type: "scout" }),
            agentStatus: "completed",
          }),
          agent("run", {
            summary: "Attendre 9",
            inputJson: JSON.stringify({ description: "Attendre 9", subagent_type: "scout" }),
            agentStatus: "running",
          }),
        ],
      },
    });
    const c = await render();
    const names = items(c).map((b) => b.getAttribute("aria-label") ?? "");
    expect(names[0]).toMatch(/scout.*Attendre 9.*Running/);
    expect(names[1]).toMatch(/scout.*Attendre 9.*Finished/);
    expect(names.every((n) => !n.includes("  "))).toBe(true);
    await act(async () => {
      items(c)[1].click();
    });
    expect(useAppStore.getState().selectedAgentBySession.s1).toBe("scout");
  });

  it("untyped agent name has no double space or leading hyphen", async () => {
    // FR-015
    useAppStore.setState({
      toolActivities: {
        s1: [agent("u", { summary: "Attendre 9", inputJson: JSON.stringify({ description: "Attendre 9" }) })],
      },
    });
    const c = await render();
    const name = items(c)[0].getAttribute("aria-label")!;
    expect(name).toBe("Open agent: Attendre 9 (Running)");
    expect(name).not.toMatch(/\s{2}|^-/);
  });

  it("empty label falls back to the localized Agent label", async () => {
    // FR-003
    useAppStore.setState({
      toolActivities: { s1: [agent("e", { summary: "", inputJson: "{}" })] },
    });
    const c = await render();
    expect(items(c)[0].getAttribute("aria-label")).toBe("Open agent: Agent (Running)");
    expect(items(c)[0].textContent).toContain("Agent");
  });
});
