import { describe, expect, it } from "vitest";
import {
  generateSizeVariants,
  imageIdentity,
  passesLoadCheck,
} from "../../src/resolver/size-variants";

const orig = (url: string): string => generateSizeVariants(url)[0] ?? "";

describe("size variants", () => {
  it("removes query size parameters but keeps the rest", () => {
    expect(generateSizeVariants("https://a.test/u/1?s=40&v=4")).toEqual(["https://a.test/u/1?v=4"]);
    expect(orig("https://a.test/p.jpg?w=200&h=100&fit=crop")).toBe("https://a.test/p.jpg?fit=crop");
    expect(orig("https://a.test/p.jpg?width=200&height=100")).toBe("https://a.test/p.jpg");
    expect(orig("https://a.test/p.jpg?size=120")).toBe("https://a.test/p.jpg");
    expect(orig("https://a.test/p.jpg?sz=64&x=1")).toBe("https://a.test/p.jpg?x=1");
    expect(generateSizeVariants("https://a.test/p.jpg?s=abc&h=9f3&w=1")).toEqual([]);
  });

  it("tries larger names for a parameter holding a size word or dimensions", () => {
    const base = "https://a.test/media/HV56?format=webp&name=";
    const expected = ["orig", "original", "full", "large"].map((word) => `${base}${word}`);
    expect(generateSizeVariants(`${base}small`)).toEqual(expected);
    expect(generateSizeVariants(`${base}360x360`)).toEqual(expected);
    expect(generateSizeVariants(`${base}large`)).toEqual(expected.slice(0, 3));
    expect(generateSizeVariants(`${base}orig`)).toEqual([]);
  });

  it("tries the full size of a labelled thumbnail directory", () => {
    expect(generateSizeVariants("https://a.test/img/feed_thumbnail/plain/abc")).toEqual([
      "https://a.test/img/feed_fullsize/plain/abc",
      "https://a.test/img/feed/plain/abc",
    ]);
  });

  it("removes file name size markers", () => {
    expect(generateSizeVariants("https://a.test/p/Uut_normal.jpg")).toEqual(["https://a.test/p/Uut.jpg"]);
    expect(orig("https://a.test/I/71TP._AC_UL320_.jpg")).toBe("https://a.test/I/71TP.jpg");
    expect(orig("https://a.test/up/beach-150x150.jpg")).toBe("https://a.test/up/beach.jpg");
    expect(orig("https://a.test/up/beach_640x480.png")).toBe("https://a.test/up/beach.png");
    expect(orig("https://a.test/up/beach-150x150@2x.jpg")).toBe("https://a.test/up/beach.jpg");
    expect(orig("https://a.test/up/thumb_beach.jpg")).toBe("https://a.test/up/beach.jpg");
  });

  it("reads a rendition stored under its source file", () => {
    expect(
      generateSizeVariants("https://a.test/commons/thumb/a/a9/Example.jpg/120px-Example.jpg"),
    ).toEqual(["https://a.test/commons/a/a9/Example.jpg"]);
  });

  it("handles sizes in a path suffix and in directories", () => {
    expect(generateSizeVariants("https://a.test/abc=s120")).toEqual([
      "https://a.test/abc=s0",
      "https://a.test/abc",
    ]);
    expect(orig("https://a.test/abc=w200-h200-c")).toBe("https://a.test/abc=s0");
    expect(orig("https://a.test/g/thumbs/p.jpg")).toBe("https://a.test/g/p.jpg");
    expect(generateSizeVariants("https://a.test/small/p.jpg")).toContain("https://a.test/large/p.jpg");
    expect(generateSizeVariants("https://a.test/236x/aa/p.jpg")).toContain("https://a.test/originals/aa/p.jpg");
    expect(orig("https://a.test/upload/w_200,h_200,c_fill/p.jpg")).toBe("https://a.test/upload/p.jpg");
  });

  it("leaves URLs without size hints alone", () => {
    for (const url of [
      "https://a.test/amplify_video_thumb/123/img/x.jpg",
      "https://a.test/photos/small-talk/IMG_1234.jpg",
      "https://a.test/icon-150x150.svg",
      "data:image/png;base64,AAAA",
      "blob:https://a.test/id",
      "not a url",
    ]) {
      expect(generateSizeVariants(url)).toEqual([]);
    }
  });

  it("caps the guesses and combines stacked hints first", () => {
    const variants = generateSizeVariants("https://a.test/thumbs/p_normal.jpg?w=100&name=small");
    expect(variants).toHaveLength(4);
    expect(variants[0]).toBe("https://a.test/p.jpg?name=orig");
  });
});

describe("image identity", () => {
  it("ignores size markers, renditions and hosts", () => {
    expect(imageIdentity("https://a.test/p/UutmZxGI_normal.jpg")).toBe(imageIdentity("https://b.test/UutmZxGI.png"));
    expect(imageIdentity("https://a.test/t/Example.svg/120px-Example.svg.png")).toBe(imageIdentity("https://a.test/Example.svg"));
    expect(imageIdentity("https://a.test/media/abc123/thumb.jpg")).toBe("abc123");
  });

  it("tells photos of one post apart and refuses generic names", () => {
    expect(imageIdentity("https://a.test/media/HUIiFb6W4AAwNM7?name=small"))
      .not.toBe(imageIdentity("https://a.test/media/HUIiFOpW8AABTfc?name=large"));
    expect(imageIdentity("https://a.test/img.jpg")).toBeNull();
    expect(imageIdentity("https://a.test/a/image.jpg")).toBeNull();
    expect(imageIdentity("https://a.test/uploads/featured.jpg")).toBeNull();
  });
});

describe("load check", () => {
  const thumbnail = { url: "https://a.test/t.jpg", width: 215, height: 360 };

  it("accepts a larger image of the same shape", () => {
    expect(passesLoadCheck({ width: 2048, height: 3429 }, { thumbnail })).toBe(true);
  });

  it("rejects a same-size image and a different shape", () => {
    expect(passesLoadCheck({ width: 215, height: 360 }, { thumbnail })).toBe(false);
    expect(passesLoadCheck({ width: 2000, height: 1000 }, { thumbnail })).toBe(false);
  });

  it("allows a square thumbnail to be a crop, within reason", () => {
    const square = { thumbnail: { url: "https://a.test/s.jpg", width: 150, height: 150 } };
    expect(passesLoadCheck({ width: 1200, height: 800 }, square)).toBe(true);
    expect(passesLoadCheck({ width: 3000, height: 1000 }, square)).toBe(false);
  });

  it("applies the rendered size only when asked", () => {
    const rendered = { width: 400, height: 300 };
    expect(passesLoadCheck({ width: 400, height: 300 }, { rendered })).toBe(false);
    expect(passesLoadCheck({ width: 800, height: 600 }, { rendered })).toBe(true);
  });
});
