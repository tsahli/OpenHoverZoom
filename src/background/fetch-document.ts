import { isHtmlContentType, mediaKindFromContentType } from "../resolver/media-type";
import type { FetchErrorCode } from "../shared/messages";
import { isPrivateHost, validateFetchUrl } from "./validate-url";

const MAX_RESPONSE_BYTES = 1_500_000;
const TIMEOUT_MILLISECONDS = 7_000;

export interface FetchedDocument {
  finalUrl: string;
  contentType: string;
  status: number;
  body?: string;
}

export class FetchDocumentError extends Error {
  constructor(readonly code: FetchErrorCode) {
    super(code);
    this.name = "FetchDocumentError";
  }
}

export async function fetchDocument(
  initialUrl: URL,
  externalSignal: AbortSignal,
  allowPrivate = false,
): Promise<FetchedDocument> {
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new DOMException("Fetch timed out", "TimeoutError")),
    TIMEOUT_MILLISECONDS,
  );
  const signal = AbortSignal.any([externalSignal, timeout.signal]);

  try {
    // Browsers hide manual redirects behind an opaque response with no status or
    // location, so redirects can only be followed by fetch and checked afterwards.
    let response: Response;
    try {
      response = await fetch(initialUrl, {
        cache: "no-store",
        credentials: "omit",
        redirect: "follow",
        referrerPolicy: "no-referrer",
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        const code = timeout.signal.aborted ? "timeout" : "aborted";
        throw new FetchDocumentError(code);
      }
      throw new FetchDocumentError("network-error");
    }

    const finalUrl = validateFetchUrl(response.url || initialUrl.href);
    // Redirects are followed before they can be inspected, so a public page can
    // still bounce the request to a private address. Discard that response.
    if (!finalUrl || (!allowPrivate && isPrivateHost(finalUrl.hostname))) {
      await discardBody(response);
      throw new FetchDocumentError("invalid-url");
    }

    const contentType = response.headers.get("content-type") ?? "";
    const result = {
      finalUrl: finalUrl.href,
      contentType,
      status: response.status,
    };
    // Only the type matters here, and an unread body would hold its connection open.
    if (mediaKindFromContentType(contentType)) {
      await discardBody(response);
      return result;
    }
    if (!isHtmlContentType(contentType)) {
      await discardBody(response);
      throw new FetchDocumentError("unsupported-content-type");
    }
    return { ...result, body: await readBoundedText(response, signal) };
  } finally {
    clearTimeout(timer);
  }
}

// Metadata normally sits near the top of a page, so an oversized document is
// truncated at the limit instead of rejected.
async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function readBoundedText(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  const chunks: string[] = [];
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_RESPONSE_BYTES - bytesRead;
      if (value.byteLength >= remaining) {
        chunks.push(decoder.decode(value.subarray(0, remaining), { stream: true }));
        break;
      }
      bytesRead += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
