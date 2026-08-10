import { loadSettings, saveSettings, type Settings } from "../shared/settings";
import {
  DEFAULT_DOWNLOAD_SHORTCUT,
  DEFAULT_PREVIEW_DISABLE_SHORTCUT,
  downloadShortcutConflictsWithPreviewDisable,
  previewDisableShortcutFromKeyboardEvent,
  sanitizeDownloadShortcut,
  sanitizePreviewDisableShortcut,
  shortcutFromKeyboardEvent,
} from "../shared/keyboard-shortcut";

const form = requiredElement<HTMLFormElement>("settings-form");
const hoverDelay = requiredElement<HTMLInputElement>("hover-delay");
const previewSize = requiredElement<HTMLInputElement>("preview-size");
const sameSize = requiredElement<HTMLInputElement>("same-size");
const downloadShortcut = requiredElement<HTMLInputElement>("download-shortcut");
const resetDownloadShortcut = requiredElement<HTMLButtonElement>("reset-download-shortcut");
const previewDisableShortcut = requiredElement<HTMLInputElement>("preview-disable-shortcut");
const resetPreviewDisableShortcut = requiredElement<HTMLButtonElement>(
  "reset-preview-disable-shortcut",
);
const sitesList = requiredElement<HTMLUListElement>("disabled-sites");
const emptySites = requiredElement<HTMLElement>("empty-sites");
const status = requiredElement<HTMLElement>("status");
let settings: Settings;
let pendingPreviewDisableShortcut: string | null = null;

void initialize();

async function initialize(): Promise<void> {
  settings = await loadSettings();
  render();
  downloadShortcut.addEventListener("keydown", (event) => {
    const shortcut = shortcutFromKeyboardEvent(event);
    if (!shortcut) return;
    event.preventDefault();
    event.stopPropagation();
    downloadShortcut.value = shortcut;
    status.textContent = `Download shortcut set to ${shortcut}. Save to apply.`;
    downloadShortcut.blur();
  });
  previewDisableShortcut.addEventListener("keydown", (event) => {
    const shortcut = previewDisableShortcutFromKeyboardEvent(event);
    if (!shortcut) return;
    event.preventDefault();
    event.stopPropagation();
    previewDisableShortcut.value = shortcut;
    if (shortcutFromKeyboardEvent(event) === null) {
      pendingPreviewDisableShortcut = shortcut;
      status.textContent = `Release to use ${shortcut}, or press another key for a combination.`;
      return;
    }
    commitPreviewDisableShortcut(shortcut);
  });
  previewDisableShortcut.addEventListener("keyup", (event) => {
    if (!pendingPreviewDisableShortcut) return;
    event.preventDefault();
    event.stopPropagation();
    commitPreviewDisableShortcut(pendingPreviewDisableShortcut);
  });
  resetDownloadShortcut.addEventListener("click", () => {
    downloadShortcut.value = DEFAULT_DOWNLOAD_SHORTCUT;
    status.textContent = "Download shortcut reset to Enter. Save to apply.";
  });
  resetPreviewDisableShortcut.addEventListener("click", () => {
    previewDisableShortcut.value = DEFAULT_PREVIEW_DISABLE_SHORTCUT;
    status.textContent = "Preview disable shortcut reset to Ctrl. Save to apply.";
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      const nextDownloadShortcut = sanitizeDownloadShortcut(downloadShortcut.value);
      const nextPreviewDisableShortcut = sanitizePreviewDisableShortcut(
        previewDisableShortcut.value,
      );
      if (
        downloadShortcutConflictsWithPreviewDisable(
          nextDownloadShortcut,
          nextPreviewDisableShortcut,
        )
      ) {
        status.textContent =
          "Choose different download and preview disable shortcuts so both remain usable.";
        return;
      }
      settings = {
        ...settings,
        hoverDelayMs: hoverDelay.valueAsNumber,
        maxPreviewPercent: previewSize.valueAsNumber,
        showSameSizeImages: sameSize.checked,
        downloadShortcut: nextDownloadShortcut,
        previewDisableShortcut: nextPreviewDisableShortcut,
      };
      await saveSettings(settings);
      settings = await loadSettings();
      render();
      status.textContent = "Options saved.";
    })();
  });
}

function render(): void {
  hoverDelay.value = String(settings.hoverDelayMs);
  previewSize.value = String(settings.maxPreviewPercent);
  sameSize.checked = settings.showSameSizeImages;
  downloadShortcut.value = settings.downloadShortcut;
  previewDisableShortcut.value = settings.previewDisableShortcut;
  sitesList.replaceChildren();
  emptySites.hidden = settings.disabledSites.length > 0;
  for (const site of settings.disabledSites) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = site;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      void (async () => {
        settings = {
          ...settings,
          disabledSites: settings.disabledSites.filter((entry) => entry !== site),
        };
        await saveSettings(settings);
        render();
      })();
    });
    item.append(label, remove);
    sitesList.append(item);
  }
}

function commitPreviewDisableShortcut(shortcut: string): void {
  pendingPreviewDisableShortcut = null;
  previewDisableShortcut.value = shortcut;
  status.textContent = `Preview disable shortcut set to ${shortcut}. Save to apply.`;
  previewDisableShortcut.blur();
}

function requiredElement<ElementType extends HTMLElement>(id: string): ElementType {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as ElementType;
}
