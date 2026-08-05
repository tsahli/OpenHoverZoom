import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchDocumentError, fetchDocument } from "../../src/background/fetch-document";

afterEach(() => vi.unstubAllGlobals());

describe("bounded document fetch", () => {
  it("returns bounded HTML text with privacy-preserving fetch options", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html><title>Fixture</title></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchDocument(new URL("https://example.com/article"), new AbortController().signal);
    expect(result).toMatchObject({ status: 200, body: "<html><title>Fixture</title></html>" });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://example.com/article"),
      expect.objectContaining({ credentials: "omit", redirect: "manual", referrerPolicy: "no-referrer" }),
    );
  });

  it("returns media content types without reading a body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/jpeg" },
        }),
      ),
    );
    const result = await fetchDocument(
      new URL("https://example.com/image"),
      new AbortController().signal,
    );
    expect(result).toMatchObject({ contentType: "image/jpeg" });
    expect(result).not.toHaveProperty("body");
  });

  it("rejects a declared oversized response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("small", {
          headers: { "content-type": "text/html", "content-length": "1500001" },
        }),
      ),
    );
    await expect(
      fetchDocument(new URL("https://example.com/large"), new AbortController().signal),
    ).rejects.toEqual(expect.objectContaining<Partial<FetchDocumentError>>({ code: "response-too-large" }));
  });
});
