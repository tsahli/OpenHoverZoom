import { describe, expect, it } from "vitest";
import { extractMetadataCandidates } from "../../src/resolver/metadata";
import { rankCandidates } from "../../src/resolver/score-candidates";

describe("linked-document metadata", () => {
  it("extracts and resolves standard image metadata", () => {
    const candidates = extractMetadataCandidates(
      `<!doctype html>
        <title>Fixture title</title>
        <meta property="og:title" content="A safe caption">
        <meta property="og:image" content="/media/hero.jpg">
        <meta name="twitter:image" content="https://cdn.example/twitter.webp">`,
      "https://example.com/articles/one",
    );
    expect(candidates[0]).toMatchObject({
      url: "https://example.com/media/hero.jpg",
      kind: "image",
      caption: "A safe caption",
    });
  });

  it("retains Open Graph dimensions for quality ranking", () => {
    const candidates = extractMetadataCandidates(
      `<meta property="og:image" content="/social.jpg">
       <meta property="og:image:width" content="2400">
       <meta property="og:image:height" content="1260">`,
      "https://example.com/post",
    );

    expect(candidates[0]).toMatchObject({
      url: "https://example.com/social.jpg",
      quality: "responsive",
      width: 2400,
      height: 1260,
    });
  });

  it("retains Open Graph video dimensions and audio candidates", () => {
    const candidates = extractMetadataCandidates(
      `<meta property="og:video" content="/movie.mp4">
       <meta property="og:video:width" content="3840">
       <meta property="og:video:height" content="2160">
       <meta property="og:audio" content="/soundtrack.opus">`,
      "https://example.com/watch/1",
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://example.com/movie.mp4",
          kind: "video",
          width: 3840,
          height: 2160,
        }),
        expect.objectContaining({
          url: "https://example.com/soundtrack.opus",
          kind: "audio",
        }),
      ]),
    );
  });

  it("uses VideoObject semantics for extensionless content URLs", () => {
    const candidates = extractMetadataCandidates(
      `<script type="application/ld+json">
        {"@type":"VideoObject","contentUrl":"/media/stream?id=1","width":1920,"height":1080}
       </script>`,
      "https://example.com/watch/1",
    );

    expect(candidates).toContainEqual(
      expect.objectContaining({
        url: "https://example.com/media/stream?id=1",
        kind: "video",
        quality: "original",
        width: 1920,
        height: 1080,
      }),
    );
  });

  it("keeps extensionless VideoObject thumbnails typed as images", () => {
    const candidates = extractMetadataCandidates(
      `<script type="application/ld+json">
        {"@type":"VideoObject","thumbnailUrl":"/media/thumbnail?id=1"}
       </script>`,
      "https://example.com/watch/1",
    );

    expect(candidates).toContainEqual(
      expect.objectContaining({
        url: "https://example.com/media/thumbnail?id=1",
        kind: "image",
        quality: "thumbnail",
      }),
    );
  });

  it("extracts explicitly sized HTML video sources from detail pages", () => {
    const candidates = extractMetadataCandidates(
      `<video src="/movie-720.mp4" width="1280" height="720">
         <source src="/movie-4k.webm" data-width="3840" data-height="2160">
       </video>`,
      "https://example.com/watch/1",
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://example.com/movie-4k.webm",
          kind: "video",
          width: 3840,
          height: 2160,
        }),
      ]),
    );
  });

  it("extracts bounded JSON-LD and responsive image values", () => {
    const candidates = extractMetadataCandidates(
      `<script type="application/ld+json">
        {"@type":"ImageObject","contentUrl":"/full.avif","thumbnailUrl":"/thumb.jpg"}
       </script>
       <img srcset="small.jpg 300w, large.jpg 1800w">`,
      "https://example.com/post/",
    );
    expect(candidates.map((candidate) => candidate.url)).toEqual([
      "https://example.com/post/large.jpg",
      "https://example.com/thumb.jpg",
      "https://example.com/full.avif",
    ]);
  });

  it("extracts the largest lazy responsive candidate from a detail page", () => {
    const candidates = extractMetadataCandidates(
      `<img data-lazy-srcset="small.webp 400w, original.webp 3600w">`,
      "https://example.com/photos/1/",
    );

    expect(candidates[0]).toMatchObject({
      url: "https://example.com/photos/1/original.webp",
      quality: "responsive",
      width: 3600,
    });
  });

  it("does not let an unscoped full-size hint outrank primary page metadata", () => {
    const candidates = extractMetadataCandidates(
      `<meta property="og:image" content="/primary.jpg">
       <meta property="og:image:width" content="4000">
       <img data-full="/unrelated-recommendation.jpg">`,
      "https://example.com/photos/1/",
    );

    expect(rankCandidates(candidates, { showSameSizeImages: true })[0]?.url).toBe(
      "https://example.com/primary.jpg",
    );
  });

  it("ignores malformed JSON-LD and unsafe protocols", () => {
    expect(
      extractMetadataCandidates(
        '<meta property="og:image" content="javascript:alert(1)"><script type="application/ld+json">{bad</script>',
        "https://example.com",
      ),
    ).toEqual([]);
  });

  it("turns an explicit structured image array into a gallery", () => {
    const candidates = extractMetadataCandidates(
      `<script type="application/ld+json">
        {"@type":"ImageGallery","image":["/one.jpg","/two.jpg","/three.jpg"]}
       </script>`,
      "https://example.com/album/",
    );

    expect(candidates[0]?.gallery?.map((item) => item.url)).toEqual([
      "https://example.com/one.jpg",
      "https://example.com/two.jpg",
      "https://example.com/three.jpg",
    ]);
    expect(candidates[0]?.galleryIndex).toBe(2);
  });

  it("recognizes explicit full-size sources and JSON-LD ImageObject dimensions", () => {
    const candidates = extractMetadataCandidates(
      `<img data-full="/full-from-dom.webp">
       <script type="application/ld+json">
        {"@type":"ImageObject","url":"/full-from-json.avif","width":4096,"height":2731}
       </script>`,
      "https://example.com/photo/1",
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://example.com/full-from-dom.webp",
          quality: "responsive",
        }),
        expect.objectContaining({
          url: "https://example.com/full-from-json.avif",
          quality: "original",
          width: 4096,
          height: 2731,
        }),
      ]),
    );
  });

  it("does not promote a publisher logo over the primary article image", () => {
    const candidates = extractMetadataCandidates(
      `<meta property="og:image" content="/article.jpg">
       <meta property="og:image:width" content="4000">
       <meta property="og:image:height" content="3000">
       <script type="application/ld+json">
        {
          "@type":"NewsArticle",
          "image":"/article.jpg",
          "publisher":{"logo":{
            "@type":"ImageObject",
            "url":"/publisher-logo-page",
            "contentUrl":"/publisher-logo.png"
          }}
        }
       </script>`,
      "https://example.com/article/1",
    );

    expect(rankCandidates(candidates, { showSameSizeImages: true })[0]?.url).toBe(
      "https://example.com/article.jpg",
    );
    expect(candidates.map((candidate) => candidate.url)).not.toContain(
      "https://example.com/publisher-logo.png",
    );
    expect(candidates.map((candidate) => candidate.url)).not.toContain(
      "https://example.com/publisher-logo-page",
    );
  });

  it("resolves relative explicit download links", () => {
    const candidates = extractMetadataCandidates(
      '<a download href="/media/original.avif">Download</a>',
      "https://example.com/photo/1",
    );

    expect(candidates).toContainEqual(
      expect.objectContaining({
        url: "https://example.com/media/original.avif",
        quality: "responsive",
      }),
    );
  });

  it("does not let an unrelated video download replace the primary media", () => {
    const candidates = extractMetadataCandidates(
      `<meta property="og:image" content="/primary.jpg">
       <a download href="/media/trailer.mp4">Download trailer</a>`,
      "https://example.com/article/1",
    );

    expect(rankCandidates(candidates, { showSameSizeImages: true })[0]?.url).toBe(
      "https://example.com/primary.jpg",
    );
    expect(candidates).toContainEqual(
      expect.objectContaining({
        url: "https://example.com/media/trailer.mp4",
        source: "document-metadata",
        quality: "responsive",
      }),
    );
  });

  it("recognizes a semantically explicit original-media link", () => {
    const candidates = extractMetadataCandidates(
      '<a href="/media/full-size.jpg">Original file</a>',
      "https://example.com/photo/1",
    );

    expect(candidates).toContainEqual(
      expect.objectContaining({
        url: "https://example.com/media/full-size.jpg",
        source: "document-original-link",
        quality: "original",
      }),
    );
  });

  it("does not let an unrelated download link replace the primary image", () => {
    const candidates = extractMetadataCandidates(
      `<meta property="og:image" content="/primary.jpg">
       <meta property="og:image:width" content="4000">
       <meta property="og:image:height" content="3000">
       <footer><a download href="/brand.svg">Download logo</a></footer>`,
      "https://example.com/article/1",
    );

    expect(rankCandidates(candidates, { showSameSizeImages: true })[0]?.url).toBe(
      "https://example.com/primary.jpg",
    );
  });
});
