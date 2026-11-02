import type { MediaKind } from "./candidate";

const EXTENSION_KIND = new Map<string, MediaKind>([
  ["avif", "image"],
  ["bmp", "image"],
  ["gif", "image"],
  ["ico", "image"],
  ["jpeg", "image"],
  ["jpg", "image"],
  ["png", "image"],
  ["svg", "image"],
  ["webp", "image"],
  ["m4v", "video"],
  ["mkv", "video"],
  ["mov", "video"],
  ["mp4", "video"],
  ["mpeg", "video"],
  ["mpg", "video"],
  ["ogv", "video"],
  ["webm", "video"],
  ["aac", "audio"],
  ["flac", "audio"],
  ["m4a", "audio"],
  ["mp3", "audio"],
  ["oga", "audio"],
  ["ogg", "audio"],
  ["opus", "audio"],
  ["wav", "audio"],
]);

export function mediaKindFromUrl(value: string): MediaKind | null {
  try {
    const pathname = new URL(value).pathname;
    const extension = pathname.split(".").pop()?.toLowerCase();
    return extension ? (EXTENSION_KIND.get(extension) ?? null) : null;
  } catch {
    return null;
  }
}

/** The type itself, without parameters such as a charset. */
export function contentTypeEssence(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function mediaKindFromContentType(value: string): MediaKind | null {
  const essence = contentTypeEssence(value);
  if (essence.startsWith("image/")) return "image";
  if (essence.startsWith("video/")) return "video";
  if (essence.startsWith("audio/")) return "audio";
  return null;
}

export function isHtmlContentType(value: string): boolean {
  const essence = contentTypeEssence(value);
  return essence === "text/html" || essence === "application/xhtml+xml";
}
