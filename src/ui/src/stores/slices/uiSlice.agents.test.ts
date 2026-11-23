import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../useAppStore";
import { RIGHT_SIDEBAR_TABS } from "./uiSlice";

describe("agents right-sidebar tab state", () => {
  beforeEach(() => {
    useAppStore.setState({
      rightSidebarVisible: false,
      rightSidebarTabByWorkspace: {},
      selectedAgentBySession: {},
    });
  });

  // FR-008
  it("agents is a valid right sidebar tab", () => {
    expect(RIGHT_SIDEBAR_TABS).toContain("agents");
  });

  // FR-007
  it("openAgentInSidebar selects, switches tab and opens sidebar", () => {
    useAppStore.getState().openAgentInSidebar("w1", "s1", "tool-1");
    const s = useAppStore.getState();
    expect(s.selectedAgentBySession.s1).toBe("tool-1");
    expect(s.rightSidebarTabByWorkspace.w1).toBe("agents");
    expect(s.rightSidebarVisible).toBe(true);

    useAppStore.getState().openAgentInSidebar("w1", "s1", "tool-2");
    expect(useAppStore.getState().rightSidebarVisible).toBe(true);
  });

  // FR-006
  it("openAgentInSidebar with null clears the selection", () => {
    useAppStore.getState().openAgentInSidebar("w1", "s1", "tool-1");
    useAppStore.getState().openAgentInSidebar("w1", "s1", null);
    const s = useAppStore.getState();
    expect(s.selectedAgentBySession.s1).toBeNull();
    expect(s.rightSidebarTabByWorkspace.w1).toBe("agents");
  });

  // FR-012
  it("selectAgentInSidebar changes only that session", () => {
    useAppStore.setState({
      selectedAgentBySession: { s1: "a", s2: "b" },
      rightSidebarVisible: false,
    });
    useAppStore.getState().selectAgentInSidebar("s1", "c");
    const s = useAppStore.getState();
    expect(s.selectedAgentBySession).toEqual({ s1: "c", s2: "b" });
    expect(s.rightSidebarVisible).toBe(false);
  });
});
