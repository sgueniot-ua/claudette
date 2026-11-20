import { describe, expect, it } from "vitest";
import i18n, { SUPPORTED_LANGUAGES } from "./i18n";

describe("rollback_project_others_running plurals", () => {
  // FR-017
  it("uses singular and plural forms in English", () => {
    const t = i18n.getFixedT("en", "modals");
    expect(t("rollback_project_others_running", { count: 1 })).toBe(
      "1 other chat in this project is running and may be changing these files right now.",
    );
    expect(t("rollback_project_others_running", { count: 2 })).toBe(
      "2 other chats in this project are running and may be changing these files right now.",
    );
  });

  it("resolves a translation with the count in every language", () => {
    for (const lng of SUPPORTED_LANGUAGES) {
      const t = i18n.getFixedT(lng, "modals");
      for (const count of [1, 3]) {
        const text = t("rollback_project_others_running", { count });
        expect(text, `${lng} count=${count}`).toContain(String(count));
        expect(text).not.toContain("rollback_project_others_running");
        expect(text).not.toContain("(s)");
        if (lng !== "en") {
          const en = i18n.getFixedT("en", "modals");
          expect(text, `${lng} is translated`).not.toBe(
            en("rollback_project_others_running", { count }),
          );
        }
      }
    }
  });
});
