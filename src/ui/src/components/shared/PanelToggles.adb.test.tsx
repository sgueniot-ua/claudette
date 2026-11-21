// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../stores/useAppStore";
import type { Workspace } from "../../types/workspace";
import { PanelToggles } from "./PanelToggles";

const workspace = {
  id: "ws-1",
  repository_id: "repo-1",
  remote_connection_id: null,
} as Workspace;

let root: Root;
let container: HTMLDivElement;

async function render() {
  await act(async () => {
    root.render(<PanelToggles />);
  });
}

const adbButton = () =>
  container.querySelector<HTMLButtonElement>('button[aria-label="Toggle ADB panel"]');

describe("PanelToggles ADB button", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAppStore.setState({
      workspaces: [workspace],
      selectedWorkspaceId: "ws-1",
      androidModeByRepo: {},
      adbPanelVisible: false,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useAppStore.setState({ workspaces: [], selectedWorkspaceId: null, androidModeByRepo: {} });
  });

  it("is absent without the Android mode", async () => {
    // FR-001a
    await render();
    expect(adbButton()).toBeNull();
  });

  it("is absent for a remote workspace", async () => {
    // FR-003a
    useAppStore.setState({
      workspaces: [{ ...workspace, remote_connection_id: "c1" }],
      androidModeByRepo: { "repo-1": true },
    });
    await render();
    expect(adbButton()).toBeNull();
  });

  it("is present with the Android mode and toggles the panel", async () => {
    // FR-001
    useAppStore.setState({ androidModeByRepo: { "repo-1": true } });
    await render();
    const button = adbButton();
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      button!.click();
    });
    expect(useAppStore.getState().adbPanelVisible).toBe(true);
    expect(adbButton()!.getAttribute("aria-pressed")).toBe("true");
  });
});
