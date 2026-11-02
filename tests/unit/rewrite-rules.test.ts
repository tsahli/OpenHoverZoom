import { describe, expect, it } from "vitest";
import { applyRewriteRules, type RewriteRule } from "../../src/resolver/rewrite-rules";

const candidate = {
  url: "https://media.example/thumb/photo-small.jpg",
  kind: "image" as const,
  source: "image-src" as const,
  confidence: 60,
};

describe("declarative rewrites", () => {
  it("applies a host-bounded string replacement", () => {
    const rule: RewriteRule = {
      id: "fixture-size-token",
      appliesTo: "image",
      pageHosts: ["gallery.example"],
      mediaHosts: ["media.example"],
      match: /-small(?=\.jpg$)/u,
      replace: "-original",
      priority: 10,
    };
    expect(
      applyRewriteRules(candidate, { pageUrl: "https://gallery.example/item", target: "image" }, [
        rule,
      ]),
    ).toEqual([
      {
        ...candidate,
        url: "https://media.example/thumb/photo-original.jpg",
        source: "rewrite-rule",
        confidence: 70,
        quality: "original",
      },
    ]);
  });

  it("rejects stateful regular expressions", () => {
    const rule: RewriteRule = {
      id: "unsafe-stateful-pattern",
      appliesTo: "both",
      match: /small/gu,
      replace: "large",
    };
    expect(
      applyRewriteRules(candidate, { pageUrl: "https://gallery.example", target: "image" }, [rule]),
    ).toEqual([]);
  });

  describe("X media", () => {
    const rewrite = (url: string): string[] =>
      applyRewriteRules(
        { ...candidate, url },
        { pageUrl: "https://x.com/home", target: "image" },
      ).map((item) => item.url);

    it.each([
      ["jpg", "small"],
      ["jpg", "360x360"],
      ["jpg", "240x240"],
      ["png", "small"],
    ])("requests the original of a %s %s rendition", (format, name) => {
      expect(rewrite(`https://pbs.twimg.com/media/HV56yHnXcAAwYJ2?format=${format}&name=${name}`)).toEqual([
        `https://pbs.twimg.com/media/HV56yHnXcAAwYJ2?format=${format}&name=orig`,
      ]);
    });

    it("requests the large WebP rendition because WebP originals do not exist", () => {
      expect(rewrite("https://pbs.twimg.com/media/BhxWutnCEAAtEQ6?format=webp&name=small")).toEqual([
        "https://pbs.twimg.com/media/BhxWutnCEAAtEQ6?format=webp&name=large",
      ]);
    });

    it("ranks above the linked-document lookup threshold", () => {
      const [rewritten] = applyRewriteRules(
        {
          ...candidate,
          url: "https://pbs.twimg.com/media/HV56yHnXcAAwYJ2?format=jpg&name=small",
          source: "image-src",
          confidence: 58,
        },
        { pageUrl: "https://x.com/home", target: "image" },
      );
      expect(rewritten?.confidence).toBeGreaterThanOrEqual(90);
    });

    it.each([
      ["already original", "https://pbs.twimg.com/media/HV56yHnXcAAwYJ2?format=jpg&name=orig"],
      ["a video poster", "https://pbs.twimg.com/media/HUCWq0kXUAANHzF.jpg"],
      ["a video thumbnail", "https://pbs.twimg.com/amplify_video_thumb/211/img/106nHEUM.jpg"],
      ["an avatar", "https://pbs.twimg.com/profile_images/190/UutmZxGI_normal.jpg"],
      ["another host", "https://media.example/media/HV56yHnXcAAwYJ2?format=jpg&name=small"],
    ])("leaves %s unchanged", (_label, url) => {
      expect(rewrite(url)).toEqual([]);
    });
  });
});
