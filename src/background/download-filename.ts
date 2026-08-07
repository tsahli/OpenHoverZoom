const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "jfif",
  "jpe",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);

export function createDownloadFilename(url: URL, date = new Date()): string | undefined {
  const extension = imageExtension(url);
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

function imageExtension(url: URL): string | undefined {
  for (const parameter of ["format", "fm", "extension", "ext"]) {
    const requested = url.searchParams.get(parameter)?.toLowerCase();
    if (!requested) continue;
    return IMAGE_EXTENSIONS.has(requested) ? requested : undefined;
  }
  const match = /\.([a-z0-9]+)$/iu.exec(url.pathname);
  const extension = match?.[1]?.toLowerCase();
  return extension && IMAGE_EXTENSIONS.has(extension) ? extension : undefined;
}
