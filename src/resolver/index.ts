import type { MediaCandidate } from "./candidate";
import { resolveDomTarget, type DomResolution } from "./dom-resolver";
import { resolveLinkedDocument } from "./linked-document-resolver";
import { rankCandidates } from "./score-candidates";

export interface ResolverOptions {
  showSameSizeImages: boolean;
}

export interface ResolverHooks {
  onLocalCandidate?: (candidate: MediaCandidate) => void;
  metadataBudgetMs?: number;
}

export interface ResolvedTarget {
  candidate: MediaCandidate | null;
  upgrade: Promise<MediaCandidate | null> | null;
}

const DEFAULT_METADATA_BUDGET_MILLISECONDS = 180;
const METADATA_TIMEOUT = Symbol("metadata-timeout");

export async function resolveTarget(
  target: Element,
  options: ResolverOptions,
  signal: AbortSignal,
  hooks: ResolverHooks = {},
): Promise<ResolvedTarget> {
  signal.throwIfAborted();
  const resolution = resolveDomTarget(target, options);
  const direct = resolution.candidates[0];
  const local = resolution.candidates.find((candidate) => candidate.source !== "direct-link");
  if (local) hooks.onLocalCandidate?.(attachGallery(local, resolution));
  if (direct && direct.confidence >= 90 && direct.source !== "direct-link") {
    return { candidate: attachGallery(direct, resolution), upgrade: null };
  }

  const linkedPromise = resolution.anchorUrl
    ? resolveLinkedDocument(resolution.anchorUrl, signal)
    : Promise.resolve([]);
  const linked = local && resolution.anchorUrl
    ? await resolveWithinBudget(
        linkedPromise,
        hooks.metadataBudgetMs ?? DEFAULT_METADATA_BUDGET_MILLISECONDS,
        signal,
      )
    : await linkedPromise;
  signal.throwIfAborted();
  if (linked === METADATA_TIMEOUT) {
    const initial = attachGallery(local!, resolution);
    const upgrade = linkedPromise.then((lateLinked) => {
      signal.throwIfAborted();
      const upgraded = selectBestCandidate(lateLinked, resolution, options);
      return upgraded && upgraded.url !== initial.url ? upgraded : null;
    });
    return { candidate: initial, upgrade };
  }
  return {
    candidate: selectBestCandidate(linked, resolution, options),
    upgrade: null,
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

async function resolveWithinBudget(
  linked: Promise<MediaCandidate[]>,
  budgetMilliseconds: number,
  signal: AbortSignal,
): Promise<MediaCandidate[] | typeof METADATA_TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<typeof METADATA_TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(METADATA_TIMEOUT), Math.max(0, budgetMilliseconds));
  });
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    const result = await Promise.race([linked, timeout, aborted]);
    signal.throwIfAborted();
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
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
