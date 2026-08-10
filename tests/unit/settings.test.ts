import { describe, expect, it } from "vitest";
import { isSiteDisabled, sanitizeSettings, siteFromUrl } from "../../src/shared/settings";
import {
  downloadShortcutConflictsWithPreviewDisable,
  matchesDownloadShortcut,
  matchesPreviewDisableShortcut,
  previewDisableShortcutFromKeyboardEvent,
  sanitizeDownloadShortcut,
  sanitizePreviewDisableShortcut,
  shortcutFromKeyboardEvent,
} from "../../src/shared/keyboard-shortcut";

describe("settings", () => {
  it("bounds numeric values and sanitizes site names", () => {
    expect(
      sanitizeSettings({
        enabled: false,
        hoverDelayMs: 9,
        maxPreviewPercent: 120,
        mediaVolumePercent: 130,
        downloadShortcut: "command+shift+d",
        disabledSites: ["Example.COM", "bad/site", "example.com"],
      }),
    ).toMatchObject({
      enabled: false,
      hoverDelayMs: 100,
      maxPreviewPercent: 95,
      mediaVolumePercent: 100,
      downloadShortcut: "Shift+Meta+D",
      disabledSites: ["example.com"],
    });
  });

  it("defaults and bounds hover media volume from zero to one hundred", () => {
    expect(sanitizeSettings({}).mediaVolumePercent).toBe(75);
    expect(sanitizeSettings({ mediaVolumePercent: -1 }).mediaVolumePercent).toBe(0);
    expect(sanitizeSettings({ mediaVolumePercent: 40.6 }).mediaVolumePercent).toBe(41);
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

  it("captures and normalizes a customizable preview disable shortcut", () => {
    const event = {
      altKey: false,
      ctrlKey: true,
      key: "Control",
      metaKey: false,
      shiftKey: false,
    };
    expect(previewDisableShortcutFromKeyboardEvent(event)).toBe("Ctrl");
    expect(matchesPreviewDisableShortcut(event, "Ctrl")).toBe(true);
    expect(matchesPreviewDisableShortcut({ ...event, shiftKey: true }, "Ctrl")).toBe(true);
    expect(matchesPreviewDisableShortcut({ ...event, key: "t" }, "Ctrl")).toBe(false);
    expect(sanitizePreviewDisableShortcut("control+shift")).toBe("Ctrl+Shift");
  });

  it("ignores synthetic keyboard events without a key", () => {
    const event = {
      altKey: false,
      ctrlKey: false,
      key: undefined,
      metaKey: false,
      shiftKey: false,
    } as unknown as KeyboardEvent;

    expect(shortcutFromKeyboardEvent(event)).toBeNull();
    expect(matchesPreviewDisableShortcut(event, "Ctrl")).toBe(false);
  });

  it("resolves shortcut conflicts while allowing Ctrl downloads with another disable key", () => {
    expect(sanitizeSettings({ downloadShortcut: "Ctrl+D" }).downloadShortcut).toBe("Enter");
    expect(
      sanitizeSettings({
        downloadShortcut: "Ctrl+D",
        previewDisableShortcut: "Alt",
      }),
    ).toMatchObject({
      downloadShortcut: "Ctrl+D",
      previewDisableShortcut: "Alt",
    });
    expect(downloadShortcutConflictsWithPreviewDisable("Shift+D", "Shift")).toBe(true);
  });

  it("uses exact hostnames for per-site disablement", () => {
    const settings = sanitizeSettings({ disabledSites: ["example.com"] });
    expect(isSiteDisabled(settings, "https://example.com/page")).toBe(true);
    expect(isSiteDisabled(settings, "https://sub.example.com/page")).toBe(false);
    expect(siteFromUrl("chrome://extensions")).toBeNull();
  });
});
