import type { MediaCandidate, RenderedSize } from "./candidate";

export interface ScoreOptions {
  renderedSize?: RenderedSize;
  showSameSizeImages: boolean;
}

const CURRENT_IMAGE_SOURCES = new Set(["current-src", "image-src"]);

export function rankCandidates(
  candidates: readonly MediaCandidate[],
  options: ScoreOptions,
): MediaCandidate[] {
  const deduplicated = new Map<string, MediaCandidate>();

  for (const candidate of candidates) {
    if (!isUseful(candidate, options)) continue;
    const existing = deduplicated.get(candidate.url);
    if (!existing || score(candidate) > score(existing)) {
      deduplicated.set(candidate.url, candidate);
    }
  }

  return [...deduplicated.values()].sort((left, right) => score(right) - score(left));
}

export function score(candidate: MediaCandidate): number {
  const area = (candidate.width ?? 0) * (candidate.height ?? 0);
  const resolutionBonus = area > 0 ? Math.min(8, Math.log2(area) / 3) : 0;
  return candidate.confidence + resolutionBonus;
}

function isUseful(candidate: MediaCandidate, options: ScoreOptions): boolean {
  if (
    candidate.kind !== "image" ||
    options.showSameSizeImages ||
    !CURRENT_IMAGE_SOURCES.has(candidate.source)
  ) {
    return true;
  }

  const rendered = options.renderedSize;
  if (!rendered || !candidate.width || !candidate.height) return false;
  return candidate.width > rendered.width * 1.1 || candidate.height > rendered.height * 1.1;
}
