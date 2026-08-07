import { describe, expect, it } from "vitest";
import { createDownloadFilename } from "../../src/background/download-filename";

describe("download filename", () => {
  it("uses a compact UTC timestamp and preserves the image extension", () => {
    expect(
      createDownloadFilename(
        new URL("https://cdn.example/original.AVIF?width=4000"),
        new Date("2026-08-05T14:23:09Z"),
      ),
    ).toBe(
      "ohz_260805_142309.avif",
    );
  });

  it("lets Chrome use response metadata when the URL has no reliable image extension", () => {
    expect(
      createDownloadFilename(
        new URL("https://cdn.example/media/12345?format=auto"),
        new Date("2026-08-05T14:23:09Z"),
      ),
    ).toBeUndefined();
  });

  it("uses an explicit CDN format instead of the pathname extension", () => {
    expect(
      createDownloadFilename(
        new URL("https://cdn.example/original.jpg?width=4000&format=webp"),
        new Date("2026-08-05T14:23:09Z"),
      ),
    ).toBe("ohz_260805_142309.webp");
  });
});
