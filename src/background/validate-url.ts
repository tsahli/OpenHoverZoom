const MAX_URL_LENGTH = 8192;

export function validateFetchUrl(value: string, baseUrl?: string): URL | null {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = baseUrl ? new URL(value, baseUrl) : new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url;
}
