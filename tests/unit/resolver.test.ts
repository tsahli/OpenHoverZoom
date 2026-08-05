import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaCandidate } from "../../src/resolver/candidate";

const mocks = vi.hoisted(() => ({
  resolveDomTarget: vi.fn(),
  resolveLinkedDocument: vi.fn(),
}));

vi.mock("../../src/resolver/dom-resolver", () => ({
  resolveDomTarget: mocks.resolveDomTarget,
}));

vi.mock("../../src/resolver/linked-document-resolver", () => ({
  resolveLinkedDocument: mocks.resolveLinkedDocument,
}));

import { resolveTarget } from "../../src/resolver";

describe("target resolver", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it("verifies extension-looking links instead of trusting the path", async () => {
    mocks.resolveDomTarget.mockReturnValue({
      candidates: [
        {
          url: "https://gallery.example/item/photo.jpg",
          kind: "image",
          source: "direct-link",
          confidence: 92,
        },
      ],
      anchorUrl: "https://gallery.example/item/photo.jpg",
    });
    mocks.resolveLinkedDocument.mockResolvedValue([
      {
        url: "https://cdn.example/original.jpg",
        kind: "image",
        source: "document-metadata",
        confidence: 98,
      },
    ]);

    const result = await resolveTarget(
      document.createElement("a"),
      { showSameSizeImages: false },
      new AbortController().signal,
    );

    expect(mocks.resolveLinkedDocument).toHaveBeenCalledWith(
      "https://gallery.example/item/photo.jpg",
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      url: "https://cdn.example/original.jpg",
      source: "document-metadata",
    });
  });

  it("uses a high-confidence DOM media candidate without an HTML request", async () => {
    mocks.resolveDomTarget.mockReturnValue({
      candidates: [
        {
          url: "https://cdn.example/large.jpg",
          kind: "image",
          source: "srcset",
          confidence: 90,
        },
      ],
      anchorUrl: "https://gallery.example/item/123",
    });

    const result = await resolveTarget(
      document.createElement("img"),
      { showSameSizeImages: false },
      new AbortController().signal,
    );

    expect(mocks.resolveLinkedDocument).not.toHaveBeenCalled();
    expect(result).toMatchObject({ url: "https://cdn.example/large.jpg", source: "srcset" });
  });

  it("uses linked metadata that resolves within the local fallback budget", async () => {
    const local: MediaCandidate = {
      url: "https://cdn.example/thumbnail.jpg",
      kind: "image",
      source: "current-src",
      confidence: 62,
    };
    mocks.resolveDomTarget.mockReturnValue({
      candidates: [local],
      anchorUrl: "https://gallery.example/item/fast",
    });
    mocks.resolveLinkedDocument.mockResolvedValue([
      {
        url: "https://cdn.example/original.jpg",
        kind: "image",
        source: "document-metadata",
        confidence: 98,
      },
    ]);
    const onLocalCandidate = vi.fn();

    const result = await resolveTarget(
      document.createElement("img"),
      { showSameSizeImages: false },
      new AbortController().signal,
      { metadataBudgetMs: 75, onLocalCandidate },
    );

    expect(onLocalCandidate).toHaveBeenCalledWith(local);
    expect(result).toMatchObject({
      url: "https://cdn.example/original.jpg",
      source: "document-metadata",
    });
  });

  it("attaches the selected candidate at its ordered gallery position", async () => {
    const first = {
      url: "https://cdn.example/first.jpg",
      kind: "image",
      source: "srcset",
      confidence: 90,
    };
    const second = {
      url: "https://cdn.example/second.jpg",
      kind: "image",
      source: "srcset",
      confidence: 90,
    };
    mocks.resolveDomTarget.mockReturnValue({
      candidates: [second],
      anchorUrl: null,
      gallery: { items: [first, second], index: 1 },
    });

    const result = await resolveTarget(
      document.createElement("img"),
      { showSameSizeImages: false },
      new AbortController().signal,
    );

    expect(result?.galleryIndex).toBe(1);
    expect(result?.gallery?.map((item) => item.url)).toEqual([
      "https://cdn.example/first.jpg",
      "https://cdn.example/second.jpg",
    ]);
  });

  it("prepares and returns the best local candidate when metadata exceeds its budget", async () => {
    vi.useFakeTimers();
    const local: MediaCandidate = {
      url: "https://cdn.example/thumbnail.jpg",
      kind: "image",
      source: "current-src",
      confidence: 62,
    };
    let finishMetadata: ((candidates: MediaCandidate[]) => void) | undefined;
    mocks.resolveDomTarget.mockReturnValue({
      candidates: [local],
      anchorUrl: "https://gallery.example/item/slow",
    });
    mocks.resolveLinkedDocument.mockReturnValue(
      new Promise<MediaCandidate[]>((resolve) => {
        finishMetadata = resolve;
      }),
    );
    const onLocalCandidate = vi.fn();

    const resultPromise = resolveTarget(
      document.createElement("img"),
      { showSameSizeImages: false },
      new AbortController().signal,
      { metadataBudgetMs: 75, onLocalCandidate },
    );

    expect(onLocalCandidate).toHaveBeenCalledWith(local);
    await vi.advanceTimersByTimeAsync(74);
    let settled = false;
    void resultPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toEqual(local);
    finishMetadata?.([]);
  });

  it("cancels a bounded metadata wait immediately when the hover is abandoned", async () => {
    vi.useFakeTimers();
    const local: MediaCandidate = {
      url: "https://cdn.example/thumbnail.jpg",
      kind: "image",
      source: "current-src",
      confidence: 62,
    };
    mocks.resolveDomTarget.mockReturnValue({
      candidates: [local],
      anchorUrl: "https://gallery.example/item/slow",
    });
    mocks.resolveLinkedDocument.mockReturnValue(new Promise<MediaCandidate[]>(() => undefined));
    const controller = new AbortController();

    const resultPromise = resolveTarget(
      document.createElement("img"),
      { showSameSizeImages: false },
      controller.signal,
      { metadataBudgetMs: 5_000 },
    );
    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
  });
});
