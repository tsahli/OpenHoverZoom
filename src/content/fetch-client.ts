import {
  isFetchDocumentResponse,
  type CancelFetchRequest,
  type FetchDocumentRequest,
  type FetchDocumentSuccess,
} from "../shared/messages";

export async function requestDocument(
  url: string,
  signal: AbortSignal,
): Promise<FetchDocumentSuccess | null> {
  signal.throwIfAborted();
  const requestId = `ohz_${crypto.randomUUID().replaceAll("-", "")}`;
  const request: FetchDocumentRequest = { type: "fetch-document", requestId, url };
  const cancel = (): void => {
    const message: CancelFetchRequest = { type: "cancel-fetch", requestId };
    void chrome.runtime.sendMessage(message).catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });

  try {
    const response: unknown = await chrome.runtime.sendMessage(request);
    signal.throwIfAborted();
    if (!isFetchDocumentResponse(response) || response.requestId !== requestId) return null;
    return response.success ? response : null;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
