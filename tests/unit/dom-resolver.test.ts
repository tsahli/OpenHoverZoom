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

  it("discovers an ordered, bounded gallery around the hovered image", () => {
    const gallery = document.createElement("section");
    gallery.className = "photo-gallery";
    const images = ["one", "two", "three"].map((name) => {
      const figure = document.createElement("figure");
      figure.className = "gallery-card";
      const image = document.createElement("img");
      image.alt = `Gallery ${name}`;
      image.srcset = `/${name}-thumb.jpg 300w, /${name}-large.jpg 1600w`;
      figure.append(image);
      gallery.append(figure);
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
