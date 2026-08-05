import { describe, expect, it } from "vitest";
import { extractMetadataCandidates } from "../../src/resolver/metadata";

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
});
