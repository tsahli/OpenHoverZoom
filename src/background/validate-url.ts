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

const PRIVATE_NAME_SUFFIXES = [".localhost", ".local", ".internal"];

/**
 * Names and IP literals that point at the local machine or a private network.
 * The check is lexical only: a public name that resolves to a private address is
 * not detected because the worker does no DNS lookups.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  if (host.includes(":")) return isPrivateIpv6(host);
  const octets = parseIpv4(host);
  if (octets) return isPrivateIpv4(octets);
  return (
    // A single label such as "router" only resolves through a local search domain.
    !host.includes(".") ||
    host === "localhost" ||
    PRIVATE_NAME_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

/** Pages with a missing or non-HTTP URL are not treated as private. */
export function isPrivatePageUrl(pageUrl: string | undefined): boolean {
  if (!pageUrl) return false;
  try {
    const url = new URL(pageUrl);
    return (url.protocol === "http:" || url.protocol === "https:") && isPrivateHost(url.hostname);
  } catch {
    return false;
  }
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/u.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function isPrivateIpv4([first = 0, second = 0]: number[]): boolean {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6(host: string): boolean {
  const groups = parseIpv6(host);
  // The URL parser canonicalizes literals, so a failure means something unexpected.
  if (!groups) return true;
  const [first = 0, second = 0] = groups;
  const embeddedHigh = groups[6] ?? 0;
  const embeddedIpv4 = [embeddedHigh >> 8, embeddedHigh & 0xff];
  const leadingZeros = groups.slice(0, 5).every((group) => group === 0);
  return (
    // ::, ::1 and other IPv4-compatible addresses, then IPv4-mapped and NAT64 forms.
    (leadingZeros && (groups[5] === 0 || groups[5] === 0xffff) && isPrivateIpv4(embeddedIpv4)) ||
    (first === 0x64 && second === 0xff9b && groups.slice(2, 6).every((group) => group === 0) &&
      isPrivateIpv4(embeddedIpv4)) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0
  );
}

function parseIpv6(host: string): number[] | null {
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/u.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}
