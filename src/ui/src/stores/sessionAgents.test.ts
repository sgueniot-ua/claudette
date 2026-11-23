// @vitest-environment happy-dom

import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { agentTaskState, isAgentRunningState } from "../components/chat/agentActivityDisplay";
import { useSessionAgents } from "../hooks/useSessionAgents";
import {
  collectSessionAgents,
  orderForAgentsPanel,
  runningSessionAgents,
} from "./sessionAgents";
import {
  useAppStore,
  type AgentToolCall,
  type CompletedTurn,
  type ToolActivity,
} from "./useAppStore";

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

function turn(id: string, activities: ToolActivity[]): CompletedTurn {
  return { id, activities, messageCount: 1, collapsed: true, afterMessageIndex: 0 };
}

const ids = (list: { toolUseId: string }[]) => list.map((a) => a.toolUseId);

beforeEach(() => {
  useAppStore.setState({ toolActivities: {}, completedTurns: {} });
});

describe("sessionAgents", () => {
  it("runningSessionAgents keeps only running", () => {
    // FR-001
    const all = collectSessionAgents(
      [agent("a", { agentStatus: "running" }), agent("b", { agentStatus: "completed" })],
      [],
    );
    expect(ids(runningSessionAgents(all))).toEqual(["a"]);
  });

  it("running matches agentTaskState", () => {
    // FR-004
    const statuses: (string | null)[] = ["running", "starting", "completed", "failed", "stopped", null];
    const live = statuses.map((s, i) =>
      agent(`l${i}`, s === null ? { agentStatus: null, resultText: "ok" } : { agentStatus: s }),
    );
    for (const isLive of [true, false]) {
      const agents = isLive
        ? collectSessionAgents(live, [])
        : collectSessionAgents([], [turn("t", live)]);
      expect(agents).toHaveLength(live.length);
      for (const a of agents) {
        expect(a.live).toBe(isLive);
        expect(a.running).toBe(isAgentRunningState(agentTaskState(a.activity, isLive)));
      }
    }
  });

  it("lists a running agent from a completed turn", () => {
    // FR-001
    const agents = collectSessionAgents([], [turn("t", [agent("c", { agentStatus: "running" })])]);
    const running = runningSessionAgents(agents);
    expect(ids(running)).toEqual(["c"]);
    expect(running[0].live).toBe(false);
  });

  it("orderForAgentsPanel puts running first", () => {
    // FR-009
    const agents = collectSessionAgents(
      [agent("z", { agentStatus: "running" })],
      [
        turn("t", [
          agent("x", { agentStatus: "completed" }),
          agent("y", { agentStatus: "running" }),
        ]),
      ],
    );
    expect(ids(agents)).toEqual(["x", "y", "z"]);
    expect(ids(orderForAgentsPanel(agents))).toEqual(["y", "z", "x"]);
  });

  it("excludes team agents", () => {
    // FR-013
    const team = agent("t", {
      inputJson: JSON.stringify({ description: "d", team_name: "T", name: "n" }),
    });
    const teamOnly = agent("u", {
      inputJson: JSON.stringify({ description: "d", team_name: "T" }),
    });
    expect(ids(collectSessionAgents([team, teamOnly], []))).toEqual(["u"]);
  });

  it("lists team agents when they do not open as session tabs", () => {
    // FR-013
    const team = agent("t", {
      inputJson: JSON.stringify({ description: "d", team_name: "T", name: "n" }),
    });
    expect(ids(collectSessionAgents([team], [], false))).toEqual(["t"]);
    expect(ids(collectSessionAgents([team], [], true))).toEqual([]);
  });

  it("falls back to the subagent type when the label is empty", () => {
    // FR-003
    const a = agent("e", {
      summary: "",
      inputJson: JSON.stringify({ subagent_type: "Explore" }),
    });
    expect(collectSessionAgents([a], [])[0].label).toBe("Explore");
    const b = agent("f", { summary: "", inputJson: "{}" });
    expect(collectSessionAgents([b], [])[0].label).toBe("");
  });

  it("ignores nested agents", () => {
    // FR-013
    const nested: AgentToolCall = {
      toolUseId: "n",
      toolName: "Agent",
      agentId: "p",
      status: "running",
      startedAt: "2026-10-30T00:00:00Z",
    };
    const parent = agent("p", { agentStatus: "running", agentToolCalls: [nested] });
    expect(ids(collectSessionAgents([parent], []))).toEqual(["p"]);
  });

  it("ignores non-Agent tools", () => {
    const bash = agent("b", { toolName: "Bash" });
    expect(collectSessionAgents([bash], [])).toEqual([]);
  });

  it("exposes state, subagent type and label", () => {
    const [a] = collectSessionAgents([agent("a", { agentStatus: "running" })], []);
    expect(a).toMatchObject({
      toolUseId: "a",
      live: true,
      state: "progress",
      running: true,
      subagentType: "Explore",
      label: "a",
    });
  });

  it("scopes to the session", async () => {
    // FR-012
    useAppStore.setState({
      toolActivities: {
        s1: [agent("a1", { agentStatus: "running" })],
        s2: [agent("a2", { agentStatus: "running" })],
      },
      completedTurns: { s2: [turn("t", [agent("c2", { agentStatus: "running" })])] },
    });
    let result: ReturnType<typeof useSessionAgents> = [];
    function Probe({ id }: { id: string | null }) {
      result = useSessionAgents(id);
      return null;
    }
    const probe = (id: string | null) => createElement(Probe, { id });
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(probe("s1")));
    expect(ids(result)).toEqual(["a1"]);
    await act(async () => root.render(probe(null)));
    expect(result).toEqual([]);
    await act(async () => root.unmount());
  });
});
