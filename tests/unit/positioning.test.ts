import { describe, expect, it } from "vitest";
import { calculatePlacement } from "../../src/content/positioning";

describe("preview placement", () => {
  it("uses the roomier side of the pointer", () => {
    expect(
      calculatePlacement({ x: 100, y: 300 }, { width: 200, height: 100 }, { width: 1000, height: 700 }),
    ).toMatchObject({ left: 118, top: 250, side: "right" });
    expect(
      calculatePlacement({ x: 900, y: 300 }, { width: 200, height: 100 }, { width: 1000, height: 700 }),
    ).toMatchObject({ left: 682, top: 250, side: "left" });
  });

  it("constrains oversized media to a cursor-safe side", () => {
    expect(
      calculatePlacement({ x: 5, y: 5 }, { width: 900, height: 700 }, { width: 800, height: 600 }),
    ).toMatchObject({ left: 23, top: 12, side: "right", maxWidth: 765, maxHeight: 576 });
  });

  it("uses vertical space instead of flipping a large preview at the viewport center", () => {
    const leftOfCenter = calculatePlacement(
      { x: 380, y: 450 },
      { width: 659, height: 470 },
      { width: 783, height: 1071 },
    );
    const rightOfCenter = calculatePlacement(
      { x: 405, y: 450 },
      { width: 659, height: 470 },
      { width: 783, height: 1071 },
      18,
      12,
      leftOfCenter.side,
    );

    expect(leftOfCenter.side).toBe("below");
    expect(rightOfCenter.side).toBe("below");
    expect(leftOfCenter.top).toBe(rightOfCenter.top);
  });

  it("retains a viable preferred side across small pointer changes", () => {
    const initial = calculatePlacement(
      { x: 490, y: 300 },
      { width: 200, height: 100 },
      { width: 1000, height: 700 },
    );
    const retained = calculatePlacement(
      { x: 510, y: 300 },
      { width: 200, height: 100 },
      { width: 1000, height: 700 },
      18,
      12,
      initial.side,
    );

    expect(initial.side).toBe("right");
    expect(retained.side).toBe("right");
  });
});
