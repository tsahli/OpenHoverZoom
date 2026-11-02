import { FetchDocumentError, fetchDocument } from "./fetch-document";
import { createDownloadFilename } from "./download-filename";
import { isPrivateHost, isPrivatePageUrl, validateFetchUrl } from "./validate-url";
import {
  isBackgroundRequest,
  type DownloadMediaResponse,
  type FetchDocumentFailure,
  type FetchDocumentResponse,
} from "../shared/messages";

const activeFetches = new Map<string, AbortController>();
// Long enough for an image or a short clip. The worker is stopped about half a minute
// after its last event, so it cannot wait on a large video for long.
const DOWNLOAD_WAIT_MILLISECONDS = 10_000;

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isBackgroundRequest(message)) return false;

  if (message.type === "download-media") {
    const url = validateFetchUrl(message.url);
    if (!url) {
      sendResponse({ result: "failed" } satisfies DownloadMediaResponse);
      return false;
    }
    void downloadMedia(url).then(sendResponse);
    return true;
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
  // Pages on a private address may look up private links; public pages may not.
  const allowPrivate = isPrivatePageUrl(sender.url ?? sender.tab?.url);
  if (!allowPrivate && isPrivateHost(url.hostname)) {
    sendResponse(failure(message.requestId, "invalid-url"));
    return false;
  }
  if (activeFetches.has(message.requestId)) {
    sendResponse(failure(message.requestId, "duplicate-request"));
    return false;
  }

  const controller = new AbortController();
  activeFetches.set(message.requestId, controller);
  void fetchDocument(url, controller.signal, allowPrivate)
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

/** Starts the download and reports how it went, waiting a little for it to finish. */
async function downloadMedia(url: URL): Promise<DownloadMediaResponse> {
  const filename = createDownloadFilename(url);
  try {
    // This settles when Chrome has begun the download, not when the file is saved.
    const id = await chrome.downloads.download({
      url: url.href,
      ...(filename ? { filename } : {}),
      conflictAction: "uniquify",
      saveAs: false,
    });
    return { result: await downloadResult(id) };
  } catch (error) {
    console.warn("[OpenHoverZoom] Media download failed", error);
    return { result: "failed" };
  }
}

function downloadResult(id: number): Promise<DownloadMediaResponse["result"]> {
  return new Promise((resolve) => {
    const finish = (result: DownloadMediaResponse["result"]): void => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(result);
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta): void => {
      if (delta.id !== id) return;
      if (delta.state?.current === "complete") finish("complete");
      if (delta.state?.current === "interrupted") finish("failed");
    };
    const timer = setTimeout(() => finish("started"), DOWNLOAD_WAIT_MILLISECONDS);
    chrome.downloads.onChanged.addListener(onChanged);
    // A small file may have finished before the listener existed.
    void chrome.downloads
      .search({ id })
      .then(([item]) => {
        if (item?.state === "complete") finish("complete");
        if (item?.state === "interrupted") finish("failed");
      })
      .catch(() => undefined);
  });
}
