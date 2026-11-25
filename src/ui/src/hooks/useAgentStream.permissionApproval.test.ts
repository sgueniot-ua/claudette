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
      "reason",
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
