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

import { resolveGalleryCandidate, resolveTarget } from "../../src/resolver";

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
      candidate: {
        url: "https://cdn.example/original.jpg",
        source: "document-metadata",
      },
      fallback: null,
    });
  });

  it("uses a high-confidence DOM media candidate without an HTML request", async () => {
    const fallback: MediaCandidate = {
      url: "https://cdn.example/thumbnail.jpg",
      kind: "image",
      source: "current-src",
      confidence: 62,
    };
    mocks.resolveDomTarget.mockReturnValue({
      candidates: [
        {
          url: "https://cdn.example/large.jpg",
          kind: "image",
          source: "srcset",
          confidence: 90,
        },
        fallback,
      ],
      anchorUrl: "https://gallery.example/item/123",
    });
    const onFallbackCandidate = vi.fn();

    const result = await resolveTarget(
      document.createElement("img"),
      { showSameSizeImages: false },
      new AbortController().signal,
      { onFallbackCandidate },
    );

    expect(mocks.resolveLinkedDocument).not.toHaveBeenCalled();
    expect(onFallbackCandidate).toHaveBeenCalledWith(fallback);
    expect(result).toMatchObject({
      candidate: { url: "https://cdn.example/large.jpg", source: "srcset" },
      fallback,
    });
  });

  it("uses linked metadata and retains the local candidate only as a failure fallback", async () => {
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
    const onFallbackCandidate = vi.fn();

    const result = await resolveTarget(
      document.createElement("img"),
      { showSameSizeImages: false },
      new AbortController().signal,
      { onFallbackCandidate },
    );

    expect(onFallbackCandidate).toHaveBeenCalledWith(local);
    expect(result).toMatchObject({
      candidate: {
        url: "https://cdn.example/original.jpg",
        source: "document-metadata",
      },
      fallback: local,
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

    expect(result.candidate?.galleryIndex).toBe(1);
    expect(result.candidate?.gallery?.map((item) => item.url)).toEqual([
      "https://cdn.example/first.jpg",
      "https://cdn.example/second.jpg",
    ]);
  });

  it("resolves a gallery item's detail page to a better image", async () => {
    const thumbnail: MediaCandidate = {
      url: "https://cdn.example/thumbnail.jpg",
      kind: "image",
      source: "srcset",
      confidence: 90,
      caption: "Gallery caption",
      linkedPageUrl: "https://gallery.example/photos/123",
    };
    mocks.resolveLinkedDocument.mockResolvedValue([
      {
        url: "https://cdn.example/original.jpg",
        kind: "image",
        source: "document-metadata",
        confidence: 98,
      },
    ]);

    const result = await resolveGalleryCandidate(
      thumbnail,
      new AbortController().signal,
    );

    expect(mocks.resolveLinkedDocument).toHaveBeenCalledWith(
      "https://gallery.example/photos/123",
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      url: "https://cdn.example/original.jpg",
      caption: "Gallery caption",
      linkedPageUrl: "https://gallery.example/photos/123",
    });
  });

  it("waits for slow metadata instead of returning a provisional local candidate", async () => {
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
    const onFallbackCandidate = vi.fn();
    const resultPromise = resolveTarget(
      document.createElement("img"),
      { showSameSizeImages: false },
      new AbortController().signal,
      { onFallbackCandidate },
    );

    expect(onFallbackCandidate).toHaveBeenCalledWith(local);
    let settled = false;
    void resultPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    const original: MediaCandidate = {
      url: "https://cdn.example/original.jpg",
      kind: "image",
      source: "document-metadata",
      confidence: 98,
    };
    finishMetadata?.([original]);
    await expect(resultPromise).resolves.toEqual({
      candidate: original,
      fallback: local,
    });
  });

  it("cancels metadata resolution when the hover is abandoned", async () => {
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
    mocks.resolveLinkedDocument.mockImplementation((_url: string, signal: AbortSignal) =>
      new Promise<MediaCandidate[]>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }));
    const controller = new AbortController();

    const resultPromise = resolveTarget(
      document.createElement("img"),
      { showSameSizeImages: false },
      controller.signal,
    );
    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
  });
});
