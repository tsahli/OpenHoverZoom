import { beforeEach, describe, expect, it } from "vitest";
import { resolveDomTarget } from "../../src/resolver/dom-resolver";

describe("DOM resolver", () => {
  beforeEach(() => document.body.replaceChildren());

  it("prefers a direct linked image over its thumbnail", () => {
    const anchor = document.createElement("a");
    anchor.href = "https://cdn.example/full.jpg";
    const image = document.createElement("img");
    image.src = "https://cdn.example/thumb.jpg";
    image.alt = "Preview caption";
    anchor.append(image);
    document.body.append(anchor);

    const resolution = resolveDomTarget(image, { showSameSizeImages: false });
    expect(resolution.candidates[0]).toMatchObject({
      url: "https://cdn.example/full.jpg",
      source: "direct-link",
      caption: "Preview caption",
    });
  });

  it("collects the largest responsive and lazy-load candidates", () => {
    const image = document.createElement("img");
    image.srcset = "/small.jpg 300w, /large.jpg 1600w";
    image.setAttribute("data-full", "/original.jpg");
    document.body.append(image);

    const urls = resolveDomTarget(image, { showSameSizeImages: false }).candidates.map(
      (candidate) => candidate.url,
    );
    expect(urls).toContain("http://localhost:3000/large.jpg");
    expect(urls).toContain("http://localhost:3000/original.jpg");
  });

  it("retains a rendered-size thumbnail only as a failure fallback", () => {
    const image = document.createElement("img");
    image.src = "/thumbnail.jpg";
    image.srcset = "/large.jpg 1600w";
    document.body.append(image);

    const resolution = resolveDomTarget(image, { showSameSizeImages: false });

    expect(resolution.candidates.map((candidate) => candidate.url)).not.toContain(
      "http://localhost:3000/thumbnail.jpg",
    );
    expect(resolution.fallbackCandidates).toContainEqual(
      expect.objectContaining({
        url: "http://localhost:3000/thumbnail.jpg",
        source: "image-src",
      }),
    );
  });

  it("collects a CSS background URL", () => {
    const tile = document.createElement("div");
    tile.style.backgroundImage = 'url("/background.webp")';
    document.body.append(tile);
    expect(resolveDomTarget(tile, { showSameSizeImages: false }).candidates[0]).toMatchObject({
      url: "http://localhost:3000/background.webp",
      source: "background-image",
    });
  });

  it("collects media nested inside a linked gallery wrapper", () => {
    const anchor = document.createElement("a");
    anchor.href = "/details/photo";
    const figure = document.createElement("figure");
    const wrapper = document.createElement("div");
    const image = document.createElement("img");
    image.srcset = "/thumb.jpg 300w, /large.jpg 1800w";
    wrapper.append(image);
    figure.append(wrapper);
    anchor.append(figure);
    document.body.append(anchor);

    const resolution = resolveDomTarget(anchor, { showSameSizeImages: false });

    expect(resolution.candidates).toContainEqual(
      expect.objectContaining({
        url: "http://localhost:3000/large.jpg",
        source: "srcset",
      }),
    );
  });

  it("uses a matching sibling thumbnail as an extensionless media link fallback", () => {
    const row = document.createElement("article");
    row.dataset.kind = "video";
    const thumbnailLink = document.createElement("a");
    thumbnailLink.href = "https://media.example.test/watch/123";
    const image = document.createElement("img");
    image.src = "https://cdn.example.test/poster.jpg";
    thumbnailLink.append(image);
    const titleLink = document.createElement("a");
    titleLink.href = thumbnailLink.href;
    titleLink.textContent = "Video title";
    row.append(thumbnailLink, titleLink);
    document.body.append(row);

    const resolution = resolveDomTarget(titleLink, { showSameSizeImages: true });

    expect(resolution.anchorUrl).toBe("https://media.example.test/watch/123");
    expect(resolution.candidates).toContainEqual(
      expect.objectContaining({
        url: "https://cdn.example.test/poster.jpg",
        source: "image-src",
      }),
    );
  });

  it("discovers a detail page from a covering sibling link", () => {
    const tile = document.createElement("div");
    const image = document.createElement("img");
    image.src = "https://cdn.example.test/thumbnail.jpg";
    const interactionLayer = document.createElement("div");
    const overlay = document.createElement("a");
    overlay.href = "https://gallery.example.test/photos/123";
    interactionLayer.append(overlay);
    tile.append(image, interactionLayer);
    document.body.append(tile);
    image.getBoundingClientRect = () => rectangle(20, 30, 300, 200);
    overlay.getBoundingClientRect = () => rectangle(20, 30, 300, 200);

    const resolution = resolveDomTarget(image, { showSameSizeImages: true });

    expect(resolution.anchorUrl).toBe("https://gallery.example.test/photos/123");
    expect(resolution.candidates).toContainEqual(
      expect.objectContaining({
        url: "https://cdn.example.test/thumbnail.jpg",
        source: "image-src",
      }),
    );
  });

  it("ignores a sibling link that does not cover the image", () => {
    const tile = document.createElement("div");
    const image = document.createElement("img");
    image.src = "https://cdn.example.test/thumbnail.jpg";
    const unrelated = document.createElement("a");
    unrelated.href = "https://gallery.example.test/unrelated";
    tile.append(image, unrelated);
    document.body.append(tile);
    image.getBoundingClientRect = () => rectangle(20, 30, 300, 200);
    unrelated.getBoundingClientRect = () => rectangle(400, 30, 120, 30);

    const resolution = resolveDomTarget(image, { showSameSizeImages: true });

    expect(resolution.anchorUrl).toBeNull();
  });

  it("discovers an ordered, bounded gallery around the hovered image", () => {
    const gallery = document.createElement("section");
    gallery.className = "photo-gallery";
    const images = ["one", "two", "three"].map((name) => {
      const figure = document.createElement("figure");
      figure.className = "gallery-card";
      const image = document.createElement("img");
      image.alt = `Gallery ${name}`;
      image.srcset = `/${name}-thumb.jpg 300w, /${name}-large.jpg 1600w`;
      const detailLink = document.createElement("a");
      detailLink.href = `/photos/${name}`;
      figure.append(image, detailLink);
      gallery.append(figure);
      image.getBoundingClientRect = () => rectangle(20, 30, 300, 200);
      detailLink.getBoundingClientRect = () => rectangle(20, 30, 300, 200);
      return image;
    });
    document.body.append(gallery);

    const resolution = resolveDomTarget(images[1]!, { showSameSizeImages: false });

    expect(resolution.gallery?.index).toBe(1);
    expect(resolution.gallery?.items.map((item) => item.url)).toEqual([
      "http://localhost:3000/one-large.jpg",
      "http://localhost:3000/two-large.jpg",
      "http://localhost:3000/three-large.jpg",
    ]);
    expect(resolution.gallery?.items.map((item) => item.linkedPageUrl)).toEqual([
      "http://localhost:3000/photos/one",
      "http://localhost:3000/photos/two",
      "http://localhost:3000/photos/three",
    ]);
  });

  it("discovers images inside a wide gallery without exhausting traversal on card shells", () => {
    const gallery = document.createElement("ul");
    gallery.className = "gallery";
    const images = Array.from({ length: 40 }, (_, index) => {
      const item = document.createElement("li");
      item.className = "gallery-card";
      const wrapper = document.createElement("div");
      const image = document.createElement("img");
      image.srcset = `/item-${index}-thumb.jpg 300w, /item-${index}-large.jpg 1200w`;
      wrapper.append(image);
      item.append(wrapper, document.createElement("span"));
      gallery.append(item);
      return image;
    });
    document.body.append(gallery);

    const resolution = resolveDomTarget(images[30]!, { showSameSizeImages: false });

    expect(resolution.gallery?.items).toHaveLength(40);
    expect(resolution.gallery?.index).toBe(30);
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
