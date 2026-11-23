// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../workers/highlight.worker?worker", () => ({
  default: class FakeWorker {
    postMessage(): void {}
    addEventListener(): void {}
    terminate(): void {}
  },
}));

import "../../i18n";
import { useAppStore, type ToolActivity } from "../../stores/useAppStore";
import sessionViewSource from "./ChatPanelSessionView.tsx?raw";
import { RunningAgentsBar } from "./RunningAgentsBar";

const WS = "ws-1";
const SESSION = "s-1";

const mountedRoots: Root[] = [];
const mountedContainers: HTMLElement[] = [];

function agent(id: string, overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    toolUseId: id,
    toolName: "Agent",
    inputJson: JSON.stringify({ description: `Attendre ${id}`, subagent_type: "scout" }),
    resultText: "",
    collapsed: true,
    summary: `Attendre ${id}`,
    agentStatus: "running",
    ...overrides,
  };
}

function setActivities(activities: ToolActivity[]) {
  useAppStore.setState({ toolActivities: { [SESSION]: activities } });
}

async function render(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  mountedContainers.push(container);
  await act(async () => {
    root.render(<RunningAgentsBar workspaceId={WS} sessionId={SESSION} />);
  });
  return container;
}

beforeEach(() => {
  useAppStore.setState({
    toolActivities: {},
    completedTurns: {},
    selectedAgentBySession: {},
    rightSidebarTabByWorkspace: {},
    rightSidebarVisible: false,
  });
});

afterEach(async () => {
  for (const root of mountedRoots.splice(0).reverse()) {
    await act(async () => root.unmount());
  }
  for (const container of mountedContainers.splice(0)) container.remove();
});

describe("RunningAgentsBar", () => {
  it("renders nothing without running agents", async () => {
    // FR-002
    setActivities([agent("a", { agentStatus: "completed" })]);
    const container = await render();
    expect(container.innerHTML).toBe("");
  });

  it("renders one row per running agent", async () => {
    // FR-001
    setActivities([agent("a"), agent("b")]);
    const container = await render();
    expect(container.querySelectorAll("nav button")).toHaveLength(2);
  });

  it("row shows icon, type and description", async () => {
    // FR-003
    setActivities([agent("a")]);
    const container = await render();
    const row = container.querySelector("nav button")!;
    expect(row.querySelector('[role="img"]')).not.toBeNull();
    expect(row.textContent).toContain("scout");
    expect(row.textContent).toContain("Attendre a");
  });

  it("omits the type when the agent has none", async () => {
    // FR-003
    setActivities([
      agent("a", { inputJson: JSON.stringify({ description: "Attendre a" }) }),
    ]);
    const container = await render();
    expect(container.querySelector("nav button")!.textContent).not.toContain("scout");
  });

  it("disappears when the last agent finishes", async () => {
    // FR-002
    setActivities([agent("a")]);
    const container = await render();
    expect(container.querySelector("nav")).not.toBeNull();
    await act(async () => setActivities([agent("a", { agentStatus: "completed" })]));
    expect(container.querySelector("nav")).toBeNull();
  });

  it("caps at 3 rows with +N more", async () => {
    // FR-006
    setActivities(["a", "b", "c", "d", "e"].map((id) => agent(id)));
    const container = await render();
    const buttons = [...container.querySelectorAll("nav button")];
    expect(buttons).toHaveLength(4);
    expect(buttons[3].textContent).toBe("+2 more");
  });

  it("+N opens the Agents tab without selection", async () => {
    // FR-006
    setActivities(["a", "b", "c", "d"].map((id) => agent(id)));
    const container = await render();
    const more = [...container.querySelectorAll("nav button")][3] as HTMLButtonElement;
    await act(async () => more.click());
    const s = useAppStore.getState();
    expect(s.rightSidebarTabByWorkspace[WS]).toBe("agents");
    expect(s.selectedAgentBySession[SESSION]).toBeNull();
    expect(s.rightSidebarVisible).toBe(true);
  });

  it("row click opens the agent", async () => {
    // FR-007
    setActivities([agent("a"), agent("b")]);
    const container = await render();
    const row = container.querySelectorAll("nav button")[1] as HTMLButtonElement;
    await act(async () => row.click());
    const s = useAppStore.getState();
    expect(s.rightSidebarTabByWorkspace[WS]).toBe("agents");
    expect(s.selectedAgentBySession[SESSION]).toBe("b");
  });

  it("rows are buttons with accessible names", async () => {
    // FR-015
    setActivities([agent("9")]);
    const container = await render();
    const row = container.querySelector("nav button")!;
    expect(row.getAttribute("aria-label")).toMatch(/scout.*Attendre 9/);
    expect(container.querySelector("nav")!.getAttribute("aria-label")).toBe("Running agents");
  });
});

describe("RunningAgentsBar placement", () => {
  it("is mounted outside the messages scroller", () => {
    // FR-005: rendering ChatPanelSessionView needs its whole chat harness, so
    // assert structurally that the mount sits after the messagesWrapper div
    // closes, next to the other composer-adjacent pills.
    const src = sessionViewSource;
    const wrapperStart = src.lastIndexOf("<div", src.indexOf("styles.messagesWrapper"));
    const pill = src.indexOf("<WorkflowStatusPill");
    const bar = src.indexOf("<RunningAgentsBar");
    expect(wrapperStart).toBeGreaterThan(-1);
    expect(bar).toBeGreaterThan(pill);
    const between = src.slice(wrapperStart, bar);
    const opens = (between.match(/<div\b/g) ?? []).length;
    const closes = (between.match(/<\/div>/g) ?? []).length;
    expect(closes).toBe(opens);
  });
});
