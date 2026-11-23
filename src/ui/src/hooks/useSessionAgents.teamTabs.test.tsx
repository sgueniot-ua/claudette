// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAppSetting = vi.hoisted(() => vi.fn());
vi.mock("../services/tauri/settings", () => ({ getAppSetting }));

import { useSessionAgents } from "./useSessionAgents";
import { useAppStore, type ToolActivity } from "../stores/useAppStore";

const teamAgent: ToolActivity = {
  toolUseId: "team",
  toolName: "Agent",
  inputJson: JSON.stringify({ description: "d", team_name: "T", name: "n" }),
  resultText: "",
  collapsed: true,
  summary: "d",
  agentStatus: "running",
};

async function listed(): Promise<string[]> {
  let result: ReturnType<typeof useSessionAgents> = [];
  function Probe() {
    result = useSessionAgents("s1");
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
  const ids = result.map((a) => a.toolUseId);
  await act(async () => root.unmount());
  return ids;
}

beforeEach(() => {
  useAppStore.setState({ toolActivities: { s1: [teamAgent] }, completedTurns: {} });
});

describe("useSessionAgents team agent exclusion", () => {
  it("excludes team agents when the session-tabs setting is on", async () => {
    // FR-013
    getAppSetting.mockResolvedValue("true");
    expect(await listed()).toEqual([]);
  });

  it("excludes team agents when the setting is absent (default on)", async () => {
    // FR-013
    getAppSetting.mockResolvedValue(null);
    expect(await listed()).toEqual([]);
  });

  it("lists team agents when the setting is off", async () => {
    // FR-013
    getAppSetting.mockResolvedValue("false");
    expect(await listed()).toEqual(["team"]);
  });
});
