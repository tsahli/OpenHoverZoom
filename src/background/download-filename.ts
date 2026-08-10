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

export function createDownloadFilename(url: URL, date = new Date()): string | undefined {
  const extension = mediaExtension(url);
  if (!extension) return undefined;
  const year = String(date.getUTCFullYear()).slice(-2);
  const month = twoDigits(date.getUTCMonth() + 1);
  const day = twoDigits(date.getUTCDate());
  const hour = twoDigits(date.getUTCHours());
  const minute = twoDigits(date.getUTCMinutes());
  const second = twoDigits(date.getUTCSeconds());
  return `ohz_${year}${month}${day}_${hour}${minute}${second}.${extension}`;
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
