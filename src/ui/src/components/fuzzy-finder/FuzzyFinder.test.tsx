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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openProjectChatTarget } from "../../hooks/useOpenProjectChat";
import { FuzzyFinder, filterFuzzyWorkspaces, filterFuzzyProjectChats } from "./FuzzyFinder";
import type { Repository } from "../../types/repository";
import { useAppStore } from "../../stores/useAppStore";
import type { Workspace } from "../../types/workspace";

vi.mock("../../hooks/useOpenProjectChat", () => ({
  openProjectChatTarget: vi.fn(async () => {}),
}));

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

describe("filterFuzzyProjectChats", () => {
  const repo = (id: string, name: string, remote: string | null = null) =>
    ({ id, name, remote_connection_id: remote }) as unknown as Repository;

  it("fuzzy finder lists one project chats entry per local repo", () => { // FR-013
    const repos = [repo("r1", "alpha"), repo("r2", "beta"), repo("r3", "gamma", "conn")];
    expect(filterFuzzyProjectChats(repos, "").map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(filterFuzzyProjectChats(repos, "BET").map((r) => r.id)).toEqual(["r2"]);
    // The generic label must not flood the results (matches on repo name only).
    expect(filterFuzzyProjectChats(repos, "chats")).toEqual([]);
    expect(filterFuzzyProjectChats(repos, "pro")).toEqual([]);
  });
});

describe("FuzzyFinder project chats entry", () => {
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = null;
    document.body.innerHTML = "";
    useAppStore.setState({ fuzzyFinderOpen: false });
  });

  it("selecting a project chats entry opens it and closes the finder", async () => { // FR-013
    vi.mocked(openProjectChatTarget).mockClear();
    useAppStore.setState({
      workspaces: [],
      repositories: [
        { id: "r1", name: "alpha", remote_connection_id: null } as unknown as Repository,
      ],
      fuzzyFinderOpen: true,
    });
    await mount();
    const entry = container!.querySelector<HTMLElement>("[class*=result]:not([class*=results])");
    expect(entry?.textContent).toContain("alpha");
    await act(async () => {
      entry!.click();
    });
    expect(openProjectChatTarget).toHaveBeenCalledWith("r1");
    expect(useAppStore.getState().fuzzyFinderOpen).toBe(false);
  });

  it("lists workspaces before project entries (empty query: first result is a workspace)", async () => { // FR-013
    vi.mocked(openProjectChatTarget).mockClear();
    useAppStore.setState({
      workspaces: [
        {
          id: "w1",
          repository_id: "r1",
          name: "alpha-ws",
          branch_name: "main",
          worktree_path: "/wt",
          status: "Active",
          agent_status: "Idle",
          status_line: "",
          created_at: "2026-01-01T00:00:00Z",
          sort_order: 0,
          input_values: null,
          remote_connection_id: null,
          kind: "worktree",
        },
      ],
      repositories: [
        { id: "r1", name: "alpha", remote_connection_id: null } as unknown as Repository,
      ],
      fuzzyFinderOpen: true,
    });
    await mount();
    const entries = Array.from(
      container!.querySelector("[class*=results]")!.children,
    ) as HTMLElement[];
    expect(entries).toHaveLength(2);
    expect(entries[0].textContent).toContain("alpha-ws");
    expect(entries[1].textContent).toContain("alpha");
    expect(entries[1].textContent).not.toContain("alpha-ws");
  });
});
