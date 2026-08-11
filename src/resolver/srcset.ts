export interface SrcsetCandidate {
  url: string;
  width?: number;
  density?: number;
}

const ASCII_SPACE = /[\t\n\f\r ]/u;

export function parseSrcset(value: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  let position = 0;

  while (position < value.length) {
    while (
      position < value.length &&
      (ASCII_SPACE.test(value[position] ?? "") || value[position] === ",")
    ) {
      position += 1;
    }
    if (position >= value.length) break;

    const urlStart = position;
    while (position < value.length && !ASCII_SPACE.test(value[position] ?? "")) {
      position += 1;
    }
    let url = value.slice(urlStart, position);

    if (url.endsWith(",")) {
      url = url.replace(/,+$/u, "");
      if (url !== "") candidates.push({ url });
      continue;
    }

    while (position < value.length && ASCII_SPACE.test(value[position] ?? "")) {
      position += 1;
    }

    const descriptorStart = position;
    let parenthesisDepth = 0;
    while (position < value.length) {
      const character = value[position];
      if (character === "(") parenthesisDepth += 1;
      else if (character === ")" && parenthesisDepth > 0) parenthesisDepth -= 1;
      else if (character === "," && parenthesisDepth === 0) break;
      position += 1;
    }
    const descriptors = value
      .slice(descriptorStart, position)
      .trim()
      .split(/\s+/u)
      .filter(Boolean);
    if (value[position] === ",") position += 1;

    const candidate = parseCandidate(url, descriptors);
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

function parseCandidate(
  url: string,
  descriptors: readonly string[],
): SrcsetCandidate | null {
  if (url === "" || descriptors.length > 1) return null;
  const descriptor = descriptors[0];
  if (descriptor === undefined) return { url };

  if (/^[1-9]\d*w$/u.test(descriptor)) {
    return { url, width: Number.parseInt(descriptor, 10) };
  }
  if (/^(?:\d+|\d*\.\d+)x$/u.test(descriptor)) {
    const density = Number.parseFloat(descriptor);
    if (density > 0) return { url, density };
  }
  return null;
}

export function selectLargestSrcset(value: string): SrcsetCandidate | null {
  const candidates = parseSrcset(value);
  if (candidates.length === 0) return null;

  let largest = candidates[0] ?? null;
  let largestScore = largest ? srcsetScore(largest) : 0;
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate) continue;
    const score = srcsetScore(candidate);
    if (score > largestScore) {
      largest = candidate;
      largestScore = score;
    }
  }
  return largest;
}

function srcsetScore(candidate: SrcsetCandidate): number {
  return candidate.width ?? (candidate.density ?? 1) * 10_000;
}
