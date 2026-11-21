import { describe, expect, it } from "vitest";
import { isAdbAvailable } from "./adbVisibility";

const local = { repository_id: "r1", remote_connection_id: null };

describe("isAdbAvailable", () => {
  it("is false without a workspace", () => {
    // FR-003a
    expect(isAdbAvailable(undefined, { r1: true })).toBe(false);
    expect(isAdbAvailable(null, { r1: true })).toBe(false);
  });

  it("is false when the Android mode is off or not loaded", () => {
    // FR-001a
    expect(isAdbAvailable(local, { r1: false })).toBe(false);
    expect(isAdbAvailable(local, {})).toBe(false);
  });

  it("is false for a remote workspace even with the mode on", () => {
    // FR-003a
    expect(isAdbAvailable({ ...local, remote_connection_id: "c1" }, { r1: true })).toBe(false);
  });

  it("is true for a local workspace of an Android-mode repository", () => {
    // FR-001a
    expect(isAdbAvailable(local, { r1: true })).toBe(true);
  });
});
