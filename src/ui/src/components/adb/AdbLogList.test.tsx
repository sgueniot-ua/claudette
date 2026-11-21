// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogcatLine } from "../../types/adb";
import { type AdbLogBuffer, createAdbLogBuffer } from "./adbLogBuffer";
import { AdbLogList } from "./AdbLogList";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const VIEWPORT = 200;
const scrollTops = new WeakMap<Element, number>();

function line(n: number, message = `msg-${n}`): LogcatLine {
  return { ts: null, pid: 1, tid: 1, level: "i", tag: "T", message };
}
function lines(from: number, to: number): LogcatLine[] {
  return Array.from({ length: to - from }, (_, i) => line(from + i));
}
const ROW = '[data-testid="adb-log-row"]';
const BUTTON_TEXT = "adb_latest_logs";
let container: HTMLElement;
let root: Root;

function rowCount(): number {
  return container.querySelectorAll(ROW).length;
}
function scroller(): HTMLElement {
  return container.querySelector('[data-testid="adb-log-scroll"]') as HTMLElement;
}
function button(): HTMLButtonElement | null {
  return container.querySelector("button");
}
async function show(buffer: AdbLogBuffer, version: number) {
  await act(async () => {
    root.render(<AdbLogList workspaceId="w" version={version} buffer={buffer} />);
  });
}
async function scrollTo(top: number) {
  const el = scroller();
  scrollTops.set(el, top);
  await act(async () => {
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}
async function append(buffer: AdbLogBuffer, from: number, to: number, reset = false) {
  await act(async () => {
    buffer.append("w", lines(from, to), reset);
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(VIEWPORT);
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get() {
      return scrollTops.get(this) ?? 0;
    },
    set(value: number) {
      scrollTops.set(this, value);
    },
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("AdbLogList", () => {
  // FR-006
  it("renders only a window of a 50 000-line buffer", async () => {
    const buffer = createAdbLogBuffer(60_000);
    buffer.append("w", lines(0, 50_000));
    await show(buffer, 1);
    expect(rowCount()).toBeGreaterThan(0);
    expect(rowCount()).toBeLessThanOrEqual(60);
  });

  // FR-006
  it("renders a 20 000-character line as a single row", async () => {
    const buffer = createAdbLogBuffer(10);
    buffer.append("w", [line(0, "x".repeat(20_000))]);
    await show(buffer, 1);
    expect(rowCount()).toBe(1);
  });

  // FR-006
  it("contains no editable element", async () => {
    const buffer = createAdbLogBuffer(10);
    buffer.append("w", lines(0, 5));
    await show(buffer, 1);
    expect(container.querySelector("input, textarea, [contenteditable]")).toBeNull();
  });

  // FR-006a
  it("follows the bottom by default and shows no button", async () => {
    const buffer = createAdbLogBuffer(1000);
    buffer.append("w", lines(0, 100));
    await show(buffer, 1);
    expect(button()).toBeNull();
    await append(buffer, 100, 200);
    await show(buffer, 2);
    expect(container.textContent).toContain("msg-199");
    expect(button()).toBeNull();
  });

  // FR-006a
  it("freezes on scroll up, keeps the first row stable, and resumes via the button", async () => {
    const buffer = createAdbLogBuffer(1000);
    buffer.append("w", lines(0, 100));
    await show(buffer, 1);
    await scrollTo(400);
    expect(button()?.textContent).toBe(BUTTON_TEXT);
    const firstRow = container.querySelector(ROW)?.textContent;
    await append(buffer, 100, 150);
    await show(buffer, 2);
    expect(container.querySelector(ROW)?.textContent).toBe(firstRow);
    expect(container.textContent).not.toContain("msg-149");

    await act(async () => {
      button()?.click();
    });
    expect(button()).toBeNull();
    expect(container.textContent).toContain("msg-149");
  });

  // FR-006b
  it("keeps the displayed content anchored when old lines are evicted while frozen", async () => {
    const buffer = createAdbLogBuffer(100);
    buffer.append("w", lines(0, 100));
    await show(buffer, 1);
    await scrollTo(1000); // anchor at absolute index 50
    await append(buffer, 100, 130); // evicts 30
    await show(buffer, 2);
    expect(scroller().scrollTop).toBe((50 - 30) * 20);
    expect(container.textContent).toContain("msg-50");
  });

  // FR-006a
  it("resumes following after a clear/reset session boundary", async () => {
    const buffer = createAdbLogBuffer(1000);
    buffer.append("w", lines(0, 100));
    await show(buffer, 1);
    await scrollTo(400);
    expect(button()).not.toBeNull();
    await append(buffer, 0, 10, true);
    await show(buffer, 2);
    expect(button()).toBeNull();
    expect(container.textContent).toContain("msg-9");
  });

  // FR-006a
  it("resumes following when a reset is followed by more lines than before", async () => {
    const buffer = createAdbLogBuffer(1000);
    buffer.append("w", lines(0, 100));
    await show(buffer, 1);
    await scrollTo(400);
    expect(button()).not.toBeNull();
    await append(buffer, 0, 300, true);
    await show(buffer, 2);
    expect(button()).toBeNull();
    expect(container.textContent).toContain("msg-299");
  });

  // FR-006a
  it("does not move a frozen non-row-aligned scroll position", async () => {
    const buffer = createAdbLogBuffer(100);
    buffer.append("w", lines(0, 90));
    await show(buffer, 1);
    await scrollTo(407);
    await append(buffer, 90, 95); // no eviction
    await show(buffer, 2);
    expect(scroller().scrollTop).toBe(407);
    await append(buffer, 95, 110); // evicts 10
    await show(buffer, 3);
    expect(scroller().scrollTop).toBe(407 - 10 * 20);
  });
});
