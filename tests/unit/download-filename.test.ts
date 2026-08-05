import { describe, expect, it } from "vitest";
import { createDownloadFilename } from "../../src/background/download-filename";

describe("download filename", () => {
  it("uses a compact fixed-format UTC timestamp", () => {
    expect(createDownloadFilename(new Date("2026-08-05T14:23:09Z"))).toBe(
      "ohz_260805_142309.jpg",
    );
  });
});
