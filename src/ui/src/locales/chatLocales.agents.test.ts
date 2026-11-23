import { describe, expect, it } from "vitest";
import de from "./de/chat.json";
import en from "./en/chat.json";
import es from "./es/chat.json";
import ja from "./ja/chat.json";
import ptBR from "./pt-BR/chat.json";
import zhCN from "./zh-CN/chat.json";

const KEYS = [
  "running_agents_bar_label",
  "running_agents_more",
  "running_agent_open",
  "running_agent_open_untyped",
  "running_agents_more_label",
  "running_agent_default_label",
  "agents_tab",
  "agents_panel_empty",
  "agents_panel_running",
  "agents_panel_finished",
  "agents_panel_all",
  "agents_state_running",
  "agents_state_completed",
  "agents_state_failed",
  "agents_state_stopped",
  "agents_state_queued",
] as const;

const PLACEHOLDERS: Record<string, string[]> = {
  running_agents_more: ["count"],
  running_agent_open: ["type", "description", "state"],
  running_agent_open_untyped: ["description", "state"],
  running_agents_more_label: ["count"],
};

const locales = { de, en, es, ja, "pt-BR": ptBR, "zh-CN": zhCN } as Record<
  string,
  Record<string, string>
>;

describe("chat locales: agents keys", () => {
  it("every locale has the new keys", () => {
    // FR-014
    for (const [locale, bundle] of Object.entries(locales)) {
      for (const key of KEYS) {
        expect(bundle[key], `${locale}:${key}`).toBeTruthy();
        for (const p of PLACEHOLDERS[key] ?? []) {
          expect(bundle[key], `${locale}:${key}`).toContain(`{{${p}}}`);
        }
      }
    }
  });
});
