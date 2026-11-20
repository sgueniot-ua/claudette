// @vitest-environment happy-dom

// Regression test: pressing Escape inside the fuzzy finder used to bubble
// through to the global `dismiss-or-stop` handler in `useKeyboardShortcuts`.
// Because that listener captured `fuzzyFinderOpen` in a closure that didn't
// update until React re-rendered, the global branch fell through to the
// agent-stop path and cancelled the running workspace. The component now
// calls preventDefault + stopImmediatePropagation so the global listener
// never sees the event.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FuzzyFinder, filterFuzzyWorkspaces } from "./FuzzyFinder";
import { useAppStore } from "../../stores/useAppStore";
import type { Workspace } from "../../types/workspace";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(FuzzyFinder));
  });
}

describe("FuzzyFinder Escape handling", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    useAppStore.setState({
      workspaces: [],
      repositories: [],
      fuzzyFinderOpen: true,
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    root = null;
    container = null;
    document.body.innerHTML = "";
    useAppStore.setState({ fuzzyFinderOpen: false });
  });

  it("closes the finder and stops the native event from bubbling to window", async () => {
    await mount();

    const input = container!.querySelector("input");
    expect(input).toBeTruthy();

    // Listen at the window so we can assert the event never reaches the
    // global keyboard handler — `stopImmediatePropagation()` should prevent
    // any window-level listener from firing.
    let windowSawEscape = false;
    const windowListener = (e: KeyboardEvent) => {
      if (e.key === "Escape") windowSawEscape = true;
    };
    window.addEventListener("keydown", windowListener);

    await act(async () => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    window.removeEventListener("keydown", windowListener);

    expect(useAppStore.getState().fuzzyFinderOpen).toBe(false);
    expect(windowSawEscape).toBe(false);
  });
});

describe("filterFuzzyWorkspaces", () => {
  const make = (id: string, kind: Workspace["kind"]): Workspace => ({
    id,
    repository_id: "repo-1",
    name: id,
    branch_name: id,
    worktree_path: null,
    status: "Active",
    agent_status: "Idle",
    status_line: "",
    created_at: "2026-01-01T00:00:00Z",
    sort_order: 0,
    input_values: null,
    remote_connection_id: null,
    kind,
  });

  it("excludes project chat workspaces", () => { // FR-013
    const out = filterFuzzyWorkspaces(
      [make("alpha", "worktree"), make("@project", "repository")],
      "",
    );
    expect(out.map((w) => w.id)).toEqual(["alpha"]);
  });

  it("still matches by name or branch", () => {
    const out = filterFuzzyWorkspaces(
      [make("alpha", "worktree"), make("beta", "worktree")],
      "BET",
    );
    expect(out.map((w) => w.id)).toEqual(["beta"]);
  });
});
