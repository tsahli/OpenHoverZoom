export const DEFAULT_DOWNLOAD_SHORTCUT = "Enter";
export const DEFAULT_PREVIEW_DISABLE_SHORTCUT = "Ctrl";

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);
const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];
type ShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;
type ModifierState = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;

export function sanitizeDownloadShortcut(value: unknown): string {
  return normalizeShortcut(value, false) ?? DEFAULT_DOWNLOAD_SHORTCUT;
}

export function sanitizePreviewDisableShortcut(value: unknown): string {
  return normalizeShortcut(value, true) ?? DEFAULT_PREVIEW_DISABLE_SHORTCUT;
}

export function shortcutFromKeyboardEvent(
  event: ShortcutEvent,
): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const base = normalizeBaseKey(event.key);
  if (!base) return null;
  return [...activeModifiers(event), base].join("+");
}

export function previewDisableShortcutFromKeyboardEvent(event: ShortcutEvent): string | null {
  const modifier = normalizeModifier(event.key);
  if (!modifier) return shortcutFromKeyboardEvent(event);
  const modifiers = new Set(activeModifiers(event));
  modifiers.add(modifier);
  return MODIFIER_ORDER.filter((candidate) => modifiers.has(candidate)).join("+");
}

export function matchesDownloadShortcut(
  event: ShortcutEvent,
  shortcut: string,
): boolean {
  return shortcutFromKeyboardEvent(event) === sanitizeDownloadShortcut(shortcut);
}

export function matchesPreviewDisableShortcut(
  event: ShortcutEvent,
  shortcut: string,
): boolean {
  const normalized = sanitizePreviewDisableShortcut(shortcut);
  const parts = normalized.split("+");
  if (!parts.every((part) => normalizeModifier(part))) {
    return shortcutFromKeyboardEvent(event) === normalized;
  }
  return normalizeModifier(event.key) !== null && parts.every((part) => {
    const modifier = normalizeModifier(part);
    return modifier ? modifierIsActive(event, modifier) : false;
  });
}

export function matchesPreviewDisableModifiers(
  event: ModifierState,
  shortcut: string,
): boolean {
  const parts = sanitizePreviewDisableShortcut(shortcut).split("+");
  return parts.every((part) => {
    const modifier = normalizeModifier(part);
    return modifier ? modifierIsActive(event, modifier) : false;
  });
}

export function releasesPreviewDisableShortcut(
  event: Pick<KeyboardEvent, "key">,
  shortcut: string,
): boolean {
  const releasedKey = normalizeModifier(event.key) ?? normalizeBaseKey(event.key);
  return releasedKey
    ? sanitizePreviewDisableShortcut(shortcut).split("+").includes(releasedKey)
    : false;
}

export function downloadShortcutConflictsWithPreviewDisable(
  downloadShortcut: string,
  previewDisableShortcut: string,
): boolean {
  const download = sanitizeDownloadShortcut(downloadShortcut).split("+");
  const disable = sanitizePreviewDisableShortcut(previewDisableShortcut).split("+");
  const modifierOnly = disable.every((part) => normalizeModifier(part));
  return modifierOnly
    ? disable.every((part) => download.includes(part))
    : download.join("+") === disable.join("+");
}

function normalizeShortcut(value: unknown, allowModifierOnly: boolean): string | null {
  if (typeof value !== "string") return null;
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const modifiers = new Set(parts.map(normalizeModifier));
  if (allowModifierOnly && !modifiers.has(null)) {
    return MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)).join("+");
  }

  const base = normalizeBaseKey(parts.at(-1) ?? "");
  if (!base) return null;
  const leadingModifiers = new Set(parts.slice(0, -1).map(normalizeModifier));
  if (leadingModifiers.has(null)) return null;
  return [
    ...MODIFIER_ORDER.filter((modifier) => leadingModifiers.has(modifier)),
    base,
  ].join("+");
}

function activeModifiers(event: ModifierState): Modifier[] {
  return [
    ...(event.ctrlKey ? ["Ctrl" as const] : []),
    ...(event.altKey ? ["Alt" as const] : []),
    ...(event.shiftKey ? ["Shift" as const] : []),
    ...(event.metaKey ? ["Meta" as const] : []),
  ];
}

function modifierIsActive(event: ModifierState, modifier: Modifier): boolean {
  if (modifier === "Ctrl") return event.ctrlKey;
  if (modifier === "Alt") return event.altKey;
  if (modifier === "Shift") return event.shiftKey;
  return event.metaKey;
}

function normalizeBaseKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (/^[a-z0-9]$/iu.test(normalized)) return normalized.toUpperCase();
  if (normalized.toLowerCase() === "enter" || normalized.toLowerCase() === "return") {
    return "Enter";
  }
  if (value === " " || normalized.toLowerCase() === "space") return "Space";
  return null;
}

function normalizeModifier(value: unknown): Modifier | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (normalized === "ctrl" || normalized === "control") return "Ctrl";
  if (normalized === "alt" || normalized === "option") return "Alt";
  if (normalized === "shift") return "Shift";
  if (normalized === "meta" || normalized === "command" || normalized === "cmd") {
    return "Meta";
  }
  return null;
}
