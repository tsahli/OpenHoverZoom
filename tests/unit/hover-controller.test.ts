import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaCandidate } from "../../src/resolver/candidate";
import { DEFAULT_SETTINGS } from "../../src/shared/settings";

const mocks = vi.hoisted(() => ({ resolveTarget: vi.fn() }));

vi.mock("../../src/resolver", () => ({ resolveTarget: mocks.resolveTarget }));

import { HoverController } from "../../src/content/hover-controller";
import type { PreviewOverlay } from "../../src/content/preview-overlay";

describe("hover tracking", () => {
  let overlay: OverlayDouble;
  let controller: HoverController;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    mocks.resolveTarget.mockReset();
    mocks.resolveTarget.mockImplementation(async (target: Element) => candidateFor(target));
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

  it("cancels an in-flight transition when the pointer changes targets again", async () => {
    const first = imageWithId("first");
    const second = imageWithId("second");
    let secondSignal: AbortSignal | undefined;
    mocks.resolveTarget.mockImplementation((target: Element, _options, signal: AbortSignal) => {
      if (target === second) {
        secondSignal = signal;
        return new Promise<MediaCandidate | null>(() => undefined);
      }
      return Promise.resolve(candidateFor(target));
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

  it("resolves link targets silently and stays inert when no media is found", async () => {
    const anchor = document.createElement("a");
    anchor.href = "https://cdn.example/file.jpg";
    document.body.append(anchor);
    mocks.resolveTarget.mockResolvedValueOnce(null);

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
  navigateGallery = vi.fn(() => false);
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
  type: "pointerover" | "pointermove",
  clientX: number,
  clientY: number,
): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY }));
}
