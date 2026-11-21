import { useCallback, useEffect, useRef, useState } from "react";
import {
  selectActiveFileTabPath,
  useAppStore,
} from "../../stores/useAppStore";
import { Sidebar } from "../sidebar/Sidebar";
import { ChatPanel } from "../chat/ChatPanel";
import { DiffViewer } from "../diff/DiffViewer";
import { FileViewer } from "../file-viewer/FileViewer";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { AdbPanel } from "../adb/AdbPanel";
import { useAdbEvents } from "../adb/useAdbEvents";
import { isAdbAvailable } from "../adb/adbVisibility";
import { adbOpenSession } from "../../services/adb";
import { RightSidebar } from "../right-sidebar/RightSidebar";
import { FuzzyFinder } from "../fuzzy-finder/FuzzyFinder";
import { CommandPalette } from "../command-palette/CommandPalette";
import { Dashboard } from "./Dashboard";
import { ModalRouter } from "../modals/ModalRouter";
import { SettingsPage } from "../settings/SettingsPage";
import { SchedulerPage } from "../scheduler/SchedulerPage";
import { ResizeHandle } from "./ResizeHandle";
import { ToastContainer } from "./Toast";
import { AppTooltip } from "../shared/AppTooltip";
import { useAgentStream } from "../../hooks/useAgentStream";
import { useWorkflowActivityStatus } from "../../hooks/useWorkflowActivityStatus";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useBranchRefresh } from "../../hooks/useBranchRefresh";
import { useAutoUpdater } from "../../hooks/useAutoUpdater";
import { useWorkspaceFileWatcher } from "../../hooks/useWorkspaceFileWatcher";
import { useWorkspaceEnvironmentPreparation } from "../../hooks/useWorkspaceEnvironmentPreparation";
import { useQueuedMessageAutoDispatch } from "../../hooks/useQueuedMessageAutoDispatch";
import styles from "./AppLayout.module.css";

export function AppLayout() {
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth);
  const rightSidebarVisible = useAppStore((s) => s.rightSidebarVisible);
  const rightSidebarWidth = useAppStore((s) => s.rightSidebarWidth);
  const setRightSidebarWidth = useAppStore((s) => s.setRightSidebarWidth);
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const diffSelectedFile = useAppStore((s) => s.diffSelectedFile);
  const allFilesOpenedFile = useAppStore(selectActiveFileTabPath);
  const terminalPanelVisible = useAppStore((s) => s.terminalPanelVisible);
  const terminalHeight = useAppStore((s) => s.terminalHeight);
  const setTerminalHeight = useAppStore((s) => s.setTerminalHeight);
  const adbPanelVisible = useAppStore((s) => s.adbPanelVisible);
  const adbPanelWidth = useAppStore((s) => s.adbPanelWidth);
  const setAdbPanelWidth = useAppStore((s) => s.setAdbPanelWidth);
  const setAdbSessionStatus = useAppStore((s) => s.setAdbSessionStatus);
  const loadAndroidMode = useAppStore((s) => s.loadAndroidMode);
  const selectedWorkspace = useAppStore((s) =>
    s.workspaces.find((w) => w.id === s.selectedWorkspaceId),
  );
  const adbAvailable = useAppStore((s) =>
    isAdbAvailable(
      s.workspaces.find((w) => w.id === s.selectedWorkspaceId),
      s.androidModeByRepo,
    ),
  );
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const schedulerOpen = useAppStore((s) => s.schedulerOpen);
  const fuzzyFinderOpen = useAppStore((s) => s.fuzzyFinderOpen);
  const commandPaletteOpen = useAppStore((s) => s.commandPaletteOpen);

  useAgentStream();
  useWorkflowActivityStatus();
  useKeyboardShortcuts();
  useBranchRefresh();
  useAutoUpdater();
  useWorkspaceFileWatcher();
  useWorkspaceEnvironmentPreparation();
  useQueuedMessageAutoDispatch();
  // Consumes the ADB events even while the panel is hidden or never opened.
  useAdbEvents();

  // Main-pane priority: an explicitly opened file from the Files tree
  // takes precedence over a diff selection, and a diff selection takes
  // precedence over the chat view. Selecting a chat-session or diff tab
  // in the shared tab strip dispatches `clearActiveFileTab`, which
  // releases the file viewer's hold so the lower-priority pane is shown.
  const showFileViewer = allFilesOpenedFile !== null;
  const showDiff = !showFileViewer && diffSelectedFile !== null;

  // Ref for the .main flex container — CSS variables are set here.
  const mainRef = useRef<HTMLDivElement>(null);

  // Sync Zustand dimensions → CSS variables on mount, visibility toggles,
  // and workspace switches. During drag, ResizeHandle writes CSS vars
  // directly; this effect only runs for non-drag state changes.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    el.style.setProperty("--sidebar-w", `${sidebarWidth}px`);
    el.style.setProperty("--right-sidebar-w", `${rightSidebarWidth}px`);
    el.style.setProperty("--terminal-h", `${terminalHeight}px`);
    el.style.setProperty("--adb-w", `${adbPanelWidth}px`);
  }, [sidebarWidth, rightSidebarWidth, terminalHeight, adbPanelWidth, sidebarVisible, rightSidebarVisible, terminalPanelVisible]);

  const handleLeftResizeEnd = useCallback((finalWidth: number) => {
    setSidebarWidth(finalWidth);
  }, [setSidebarWidth]);

  const handleRightResizeEnd = useCallback((finalWidth: number) => {
    setRightSidebarWidth(finalWidth);
  }, [setRightSidebarWidth]);

  const handleTerminalResizeEnd = useCallback((finalHeight: number) => {
    setTerminalHeight(finalHeight);
  }, [setTerminalHeight]);

  const handleAdbResizeEnd = useCallback((finalWidth: number) => {
    setAdbPanelWidth(finalWidth);
  }, [setAdbPanelWidth]);

  // The Android mode of a repository is read when one of its workspaces is
  // selected; the ADB panel is only offered once it is known to be on.
  const selectedRepoId =
    selectedWorkspace && selectedWorkspace.remote_connection_id === null
      ? selectedWorkspace.repository_id
      : null;
  useEffect(() => {
    if (!selectedRepoId) return;
    loadAndroidMode(selectedRepoId).catch((e) =>
      console.error("Failed to load the Android mode:", e),
    );
  }, [selectedRepoId, loadAndroidMode]);

  const adbShown = !schedulerOpen && !!selectedWorkspaceId && adbAvailable && adbPanelVisible;
  const terminalShown = !schedulerOpen && !!selectedWorkspaceId && terminalPanelVisible;

  // Mount the ADB panel on first display, then keep it mounted (hidden via
  // CSS) so closing it never drops its state. Its logcat session runs on
  // until the workspace is archived or deleted, so closing never ends it.
  const [adbMounted, setAdbMounted] = useState(false);
  const adbOpenedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!adbShown || !selectedWorkspaceId) return;
    setAdbMounted(true);
    if (adbOpenedRef.current.has(selectedWorkspaceId)) return;
    const workspaceId = selectedWorkspaceId;
    adbOpenedRef.current.add(workspaceId);
    adbOpenSession(workspaceId)
      .then((status) => setAdbSessionStatus(workspaceId, status))
      .catch((e) => {
        adbOpenedRef.current.delete(workspaceId);
        console.error("Failed to open the ADB session:", e);
      });
  }, [adbShown, selectedWorkspaceId, setAdbSessionStatus]);

  // Lazy-mount SettingsPage: defer initial mount until the user first opens
  // settings, then keep it mounted so subsequent toggles are instant.
  const [settingsMounted, setSettingsMounted] = useState(false);
  useEffect(() => {
    if (settingsOpen && !settingsMounted) setSettingsMounted(true);
  }, [settingsOpen, settingsMounted]);

  const isMac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");

  return (
    <div className={styles.container} {...(isMac ? { "data-platform": "mac" } : {})}>
      <div className={styles.main} ref={mainRef}>
        {/*
          Settings is lazy-mounted on first open, then kept alive so
          subsequent toggles are instant.  The workspace subtree is
          ALWAYS mounted.  We swap visibility via CSS display:none so
          opening settings never unmounts the workspace tree —
          unmounting would destroy xterm instances and kill PTY children
          (same rationale as the terminal panel toggle below).
        */}
        {settingsMounted && (
          <div className={`${styles.viewPanel} ${settingsOpen ? "" : styles.hidden}`}>
            <SettingsPage />
          </div>
        )}
        <div className={`${styles.viewPanel} ${settingsOpen ? styles.hidden : ""}`}>
          <div
            className={`${styles.sidebar} ${sidebarVisible ? "" : styles.sidebarHidden}`}
            aria-hidden={!sidebarVisible}
          >
            <div className={styles.sidebarContent}>
              <Sidebar />
            </div>
          </div>
          {sidebarVisible && (
            <ResizeHandle
              direction="horizontal"
              targetRef={mainRef}
              cssVar="--sidebar-w"
              min={150}
              max={600}
              onResizeEnd={handleLeftResizeEnd}
            />
          )}
          <div className={styles.center}>
            <div className={styles.content}>
              {/* The Loops and Schedules view replaces the workspace/dashboard
                  content but, like the Dashboard, keeps the sidebar +
                  PanelHeader + PanelToggles chrome in place. */}
              {schedulerOpen ? (
                <SchedulerPage />
              ) : selectedWorkspaceId ? (
                <>
                  <div
                    className={`${styles.contentPanel} ${
                      showFileViewer ? "" : styles.contentPanelHidden
                    }`}
                    aria-hidden={!showFileViewer}
                  >
                    {showFileViewer && <FileViewer />}
                  </div>
                  <div
                    className={`${styles.contentPanel} ${
                      showDiff ? "" : styles.contentPanelHidden
                    }`}
                    aria-hidden={!showDiff}
                  >
                    {showDiff && <DiffViewer />}
                  </div>
                  <div
                    className={`${styles.contentPanel} ${
                      !showFileViewer && !showDiff ? "" : styles.contentPanelHidden
                    }`}
                    aria-hidden={showFileViewer || showDiff}
                  >
                    <ChatPanel />
                  </div>
                </>
              ) : (
                <Dashboard />
              )}
            </div>
            {/*
              Always mount the terminal panel; drive visibility via a CSS
              class. TerminalPanel owns every live xterm/PTY instance across
              workspaces, so unmounting it on collapse, dashboard/project view,
              or settings swaps would dispose xterm instances and kill PTY
              children. The ResizeHandle has no state worth preserving and is
              only useful when a selected workspace's panel is visible, so we
              conditionally render it.
            */}
            {(terminalShown || adbShown) && (
              <ResizeHandle
                direction="vertical"
                targetRef={mainRef}
                cssVar="--terminal-h"
                min={100}
                max={800}
                invert
                onResizeEnd={handleTerminalResizeEnd}
              />
            )}
            {/* The bottom area is shared: terminal on the left, ADB panel on
                the right. Each is hidden in place, never unmounted. */}
            <div
              className={`${styles.terminal} ${
                terminalShown || adbShown ? "" : styles.terminalHidden
              }`}
              aria-hidden={!terminalShown && !adbShown}
            >
              <div
                className={`${styles.terminalPane} ${terminalShown ? "" : styles.hidden}`}
                aria-hidden={!terminalShown}
              >
                <TerminalPanel />
              </div>
              {terminalShown && adbShown && (
                <ResizeHandle
                  direction="horizontal"
                  targetRef={mainRef}
                  cssVar="--adb-w"
                  min={240}
                  max={1200}
                  invert
                  onResizeEnd={handleAdbResizeEnd}
                />
              )}
              {adbMounted && (
                <div
                  className={`${styles.adbPane} ${terminalShown ? "" : styles.adbPaneAlone} ${
                    adbShown ? "" : styles.hidden
                  }`}
                  aria-hidden={!adbShown}
                >
                  <AdbPanel />
                </div>
              )}
            </div>
          </div>
          {!schedulerOpen && selectedWorkspaceId && (
            <>
              {rightSidebarVisible && (
                <ResizeHandle
                  direction="horizontal"
                  targetRef={mainRef}
                  cssVar="--right-sidebar-w"
                  min={150}
                  max={600}
                  invert
                  onResizeEnd={handleRightResizeEnd}
                />
              )}
              <div
                className={`${styles.rightSidebar} ${rightSidebarVisible ? "" : styles.rightSidebarHidden}`}
                aria-hidden={!rightSidebarVisible}
              >
                <div className={styles.rightSidebarContent}>
                  <RightSidebar />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <ModalRouter />
      {fuzzyFinderOpen && <FuzzyFinder />}
      {commandPaletteOpen && <CommandPalette />}
      <ToastContainer />
      <AppTooltip />
    </div>
  );
}
