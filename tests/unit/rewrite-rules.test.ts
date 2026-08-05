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
});
