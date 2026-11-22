import { describe, it, expect } from "vitest";
import type { AgentStatus } from "../types/workspace";
import { isAgentBusy, isBackgroundRunning } from "./agentStatus";

describe("isAgentBusy", () => {
  it("returns true for Running", () => {
    expect(isAgentBusy("Running")).toBe(true);
  });
  it("returns true for Compacting", () => {
    expect(isAgentBusy("Compacting")).toBe(true);
  });
  it("returns false for Idle", () => {
    expect(isAgentBusy("Idle")).toBe(false);
  });
  it("returns false for Stopped", () => {
    expect(isAgentBusy("Stopped")).toBe(false);
  });
  it("returns false for undefined", () => {
    expect(isAgentBusy(undefined)).toBe(false);
  });
  it("returns false for null", () => {
    expect(isAgentBusy(null)).toBe(false);
  });
  it("returns false for Error variant object", () => {
    // AgentStatus can be { Error: string } — should NOT count as busy
    expect(isAgentBusy({ Error: "boom" } as unknown as AgentStatus)).toBe(false);
  });
});

describe("isBackgroundRunning", () => {
  // FR-011
  it("treats IdleWithBackground as not busy but background-running", () => {
    expect(isAgentBusy("IdleWithBackground")).toBe(false);
    expect(isBackgroundRunning("IdleWithBackground")).toBe(true);
  });
  // FR-011
  it("returns false for Running", () => {
    expect(isBackgroundRunning("Running")).toBe(false);
  });
});
