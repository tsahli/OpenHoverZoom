export const DEFAULT_DOWNLOAD_SHORTCUT = "Enter";

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);
const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;

export function sanitizeDownloadShortcut(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_DOWNLOAD_SHORTCUT;
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return DEFAULT_DOWNLOAD_SHORTCUT;

  const base = normalizeBaseKey(parts.at(-1) ?? "");
  if (!base) return DEFAULT_DOWNLOAD_SHORTCUT;
  const modifiers = new Set(parts.slice(0, -1).map(normalizeModifier));
  if (modifiers.has(null)) return DEFAULT_DOWNLOAD_SHORTCUT;
  return [
    ...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    base,
  ].join("+");
}

export function shortcutFromKeyboardEvent(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const base = normalizeBaseKey(event.key);
  if (!base) return null;
  return [
    ...(event.ctrlKey ? ["Ctrl"] : []),
    ...(event.altKey ? ["Alt"] : []),
    ...(event.shiftKey ? ["Shift"] : []),
    ...(event.metaKey ? ["Meta"] : []),
    base,
  ].join("+");
}

export function matchesDownloadShortcut(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
  shortcut: string,
): boolean {
  return shortcutFromKeyboardEvent(event) === sanitizeDownloadShortcut(shortcut);
}

function normalizeBaseKey(value: string): string | null {
  const normalized = value.trim();
  if (/^[a-z0-9]$/iu.test(normalized)) return normalized.toUpperCase();
  if (normalized.toLowerCase() === "enter" || normalized.toLowerCase() === "return") {
    return "Enter";
  }
  if (value === " " || normalized.toLowerCase() === "space") return "Space";
  return null;
}

function normalizeModifier(value: string): (typeof MODIFIER_ORDER)[number] | null {
  const normalized = value.toLowerCase();
  if (normalized === "ctrl" || normalized === "control") return "Ctrl";
  if (normalized === "alt" || normalized === "option") return "Alt";
  if (normalized === "shift") return "Shift";
  if (normalized === "meta" || normalized === "command" || normalized === "cmd") {
    return "Meta";
  }
  return null;
}
