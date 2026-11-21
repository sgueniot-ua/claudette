// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "../../../types/repository";

const adbMocks = vi.hoisted(() => ({
  adbGetAndroidMode: vi.fn(),
  adbSetAndroidMode: vi.fn(),
}));

vi.mock("../../../services/adb", () => adbMocks);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { useAppStore } from "../../../stores/useAppStore";
import { AndroidModeSetting } from "./AndroidModeSetting";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];
const mountedContainers: HTMLElement[] = [];

function repo(overrides: Partial<Repository> = {}): Repository {
  return {
    id: "r1",
    path: "/tmp/r1",
    name: "r1",
    path_slug: "r1",
    icon: null,
    created_at: "2026-01-01T00:00:00Z",
    setup_script: null,
    custom_instructions: null,
    sort_order: 0,
    branch_rename_preferences: null,
    setup_script_auto_run: false,
    archive_script: null,
    archive_script_auto_run: false,
    base_branch: null,
    default_remote: null,
    required_inputs: null,
    path_valid: true,
    remote_connection_id: null,
    ...overrides,
  };
}

async function render(r: Repository): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  mountedContainers.push(container);
  await act(async () => {
    root.render(<AndroidModeSetting repo={r} />);
  });
  return container;
}

describe("AndroidModeSetting", () => {
  beforeEach(() => {
    useAppStore.setState({ androidModeByRepo: {} });
    adbMocks.adbGetAndroidMode.mockReset().mockResolvedValue(false);
    adbMocks.adbSetAndroidMode.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    for (const root of mountedRoots.splice(0)) act(() => root.unmount());
    for (const c of mountedContainers.splice(0)) c.remove();
    vi.restoreAllMocks();
  });

  it("is unchecked by default", async () => {
    // FR-001a
    const c = await render(repo());
    const box = c.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box).not.toBeNull();
    expect(box!.checked).toBe(false);
    expect(adbMocks.adbGetAndroidMode).toHaveBeenCalledWith("r1");
  });

  it("reflects the persisted value", async () => {
    // FR-001a
    adbMocks.adbGetAndroidMode.mockResolvedValue(true);
    const c = await render(repo());
    expect(
      c.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked,
    ).toBe(true);
  });

  it("calls the service then updates the store on toggle", async () => {
    // FR-001a
    const c = await render(repo());
    const box = c.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => {
      box.click();
    });
    expect(adbMocks.adbSetAndroidMode).toHaveBeenCalledWith("r1", true);
    expect(useAppStore.getState().androidModeByRepo["r1"]).toBe(true);
  });

  it("toggles when the label is clicked", async () => {
    // FR-001a
    const c = await render(repo());
    const label = c.querySelector("label")!;
    await act(async () => {
      label.click();
    });
    expect(adbMocks.adbSetAndroidMode).toHaveBeenCalledWith("r1", true);
  });

  it("leaves the state unchanged when saving fails", async () => {
    // FR-001a
    vi.spyOn(console, "error").mockImplementation(() => {});
    adbMocks.adbSetAndroidMode.mockRejectedValue(new Error("boom"));
    const c = await render(repo());
    const box = c.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => {
      box.click();
    });
    expect(useAppStore.getState().androidModeByRepo["r1"]).toBe(false);
  });

  it("stays off when loading fails", async () => {
    // FR-001a
    vi.spyOn(console, "error").mockImplementation(() => {});
    adbMocks.adbGetAndroidMode.mockRejectedValue(new Error("boom"));
    const c = await render(repo());
    expect(
      c.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked,
    ).toBe(false);
  });

  it("is hidden for a remote repository", async () => {
    // FR-001a
    const c = await render(repo({ remote_connection_id: "conn" }));
    expect(c.querySelector('input[type="checkbox"]')).toBeNull();
    expect(adbMocks.adbGetAndroidMode).not.toHaveBeenCalled();
  });
});
