import { describe, expect, it } from "vitest";
import type { MediaCandidate } from "../../src/resolver/candidate";
import { rankCandidates } from "../../src/resolver/score-candidates";

const current: MediaCandidate = {
  url: "https://example.com/thumb.jpg",
  kind: "image",
  source: "current-src",
  confidence: 60,
  width: 100,
  height: 100,
};

describe("candidate ranking", () => {
  it("suppresses a same-size current image by default", () => {
    expect(
      rankCandidates([current], {
        renderedSize: { width: 100, height: 100 },
        showSameSizeImages: false,
      }),
    ).toEqual([]);
  });

  it("keeps a meaningfully larger current image", () => {
    expect(
      rankCandidates([{ ...current, width: 300, height: 300 }], {
        renderedSize: { width: 100, height: 100 },
        showSameSizeImages: false,
      }),
    ).toHaveLength(1);
  });

  it("deduplicates by URL and retains the stronger source", () => {
    const direct: MediaCandidate = {
      ...current,
      source: "direct-link",
      confidence: 100,
    };
    expect(
      rankCandidates([current, direct], {
        renderedSize: { width: 100, height: 100 },
        showSameSizeImages: true,
      }),
    ).toEqual([direct]);
  });
});
