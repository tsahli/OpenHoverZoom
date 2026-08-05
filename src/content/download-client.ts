import type { DownloadMediaRequest } from "../shared/messages";

export async function requestImageDownload(url: string): Promise<void> {
  const message: DownloadMediaRequest = { type: "download-media", url };
  await chrome.runtime.sendMessage(message);
}
