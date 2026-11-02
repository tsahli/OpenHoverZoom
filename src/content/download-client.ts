import { createLocalDownloadFilename } from "../background/download-filename";
import {
  isDownloadMediaResponse,
  type DownloadMediaRequest,
  type DownloadResult,
} from "../shared/messages";

const MIME_LOOKUP_MILLISECONDS = 1_000;

/** Never rejects: a download that cannot be requested is a failed one. */
export async function requestMediaDownload(url: string): Promise<DownloadResult> {
  if (isPageLocalUrl(url)) return savePageLocalMedia(url);
  try {
    const message: DownloadMediaRequest = { type: "download-media", url };
    const response: unknown = await chrome.runtime.sendMessage(message);
    return isDownloadMediaResponse(response) ? response.result : "failed";
  } catch (error) {
    console.warn("[OpenHoverZoom] Media download request failed", error);
    return "failed";
  }
}

function isPageLocalUrl(url: string): boolean {
  return url.startsWith("blob:") || url.startsWith("data:");
}

/**
 * A blob URL belongs to the page that made it, so the worker cannot read it. The
 * content script runs as that page, so an anchor click saves it as the page would.
 * Chrome gives no report on a download started this way: at best it has started.
 */
async function savePageLocalMedia(url: string): Promise<DownloadResult> {
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = createLocalDownloadFilename(await mimeTypeOf(url));
    link.rel = "noopener";
    // Detached, so page click handlers never see it and cannot cancel it.
    link.click();
    return "started";
  } catch (error) {
    console.warn("[OpenHoverZoom] Saving page-local media failed", error);
    return "failed";
  }
}

async function mimeTypeOf(url: string): Promise<string | undefined> {
  if (url.startsWith("data:")) return /^data:([^;,]*)/iu.exec(url)?.[1];
  // A blob answers instantly, and its type is all that names the file. The page's
  // policy may still refuse this, in which case the file simply has no extension.
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(MIME_LOOKUP_MILLISECONDS) });
    void response.body?.cancel().catch(() => undefined);
    return response.headers.get("content-type") ?? undefined;
  } catch {
    return undefined;
  }
}
