import { describe, expect, it } from "vitest";
import { parseSrcset, selectLargestSrcset } from "../../src/resolver/srcset";

describe("srcset parsing", () => {
  it("selects the largest width candidate", () => {
    expect(
      selectLargestSrcset("small.jpg 320w, medium.jpg 800w, /large.jpg 1600w"),
    ).toEqual({ url: "/large.jpg", width: 1600 });
  });

  it("selects the largest density candidate", () => {
    expect(selectLargestSrcset("one.jpg 1x, three.jpg 3x, two.jpg 2x")).toEqual({
      url: "three.jpg",
      density: 3,
    });
  });

  it("does not split a data URL at its internal comma", () => {
    expect(parseSrcset("data:image/png;base64,AAAA 1x, high.png 2x")).toEqual([
      { url: "data:image/png;base64,AAAA", density: 1 },
      { url: "high.png", density: 2 },
    ]);
  });

  it("drops invalid or ambiguous descriptors", () => {
    expect(parseSrcset("bad.jpg 0w, ambiguous.jpg 2x 3x, good.jpg 400w")).toEqual([
      { url: "good.jpg", width: 400 },
    ]);
  });
});
