import type { SessionStatusKind } from "./SessionStatusIcon";

export type SessionStatusLabelKey =
  | "status_running"
  | "status_background"
  | "status_idle"
  | "status_badge_ask_aria"
  | "status_badge_plan_aria"
  | "status_badge_completed_aria"
  | "status_stopped";

/** i18n key (namespace `sidebar`) of the accessible label for a session status. */
export function sessionStatusLabelKey(status: SessionStatusKind): SessionStatusLabelKey {
  switch (status.kind) {
    case "running":
      return "status_running";
    case "background":
      return "status_background";
    case "idle":
      return "status_idle";
    case "ask":
      return "status_badge_ask_aria";
    case "plan":
      return "status_badge_plan_aria";
    case "unread":
      return "status_badge_completed_aria";
    case "stopped":
      return "status_stopped";
  }
}
