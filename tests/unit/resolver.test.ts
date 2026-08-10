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

import {
  resolveDownloadCandidate,
  resolveGalleryCandidate,
  resolveTarget,
} from "../../src/resolver";

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
          quality: "display",
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

  it("uses the fetched media kind when a direct-link extension is misleading", async () => {
    mocks.resolveDomTarget.mockReturnValue({
      candidates: [
        {
          url: "https://cdn.example/media.jpg",
          kind: "image",
          source: "direct-link",
          confidence: 92,
          quality: "display",
        },
      ],
      anchorUrl: "https://cdn.example/media.jpg",
    });
    mocks.resolveLinkedDocument.mockResolvedValue([
      {
        url: "https://cdn.example/media.jpg",
        kind: "video",
        source: "document-metadata",
        confidence: 99,
        quality: "original",
      },
    ]);

    await expect(
      resolveTarget(
        document.createElement("a"),
        { showSameSizeImages: false },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      candidate: {
        url: "https://cdn.example/media.jpg",
        kind: "video",
        source: "document-metadata",
      },
    });
  });

  it("uses a high-confidence local image without fetching an unrelated detail page", async () => {
    const responsive: MediaCandidate = {
      url: "https://cdn.example/large.jpg",
      kind: "image",
      source: "srcset",
      confidence: 90,
    };
    const fallback: MediaCandidate = {
      url: "https://cdn.example/thumbnail.jpg",
      kind: "image",
      source: "current-src",
      confidence: 62,
    };
    mocks.resolveDomTarget.mockReturnValue({
      candidates: [responsive, fallback],
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
      candidate: {
        url: "https://cdn.example/large.jpg",
        source: "srcset",
        linkedPageUrl: "https://gallery.example/item/123",
      },
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

  it("prefers an explicitly identified linked original when local evidence is inconclusive", async () => {
    const responsive: MediaCandidate = {
      url: "https://cdn.example/large.jpg",
      kind: "image",
      source: "data-attribute",
      confidence: 88,
      quality: "responsive",
      width: 2400,
    };
    const original: MediaCandidate = {
      url: "https://cdn.example/original.avif",
      kind: "image",
      source: "document-metadata",
      confidence: 92,
      quality: "original",
    };
    mocks.resolveDomTarget.mockReturnValue({
      candidates: [responsive],
      fallbackCandidates: [responsive],
      anchorUrl: "https://gallery.example/item/quality",
    });
    mocks.resolveLinkedDocument.mockResolvedValue([original]);

    const result = await resolveTarget(
      document.createElement("img"),
      { showSameSizeImages: false },
      new AbortController().signal,
    );

    expect(result).toEqual({ candidate: original, fallback: responsive });
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

  it("uses the active gallery image when same-size filtering removes local candidates", async () => {
    const first: MediaCandidate = {
      url: "https://cdn.example/first.jpg",
      kind: "image",
      source: "current-src",
      confidence: 70,
    };
    const second: MediaCandidate = {
      url: "https://cdn.example/second.jpg",
      kind: "image",
      source: "current-src",
      confidence: 70,
    };
    mocks.resolveDomTarget.mockReturnValue({
      candidates: [],
      fallbackCandidates: [first],
      anchorUrl: null,
      gallery: { items: [first, second], index: 0 },
    });

    const result = await resolveTarget(
      document.createElement("img"),
      { showSameSizeImages: false },
      new AbortController().signal,
    );

    expect(result.candidate).toMatchObject({
      url: "https://cdn.example/first.jpg",
      galleryIndex: 0,
    });
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

  it("does not change an image gallery thumbnail into linked video", async () => {
    const thumbnail: MediaCandidate = {
      url: "https://cdn.example/poster.jpg",
      kind: "image",
      source: "srcset",
      confidence: 90,
      linkedPageUrl: "https://gallery.example/videos/123",
    };
    const video: MediaCandidate = {
      url: "https://cdn.example/original.mp4",
      kind: "video",
      source: "document-metadata",
      confidence: 96,
      quality: "original",
    };
    mocks.resolveLinkedDocument.mockResolvedValue([video]);

    await expect(
      resolveGalleryCandidate(thumbnail, new AbortController().signal),
    ).resolves.toBeNull();
  });

  it("does not change an initially hovered image into linked video", async () => {
    const thumbnail: MediaCandidate = {
      url: "https://cdn.example/poster.jpg",
      kind: "image",
      source: "current-src",
      confidence: 62,
    };
    const video: MediaCandidate = {
      url: "https://cdn.example/original.mp4",
      kind: "video",
      source: "document-metadata",
      confidence: 96,
      quality: "original",
    };
    mocks.resolveDomTarget.mockReturnValue({
      candidates: [thumbnail],
      fallbackCandidates: [thumbnail],
      anchorUrl: "https://gallery.example/videos/123",
    });
    mocks.resolveLinkedDocument.mockResolvedValue([video]);

    await expect(
      resolveTarget(
        document.createElement("img"),
        { showSameSizeImages: true },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      candidate: {
        ...thumbnail,
        linkedPageUrl: "https://gallery.example/videos/123",
      },
      fallback: null,
    });
  });

  it("uses only a semantically explicit original for an on-demand download", async () => {
    const preview: MediaCandidate = {
      url: "https://cdn.example/preview.jpg",
      kind: "image",
      source: "srcset",
      confidence: 90,
      linkedPageUrl: "https://gallery.example/photos/123",
    };
    const unrelatedHero: MediaCandidate = {
      url: "https://cdn.example/article-hero.jpg",
      kind: "image",
      source: "document-metadata",
      confidence: 98,
      quality: "original",
    };
    const explicitOriginal: MediaCandidate = {
      url: "https://cdn.example/original.jpg",
      kind: "image",
      source: "document-original-link",
      confidence: 99,
      quality: "original",
    };
    mocks.resolveLinkedDocument.mockResolvedValue([unrelatedHero, explicitOriginal]);

    await expect(
      resolveDownloadCandidate(preview, new AbortController().signal),
    ).resolves.toBe(explicitOriginal);

    mocks.resolveLinkedDocument.mockResolvedValue([unrelatedHero]);
    await expect(
      resolveDownloadCandidate(preview, new AbortController().signal),
    ).resolves.toBeNull();
  });

  it("keeps original downloads the same media kind as the visible preview", async () => {
    const preview: MediaCandidate = {
      url: "https://cdn.example/preview.webm",
      kind: "video",
      source: "video-source",
      confidence: 92,
      linkedPageUrl: "https://gallery.example/videos/123",
    };
    const poster: MediaCandidate = {
      url: "https://cdn.example/poster.jpg",
      kind: "image",
      source: "document-original-link",
      confidence: 99,
      quality: "original",
    };
    const original: MediaCandidate = {
      url: "https://cdn.example/original.mp4",
      kind: "video",
      source: "document-original-link",
      confidence: 99,
      quality: "original",
      width: 3840,
      height: 2160,
    };
    mocks.resolveLinkedDocument.mockResolvedValue([poster, original]);

    await expect(
      resolveDownloadCandidate(preview, new AbortController().signal),
    ).resolves.toBe(original);
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
