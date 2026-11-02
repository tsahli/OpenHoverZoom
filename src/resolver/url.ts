export interface NormalizeUrlOptions {
  allowPageLocal?: boolean;
}

const MAX_LOCAL_URL_LENGTH = 2_000_000;

export function normalizeUrl(
  value: string,
  baseUrl: string,
  options: NormalizeUrlOptions = {},
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed, baseUrl);
  } catch {
    return null;
  }

  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    if (parsed.username !== "" || parsed.password !== "") return null;
    return parsed.href;
  }

  if (!options.allowPageLocal || trimmed.length > MAX_LOCAL_URL_LENGTH) {
    return null;
  }

  if (parsed.protocol === "blob:") return parsed.href;
  if (
    parsed.protocol === "data:" &&
    /^(?:data:)(?:image|video|audio)\/[a-z0-9.+-]+[;,]/iu.test(trimmed)
  ) {
    return parsed.href;
  }

  return null;
}

export function isRemoteUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
