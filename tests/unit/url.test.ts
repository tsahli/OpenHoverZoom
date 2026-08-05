import { describe, expect, it } from "vitest";
import { isRemoteUrl, normalizeUrl } from "../../src/resolver/url";
import { validateFetchUrl } from "../../src/background/validate-url";

describe("URL validation", () => {
  it("resolves relative HTTP URLs", () => {
    expect(normalizeUrl("../large.jpg", "https://example.com/gallery/page")).toBe(
      "https://example.com/large.jpg",
    );
  });

  it("rejects credentials and unsupported protocols", () => {
    expect(normalizeUrl("https://user:secret@example.com/image.jpg", "https://example.com")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)", "https://example.com")).toBeNull();
    expect(normalizeUrl("file:///tmp/image.jpg", "https://example.com")).toBeNull();
  });

  it("allows local page media only when explicitly requested", () => {
    const dataImage = "data:image/png;base64,AAAA";
    expect(normalizeUrl(dataImage, "https://example.com")).toBeNull();
    expect(normalizeUrl(dataImage, "https://example.com", { allowPageLocal: true })).toBe(dataImage);
    expect(
      normalizeUrl("data:text/html,<script></script>", "https://example.com", {
        allowPageLocal: true,
      }),
    ).toBeNull();
  });

  it("keeps local media out of background-fetch URLs", () => {
    expect(validateFetchUrl("blob:https://example.com/id")).toBeNull();
    expect(validateFetchUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(validateFetchUrl("/article", "https://example.com/gallery")).toMatchObject({
      href: "https://example.com/article",
    });
    expect(isRemoteUrl("https://example.com/image.jpg")).toBe(true);
  });
});
