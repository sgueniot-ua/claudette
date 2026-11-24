// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { NewWorkspaceModal } from "./NewWorkspaceModal";
import {
  getAppSetting,
  getGitUsername,
  listWorkspaceBranches,
} from "../../services/tauri";
import { createWorkspaceOrchestrated } from "../../hooks/useCreateWorkspace";
import { useAppStore } from "../../stores/useAppStore";
import type { Repository } from "../../types/repository";
import type { WorkspaceBranch } from "../../types/workspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../services/tauri", () => ({
  listWorkspaceBranches: vi.fn(),
  getAppSetting: vi.fn(),
  getGitUsername: vi.fn(),
}));
vi.mock("../../hooks/useCreateWorkspace", () => ({
  createWorkspaceOrchestrated: vi.fn().mockResolvedValue(null),
}));

const mockedList = vi.mocked(listWorkspaceBranches);
const mockedCreate = vi.mocked(createWorkspaceOrchestrated);
const mockedSetting = vi.mocked(getAppSetting);
const mockedUsername = vi.mocked(getGitUsername);

function textInput(placeholder: string): HTMLInputElement {
  const el = Array.from(
    document.querySelectorAll<HTMLInputElement>("input[type=text]"),
  ).find((i) => i.placeholder.includes(placeholder));
  if (!el) throw new Error(`no input with placeholder "${placeholder}"`);
  return el;
}

function branch(
  name: string,
  remote: string | null = null,
  checked_out_at: string | null = null,
): WorkspaceBranch {
  return { branch: { name, remote }, checked_out_at };
}

const roots: Root[] = [];

async function render(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<NewWorkspaceModal />);
  });
  return container;
}

function byText(selector: string, text: string): HTMLElement {
  const el = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
    (e) => e.textContent?.includes(text),
  );
  if (!el) throw new Error(`no ${selector} containing "${text}"`);
  return el;
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const repo = { id: "repo-1", base_branch: "origin/main" } as Repository;
  useAppStore.setState({
    repositories: [repo],
    activeModal: "newWorkspace",
    modalData: { repoId: "repo-1" },
  });
  mockedSetting.mockResolvedValue(null);
  mockedUsername.mockResolvedValue(null);
  mockedList.mockResolvedValue([
    branch("main"),
    branch("feat/OMS-1"),
    branch("busy", null, "/tmp/busy"),
    branch("dev", "origin"),
    branch("main", "origin"),
  ]);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("NewWorkspaceModal", () => {
  it("disables branches already checked out", async () => {
    await render();
    await click(byText("button", "Existing branch"));
    const busy = byText("button", "busy") as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toContain("already open");
    expect((byText("button", "feat/OMS-1") as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(document.body.textContent).toContain("origin/dev");
    // The remote twin of local `main` is only offered as a base.
    expect(document.body.textContent).not.toContain("origin/main");
  });

  it("creates from existing branch", async () => {
    await render();
    await click(byText("button", "Existing branch"));
    await click(byText("button", "feat/OMS-1"));
    await click(byText("button", "Create"));
    expect(mockedCreate).toHaveBeenCalledWith("repo-1", {
      source: {
        kind: "existing_branch",
        branch: { name: "feat/OMS-1", remote: null },
      },
    });
    expect(useAppStore.getState().activeModal).toBeNull();
  });

  it("creates new branch from chosen base", async () => {
    await render();
    const select = document.querySelector("select") as HTMLSelectElement;
    // base_branch is `origin/main`: the remote entry wins over the local twin.
    expect(select.value).toBe("origin:main");
    act(() => {
      select.value = "origin:dev";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const create = byText("button", "Create") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    setValue(textInput("feat/my-change"), "feat/x");
    await click(create);
    expect(mockedCreate).toHaveBeenCalledWith("repo-1", {
      source: {
        kind: "new_branch",
        base: { name: "dev", remote: "origin" },
        branch: "feat/x",
      },
    });
  });

  it("refreshes list after fetch", async () => {
    let release!: (v: WorkspaceBranch[]) => void;
    mockedList.mockReset();
    mockedList.mockResolvedValueOnce([branch("main")]);
    mockedList.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    await render();
    await click(byText("button", "Existing branch"));
    expect(document.body.textContent).not.toContain("fresh-branch");
    await act(async () => {
      release([branch("main"), branch("fresh-branch", "origin")]);
    });
    expect(mockedList).toHaveBeenNthCalledWith(1, "repo-1", false);
    expect(mockedList).toHaveBeenNthCalledWith(2, "repo-1", true);
    expect(document.body.textContent).toContain("origin/fresh-branch");
  });

  it("keeps the fetched list when it resolves before the local one", async () => {
    let releaseLocal!: (v: WorkspaceBranch[]) => void;
    mockedList.mockReset();
    mockedList.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseLocal = resolve;
      }),
    );
    mockedList.mockResolvedValueOnce([branch("main"), branch("fresh", "origin")]);
    await render();
    await click(byText("button", "Existing branch"));
    await act(async () => {
      releaseLocal([branch("main")]);
    });
    expect(document.body.textContent).toContain("origin/fresh");
  });

  it("does not flag an error when the local pass fails after the fetched list", async () => {
    let rejectLocal!: (e: unknown) => void;
    mockedList.mockReset();
    mockedList.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectLocal = reject;
      }),
    );
    mockedList.mockResolvedValueOnce([branch("main")]);
    await render();
    await act(async () => {
      rejectLocal(new Error("boom"));
    });
    expect(document.body.textContent).not.toContain("boom");
  });

  it("filters base options with the search box and keeps the chosen base", async () => {
    await render();
    const select = document.querySelector("select") as HTMLSelectElement;
    const options = () => Array.from(select.options).map((o) => o.value);
    expect(options()).toContain("origin:dev");
    setValue(textInput("Search branches"), "dev");
    expect(options()).toEqual(["origin:dev", "origin:main"]);
    setValue(textInput("Search branches"), "oms");
    expect(options()).toEqual(["local:feat/OMS-1", "origin:main"]);
  });

  it("prefills the new branch name with the configured prefix", async () => {
    mockedSetting.mockImplementation(async (k: string) =>
      k === "git_branch_prefix_mode" ? "custom" : "Team",
    );
    await render();
    const input = textInput("feat/my-change");
    expect(input.value).toBe("team/");
    expect((byText("button", "Create") as HTMLButtonElement).disabled).toBe(true);
    setValue(input, "team/x");
    expect((byText("button", "Create") as HTMLButtonElement).disabled).toBe(false);
  });

  it("prefills with the git username by default", async () => {
    mockedUsername.mockResolvedValue("Jane Doe");
    await render();
    expect(textInput("feat/my-change").value).toBe("jane-doe/");
  });
});
