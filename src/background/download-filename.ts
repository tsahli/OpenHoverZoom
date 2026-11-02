import { contentTypeEssence } from "../resolver/media-type";

const MEDIA_EXTENSIONS = new Set([
  "aac",
  "avif",
  "bmp",
  "flac",
  "gif",
  "heic",
  "heif",
  "jfif",
  "jpe",
  "jpeg",
  "jpg",
  "m4a",
  "m4v",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "mpeg",
  "mpg",
  "oga",
  "ogg",
  "ogv",
  "opus",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
  "webm",
  "wav",
]);

// What a blob or data URL says about itself, in place of a file name in its URL.
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "video/mpeg": "mpeg",
  "video/x-m4v": "m4v",
  "video/x-matroska": "mkv",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
};

export function createDownloadFilename(url: URL, date = new Date()): string | undefined {
  const extension = mediaExtension(url);
  if (!extension) return undefined;
  return timestampedName(date, extension);
}

/** The same name for a `blob:` or `data:` URL, whose extension can only come from its MIME type. */
export function createLocalDownloadFilename(
  mimeType: string | undefined,
  date = new Date(),
): string {
  const essence = contentTypeEssence(mimeType ?? "");
  return timestampedName(
    date,
    Object.hasOwn(MIME_EXTENSIONS, essence) ? MIME_EXTENSIONS[essence] : undefined,
  );
}

function timestampedName(date: Date, extension: string | undefined): string {
  const year = String(date.getUTCFullYear()).slice(-2);
  const month = twoDigits(date.getUTCMonth() + 1);
  const day = twoDigits(date.getUTCDate());
  const hour = twoDigits(date.getUTCHours());
  const minute = twoDigits(date.getUTCMinutes());
  const second = twoDigits(date.getUTCSeconds());
  const name = `ohz_${year}${month}${day}_${hour}${minute}${second}`;
  return extension ? `${name}.${extension}` : name;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function mediaExtension(url: URL): string | undefined {
  for (const parameter of ["format", "fm", "extension", "ext"]) {
    const requested = url.searchParams.get(parameter)?.toLowerCase();
    if (!requested) continue;
    return MEDIA_EXTENSIONS.has(requested) ? requested : undefined;
  }
  const match = /\.([a-z0-9]+)$/iu.exec(url.pathname);
  const extension = match?.[1]?.toLowerCase();
  return extension && MEDIA_EXTENSIONS.has(extension) ? extension : undefined;
}
