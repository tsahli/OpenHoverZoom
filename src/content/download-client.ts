import type { DownloadMediaRequest } from "../shared/messages";

export async function requestMediaDownload(url: string): Promise<void> {
  const message: DownloadMediaRequest = { type: "download-media", url };
  await chrome.runtime.sendMessage(message);
}
