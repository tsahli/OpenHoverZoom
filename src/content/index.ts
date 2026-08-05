import { HoverController } from "./hover-controller";
import { PreviewOverlay } from "./preview-overlay";
import { loadSettings } from "../shared/settings";

void initialize();

async function initialize(): Promise<void> {
  let settings = await loadSettings();
  const overlay = new PreviewOverlay(
    settings.maxPreviewPercent,
    settings.downloadShortcut,
  );
  const controller = new HoverController(overlay, settings);

  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName !== "local") return;
    void (async () => {
      settings = await loadSettings();
      controller.updateSettings(settings);
    })();
  });
}
