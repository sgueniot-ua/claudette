import { useEffect, useState } from "react";
import { getAppSetting } from "../services/tauri/settings";

/**
 * Whether team agents open as their own chat tabs (`team_agent_session_tabs_enabled`,
 * absent = on). Read once on mount; true while unknown.
 */
export function useTeamAgentSessionTabs(): boolean {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    let cancelled = false;
    getAppSetting("team_agent_session_tabs_enabled")
      .then((val) => {
        if (!cancelled) setEnabled(val !== "false");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
