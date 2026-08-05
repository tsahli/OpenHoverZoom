import { describe, expect, it, vi } from "vitest";
import {
  comparableAreaOverlap,
  intersectionArea,
  walkBoundedDescendants,
} from "../../src/shared/dom";

describe("shared DOM helpers", () => {
  it("walks descendants breadth-first within depth and element limits", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div id="first"><span id="third"><i id="too-deep"></i></span></div>
      <div id="second"><span id="fourth"></span></div>
    `;

    const elements = [...walkBoundedDescendants(root, {
      maxDepth: 2,
      maxElements: 3,
    })];

    expect(elements.map((element) => element.id)).toEqual(["first", "second", "third"]);
  });

  it("measures overlap only between elements with comparable areas", () => {
    const left = document.createElement("div");
    const right = document.createElement("div");
    vi.spyOn(left, "getBoundingClientRect").mockReturnValue(rectangle(0, 0, 100, 100));
    const rightRectangle = vi
      .spyOn(right, "getBoundingClientRect")
      .mockReturnValue(rectangle(25, 0, 100, 100));

    expect(comparableAreaOverlap(left, right)).toBe(0.75);
    expect(intersectionArea(left.getBoundingClientRect(), right.getBoundingClientRect())).toBe(
      7_500,
    );

    rightRectangle.mockReturnValue(rectangle(0, 0, 10, 10));
    expect(comparableAreaOverlap(left, right)).toBe(0);
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
