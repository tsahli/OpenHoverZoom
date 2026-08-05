import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewOverlay } from "../../src/content/preview-overlay";
import type { MediaCandidate } from "../../src/resolver/candidate";

const originalAttachShadow = HTMLElement.prototype.attachShadow;

describe("preview overlay", () => {
  beforeEach(() => {
    document.getElementById("open-hover-zoom-host")?.remove();
    vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (
      this: HTMLElement,
      init: ShadowRootInit,
    ) {
      return originalAttachShadow.call(this, { ...init, mode: "open" });
    });
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
    expect(panel.querySelector(".metadata")?.textContent).toContain("First caption");
    panel.querySelector(".preload-bin img")?.dispatchEvent(new Event("load"));
    await Promise.resolve();
    panel = previewPanel();
    expect(panel.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example/second.jpg",
    );
    expect(panel.querySelector(".metadata")?.textContent).toContain("Second caption");
    expect(panel.querySelector(".gallery-status")?.textContent).toContain("2 / 2");

    if (!selection) throw new Error("Expected a gallery selection");
    expect(overlay.upgradeGalleryItem(selection, secondOriginal)).toBe(true);
    expect(previewPanel().querySelector(".media-frame img")?.getAttribute("src")).toBe(
      "https://cdn.example/second.jpg",
    );
    previewPanel().querySelector(".preload-bin img")?.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(previewPanel().querySelector(".media-frame img")?.getAttribute("src")).toBe(
      "https://cdn.example/second-original.jpg",
    );

    expect(overlay.navigateGallery(1)).toMatchObject({ index: 0, candidate: first });
    previewPanel().querySelector(".preload-bin img")?.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(previewPanel().querySelector(".gallery-status")?.textContent).toContain("1 / 2");
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
    overlay.updateSettings(85, "Shift+D");
    expect(previewPanel().querySelector(".download-hint")?.textContent).toBe(
      "Shift+D ⤓",
    );
    overlay.hide();
    expect(overlay.getVisibleImageUrl()).toBeNull();
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
