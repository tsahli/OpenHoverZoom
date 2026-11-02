import { isHtmlContentType, mediaKindFromContentType } from "../resolver/media-type";
import type { FetchErrorCode } from "../shared/messages";
import { validateFetchUrl } from "./validate-url";

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
    if (!finalUrl) {
      await response.body?.cancel().catch(() => undefined);
      throw new FetchDocumentError("invalid-url");
    }

    const contentType = response.headers.get("content-type") ?? "";
    const result = {
      finalUrl: finalUrl.href,
      contentType,
      status: response.status,
    };
    if (mediaKindFromContentType(contentType)) return result;
    if (!isHtmlContentType(contentType)) {
      throw new FetchDocumentError("unsupported-content-type");
    }
    return { ...result, body: await readBoundedText(response, signal) };
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedText(response: Response, signal: AbortSignal): Promise<string> {
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new FetchDocumentError("response-too-large");
  }
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
      bytesRead += value.byteLength;
      if (bytesRead > MAX_RESPONSE_BYTES) {
        throw new FetchDocumentError("response-too-large");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
