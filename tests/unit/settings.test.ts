import { describe, expect, it } from "vitest";
import { isSiteDisabled, sanitizeSettings, siteFromUrl } from "../../src/shared/settings";

describe("settings", () => {
  it("bounds numeric values and sanitizes site names", () => {
    expect(
      sanitizeSettings({
        enabled: false,
        hoverDelayMs: 9,
        maxPreviewPercent: 120,
        disabledSites: ["Example.COM", "bad/site", "example.com"],
      }),
    ).toMatchObject({
      enabled: false,
      hoverDelayMs: 100,
      maxPreviewPercent: 95,
      disabledSites: ["example.com"],
    });
  });

  it("uses exact hostnames for per-site disablement", () => {
    const settings = sanitizeSettings({ disabledSites: ["example.com"] });
    expect(isSiteDisabled(settings, "https://example.com/page")).toBe(true);
    expect(isSiteDisabled(settings, "https://sub.example.com/page")).toBe(false);
    expect(siteFromUrl("chrome://extensions")).toBeNull();
  });
});
