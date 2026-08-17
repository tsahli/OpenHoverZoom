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

  it("recognizes a non-repeating CSS background thumbnail", () => {
    const thumbnail = document.createElement("div");
    thumbnail.style.backgroundImage = 'url("/photo.jpg")';
    thumbnail.style.backgroundRepeat = "no-repeat";
    document.body.append(thumbnail);

    expect(findHoverTarget(thumbnail, { x: 100, y: 100 })).toBe(thumbnail);
  });

  it.each(["0 0", "0 -48px"])(
    "ignores a compact CSS sprite positioned at %s",
    (position) => {
      const play = document.createElement("div");
      play.className = "expando-button video collapsed";
      play.style.backgroundImage = 'url("/expando-sprite.png")';
      play.style.backgroundPosition = position;
      play.style.backgroundRepeat = "no-repeat";
      document.body.append(play);
      vi.spyOn(play, "getBoundingClientRect").mockReturnValue(
        rectangle(20, 30, 16, 16),
      );

      expect(findHoverTarget(play, { x: 24, y: 34 })).toBeNull();
    },
  );

  it("ignores an elongated compact CSS sprite", () => {
    const control = document.createElement("div");
    control.style.backgroundImage = 'url("/toolbar-sprite.png")';
    control.style.backgroundRepeat = "no-repeat";
    document.body.append(control);
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(
      rectangle(20, 30, 128, 24),
    );

    expect(findHoverTarget(control, { x: 40, y: 40 })).toBeNull();
  });

  it("keeps a large negatively positioned CSS photo previewable", () => {
    const photo = document.createElement("div");
    photo.style.backgroundImage = 'url("/wide-photo.jpg")';
    photo.style.backgroundPosition = "-40px center";
    photo.style.backgroundRepeat = "no-repeat";
    document.body.append(photo);
    vi.spyOn(photo, "getBoundingClientRect").mockReturnValue(
      rectangle(20, 30, 320, 180),
    );

    expect(findHoverTarget(photo, { x: 100, y: 100 })).toBe(photo);
  });

  it("keeps CSS background thumbnails on ordinary links previewable", () => {
    const thumbnail = document.createElement("a");
    thumbnail.href = "https://example.test/posts/123";
    thumbnail.style.backgroundImage = 'url("/photo.jpg")';
    thumbnail.style.backgroundPosition = "center";
    thumbnail.style.backgroundRepeat = "no-repeat";
    document.body.append(thumbnail);
    vi.spyOn(thumbnail, "getBoundingClientRect").mockReturnValue(
      rectangle(20, 30, 160, 90),
    );

    expect(findHoverTarget(thumbnail, { x: 100, y: 100 })).toBe(thumbnail);
  });

  it("keeps explicit CSS background media inside a control previewable", () => {
    const button = document.createElement("button");
    const image = document.createElement("span");
    image.setAttribute("role", "img");
    image.style.backgroundImage = 'url("/photo.jpg")';
    image.style.backgroundRepeat = "no-repeat";
    button.append(image);
    document.body.append(button);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      rectangle(20, 30, 32, 32),
    );

    expect(findHoverTarget(image, { x: 24, y: 34 })).toBe(image);
  });

  it("keeps a photo-sized CSS background inside a control previewable", () => {
    const button = document.createElement("button");
    const thumbnail = document.createElement("span");
    thumbnail.style.backgroundImage = 'url("/photo.jpg")';
    thumbnail.style.backgroundRepeat = "no-repeat";
    button.append(thumbnail);
    document.body.append(button);
    vi.spyOn(thumbnail, "getBoundingClientRect").mockReturnValue(
      rectangle(20, 30, 160, 90),
    );

    expect(findHoverTarget(thumbnail, { x: 100, y: 60 })).toBe(thumbnail);
  });

  it("keeps concrete media inside a control previewable", () => {
    const button = document.createElement("button");
    const image = document.createElement("img");
    button.append(image);
    document.body.append(button);

    expect(findHoverTarget(image, { x: 100, y: 100 })).toBe(image);
  });

  it("ignores a video that is already playing", () => {
    const video = document.createElement("video");
    document.body.append(video);
    setPlaybackState(video, { paused: false, ended: false });

    expect(findHoverTarget(video, { x: 100, y: 100 })).toBeNull();
  });

  it("keeps paused and ended videos previewable", () => {
    const paused = document.createElement("video");
    const ended = document.createElement("video");
    document.body.append(paused, ended);
    setPlaybackState(paused, { paused: true, ended: false });
    setPlaybackState(ended, { paused: false, ended: true });

    expect(findHoverTarget(paused, { x: 100, y: 100 })).toBe(paused);
    expect(findHoverTarget(ended, { x: 100, y: 100 })).toBe(ended);
  });

  it("ignores a playing video beneath a transparent interaction layer", () => {
    const video = document.createElement("video");
    const overlay = document.createElement("a");
    overlay.href = "https://example.test/watch/123";
    document.body.append(video, overlay);
    vi.spyOn(video, "getBoundingClientRect").mockReturnValue(
      rectangle(20, 30, 300, 200),
    );
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue(
      rectangle(20, 30, 300, 200),
    );
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => [overlay, video]),
    });

    setPlaybackState(video, { paused: true, ended: false });
    expect(findHoverTarget(overlay, { x: 100, y: 100 })).toBe(video);

    setPlaybackState(video, { paused: false, ended: false });
    expect(findHoverTarget(overlay, { x: 100, y: 100 })).toBeNull();
  });

  it("allows a foreground image over unrelated playing media", () => {
    const video = document.createElement("video");
    const image = document.createElement("img");
    document.body.append(video, image);
    setPlaybackState(video, { paused: false, ended: false });
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => [image, video]),
    });

    expect(findHoverTarget(image, { x: 100, y: 100 })).toBe(image);
  });

  it("ignores a repeating CSS background pattern", () => {
    const backdrop = document.createElement("div");
    backdrop.style.backgroundImage = 'url("/brand-pattern.png")';
    backdrop.style.backgroundRepeat = "repeat";
    document.body.append(backdrop);

    expect(findHoverTarget(backdrop, { x: 100, y: 100 })).toBeNull();
  });

  it("ignores a background applied to the page root", () => {
    document.body.style.backgroundImage = 'url("/brand-pattern.png")';
    document.body.style.backgroundRepeat = "no-repeat";

    expect(findHoverTarget(document.body, { x: 100, y: 100 })).toBeNull();
  });

  it("ignores a page-scale decorative image element", () => {
    const backdrop = document.createElement("img");
    backdrop.src = "/brand-backdrop.jpg";
    backdrop.alt = "";
    backdrop.getBoundingClientRect = () => rectangle(0, 0, 1024, 500);
    document.body.append(backdrop);

    expect(findHoverTarget(backdrop, { x: 100, y: 100 })).toBeNull();
  });

  it("ignores a lazy source on a page-scale decorative element", () => {
    const backdrop = document.createElement("div");
    backdrop.dataset.src = "/brand-backdrop.jpg";
    backdrop.getBoundingClientRect = () => rectangle(0, 0, 1024, 500);
    document.body.append(backdrop);

    expect(findHoverTarget(backdrop, { x: 100, y: 100 })).toBeNull();
  });

  it("keeps a page-scale image element with explicit media semantics", () => {
    const image = document.createElement("img");
    image.src = "/wide-photo.jpg";
    image.alt = "Wide landscape";
    image.getBoundingClientRect = () => rectangle(0, 0, 1024, 500);
    document.body.append(image);

    expect(findHoverTarget(image, { x: 100, y: 100 })).toBe(image);
  });

  it("ignores a page-scale decorative video element", () => {
    const backdrop = document.createElement("video");
    backdrop.src = "/ambient-loop.mp4";
    backdrop.getBoundingClientRect = () => rectangle(0, 0, 1024, 500);
    document.body.append(backdrop);

    expect(findHoverTarget(backdrop, { x: 100, y: 100 })).toBeNull();
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

function setPlaybackState(
  media: HTMLMediaElement,
  state: { paused: boolean; ended: boolean },
): void {
  Object.defineProperties(media, {
    paused: { configurable: true, value: state.paused },
    ended: { configurable: true, value: state.ended },
  });
}
