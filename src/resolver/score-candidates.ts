import {
  isDisplayedSource,
  type CandidateQuality,
  type MediaCandidate,
  type RenderedSize,
} from "./candidate";

export interface ScoreOptions {
  renderedSize?: RenderedSize;
  showSameSizeImages: boolean;
}

export function rankCandidates(
  candidates: readonly MediaCandidate[],
  options: ScoreOptions,
): MediaCandidate[] {
  const deduplicated = new Map<string, MediaCandidate>();

  for (const candidate of candidates) {
    if (!isUseful(candidate, options)) continue;
    const existing = deduplicated.get(candidate.url);
    if (!existing || compareCandidates(candidate, existing) < 0) {
      deduplicated.set(candidate.url, candidate);
    }
  }

  return [...deduplicated.values()].sort(compareCandidates);
}

function compareCandidates(left: MediaCandidate, right: MediaCandidate): number {
  const qualityDifference = qualityRank(right) - qualityRank(left);
  if (qualityDifference !== 0) return qualityDifference;

  const tierDifference = confidenceTier(right.confidence) - confidenceTier(left.confidence);
  if (tierDifference !== 0) return tierDifference;

  const leftWidth = dimensionWidth(left);
  const rightWidth = dimensionWidth(right);
  if (leftWidth !== rightWidth) {
    return rightWidth - leftWidth;
  }

  const leftArea = pixelArea(left);
  const rightArea = pixelArea(right);
  if (leftArea !== rightArea) {
    return rightArea - leftArea;
  }

  return right.confidence - left.confidence;
}

function confidenceTier(confidence: number): number {
  if (confidence >= 90) return 3;
  if (confidence >= 80) return 2;
  if (confidence >= 70) return 1;
  return 0;
}

function qualityRank(candidate: MediaCandidate): number {
  const quality = candidate.quality ?? defaultQuality(candidate);
  return QUALITY_RANKS[quality];
}

const QUALITY_RANKS: Record<CandidateQuality, number> = {
  thumbnail: 0,
  display: 1,
  responsive: 2,
  original: 3,
};

function defaultQuality(candidate: MediaCandidate): CandidateQuality {
  if (
    candidate.source === "srcset" ||
    candidate.source === "picture" ||
    candidate.source === "document-metadata"
  ) {
    return "responsive";
  }
  if (candidate.source === "document-original-link") {
    return "original";
  }
  return "display";
}

function dimensionWidth(candidate: MediaCandidate): number {
  return candidate.width && candidate.width > 0 ? candidate.width : 0;
}

function pixelArea(candidate: MediaCandidate): number {
  return candidate.width && candidate.height && candidate.width > 0 && candidate.height > 0
    ? candidate.width * candidate.height
    : 0;
}

function isUseful(candidate: MediaCandidate, options: ScoreOptions): boolean {
  if (
    candidate.kind !== "image" ||
    options.showSameSizeImages ||
    !isDisplayedSource(candidate)
  ) {
    return true;
  }

  const rendered = options.renderedSize;
  if (!rendered || !candidate.width || !candidate.height) return false;
  return isLargerThanRendered({ width: candidate.width, height: candidate.height }, rendered);
}

export function isLargerThanRendered(actual: RenderedSize, rendered: RenderedSize): boolean {
  return actual.width > rendered.width * 1.1 || actual.height > rendered.height * 1.1;
}
