import { beforeEach, describe, expect, it } from "vitest";

import { useAppStore } from "../stores/useAppStore";
import {
  applyAgentPermissionPrompt,
  parseClaudePermissionApproval,
} from "./useAgentStream";

describe("parseClaudePermissionApproval", () => {
  it("builds a toolUse approval for a Bash ask rule", () => {
    const a = parseClaudePermissionApproval("s1", "t1", {
      toolName: "Bash",
      toolInput: { command: "git push --force", description: "Force push" },
      decisionReasonType: "rule",
    });
    expect(a).toMatchObject({
      sessionId: "s1",
      toolUseId: "t1",
      kind: "toolUse",
      agentLabel: "Claude",
      supportsDenyReason: true,
    });
    expect(a!.details.map((d) => d.labelKey)).toEqual([
      "tool",
      "command",
      "description",
    ]);
    expect(a!.details[1].value).toBe("git push --force");
  });

  it("shows the path for file tools", () => {
    const a = parseClaudePermissionApproval("s1", "t1", {
      toolName: "Edit",
      toolInput: { file_path: "/x/y.ts" },
    });
    expect(a!.details.map((d) => d.labelKey)).toEqual(["tool", "path"]);
  });

  it("shows url, pattern, and edit/write content", () => {
    const labels = (toolName: string, toolInput: Record<string, unknown>) =>
      parseClaudePermissionApproval("s1", "t1", { toolName, toolInput })!.details;
    expect(labels("WebFetch", { url: "https://x.dev" }).map((d) => d.labelKey)).toEqual([
      "tool",
      "url",
    ]);
    expect(labels("Grep", { pattern: "foo", path: "/src" }).map((d) => d.labelKey)).toEqual([
      "tool",
      "pattern",
      "path",
    ]);
    const edit = labels("Edit", { file_path: "/a", old_string: "x", new_string: "y" });
    expect(edit.map((d) => [d.labelKey, d.value])).toEqual([
      ["tool", "Edit"],
      ["path", "/a"],
      ["oldText", "x"],
      ["newText", "y"],
    ]);
    const write = labels("Write", { file_path: "/a", content: "hello" });
    expect(write.map((d) => d.labelKey)).toEqual(["tool", "path", "newText"]);
  });

  it("falls back to truncated JSON input for unknown tools", () => {
    const a = parseClaudePermissionApproval("s1", "t1", {
      toolName: "mcp__x__do",
      toolInput: { id: 7 },
    });
    expect(a!.details.map((d) => d.labelKey)).toEqual(["tool", "input"]);
    expect(a!.details[1].value).toBe(JSON.stringify({ id: 7 }, null, 2));

    const big = parseClaudePermissionApproval("s1", "t1", {
      toolName: "mcp__x__do",
      toolInput: { blob: "a".repeat(5000) },
    });
    const value = big!.details[1].value;
    expect(value.length).toBe(2001);
    expect(value.endsWith("…")).toBe(true);
  });

  it("adds no input fallback for an empty toolInput", () => {
    const a = parseClaudePermissionApproval("s1", "t1", { toolName: "X", toolInput: {} });
    expect(a!.details.map((d) => d.labelKey)).toEqual(["tool"]);
  });

  it("returns null without toolName", () => {
    expect(parseClaudePermissionApproval("s1", "t1", { toolInput: {} })).toBeNull();
  });
});

describe("applyAgentPermissionPrompt — ClaudePermissionApproval", () => {
  beforeEach(() => {
    useAppStore.setState({ agentApprovals: {} });
  });

  it("stores a toolUse approval", () => {
    applyAgentPermissionPrompt({
      chat_session_id: "s1",
      tool_use_id: "t1",
      tool_name: "ClaudePermissionApproval",
      input: { toolName: "Bash", toolInput: { command: "ls" } },
    });
    expect(useAppStore.getState().agentApprovals["s1"].kind).toBe("toolUse");
  });
});

describe("clearAgentApproval with toolUseId", () => {
  beforeEach(() => {
    useAppStore.setState({ agentApprovals: {} });
  });

  const prompt = (toolUseId: string) =>
    applyAgentPermissionPrompt({
      chat_session_id: "s1",
      tool_use_id: toolUseId,
      tool_name: "ClaudePermissionApproval",
      input: { toolName: "Bash", toolInput: { command: toolUseId } },
    });

  it("keeps a newer card that replaced the answered one", () => {
    prompt("t1");
    prompt("t2");
    useAppStore.getState().clearAgentApproval("s1", "t1");
    expect(useAppStore.getState().agentApprovals["s1"].toolUseId).toBe("t2");
  });

  it("clears the card when the toolUseId matches", () => {
    prompt("t1");
    useAppStore.getState().clearAgentApproval("s1", "t1");
    expect(useAppStore.getState().agentApprovals["s1"]).toBeUndefined();
  });

  it("still clears by session when no toolUseId is given", () => {
    prompt("t1");
    useAppStore.getState().clearAgentApproval("s1");
    expect(useAppStore.getState().agentApprovals["s1"]).toBeUndefined();
  });
});
