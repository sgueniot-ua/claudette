import { describe, expect, it } from "vitest";
import { resolveBranchPrefix } from "./branchPrefix";

describe("resolveBranchPrefix", () => {
  it("none gives an empty prefix", () => {
    expect(resolveBranchPrefix("none", "ignored", "jane")).toBe("");
  });

  it("custom is sanitized per segment", () => {
    expect(resolveBranchPrefix("custom", " /Team A/Jane_D/ ", null)).toBe(
      "team-a/jane-d/",
    );
    expect(resolveBranchPrefix("custom", "///", null)).toBe("");
    expect(resolveBranchPrefix("custom", null, null)).toBe("");
  });

  it("username (or unset mode) slugs the git username", () => {
    expect(resolveBranchPrefix("username", null, "Jane Doe")).toBe("jane-doe/");
    expect(resolveBranchPrefix(null, null, "Jane Doe")).toBe("jane-doe/");
  });

  it("falls back to claudette/ without a usable username", () => {
    expect(resolveBranchPrefix("username", null, null)).toBe("claudette/");
    expect(resolveBranchPrefix("username", null, "éé")).toBe("claudette/");
  });

  it("truncates to 30 chars without trailing hyphen", () => {
    expect(
      resolveBranchPrefix("username", null, `${"a".repeat(29)} bbb`),
    ).toBe(`${"a".repeat(29)}/`);
  });
});
