import type { MediaCandidate } from "./candidate";
import { resolveDomTarget, type DomResolution } from "./dom-resolver";
import { resolveLinkedDocument } from "./linked-document-resolver";
import { rankCandidates } from "./score-candidates";

export interface ResolverOptions {
  showSameSizeImages: boolean;
}

export interface ResolverHooks {
  onFallbackCandidate?: (candidate: MediaCandidate) => void;
}

export interface ResolvedTarget {
  candidate: MediaCandidate | null;
  fallback: MediaCandidate | null;
}

export async function resolveTarget(
  target: Element,
  options: ResolverOptions,
  signal: AbortSignal,
  hooks: ResolverHooks = {},
): Promise<ResolvedTarget> {
  signal.throwIfAborted();
  const resolution = resolveDomTarget(target, options);
  const direct = resolution.candidates[0];
  const localCandidates = resolution.fallbackCandidates ?? resolution.candidates.filter(
    (candidate) => candidate.source !== "direct-link",
  );
  const local = localCandidates[0];
  if (direct && direct.confidence >= 90 && direct.source !== "direct-link") {
    const candidate = attachGallery(direct, resolution);
    const fallback = localCandidates.find((item) => item.url !== candidate.url);
    const fallbackCandidate = fallback ? attachGallery(fallback, resolution) : null;
    if (fallbackCandidate) hooks.onFallbackCandidate?.(fallbackCandidate);
    return { candidate, fallback: fallbackCandidate };
  }

  const localCandidate = local ? attachGallery(local, resolution) : null;
  if (localCandidate) hooks.onFallbackCandidate?.(localCandidate);
  const linked = resolution.anchorUrl
    ? await resolveLinkedDocument(resolution.anchorUrl, signal)
    : [];
  signal.throwIfAborted();
  const candidate = selectBestCandidate(linked, resolution, options);
  return {
    candidate,
    fallback:
      candidate && localCandidate && candidate.url !== localCandidate.url
        ? localCandidate
        : null,
  };
}

export async function resolveGalleryCandidate(
  candidate: MediaCandidate,
  signal: AbortSignal,
): Promise<MediaCandidate | null> {
  if (!candidate.linkedPageUrl) return null;
  signal.throwIfAborted();
  const linked = await resolveLinkedDocument(candidate.linkedPageUrl, signal);
  signal.throwIfAborted();
  const selected = rankCandidates([...linked, candidate], {
    showSameSizeImages: true,
  })[0];
  if (!selected || selected.url === candidate.url) return null;
  const {
    gallery: _gallery,
    galleryIndex: _galleryIndex,
    ...singleCandidate
  } = selected;
  return {
    ...singleCandidate,
    linkedPageUrl: candidate.linkedPageUrl,
    ...(singleCandidate.caption || !candidate.caption
      ? {}
      : { caption: candidate.caption }),
  };
}

function selectBestCandidate(
  linked: MediaCandidate[],
  resolution: DomResolution,
  options: ResolverOptions,
): MediaCandidate | null {
  const ranked = rankCandidates([...linked, ...resolution.candidates], {
    showSameSizeImages: options.showSameSizeImages,
    ...(resolution.renderedSize ? { renderedSize: resolution.renderedSize } : {}),
  });
  const selected = ranked[0];
  return selected ? attachGallery(selected, resolution) : null;
}

function attachGallery(candidate: MediaCandidate, resolution: DomResolution): MediaCandidate {
  const gallery = resolution.gallery;
  if (!gallery) return candidate;
  const items = [...gallery.items];
  items[gallery.index] = candidate;
  return {
    ...candidate,
    gallery: items,
    galleryIndex: gallery.index,
  };
}
