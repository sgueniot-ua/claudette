// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adb = vi.hoisted(() => ({
  modeByRepo: {} as Record<string, boolean>,
  adbOpenSession: vi.fn(),
  adbCloseSession: vi.fn(),
  useAdbEvents: vi.fn(),
}));

vi.mock("../../services/adb", () => ({
  adbGetAndroidMode: (repoId: string) => Promise.resolve(adb.modeByRepo[repoId] ?? false),
  adbOpenSession: adb.adbOpenSession,
  adbCloseSession: adb.adbCloseSession,
}));
vi.mock("../adb/useAdbEvents", () => ({ useAdbEvents: adb.useAdbEvents }));
vi.mock("../adb/AdbPanel", () => ({ AdbPanel: () => <div data-testid="adb-panel" /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: () => <div /> }));
vi.mock("../chat/ChatPanel", () => ({ ChatPanel: () => <div /> }));
vi.mock("../diff/DiffViewer", () => ({ DiffViewer: () => <div /> }));
vi.mock("../file-viewer/FileViewer", () => ({ FileViewer: () => <div /> }));
vi.mock("../terminal/TerminalPanel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));
vi.mock("../right-sidebar/RightSidebar", () => ({ RightSidebar: () => <div /> }));
vi.mock("../fuzzy-finder/FuzzyFinder", () => ({ FuzzyFinder: () => <div /> }));
vi.mock("../command-palette/CommandPalette", () => ({ CommandPalette: () => <div /> }));
vi.mock("./Dashboard", () => ({ Dashboard: () => <div /> }));
vi.mock("../modals/ModalRouter", () => ({ ModalRouter: () => <div /> }));
vi.mock("../settings/SettingsPage", () => ({ SettingsPage: () => <div /> }));
vi.mock("../scheduler/SchedulerPage", () => ({ SchedulerPage: () => <div /> }));
vi.mock("./ResizeHandle", () => ({
  ResizeHandle: (props: { cssVar?: string; min?: number; max?: number; invert?: boolean }) => (
    <div
      data-testid="resize-handle"
      data-cssvar={props.cssVar}
      data-min={props.min}
      data-max={props.max}
      data-invert={String(!!props.invert)}
    />
  ),
}));
vi.mock("./Toast", () => ({ ToastContainer: () => <div /> }));
vi.mock("../shared/AppTooltip", () => ({ AppTooltip: () => <div /> }));
vi.mock("../../hooks/useAgentStream", () => ({ useAgentStream: vi.fn() }));
vi.mock("../../hooks/useWorkflowActivityStatus", () => ({
  useWorkflowActivityStatus: vi.fn(),
}));
vi.mock("../../hooks/useKeyboardShortcuts", () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock("../../hooks/useBranchRefresh", () => ({ useBranchRefresh: vi.fn() }));
vi.mock("../../hooks/useAutoUpdater", () => ({ useAutoUpdater: vi.fn() }));
vi.mock("../../hooks/useWorkspaceFileWatcher", () => ({ useWorkspaceFileWatcher: vi.fn() }));
vi.mock("../../hooks/useWorkspaceEnvironmentPreparation", () => ({
  useWorkspaceEnvironmentPreparation: vi.fn(),
}));
vi.mock("../../hooks/useQueuedMessageAutoDispatch", () => ({
  useQueuedMessageAutoDispatch: vi.fn(),
}));

import { useAppStore } from "../../stores/useAppStore";
import type { Workspace } from "../../types/workspace";
import { AppLayout } from "./AppLayout";

const androidWs = { id: "ws-a", repository_id: "repo-a", remote_connection_id: null } as Workspace;
const plainWs = { id: "ws-p", repository_id: "repo-p", remote_connection_id: null } as Workspace;

let root: Root;
let container: HTMLDivElement;

async function render() {
  await act(async () => {
    root.render(<AppLayout />);
  });
}

async function setState(partial: Partial<ReturnType<typeof useAppStore.getState>>) {
  await act(async () => {
    useAppStore.setState(partial);
  });
}

const adbPanel = () => container.querySelector('[data-testid="adb-panel"]');
const adbPane = () => adbPanel()?.parentElement ?? null;
const terminalPane = () => container.querySelector('[data-testid="terminal-panel"]')!.parentElement!;
const adbHandles = () => container.querySelectorAll('[data-cssvar="--adb-w"]');

describe("AppLayout ADB panel", () => {
  beforeEach(() => {
    adb.modeByRepo = { "repo-a": true };
    adb.adbOpenSession.mockReset().mockResolvedValue({ kind: "no_device" });
    adb.adbCloseSession.mockReset();
    adb.useAdbEvents.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAppStore.setState({
      workspaces: [androidWs, plainWs],
      selectedWorkspaceId: "ws-a",
      androidModeByRepo: {},
      adbPanelVisible: false,
      adbSessions: {},
      terminalPanelVisible: true,
      schedulerOpen: false,
      settingsOpen: false,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useAppStore.setState({
      workspaces: [],
      selectedWorkspaceId: null,
      androidModeByRepo: {},
      adbPanelVisible: false,
    });
  });

  it("mounts the ADB event hook unconditionally", async () => {
    // FR-004a
    useAppStore.setState({ selectedWorkspaceId: null });
    await render();
    expect(adb.useAdbEvents).toHaveBeenCalled();
  });

  it("does not mount the panel until it is first displayed", async () => {
    // FR-001a
    await render();
    expect(adbPanel()).toBeNull();
    expect(adb.adbOpenSession).not.toHaveBeenCalled();
  });

  it("shows the terminal on the left and the ADB panel on the right with one --adb-w handle", async () => {
    // FR-001b
    await render();
    await setState({ adbPanelVisible: true });
    expect(adbPane()!.getAttribute("aria-hidden")).toBe("false");
    expect(terminalPane().getAttribute("aria-hidden")).toBe("false");
    expect(terminalPane().parentElement).toBe(adbPane()!.parentElement);
    expect(
      terminalPane().compareDocumentPosition(adbPane()!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(adbHandles()).toHaveLength(1);
    const handle = adbHandles()[0];
    expect(handle.getAttribute("data-invert")).toBe("true");
    expect(handle.getAttribute("data-min")).toBe("240");
    expect(handle.getAttribute("data-max")).toBe("1200");
  });

  it("gives the ADB panel the full width when the terminal is hidden", async () => {
    // FR-001b
    await render();
    await setState({ adbPanelVisible: true, terminalPanelVisible: false });
    expect(adbPane()!.getAttribute("aria-hidden")).toBe("false");
    expect(terminalPane().getAttribute("aria-hidden")).toBe("true");
    expect(adbHandles()).toHaveLength(0);
    expect(terminalPane().parentElement!.getAttribute("aria-hidden")).toBe("false");
  });

  it("leaves the terminal alone when the panel is not visible", async () => {
    // FR-001b
    await render();
    expect(terminalPane().getAttribute("aria-hidden")).toBe("false");
    expect(adbHandles()).toHaveLength(0);
  });

  it("hides the panel on a workspace without Android mode and shows it again on return", async () => {
    // FR-003a
    await render();
    await setState({ adbPanelVisible: true });
    expect(adbPane()!.getAttribute("aria-hidden")).toBe("false");

    await setState({ selectedWorkspaceId: "ws-p" });
    expect(adbPane()!.getAttribute("aria-hidden")).toBe("true");
    expect(adbHandles()).toHaveLength(0);
    expect(useAppStore.getState().adbPanelVisible).toBe(true);

    await setState({ selectedWorkspaceId: "ws-a" });
    expect(adbPane()!.getAttribute("aria-hidden")).toBe("false");
    expect(useAppStore.getState().adbPanelVisible).toBe(true);
  });

  it("hides the panel on a remote workspace", async () => {
    // FR-003a
    await setState({
      workspaces: [{ ...androidWs, remote_connection_id: "c1" }, plainWs],
      adbPanelVisible: true,
    });
    await render();
    expect(adbPanel()).toBeNull();
  });

  it("opens the session once on first display and never closes it", async () => {
    // FR-004a
    await render();
    await setState({ adbPanelVisible: true });
    expect(adb.adbOpenSession).toHaveBeenCalledTimes(1);
    expect(adb.adbOpenSession).toHaveBeenCalledWith("ws-a");
    expect(useAppStore.getState().adbSessions["ws-a"]).toEqual({ kind: "no_device" });

    await setState({ adbPanelVisible: false });
    await setState({ adbPanelVisible: true });
    expect(adb.adbOpenSession).toHaveBeenCalledTimes(1);
    expect(adb.adbCloseSession).not.toHaveBeenCalled();
    expect(adbPanel()).not.toBeNull();
  });

  it("keeps the panel mounted but hidden after it is closed", async () => {
    // FR-004a
    await render();
    await setState({ adbPanelVisible: true });
    await setState({ adbPanelVisible: false });
    expect(adbPanel()).not.toBeNull();
    expect(adbPane()!.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not touch the terminal tabs or visibility when the panel opens", async () => {
    // FR-010
    const tabs = useAppStore.getState().terminalTabs;
    await render();
    await setState({ adbPanelVisible: true });
    expect(useAppStore.getState().terminalTabs).toBe(tabs);
    expect(useAppStore.getState().terminalPanelVisible).toBe(true);
    expect(container.querySelector('[data-testid="terminal-panel"]')).not.toBeNull();
  });
});
