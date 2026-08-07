import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedTarget } from "../../src/resolver";
import type { MediaCandidate } from "../../src/resolver/candidate";
import { DEFAULT_SETTINGS } from "../../src/shared/settings";

const mocks = vi.hoisted(() => ({
  requestImageDownload: vi.fn(),
  resolveDownloadCandidate: vi.fn(),
  resolveGalleryCandidate: vi.fn(),
  resolveTarget: vi.fn(),
}));

vi.mock("../../src/resolver", () => ({
  resolveDownloadCandidate: mocks.resolveDownloadCandidate,
  resolveGalleryCandidate: mocks.resolveGalleryCandidate,
  resolveTarget: mocks.resolveTarget,
}));
vi.mock("../../src/content/download-client", () => ({
  requestImageDownload: mocks.requestImageDownload,
}));

import { HoverController } from "../../src/content/hover-controller";
import type {
  GallerySelection,
  PreviewOverlay,
} from "../../src/content/preview-overlay";

describe("hover tracking", () => {
  let overlay: OverlayDouble;
  let controller: HoverController;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    mocks.resolveTarget.mockReset();
    mocks.resolveGalleryCandidate.mockReset();
    mocks.resolveGalleryCandidate.mockResolvedValue(null);
    mocks.resolveDownloadCandidate.mockReset();
    mocks.resolveDownloadCandidate.mockResolvedValue(null);
    mocks.requestImageDownload.mockReset();
    mocks.requestImageDownload.mockResolvedValue(undefined);
    mocks.resolveTarget.mockImplementation(async (target: Element) => ({
      candidate: candidateFor(target),
      fallback: null,
    }));
    overlay = new OverlayDouble();
    controller = new HoverController(
      overlay as unknown as PreviewOverlay,
      { ...DEFAULT_SETTINGS, hoverDelayMs: 250 },
    );
  });

  afterEach(() => {
    controller.destroy();
    vi.useRealTimers();
    Reflect.deleteProperty(document, "elementsFromPoint");
  });

  it("keeps a resolved preview anchored while the pointer moves within its source", async () => {
    const image = imageWithId("first");
    dispatchPointer(image, "pointerover", 100, 100);

    await vi.advanceTimersByTimeAsync(120);
    expect(overlay.showLoading).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(130);
    expect(overlay.show).toHaveBeenCalledOnce();
    const anchoredAt = overlay.setAnchor.mock.calls.at(-1);

    dispatchPointer(image, "pointermove", 130, 140);

    expect(overlay.setAnchor.mock.calls.at(-1)).toEqual(anchoredAt);
    expect(overlay.reposition).not.toHaveBeenCalled();
    expect(overlay.hide).not.toHaveBeenCalled();
  });

  it("suppresses native media tooltips only during the active hover", () => {
    const anchor = document.createElement("a");
    anchor.title = "Linked image title";
    const image = document.createElement("img");
    image.id = "titled";
    image.title = "Image title";
    anchor.append(image);
    document.body.append(anchor);

    dispatchPointer(image, "pointerover", 100, 100);

    expect(anchor.hasAttribute("title")).toBe(false);
    expect(image.hasAttribute("title")).toBe(false);

    window.dispatchEvent(new Event("blur"));

    expect(anchor.title).toBe("Linked image title");
    expect(image.title).toBe("Image title");
  });

  it("re-hit-tests a shared event layer and preserves the old preview during a new hover delay", async () => {
    const layer = document.createElement("div");
    const first = imageWithId("first");
    const second = imageWithId("second");
    document.body.append(layer);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn((x: number) => x < 150 ? [layer, first] : [layer, second]),
    });

    dispatchPointer(layer, "pointerover", 100, 100);
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.resolveTarget).toHaveBeenCalledTimes(1);
    expect(overlay.show).toHaveBeenLastCalledWith(expect.objectContaining({ caption: "first" }));

    dispatchPointer(layer, "pointermove", 200, 100);
    await vi.advanceTimersByTimeAsync(249);
    expect(mocks.resolveTarget).toHaveBeenCalledTimes(1);
    expect(overlay.hide).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.resolveTarget).toHaveBeenCalledTimes(2);
    expect(overlay.show).toHaveBeenLastCalledWith(expect.objectContaining({ caption: "second" }));
    expect(overlay.hide).not.toHaveBeenCalled();
  });

  it("uses leave grace and cancels it when the pointer returns", async () => {
    const image = imageWithId("first");
    const blank = document.createElement("div");
    document.body.append(blank);
    dispatchPointer(image, "pointerover", 100, 100);
    await vi.advanceTimersByTimeAsync(250);

    dispatchPointer(blank, "pointermove", 300, 300);
    await vi.advanceTimersByTimeAsync(159);
    expect(overlay.hide).not.toHaveBeenCalled();
    dispatchPointer(image, "pointermove", 100, 100);
    await vi.advanceTimersByTimeAsync(10);
    expect(overlay.hide).not.toHaveBeenCalled();

    dispatchPointer(blank, "pointermove", 300, 300);
    await vi.advanceTimersByTimeAsync(160);
    expect(overlay.hide).toHaveBeenCalledOnce();
  });

  it("removes a delayed loader for a non-null non-media transition", async () => {
    const image = imageWithId("first");
    const surface = document.createElement("div");
    document.body.append(surface);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => [surface]),
    });

    dispatchPointer(image, "pointerover", 100, 100);
    await vi.advanceTimersByTimeAsync(120);
    expect(overlay.showLoading).toHaveBeenCalledOnce();
    expect(overlay.visible).toBe(true);

    dispatchDocumentPointerOut(surface, 200, 100);

    expect(overlay.hide).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(130);
    expect(mocks.resolveTarget).not.toHaveBeenCalled();
  });

  it("aborts an in-flight loader for a non-null non-media transition", async () => {
    const image = imageWithId("first");
    const surface = document.createElement("div");
    document.body.append(surface);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => [surface]),
    });
    let resolutionSignal: AbortSignal | undefined;
    mocks.resolveTarget.mockImplementation((_target, _options, signal: AbortSignal) => {
      resolutionSignal = signal;
      return new Promise(() => undefined);
    });

    dispatchPointer(image, "pointerover", 100, 100);
    await vi.advanceTimersByTimeAsync(250);
    expect(resolutionSignal?.aborted).toBe(false);

    dispatchDocumentPointerOut(surface, 200, 100);

    expect(resolutionSignal?.aborted).toBe(true);
    expect(overlay.hide).toHaveBeenCalledOnce();
  });

  it("clears a loader when the page loses focus", async () => {
    const image = imageWithId("first");
    dispatchPointer(image, "pointerover", 100, 100);
    await vi.advanceTimersByTimeAsync(120);
    expect(overlay.showLoading).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event("blur"));

    expect(overlay.hide).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(130);
    expect(mocks.resolveTarget).not.toHaveBeenCalled();
  });

  it("cancels an in-flight transition when the pointer changes targets again", async () => {
    const first = imageWithId("first");
    const second = imageWithId("second");
    let secondSignal: AbortSignal | undefined;
    mocks.resolveTarget.mockImplementation((target: Element, _options, signal: AbortSignal) => {
      if (target === second) {
        secondSignal = signal;
        return new Promise(() => undefined);
      }
      return Promise.resolve({ candidate: candidateFor(target), fallback: null });
    });

    dispatchPointer(first, "pointerover", 100, 100);
    await vi.advanceTimersByTimeAsync(250);
    dispatchPointer(second, "pointermove", 200, 100);
    await vi.advanceTimersByTimeAsync(250);
    expect(secondSignal?.aborted).toBe(false);

    dispatchPointer(first, "pointermove", 100, 100);
    expect(secondSignal?.aborted).toBe(true);
    expect(overlay.hide).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(overlay.show).toHaveBeenLastCalledWith(expect.objectContaining({ caption: "first" }));
  });

  it("ignores a canceled resolution that completes after its replacement", async () => {
    const first = imageWithId("first");
    const second = imageWithId("second");
    let finishFirst: ((resolution: ResolvedTarget) => void) | undefined;
    mocks.resolveTarget.mockImplementation((target: Element) => {
      if (target === first) {
        return new Promise<ResolvedTarget>((resolve) => {
          finishFirst = resolve;
        });
      }
      return Promise.resolve({ candidate: candidateFor(target), fallback: null });
    });

    dispatchPointer(first, "pointerover", 100, 100);
    await vi.advanceTimersByTimeAsync(250);
    dispatchPointer(second, "pointermove", 200, 100);
    await vi.advanceTimersByTimeAsync(250);
    expect(overlay.show).toHaveBeenCalledOnce();
    expect(overlay.show).toHaveBeenLastCalledWith(
      expect.objectContaining({ caption: "second" }),
    );

    finishFirst?.({ candidate: candidateFor(first), fallback: null });
    await Promise.resolve();

    expect(overlay.show).toHaveBeenCalledOnce();
  });

  it("resolves link targets silently and stays inert when no media is found", async () => {
    const anchor = document.createElement("a");
    anchor.href = "https://cdn.example/file.jpg";
    document.body.append(anchor);
    mocks.resolveTarget.mockResolvedValueOnce({ candidate: null, fallback: null });

    dispatchPointer(anchor, "pointerover", 100, 100);
    await vi.advanceTimersByTimeAsync(250);

    expect(overlay.showLoading).not.toHaveBeenCalled();
    expect(overlay.show).not.toHaveBeenCalled();
    expect(overlay.isVisible()).toBe(false);
  });

  it("shows a successfully resolved link without flashing a loader", async () => {
    const anchor = document.createElement("a");
    anchor.id = "linked";
    anchor.href = "https://cdn.example/file.jpg";
    document.body.append(anchor);

    dispatchPointer(anchor, "pointerover", 100, 100);
    await vi.advanceTimersByTimeAsync(250);

    expect(overlay.showLoading).not.toHaveBeenCalled();
    expect(overlay.show).toHaveBeenCalledWith(
      expect.objectContaining({ caption: "linked" }),
    );
  });

  it("keeps the spinner visible until the high-resolution candidate is resolved", async () => {
    const image = imageWithId("first");
    const local = candidateFor(image);
    const original: MediaCandidate = {
      url: "https://cdn.example/first-original.jpg",
      kind: "image",
      source: "document-metadata",
      confidence: 98,
    };
    let finishResolution: ((resolution: ResolvedTarget) => void) | undefined;
    mocks.resolveTarget.mockImplementation(() =>
      new Promise<ResolvedTarget>((resolve) => {
        finishResolution = resolve;
      }),
    );

    dispatchPointer(image, "pointerover", 100, 100);
    await vi.advanceTimersByTimeAsync(250);
    expect(overlay.showLoading).toHaveBeenCalled();
    expect(overlay.show).not.toHaveBeenCalled();

    finishResolution?.({ candidate: original, fallback: local });
    await Promise.resolve();

    expect(overlay.show).toHaveBeenCalledOnce();
    expect(overlay.show).toHaveBeenCalledWith(original, local);
  });

  it("upgrades a newly selected gallery item from its linked page", async () => {
    const thumbnail: MediaCandidate = {
      url: "https://cdn.example/second-small.jpg",
      kind: "image",
      source: "srcset",
      confidence: 90,
      linkedPageUrl: "https://gallery.example/photos/second",
    };
    const original: MediaCandidate = {
      url: "https://cdn.example/second-original.jpg",
      kind: "image",
      source: "document-metadata",
      confidence: 98,
    };
    const selection = { index: 1, candidate: thumbnail };
    overlay.visible = true;
    overlay.mediaVisible = true;
    overlay.navigateGallery.mockReturnValueOnce(selection);
    mocks.resolveGalleryCandidate.mockResolvedValueOnce(original);

    const event = dispatchKey("ArrowRight");
    await Promise.resolve();
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(mocks.resolveGalleryCandidate).toHaveBeenCalledWith(
      thumbnail,
      expect.any(AbortSignal),
    );
    expect(overlay.resolveGallerySelection).toHaveBeenCalledWith(selection, original);
  });

  it("falls back to a gallery thumbnail when its linked page has no better image", async () => {
    const thumbnail: MediaCandidate = {
      url: "https://cdn.example/second-small.jpg",
      kind: "image",
      source: "srcset",
      confidence: 90,
      linkedPageUrl: "https://gallery.example/photos/second",
    };
    const selection = { index: 1, candidate: thumbnail };
    overlay.visible = true;
    overlay.mediaVisible = true;
    overlay.navigateGallery.mockReturnValueOnce(selection);

    dispatchKey("ArrowRight");
    await Promise.resolve();
    await Promise.resolve();

    expect(overlay.resolveGallerySelection).toHaveBeenCalledWith(selection, null);
  });

  it("downloads the exact visible image only for the configured shortcut", async () => {
    controller.updateSettings({
      ...DEFAULT_SETTINGS,
      hoverDelayMs: 250,
      downloadShortcut: "Shift+D",
    });

    const inactiveEvent = dispatchKey("d", { shiftKey: true });
    expect(inactiveEvent.defaultPrevented).toBe(false);
    expect(mocks.requestImageDownload).not.toHaveBeenCalled();

    const image = imageWithId("first");
    dispatchPointer(image, "pointerover", 100, 100);
    await vi.advanceTimersByTimeAsync(250);

    const unrelatedEvent = dispatchKey("Enter");
    expect(unrelatedEvent.defaultPrevented).toBe(false);
    expect(mocks.requestImageDownload).not.toHaveBeenCalled();

    const event = dispatchKey("d", { shiftKey: true });
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(mocks.requestImageDownload).toHaveBeenCalledOnce();
    expect(mocks.requestImageDownload).toHaveBeenCalledWith(
      "https://cdn.example/first.jpg",
    );
  });

  it("resolves an explicit original only when the download shortcut is pressed", async () => {
    const preview: MediaCandidate = {
      url: "https://cdn.example/preview.jpg",
      kind: "image",
      source: "srcset",
      confidence: 90,
      linkedPageUrl: "https://gallery.example/photo/1",
    };
    const original: MediaCandidate = {
      url: "https://cdn.example/original.jpg",
      kind: "image",
      source: "document-original-link",
      confidence: 99,
      quality: "original",
    };
    overlay.visible = true;
    overlay.mediaVisible = true;
    overlay.getVisibleImageCandidate.mockReturnValue(preview);
    mocks.resolveDownloadCandidate.mockResolvedValue(original);

    dispatchKey("Enter");
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.resolveDownloadCandidate).toHaveBeenCalledWith(
      preview,
      expect.any(AbortSignal),
    );
    expect(mocks.requestImageDownload).toHaveBeenCalledWith(original.url);
  });
});

class OverlayDouble {
  visible = false;
  mediaVisible = false;
  updatePointer = vi.fn();
  setAnchor = vi.fn();
  updateSettings = vi.fn();
  reposition = vi.fn();
  prepare = vi.fn();
  showLoading = vi.fn(() => {
    this.visible = true;
    this.mediaVisible = false;
  });
  show = vi.fn(() => {
    this.visible = true;
    this.mediaVisible = true;
  });
  hide = vi.fn(() => {
    this.visible = false;
    this.mediaVisible = false;
  });
  isVisible = vi.fn(() => this.visible);
  hasVisibleMedia = vi.fn(() => this.mediaVisible);
  navigateGallery = vi.fn<(_delta: -1 | 1) => GallerySelection | null>(() => null);
  resolveGallerySelection = vi.fn<
    (_selection: GallerySelection, _candidate: MediaCandidate | null) => boolean
  >(() => false);
  getVisibleImageCandidate = vi.fn<() => MediaCandidate | null>(() =>
    this.mediaVisible
      ? {
          url: "https://cdn.example/first.jpg",
          kind: "image" as const,
          source: "current-src" as const,
          confidence: 62,
        }
      : null,
  );
}

function imageWithId(id: string): HTMLImageElement {
  const image = document.createElement("img");
  image.id = id;
  document.body.append(image);
  return image;
}

function candidateFor(target: Element): MediaCandidate {
  return {
    url: `https://cdn.example/${target.id}.jpg`,
    kind: "image",
    source: "current-src",
    confidence: 62,
    caption: target.id,
  };
}

function dispatchPointer(
  target: Element,
  type: "pointerover" | "pointerout" | "pointermove",
  clientX: number,
  clientY: number,
  relatedTarget: EventTarget | null = null,
): void {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, clientX, clientY, relatedTarget }),
  );
}

function dispatchDocumentPointerOut(
  relatedTarget: EventTarget,
  clientX: number,
  clientY: number,
): void {
  document.dispatchEvent(
    new MouseEvent("pointerout", { bubbles: true, clientX, clientY, relatedTarget }),
  );
}

function dispatchKey(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...init,
  });
  document.dispatchEvent(event);
  return event;
}
