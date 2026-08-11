import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewOverlay } from "../../src/content/preview-overlay";
import type { MediaCandidate } from "../../src/resolver/candidate";

const originalAttachShadow = HTMLElement.prototype.attachShadow;
let playMedia: ReturnType<typeof vi.spyOn>;
let pauseMedia: ReturnType<typeof vi.spyOn>;
let loadMedia: ReturnType<typeof vi.spyOn>;

describe("preview overlay", () => {
  beforeEach(() => {
    document.getElementById("open-hover-zoom-host")?.remove();
    vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (
      this: HTMLElement,
      init: ShadowRootInit,
    ) {
      return originalAttachShadow.call(this, { ...init, mode: "open" });
    });
    playMedia = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    pauseMedia = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    loadMedia = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  });

  it("does not mutate the page until a preview is requested", () => {
    new PreviewOverlay(85);

    expect(document.getElementById("open-hover-zoom-host")).toBeNull();
  });

  it("renders a visible loading placeholder", () => {
    const overlay = new PreviewOverlay(85);
    overlay.updatePointer(200, 160);
    overlay.showLoading();

    const panel = previewPanel();
    expect(panel.hidden).toBe(false);
    expect(panel.classList.contains("loading")).toBe(true);
    expect(panel.querySelector(".spinner")).not.toBeNull();
    expect(panel.querySelector(".loader")?.getAttribute("aria-label")).toBe(
      "Resolving preview",
    );
    expect(panel.textContent).toBe("");
  });

  it("keeps the host pointer-transparent and does not chase pointer movement", () => {
    const overlay = new PreviewOverlay(85);
    overlay.updatePointer(200, 160);
    overlay.setAnchor(200, 160);
    overlay.showLoading();

    const host = document.getElementById("open-hover-zoom-host");
    const panel = previewPanel();
    const initialPosition = { left: panel.style.left, top: panel.style.top };
    expect(host?.style.getPropertyValue("pointer-events")).toBe("none");
    expect(host?.style.getPropertyPriority("pointer-events")).toBe("important");
    expect(host?.shadowRoot?.querySelector("style")?.textContent).toContain(
      ".panel, .panel * { pointer-events: none !important; }",
    );

    overlay.updatePointer(700, 500);
    expect({ left: panel.style.left, top: panel.style.top }).toEqual(initialPosition);
  });

  it("reuses a concurrently prepared image for the atomic reveal", async () => {
    const candidate = imageCandidate("prepared", "Prepared caption");
    const createElement = vi.spyOn(document, "createElement");
    const overlay = new PreviewOverlay(85);

    overlay.prepare(candidate);
    expect(previewPanel().hidden).toBe(true);
    overlay.showLoading();
    overlay.show(candidate);

    const preparedImage = previewPanel().querySelector<HTMLImageElement>(".preload-bin img");
    expect(preparedImage).not.toBeNull();
    expect(createElement.mock.calls.filter(([tag]) => tag === "img")).toHaveLength(1);
    preparedImage?.dispatchEvent(new Event("load"));
    await Promise.resolve();

    expect(previewPanel().querySelector(".media-frame img")).toBe(preparedImage);
    expect(previewPanel().textContent).toContain("Prepared caption");
  });

  it("shows a subtle metadata strip and navigates an ordered gallery", async () => {
    const first = imageCandidate("first", "First caption");
    const second = {
      ...imageCandidate("second", "Second caption"),
      linkedPageUrl: "https://gallery.example/photos/second",
    };
    const secondOriginal = imageCandidate("second-original", "Second caption");
    const overlay = new PreviewOverlay(85);
    overlay.updatePointer(300, 220);
    overlay.show({ ...first, gallery: [first, second], galleryIndex: 0 });

    let panel = previewPanel();
    expect(panel.classList.contains("loading")).toBe(true);
    expect(panel.querySelector(".media-frame")).toBeNull();
    panel.querySelector(".preload-bin img")?.dispatchEvent(new Event("load"));
    await Promise.resolve();
    panel = previewPanel();
    expect(panel.querySelector(".metadata")?.textContent).toContain("First caption");
    expect(panel.querySelector(".gallery-status")?.textContent).toContain("1 / 2");
    expect(panel.querySelector(".download-hint")?.textContent).toBe("Enter ⤓");

    const selection = overlay.navigateGallery(1);
    expect(selection).toMatchObject({ index: 1, candidate: second });
    panel = previewPanel();
    expect(panel.classList.contains("loading")).toBe(true);
    expect(panel.querySelector(".media-frame")).toBeNull();

    if (!selection) throw new Error("Expected a gallery selection");
    expect(overlay.resolveGallerySelection(selection, secondOriginal)).toBe(true);
    panel = previewPanel();
    expect(panel.querySelector<HTMLImageElement>(".preload-bin img")?.src).toBe(
      "https://cdn.example/second-original.jpg",
    );
    panel.querySelector(".preload-bin img")?.dispatchEvent(new Event("load"));
    await Promise.resolve();
    panel = previewPanel();
    expect(panel.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example/second-original.jpg",
    );
    expect(panel.querySelector(".metadata")?.textContent).toContain("Second caption");
    expect(panel.querySelector(".gallery-status")?.textContent).toContain("2 / 2");

    expect(overlay.navigateGallery(1)).toMatchObject({ index: 0, candidate: first });
    previewPanel().querySelector(".preload-bin img")?.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(previewPanel().querySelector(".gallery-status")?.textContent).toContain("1 / 2");
  });

  it("reveals a prepared local image only when the selected image fails", async () => {
    const local = imageCandidate("local", "Local caption");
    const original = imageCandidate("original", "Original caption");
    const createElement = vi.spyOn(document, "createElement");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const overlay = new PreviewOverlay(85);

    overlay.prepare(local);
    overlay.showLoading();
    overlay.show(original, local);

    const createdImages = createElement.mock.results
      .map((result) => result.value)
      .filter((element): element is HTMLImageElement => element instanceof HTMLImageElement);
    const localImage = createdImages.find((image) => image.src.endsWith("/local.jpg"));
    const originalImage = createdImages.find((image) => image.src.endsWith("/original.jpg"));
    localImage?.dispatchEvent(new Event("load"));
    originalImage?.dispatchEvent(new Event("error"));
    await Promise.resolve();
    await Promise.resolve();

    expect(previewPanel().querySelector<HTMLImageElement>(".media-frame img")?.src).toBe(
      "https://cdn.example/local.jpg",
    );
    expect(previewPanel().textContent).toContain("Local caption");
    expect(debug).not.toHaveBeenCalled();
  });

  it("hides a failed preview and reports it only at debug level", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const overlay = new PreviewOverlay(85);
    overlay.show(imageCandidate("missing", "Missing image"));

    previewPanel().querySelector(".preload-bin img")?.dispatchEvent(new Event("error"));
    await Promise.resolve();

    expect(previewPanel().hidden).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      "[OpenHoverZoom] Preview candidate did not load (image, srcset): https://cdn.example/missing.jpg",
    );
  });

  it("keeps a prepared local image hidden when the selected image succeeds", async () => {
    const local = imageCandidate("local", "Local caption");
    const original = imageCandidate("original", "Original caption");
    const createElement = vi.spyOn(document, "createElement");
    const overlay = new PreviewOverlay(85);

    overlay.prepare(local);
    overlay.showLoading();
    overlay.show(original, local);

    const createdImages = createElement.mock.results
      .map((result) => result.value)
      .filter((element): element is HTMLImageElement => element instanceof HTMLImageElement);
    const localImage = createdImages.find((image) => image.src.endsWith("/local.jpg"));
    const originalImage = createdImages.find((image) => image.src.endsWith("/original.jpg"));
    localImage?.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(previewPanel().classList.contains("loading")).toBe(true);
    expect(previewPanel().querySelector(".media-frame")).toBeNull();

    originalImage?.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(previewPanel().querySelector<HTMLImageElement>(".media-frame img")?.src).toBe(
      "https://cdn.example/original.jpg",
    );
    expect(previewPanel().textContent).not.toContain("Local caption");
  });

  it("exposes the committed image URL and updates its shortcut hint", async () => {
    const overlay = new PreviewOverlay(85, "Enter");
    overlay.show(imageCandidate("downloadable", "Downloadable image"));
    const image = previewPanel().querySelector<HTMLImageElement>(".preload-bin img");
    image?.dispatchEvent(new Event("load"));
    await Promise.resolve();

    expect(overlay.getVisibleImageUrl()).toBe(
      "https://cdn.example/downloadable.jpg",
    );
    expect(overlay.getVisibleImageCandidate()).toMatchObject({
      url: "https://cdn.example/downloadable.jpg",
      kind: "image",
    });
    overlay.updateSettings(85, "Shift+D");
    expect(previewPanel().querySelector(".download-hint")?.textContent).toBe(
      "Shift+D ⤓",
    );
    overlay.hide();
    expect(overlay.getVisibleImageUrl()).toBeNull();
    expect(overlay.getVisibleImageCandidate()).toBeNull();
  });

  it("starts a committed video at the configured volume and stops it on hide", async () => {
    const overlay = new PreviewOverlay(85, "Enter", 75);
    overlay.show(videoCandidate("clip"));
    const video = previewPanel().querySelector<HTMLVideoElement>(".preload-bin video");
    if (!video) throw new Error("Expected a preloaded video");

    expect(video.autoplay).toBe(false);
    expect(video.muted).toBe(true);
    expect(playMedia).not.toHaveBeenCalled();

    video.dispatchEvent(new Event("loadedmetadata"));
    await Promise.resolve();

    expect(previewPanel().querySelector(".media-frame video")).toBe(video);
    expect(video.volume).toBe(0.75);
    expect(video.muted).toBe(false);
    expect(playMedia).toHaveBeenCalledOnce();
    expect(previewPanel().querySelector(".download-hint")?.textContent).toBe("Enter ⤓");

    overlay.updateSettings(85, "Enter", 25);
    expect(video.volume).toBe(0.25);
    expect(video.muted).toBe(false);

    overlay.hide();
    expect(pauseMedia).toHaveBeenCalledWith();
    expect(loadMedia).toHaveBeenCalledWith();
    expect(video.hasAttribute("src")).toBe(false);
  });

  it("starts audio once its metadata is loaded", async () => {
    const overlay = new PreviewOverlay(85, "Enter", 50);
    overlay.show({
      url: "https://cdn.example/track.opus",
      kind: "audio",
      source: "direct-link",
      confidence: 92,
    });
    const audio = previewPanel().querySelector<HTMLAudioElement>(".preload-bin audio");
    audio?.dispatchEvent(new Event("loadedmetadata"));
    await Promise.resolve();

    expect(previewPanel().querySelector(".media-frame audio")).toBe(audio);
    expect(audio?.volume).toBe(0.5);
    expect(playMedia).toHaveBeenCalledOnce();
  });

  it("does not try to play an image when settings change", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const overlay = new PreviewOverlay(85);
    overlay.show(imageCandidate("still", "Still image"));
    previewPanel().querySelector(".preload-bin img")?.dispatchEvent(new Event("load"));
    await Promise.resolve();

    overlay.updateSettings(75, "Shift+D", 25);

    expect(debug).not.toHaveBeenCalled();
  });

  it("falls back to muted video when Chrome blocks audible autoplay", async () => {
    playMedia
      .mockRejectedValueOnce(new DOMException("Playback blocked", "NotAllowedError"))
      .mockResolvedValueOnce(undefined);
    const overlay = new PreviewOverlay(85, "Enter", 75);
    overlay.show(videoCandidate("blocked"));
    const video = previewPanel().querySelector<HTMLVideoElement>(".preload-bin video");
    video?.dispatchEvent(new Event("loadedmetadata"));
    await Promise.resolve();
    await Promise.resolve();

    expect(video?.muted).toBe(true);
    expect(playMedia).toHaveBeenCalledTimes(2);
    expect(previewPanel().querySelector(".audio-status")?.textContent).toBe("Audio blocked");
  });

  it("keeps media muted when hover volume is zero", async () => {
    const overlay = new PreviewOverlay(85, "Enter", 0);
    overlay.show(videoCandidate("silent"));
    const video = previewPanel().querySelector<HTMLVideoElement>(".preload-bin video");
    video?.dispatchEvent(new Event("loadedmetadata"));
    await Promise.resolve();

    expect(video?.volume).toBe(0);
    expect(video?.muted).toBe(true);
    expect(previewPanel().querySelector(".audio-status")).toBeNull();
  });

  it("removes a leading File prefix from the displayed caption", async () => {
    const overlay = new PreviewOverlay(85);
    overlay.show(imageCandidate("wikimedia", "File: Mountain landscape.jpg"));
    previewPanel().querySelector(".preload-bin img")?.dispatchEvent(new Event("load"));
    await Promise.resolve();

    expect(previewPanel().querySelector(".caption")?.textContent).toBe(
      "Mountain landscape.jpg",
    );
  });

  it("sizes the committed panel from the media instead of a long caption", async () => {
    const candidate = imageCandidate(
      "portrait",
      "A deliberately long article caption that must not widen the preview frame",
    );
    const overlay = new PreviewOverlay(85);
    overlay.updatePointer(300, 220);
    overlay.show(candidate);

    const image = previewPanel().querySelector<HTMLImageElement>(".preload-bin img");
    if (!image) throw new Error("Expected a preloaded image");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rectangle(0, 0, 220, 160));
    image.dispatchEvent(new Event("load"));
    await Promise.resolve();

    expect(previewPanel().style.width).toBe("222px");
    expect(previewPanel().querySelector(".caption")?.textContent).toBe(candidate.caption);
  });

  it("refits the panel when viewport constraints resize the media", async () => {
    const overlay = new PreviewOverlay(85);
    overlay.updatePointer(300, 220);
    overlay.show(imageCandidate("responsive", "Responsive image"));

    const image = previewPanel().querySelector<HTMLImageElement>(".preload-bin img");
    if (!image) throw new Error("Expected a preloaded image");
    const mediaRectangle = vi
      .spyOn(image, "getBoundingClientRect")
      .mockReturnValue(rectangle(0, 0, 320, 180));
    image.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(previewPanel().style.width).toBe("322px");

    mediaRectangle.mockReturnValue(rectangle(0, 0, 210, 118));
    overlay.reposition();
    expect(previewPanel().style.width).toBe("212px");
  });
});

function previewPanel(): HTMLDivElement {
  const host = document.getElementById("open-hover-zoom-host");
  const panel = host?.shadowRoot?.querySelector<HTMLDivElement>(".panel");
  if (!panel) throw new Error("Preview panel was not created");
  return panel;
}

function imageCandidate(name: string, caption: string): MediaCandidate {
  return {
    url: `https://cdn.example/${name}.jpg`,
    kind: "image",
    source: "srcset",
    confidence: 90,
    caption,
  };
}

function videoCandidate(name: string): MediaCandidate {
  return {
    url: `https://cdn.example/${name}.webm`,
    kind: "video",
    source: "video-source",
    confidence: 92,
  };
}

function rectangle(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}
