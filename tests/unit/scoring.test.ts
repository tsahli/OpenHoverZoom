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

  it("prefers an explicitly identified original over a responsive preview", () => {
    const responsive: MediaCandidate = {
      url: "https://example.com/social-preview.jpg",
      kind: "image",
      source: "document-metadata",
      confidence: 98,
      quality: "responsive",
      width: 2400,
      height: 1260,
    };
    const original: MediaCandidate = {
      url: "https://example.com/original.jpg",
      kind: "image",
      source: "document-metadata",
      confidence: 92,
      quality: "original",
    };

    expect(
      rankCandidates([responsive, original], { showSameSizeImages: true })[0],
    ).toBe(original);
  });

  it("uses declared dimensions among similarly trustworthy renditions", () => {
    const smaller: MediaCandidate = {
      url: "https://example.com/smaller.jpg",
      kind: "image",
      source: "srcset",
      confidence: 94,
      width: 1600,
    };
    const larger: MediaCandidate = {
      url: "https://example.com/larger.jpg",
      kind: "image",
      source: "srcset",
      confidence: 90,
      width: 4000,
    };

    expect(
      rankCandidates([smaller, larger], { showSameSizeImages: true })[0],
    ).toBe(larger);
  });

  it("ranks confidence bands consistently regardless of input order", () => {
    const highestConfidence: MediaCandidate = {
      url: "https://example.com/high-confidence.jpg",
      kind: "image",
      source: "srcset",
      confidence: 98,
      width: 1000,
    };
    const highResolution: MediaCandidate = {
      url: "https://example.com/high-resolution.jpg",
      kind: "image",
      source: "srcset",
      confidence: 90,
      width: 2000,
    };
    const lowerConfidence: MediaCandidate = {
      url: "https://example.com/lower-confidence.jpg",
      kind: "image",
      source: "srcset",
      confidence: 82,
      width: 4000,
    };

    for (const candidates of [
      [highestConfidence, highResolution, lowerConfidence],
      [lowerConfidence, highestConfidence, highResolution],
      [highResolution, lowerConfidence, highestConfidence],
    ]) {
      expect(rankCandidates(candidates, { showSameSizeImages: true })[0]).toBe(highResolution);
    }
  });
});
