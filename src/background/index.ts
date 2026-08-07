import { FetchDocumentError, fetchDocument } from "./fetch-document";
import { createDownloadFilename } from "./download-filename";
import { validateFetchUrl } from "./validate-url";
import {
  isBackgroundRequest,
  type FetchDocumentFailure,
  type FetchDocumentResponse,
} from "../shared/messages";

const activeFetches = new Map<string, AbortController>();

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isBackgroundRequest(message)) return false;

  if (message.type === "download-media") {
    const url = validateFetchUrl(message.url);
    if (!url) {
      sendResponse({ accepted: false });
      return false;
    }
    const filename = createDownloadFilename(url);
    void chrome.downloads.download({
      url: url.href,
      ...(filename ? { filename } : {}),
      conflictAction: "uniquify",
      saveAs: false,
    }).catch((error: unknown) => {
      console.warn("[OpenHoverZoom] Image download failed", error);
    });
    sendResponse({ accepted: true });
    return false;
  }

  if (message.type === "cancel-fetch") {
    activeFetches.get(message.requestId)?.abort();
    activeFetches.delete(message.requestId);
    return false;
  }

  const url = validateFetchUrl(message.url);
  if (!url) {
    sendResponse(failure(message.requestId, "invalid-url"));
    return false;
  }
  if (activeFetches.has(message.requestId)) {
    sendResponse(failure(message.requestId, "duplicate-request"));
    return false;
  }

  const controller = new AbortController();
  activeFetches.set(message.requestId, controller);
  void fetchDocument(url, controller.signal)
    .then((result) => {
      const response: FetchDocumentResponse = {
        success: true,
        requestId: message.requestId,
        ...result,
      };
      sendResponse(response);
    })
    .catch((error: unknown) => {
      const code = error instanceof FetchDocumentError ? error.code : "network-error";
      sendResponse(failure(message.requestId, code));
    })
    .finally(() => activeFetches.delete(message.requestId));
  return true;
});

function failure(
  requestId: string,
  error: FetchDocumentFailure["error"],
): FetchDocumentFailure {
  return { success: false, requestId, error };
}
