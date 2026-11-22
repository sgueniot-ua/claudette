import type { AgentStatus } from "../types/workspace";

/**
 * Returns true when the agent is actively occupied — either running a
 * request/response cycle or performing a /compact boundary compaction.
 * Both states should disable the chat input, advance the shared spinner
 * animation, and block actions that assume an idle agent.
 */
export function isAgentBusy(status: AgentStatus | undefined | null): boolean {
  return status === "Running" || status === "Compacting";
}

/**
 * Returns true when the main agent has finished its turn but background
 * tasks are still running (`IdleWithBackground`). Not "busy": the chat
 * input stays enabled.
 */
export function isBackgroundRunning(status: AgentStatus | undefined | null): boolean {
  return status === "IdleWithBackground";
}
