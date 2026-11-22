import { describe, it, expect } from "vitest";
import { sessionStatusLabelKey } from "./sessionStatusLabel";
import type { SessionStatusKind } from "./SessionStatusIcon";
import en from "../../locales/en/sidebar.json";
import es from "../../locales/es/sidebar.json";
import ptBR from "../../locales/pt-BR/sidebar.json";
import ja from "../../locales/ja/sidebar.json";
import zhCN from "../../locales/zh-CN/sidebar.json";
import de from "../../locales/de/sidebar.json";

const kinds: SessionStatusKind["kind"][] = [
  "running", "background", "idle", "ask", "plan", "unread", "stopped",
];
const keyOf = (kind: SessionStatusKind["kind"]) =>
  sessionStatusLabelKey({ kind } as SessionStatusKind);

describe("sessionStatusLabelKey", () => {
  // FR-010
  it("gives every variant a distinct key that exists in the en locale", () => {
    const keys = kinds.map(keyOf);
    expect(new Set(keys).size).toBe(kinds.length);
    for (const key of keys) {
      expect(Object.keys(en)).toContain(key);
    }
  });

  // FR-007
  it("distinguishes running, background and idle", () => {
    const keys = new Set([keyOf("running"), keyOf("background"), keyOf("idle")]);
    expect(keys.size).toBe(3);
  });

  // FR-010
  it("has a non-empty status_background in every locale", () => {
    for (const locale of [en, es, ptBR, ja, zhCN, de]) {
      expect(locale.status_background.trim()).not.toBe("");
    }
  });
});
