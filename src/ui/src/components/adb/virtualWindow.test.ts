import { describe, expect, it } from "vitest";
import { computeWindow } from "./virtualWindow";

describe("computeWindow", () => {
  // FR-006
  it("renders the visible rows plus the overscan margin at the top", () => {
    expect(
      computeWindow({ scrollTop: 0, viewport: 200, rowHeight: 20, total: 50000, overscan: 20 }),
    ).toEqual({ start: 0, end: 30 });
  });

  // FR-006
  it("extends the margin on both sides when scrolled", () => {
    expect(
      computeWindow({ scrollTop: 2000, viewport: 200, rowHeight: 20, total: 50000, overscan: 20 }),
    ).toEqual({ start: 80, end: 130 });
  });

  // FR-006
  it("clamps to the total", () => {
    expect(
      computeWindow({ scrollTop: 400, viewport: 200, rowHeight: 20, total: 25, overscan: 20 }),
    ).toEqual({ start: 0, end: 25 });
    expect(
      computeWindow({ scrollTop: 0, viewport: 200, rowHeight: 20, total: 0, overscan: 20 }),
    ).toEqual({ start: 0, end: 0 });
  });
});
