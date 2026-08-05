import { beforeEach, describe, expect, it, vi } from "vitest";
import { findHoverTarget } from "../../src/content/target-inspector";

describe("hover target inspection", () => {
  beforeEach(() => document.body.replaceChildren());

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
