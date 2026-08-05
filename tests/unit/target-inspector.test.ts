import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findHoverTarget } from "../../src/content/target-inspector";

describe("hover target inspection", () => {
  beforeEach(() => document.body.replaceChildren());
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "elementsFromPoint");
  });

  it("finds nested media beneath a transparent link layer", () => {
    const anchor = document.createElement("a");
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    const overlay = document.createElement("span");
    figure.append(image);
    anchor.append(figure, overlay);
    document.body.append(anchor);

    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rectangle(20, 30, 300, 200));

    expect(findHoverTarget(overlay, { x: 100, y: 100 })).toBe(image);
  });

  it("finds media beneath a transparent full-tile link", () => {
    const tile = document.createElement("article");
    const image = document.createElement("img");
    const overlay = document.createElement("a");
    overlay.href = "https://gallery.example/photo/123";
    tile.append(image, overlay);
    document.body.append(tile);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      rectangle(20, 30, 300, 200),
    );
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue(
      rectangle(20, 30, 300, 200),
    );
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => [overlay, image, tile]),
    });

    expect(findHoverTarget(overlay, { x: 100, y: 100 })).toBe(image);
  });

  it("does not see an image behind an unrelated menu link", () => {
    const image = document.createElement("img");
    const menu = document.createElement("nav");
    const link = document.createElement("a");
    link.href = "https://example.test/pre-owned";
    link.textContent = "Pre-Owned";
    menu.append(link);
    document.body.append(image, menu);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      rectangle(0, 0, 800, 600),
    );
    vi.spyOn(link, "getBoundingClientRect").mockReturnValue(
      rectangle(100, 100, 80, 24),
    );
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => [link, menu, image]),
    });

    expect(findHoverTarget(link, { x: 120, y: 112 })).toBeNull();
  });

  it("does not see an image through an opaque non-interactive panel", () => {
    const image = document.createElement("img");
    const panel = document.createElement("div");
    panel.style.backgroundColor = "rgb(255, 255, 255)";
    document.body.append(image, panel);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      rectangle(0, 0, 800, 600),
    );
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => [panel, image]),
    });

    expect(findHoverTarget(panel, { x: 120, y: 112 })).toBeNull();
  });

  it("allows media inside persistent navigation structure", () => {
    const header = document.createElement("header");
    const nav = document.createElement("nav");
    nav.style.position = "sticky";
    nav.style.backgroundColor = "rgb(255, 255, 255)";
    const image = document.createElement("img");
    nav.append(
      image,
      document.createElement("button"),
      document.createElement("button"),
      document.createElement("button"),
    );
    header.append(nav);
    document.body.append(header);

    expect(findHoverTarget(image, { x: 120, y: 112 })).toBe(image);
  });

  it("keeps images inside a semantic flyout inert", () => {
    const flyout = document.createElement("div");
    flyout.className = "vehicle-flyout";
    const image = document.createElement("img");
    flyout.append(image);
    document.body.append(flyout);

    expect(findHoverTarget(image, { x: 120, y: 112 })).toBeNull();
  });

  it("keeps images inside an application menu inert", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const image = document.createElement("img");
    menu.append(image);
    document.body.append(menu);

    expect(findHoverTarget(image, { x: 120, y: 112 })).toBeNull();
  });

  it("keeps images inside a dense floating control surface inert", () => {
    const surface = document.createElement("div");
    surface.style.position = "absolute";
    surface.style.backgroundColor = "rgb(255, 255, 255)";
    const image = document.createElement("img");
    surface.append(
      image,
      document.createElement("button"),
      document.createElement("button"),
      document.createElement("button"),
    );
    document.body.append(surface);
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(
      rectangle(20, 30, 400, 300),
    );
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      rectangle(20, 30, 100, 100),
    );

    expect(findHoverTarget(image, { x: 120, y: 112 })).toBeNull();
  });

  it("allows a media-dominated tile with dense overlay controls", () => {
    const tile = document.createElement("div");
    tile.style.position = "absolute";
    tile.style.backgroundColor = "rgb(255, 255, 255)";
    const image = document.createElement("img");
    const overlay = document.createElement("a");
    overlay.href = "https://gallery.example/photo/123";
    overlay.setAttribute("role", "heading");
    overlay.append(
      document.createElement("button"),
      document.createElement("button"),
    );
    tile.append(image, overlay);
    document.body.append(tile);
    vi.spyOn(tile, "getBoundingClientRect").mockReturnValue(
      rectangle(20, 30, 300, 200),
    );
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      rectangle(20, 30, 300, 200),
    );
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue(
      rectangle(20, 30, 300, 200),
    );

    expect(findHoverTarget(overlay, { x: 120, y: 112 })).toBe(image);
  });

  it("does not select nested media outside the pointer", () => {
    const anchor = document.createElement("a");
    const image = document.createElement("img");
    const overlay = document.createElement("span");
    anchor.append(image, overlay);
    document.body.append(anchor);

    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rectangle(500, 500, 100, 100));

    expect(findHoverTarget(overlay, { x: 100, y: 100 })).toBeNull();
  });

  it("ignores a text link that does not expose visible media", () => {
    const anchor = document.createElement("a");
    anchor.href = "https://example.test/posts/123";
    anchor.textContent = "A long post title";
    document.body.append(anchor);

    expect(findHoverTarget(anchor, { x: 100, y: 100 })).toBeNull();
  });

  it("does not mistake a generic data-url for a lazy image", () => {
    const row = document.createElement("article");
    row.dataset.url = "https://example.test/posts/123";
    const anchor = document.createElement("a");
    anchor.href = row.dataset.url;
    anchor.textContent = "A long post title";
    row.append(anchor);
    document.body.append(row);

    expect(findHoverTarget(anchor, { x: 100, y: 100 })).toBeNull();
  });

  it("still recognizes an explicit lazy image source", () => {
    const lazyImage = document.createElement("div");
    lazyImage.dataset.src = "https://cdn.example.test/photo.jpg";
    document.body.append(lazyImage);

    expect(findHoverTarget(lazyImage, { x: 100, y: 100 })).toBe(lazyImage);
  });

  it("recognizes an obvious direct media link", () => {
    const anchor = document.createElement("a");
    anchor.href = "https://cdn.example.test/photo.jpg";
    anchor.textContent = "Original image";
    document.body.append(anchor);

    expect(findHoverTarget(anchor, { x: 100, y: 100 })).toBe(anchor);
  });

  it("recognizes an extensionless media link backed by a matching thumbnail", () => {
    const row = document.createElement("article");
    row.dataset.kind = "video";
    const thumbnailLink = document.createElement("a");
    thumbnailLink.href = "https://media.example.test/watch/123";
    const image = document.createElement("img");
    thumbnailLink.append(image);
    const titleLink = document.createElement("a");
    titleLink.href = thumbnailLink.href;
    titleLink.textContent = "Video title";
    row.append(thumbnailLink, titleLink);
    document.body.append(row);

    expect(findHoverTarget(titleLink, { x: 200, y: 100 })).toBe(titleLink);
  });

  it("keeps an extensionless article link inert without declared media context", () => {
    const row = document.createElement("article");
    const thumbnailLink = document.createElement("a");
    thumbnailLink.href = "https://news.example.test/articles/123";
    thumbnailLink.append(document.createElement("img"));
    const titleLink = document.createElement("a");
    titleLink.href = thumbnailLink.href;
    titleLink.textContent = "Article title";
    row.append(thumbnailLink, titleLink);
    document.body.append(row);

    expect(findHoverTarget(titleLink, { x: 200, y: 100 })).toBeNull();
  });
});

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
