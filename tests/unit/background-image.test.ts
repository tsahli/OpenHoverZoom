import { describe, expect, it } from "vitest";
import { extractBackgroundImageUrls } from "../../src/resolver/background-image";

describe("background image extraction", () => {
  it("extracts quoted and unquoted CSS URLs", () => {
    expect(
      extractBackgroundImageUrls(
        'linear-gradient(red, blue), url("/one.jpg"), url(https://cdn.example/two.webp)',
      ),
    ).toEqual(["/one.jpg", "https://cdn.example/two.webp"]);
  });
});
