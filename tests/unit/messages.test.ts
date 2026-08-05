import { describe, expect, it } from "vitest";
import { isBackgroundRequest, isFetchDocumentResponse } from "../../src/shared/messages";

describe("runtime message validation", () => {
  it("accepts a well-formed fetch request", () => {
    expect(
      isBackgroundRequest({
        type: "fetch-document",
        requestId: "request_123",
        url: "https://example.com/article",
      }),
    ).toBe(true);
  });

  it("rejects malformed request IDs and payloads", () => {
    expect(isBackgroundRequest({ type: "fetch-document", requestId: "x", url: "https://x" })).toBe(
      false,
    );
    expect(
      isBackgroundRequest({ type: "fetch-document", requestId: "request_123", url: 42 }),
    ).toBe(false);
  });

  it("validates success and failure responses", () => {
    expect(
      isFetchDocumentResponse({
        success: true,
        requestId: "request_123",
        finalUrl: "https://example.com/article",
        contentType: "text/html",
        status: 200,
        body: "<html></html>",
      }),
    ).toBe(true);
    expect(
      isFetchDocumentResponse({
        success: false,
        requestId: "request_123",
        error: "made-up-error",
      }),
    ).toBe(false);
  });
});
