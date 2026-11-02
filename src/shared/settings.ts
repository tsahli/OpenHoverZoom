import {
  DEFAULT_DOWNLOAD_SHORTCUT,
  DEFAULT_PREVIEW_DISABLE_SHORTCUT,
  downloadShortcutConflictsWithPreviewDisable,
  sanitizeDownloadShortcut,
  sanitizePreviewDisableShortcut,
} from "./keyboard-shortcut";

export interface Settings {
  enabled: boolean;
  hoverDelayMs: number;
  maxPreviewPercent: number;
  mediaVolumePercent: number;
  showSameSizeImages: boolean;
  /** Looks up the page behind a plain link for a picture. Off because it fetches linked sites. */
  previewTextLinks: boolean;
  downloadShortcut: string;
  previewDisableShortcut: string;
  disabledSites: string[];
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  enabled: true,
  hoverDelayMs: 250,
  maxPreviewPercent: 85,
  mediaVolumePercent: 75,
  showSameSizeImages: false,
  previewTextLinks: false,
  downloadShortcut: DEFAULT_DOWNLOAD_SHORTCUT,
  previewDisableShortcut: DEFAULT_PREVIEW_DISABLE_SHORTCUT,
  disabledSites: [],
};

export function sanitizeSettings(value: unknown): Settings {
  const record = isRecord(value) ? value : {};
  let downloadShortcut = sanitizeDownloadShortcut(record.downloadShortcut);
  let previewDisableShortcut = sanitizePreviewDisableShortcut(
    record.previewDisableShortcut,
  );
  if (downloadShortcutConflictsWithPreviewDisable(downloadShortcut, previewDisableShortcut)) {
    downloadShortcut = DEFAULT_DOWNLOAD_SHORTCUT;
    if (downloadShortcutConflictsWithPreviewDisable(downloadShortcut, previewDisableShortcut)) {
      previewDisableShortcut = DEFAULT_PREVIEW_DISABLE_SHORTCUT;
    }
  }
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_SETTINGS.enabled,
    hoverDelayMs: boundedNumber(record.hoverDelayMs, 100, 1500, DEFAULT_SETTINGS.hoverDelayMs),
    maxPreviewPercent: boundedNumber(
      record.maxPreviewPercent,
      25,
      95,
      DEFAULT_SETTINGS.maxPreviewPercent,
    ),
    mediaVolumePercent: boundedNumber(
      record.mediaVolumePercent,
      0,
      100,
      DEFAULT_SETTINGS.mediaVolumePercent,
    ),
    showSameSizeImages:
      typeof record.showSameSizeImages === "boolean"
        ? record.showSameSizeImages
        : DEFAULT_SETTINGS.showSameSizeImages,
    previewTextLinks:
      typeof record.previewTextLinks === "boolean"
        ? record.previewTextLinks
        : DEFAULT_SETTINGS.previewTextLinks,
    downloadShortcut,
    previewDisableShortcut,
    disabledSites: sanitizeSites(record.disabledSites),
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return sanitizeSettings(stored);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set(sanitizeSettings(settings));
}

export function siteFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isSiteDisabled(settings: Settings, pageUrl: string): boolean {
  const site = siteFromUrl(pageUrl);
  return site ? settings.disabledSites.includes(site) : false;
}

function sanitizeSites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const sites = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(item));
  return [...new Set(sites)].sort();
}

function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
