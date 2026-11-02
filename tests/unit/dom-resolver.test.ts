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

  it("previews the original of an X grid thumbnail that is not larger than its rendering", () => {
    const thumbnail = "https://pbs.twimg.com/media/HV56yHnXcAAwYJ2?format=jpg&name=360x360";
    const anchor = document.createElement("a");
    anchor.href = "/NASA/status/2116263878807998722/photo/1";
    const photo = document.createElement("div");
    photo.setAttribute("data-testid", "tweetPhoto");
    const image = document.createElement("img");
    image.src = thumbnail;
    Object.defineProperty(image, "naturalWidth", { value: 215 });
    Object.defineProperty(image, "naturalHeight", { value: 360 });
    image.getBoundingClientRect = () => new DOMRect(0, 0, 209, 350);
    photo.append(image);
    anchor.append(photo);
    document.body.append(anchor);

    const resolution = resolveDomTarget(image, { showSameSizeImages: false });
    expect(resolution.candidates).toHaveLength(1);
    expect(resolution.candidates[0]).toMatchObject({
      url: "https://pbs.twimg.com/media/HV56yHnXcAAwYJ2?format=jpg&name=orig",
      source: "rewrite-rule",
      quality: "original",
    });
    expect(resolution.candidates[0]?.confidence).toBeGreaterThanOrEqual(90);
    expect(resolution.fallbackCandidates.map((candidate) => candidate.url)).toContain(thumbnail);
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

  it("selects the largest candidate from a lazy-loaded srcset", () => {
    const image = document.createElement("img");
    image.setAttribute("data-srcset", "/lazy-small.jpg 400w, /lazy-original.jpg 3200w");
    document.body.append(image);

    expect(resolveDomTarget(image, { showSameSizeImages: false }).candidates[0]).toMatchObject({
      url: "http://localhost:3000/lazy-original.jpg",
      source: "srcset",
      quality: "responsive",
      width: 3200,
    });
  });

  it("does not treat a full-size attribute on an ancestor as the hovered image's original", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-original", "/unrelated-container-image.jpg");
    const image = document.createElement("img");
    image.srcset = "/hovered-preview.jpg 1200w, /hovered-original.jpg 4000w";
    wrapper.append(image);
    document.body.append(wrapper);

    expect(resolveDomTarget(image, { showSameSizeImages: false }).candidates[0]).toMatchObject({
      url: "http://localhost:3000/hovered-original.jpg",
      source: "srcset",
      width: 4000,
    });
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
    tile.style.backgroundRepeat = "no-repeat";
    document.body.append(tile);
    expect(resolveDomTarget(tile, { showSameSizeImages: false }).candidates[0]).toMatchObject({
      url: "http://localhost:3000/background.webp",
      source: "background-image",
    });
  });

  it("does not treat an ancestor drop shadow as the hovered image", () => {
    const wrapper = document.createElement("div");
    wrapper.style.backgroundImage = 'url("/shadow.png")';
    wrapper.style.backgroundRepeat = "no-repeat";
    const image = document.createElement("img");
    image.src = "/photo.jpg";
    wrapper.append(image);
    document.body.append(wrapper);

    const visible = resolveDomTarget(image, { showSameSizeImages: true });
    expect(visible.candidates[0]).toMatchObject({
      url: "http://localhost:3000/photo.jpg",
      source: "image-src",
    });
    expect(visible.candidates.map((candidate) => candidate.url)).not.toContain(
      "http://localhost:3000/shadow.png",
    );

    const suppressed = resolveDomTarget(image, { showSameSizeImages: false });
    expect(suppressed.candidates).toEqual([]);
    expect(suppressed.fallbackCandidates[0]).toMatchObject({
      url: "http://localhost:3000/photo.jpg",
      source: "image-src",
    });
  });

  it("does not collect a repeating decorative background", () => {
    const surface = document.createElement("div");
    surface.style.backgroundImage = 'url("/brand-pattern.png")';
    surface.style.backgroundRepeat = "repeat";
    document.body.append(surface);

    expect(resolveDomTarget(surface, { showSameSizeImages: false }).candidates).toEqual([]);
  });

  it("does not collect a page-scale decorative background", () => {
    const surface = document.createElement("div");
    surface.style.backgroundImage = 'url("/brand-backdrop.png")';
    surface.style.backgroundRepeat = "no-repeat";
    surface.getBoundingClientRect = () => rectangle(0, 0, 1024, 500);
    document.body.append(surface);

    expect(resolveDomTarget(surface, { showSameSizeImages: false }).candidates).toEqual([]);
  });

  it("keeps a page-scale background with explicit image semantics", () => {
    const image = document.createElement("div");
    image.setAttribute("role", "img");
    image.style.backgroundImage = 'url("/wide-photo.jpg")';
    image.style.backgroundRepeat = "no-repeat";
    image.getBoundingClientRect = () => rectangle(0, 0, 1024, 500);
    document.body.append(image);

    expect(resolveDomTarget(image, { showSameSizeImages: false }).candidates).toContainEqual(
      expect.objectContaining({
        url: "http://localhost:3000/wide-photo.jpg",
        source: "background-image",
      }),
    );
  });

  it("does not collect a page-scale decorative image element", () => {
    const backdrop = document.createElement("img");
    backdrop.src = "/brand-backdrop.jpg";
    backdrop.alt = "";
    backdrop.getBoundingClientRect = () => rectangle(0, 0, 1024, 500);
    document.body.append(backdrop);

    expect(resolveDomTarget(backdrop, { showSameSizeImages: true }).candidates).toEqual([]);
  });

  it("does not collect a lazy source from a page-scale decorative element", () => {
    const backdrop = document.createElement("div");
    backdrop.dataset.src = "/brand-backdrop.jpg";
    backdrop.getBoundingClientRect = () => rectangle(0, 0, 1024, 500);
    document.body.append(backdrop);

    expect(resolveDomTarget(backdrop, { showSameSizeImages: true }).candidates).toEqual([]);
  });

  it("keeps a page-scale image element with explicit media semantics", () => {
    const image = document.createElement("img");
    image.src = "/wide-photo.jpg";
    image.alt = "Wide landscape";
    image.getBoundingClientRect = () => rectangle(0, 0, 1024, 500);
    document.body.append(image);

    expect(resolveDomTarget(image, { showSameSizeImages: true }).candidates).toContainEqual(
      expect.objectContaining({
        url: "http://localhost:3000/wide-photo.jpg",
        source: "image-src",
      }),
    );
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

  it("ranks an explicitly larger video source ahead of the current rendition", () => {
    const video = document.createElement("video");
    video.src = "https://cdn.example.test/video-720.mp4";
    const source = document.createElement("source");
    source.src = "https://cdn.example.test/video-4k.webm";
    source.dataset.width = "3840";
    source.dataset.height = "2160";
    video.append(source);
    document.body.append(video);

    const resolution = resolveDomTarget(video, { showSameSizeImages: false });

    expect(resolution.candidates[0]).toMatchObject({
      url: "https://cdn.example.test/video-4k.webm",
      kind: "video",
      width: 3840,
      height: 2160,
    });
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

  it("gives each photo of an X post its own original in the gallery", () => {
    const grid = document.createElement("div");
    const images = ["HUIiFOpW8AABTfc", "HUIiFb6W4AAwNM7"].map((id, index) => {
      const anchor = document.createElement("a");
      anchor.className = "photo-link";
      anchor.href = `/NASA/status/2108285056170996122/photo/${index + 1}`;
      const image = document.createElement("img");
      image.src = `https://pbs.twimg.com/media/${id}?format=jpg&name=360x360`;
      anchor.append(image);
      grid.append(anchor);
      return image;
    });
    document.body.append(grid);

    const resolution = resolveDomTarget(images[1]!, { showSameSizeImages: false });
    expect(resolution.gallery?.index).toBe(1);
    expect(resolution.gallery?.items).toMatchObject([
      {
        url: "https://pbs.twimg.com/media/HUIiFOpW8AABTfc?format=jpg&name=orig",
        source: "rewrite-rule",
        linkedPageUrl: "http://localhost:3000/NASA/status/2108285056170996122/photo/1",
      },
      {
        url: "https://pbs.twimg.com/media/HUIiFb6W4AAwNM7?format=jpg&name=orig",
        source: "rewrite-rule",
        linkedPageUrl: "http://localhost:3000/NASA/status/2108285056170996122/photo/2",
      },
    ]);
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

  it("uses each gallery item's highest-quality source", () => {
    const gallery = document.createElement("section");
    gallery.className = "gallery";
    const images = ["one", "two"].map((name) => {
      const image = document.createElement("img");
      image.srcset = `/${name}-preview.jpg 1200w`;
      image.setAttribute("data-srcset", `/${name}-large.jpg 3200w`);
      image.setAttribute("data-full", `/${name}-original.jpg`);
      gallery.append(image);
      return image;
    });
    document.body.append(gallery);

    const resolution = resolveDomTarget(images[0]!, { showSameSizeImages: false });

    expect(resolution.gallery?.items.map((item) => item.url)).toEqual([
      "http://localhost:3000/one-original.jpg",
      "http://localhost:3000/two-original.jpg",
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

  it("does not treat repeated posts inside a thread as a gallery", () => {
    const thread = document.createElement("div");
    thread.className = "thread";
    const images = ["one.jpg", "two.webm", "three.jpg"].map((name) => {
      const post = document.createElement("div");
      post.className = "postContainer replyContainer";
      const link = document.createElement("a");
      link.href = `https://cdn.example.test/${name}`;
      const image = document.createElement("img");
      image.src = `https://cdn.example.test/${name}-thumbnail.jpg`;
      link.append(image);
      post.append(link);
      thread.append(post);
      return image;
    });
    document.body.append(thread);

    const resolution = resolveDomTarget(images[1]!, { showSameSizeImages: true });

    expect(resolution.candidates[0]).toMatchObject({
      url: "https://cdn.example.test/two.webm",
      kind: "video",
    });
    expect(resolution.gallery).toBeUndefined();
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
