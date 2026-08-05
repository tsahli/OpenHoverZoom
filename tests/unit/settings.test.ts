import { describe, expect, it } from "vitest";
import { isSiteDisabled, sanitizeSettings, siteFromUrl } from "../../src/shared/settings";
import {
  matchesDownloadShortcut,
  sanitizeDownloadShortcut,
  shortcutFromKeyboardEvent,
} from "../../src/shared/keyboard-shortcut";

describe("settings", () => {
  it("bounds numeric values and sanitizes site names", () => {
    expect(
      sanitizeSettings({
        enabled: false,
        hoverDelayMs: 9,
        maxPreviewPercent: 120,
        downloadShortcut: "command+shift+d",
        disabledSites: ["Example.COM", "bad/site", "example.com"],
      }),
    ).toMatchObject({
      enabled: false,
      hoverDelayMs: 100,
      maxPreviewPercent: 95,
      downloadShortcut: "Shift+Meta+D",
      disabledSites: ["example.com"],
    });
  });

  it("captures, normalizes, and matches download shortcuts", () => {
    const event = {
      altKey: false,
      ctrlKey: false,
      key: "d",
      metaKey: true,
      shiftKey: true,
    };
    expect(shortcutFromKeyboardEvent(event)).toBe("Shift+Meta+D");
    expect(matchesDownloadShortcut(event, "Shift+Meta+D")).toBe(true);
    expect(sanitizeDownloadShortcut("Escape")).toBe("Enter");
  });

  it("uses exact hostnames for per-site disablement", () => {
    const settings = sanitizeSettings({ disabledSites: ["example.com"] });
    expect(isSiteDisabled(settings, "https://example.com/page")).toBe(true);
    expect(isSiteDisabled(settings, "https://sub.example.com/page")).toBe(false);
    expect(siteFromUrl("chrome://extensions")).toBeNull();
  });
});
