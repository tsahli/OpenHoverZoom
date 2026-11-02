import {
  isDisplayedSource,
  stripGallery,
  type DeferredAttempts,
  type MediaCandidate,
  type PreviewAttempt,
  type RenderedSize,
  type ThumbnailReference,
} from "./candidate";
import { resolveDomTarget, type DomResolution } from "./dom-resolver";
import type { DiscoveredGallery } from "./dom-gallery";
import { matchLinkedCandidates, selectOriginalLink, type HoveredItem } from "./linked-match";
import { resolveLinkedDocument } from "./linked-document-resolver";
import { rankCandidates } from "./score-candidates";
import { isEligibleTextLink } from "./text-link";
import { normalizeUrl } from "./url";
import {
  generateSizeVariants,
  isSameFile,
  isUnscalableImage,
  MAX_SIZE_VARIANTS,
  PAGE_IMAGE_SHAPE_TOLERANCE,
  RENDITION_SHAPE_TOLERANCE,
} from "./size-variants";

/** Page evidence at least this much wider than what is displayed needs no second opinion. */
const CLEARLY_LARGER_WIDTH_RATIO = 1.5;
const EXPLICIT_EVIDENCE_CONFIDENCE = 90;
const GUESS_CONFIDENCE = 70;
/** Nothing on the page says what a text link's picture should look like, so only size can rule out icons. */
const TEXT_LINK_MIN_EDGE = 200;
/** A page's image and its video; the next one down is rarely the page's main subject. */
const MAX_TEXT_LINK_ATTEMPTS = 2;
/** A preview of a small icon or avatar has to show more than the icon itself did. */
const SMALL_MEDIA_MIN_PREVIEW_EDGE = 96;
const SHARE_IMAGE_META =
  'meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"], meta[name="twitter:image"], meta[property="twitter:image"], meta[name="twitter:image:src"]';

export interface ResolverOptions {
  showSameSizeImages: boolean;
  /** The target is an anchor with no media that is only previewed for its linked page. */
  textLink?: boolean;
}

export interface PreviewPlan {
  /** Tried one at a time until one is accepted. See `resolveTarget` for the order. */
  attempts: PreviewAttempt[];
  gallery?: DiscoveredGallery;
  /** Icons, avatars, plain links and images already loaded never earn a spinner. */
  quiet: boolean;
}

/**
 * Plans a hover without doing any work, because the attempts run in the overlay and
 * stop at the first accepted one. The order keeps the common cases fast:
 *
 * 1. Clear page evidence: originals, video sources, and a `srcset` or `picture` whose
 *    declared width is clearly larger than what is displayed. Nothing else is asked
 *    for when one of these loads, so a page with a good `srcset` costs no extra request.
 * 2. A link straight to a media file, which is explicit and is checked by fetching it.
 * 3. URL guesses. An image without size hints has none, so this adds nothing for it.
 * 4. Remaining `srcset` or `picture` evidence, which may only be a retina thumbnail.
 *    Guesses go first because they can find a much larger image for free.
 * 5. The linked page, the only step that fetches a document, skipped for small media
 *    and declared tracking links.
 * 6. Whatever else the page offers, including the current source when it is useful.
 *
 * Nothing is displayed until accepted, so no step can flash a low-resolution image.
 */
export function resolveTarget(target: Element, options: ResolverOptions): PreviewPlan {
  if (options.textLink && target instanceof HTMLAnchorElement) return textLinkPlan(target);
  const resolution = resolveDomTarget(target, options);
  const rendered = options.showSameSizeImages ? undefined : resolution.renderedSize;
  // An SVG has no larger version to find, and on most pages it is a logo or an icon.
  const showsVector =
    !options.showSameSizeImages &&
    resolution.fallbackCandidates.some(
      (candidate) => isDisplayedSource(candidate) && isUnscalableImage(candidate.url),
    );
  const local = showsVector
    ? resolution.fallbackCandidates.filter((candidate) => !isUnscalableImage(candidate.url))
    : resolution.fallbackCandidates;
  const directLink = resolution.candidates.find((candidate) => candidate.source === "direct-link");
  const displayed = displayedWidth(resolution.thumbnail, resolution.renderedSize);
  const clear = local.filter((candidate) => isClearEvidence(candidate, displayed));
  const weaker = local.filter(
    (candidate) => !clear.includes(candidate) && isExplicitImage(candidate),
  );
  const lookup =
    resolution.anchorUrl && !resolution.smallMedia && !showsVector && resolution.lookupAllowed
      ? linkedPageLookup(resolution.anchorUrl, resolution, directLink, rendered)
      : null;
  const prepare = (candidate: MediaCandidate): MediaCandidate =>
    withRenderedCheck(attachLinkedPage(candidate, resolution), rendered);
  const guessSources = [
    ...local.filter(isDisplayedSource),
    ...local.filter((candidate) => !isDisplayedSource(candidate)),
  ].filter(isGuessableSource);
  const activeGalleryItem = resolution.gallery?.items[resolution.gallery.index];

  const attempts: PreviewAttempt[] = [
    ...clear.map(prepare),
    ...(directLink && lookup ? [lookup] : []),
    ...sizeGuesses(guessSources, resolution.thumbnail, rendered),
    ...weaker.map(prepare),
    ...(!directLink && lookup ? [lookup] : []),
    ...(directLink && !lookup ? [prepare(directLink)] : []),
    ...local.map(prepare),
    // A same-size item may still preview inside a gallery so arrow keys can browse it.
    ...(activeGalleryItem && !showsVector ? [activeGalleryItem] : []),
  ];
  return {
    attempts: resolution.smallMedia ? attempts.map(requireUsefulSize) : attempts,
    quiet:
      resolution.smallMedia ||
      attempts.every((attempt) => !("expand" in attempt) && isDisplayedSource(attempt)),
    ...(resolution.gallery ? { gallery: resolution.gallery } : {}),
  };
}

function requireUsefulSize(attempt: PreviewAttempt): PreviewAttempt {
  return "expand" in attempt
    ? attempt
    : { ...attempt, check: { ...attempt.check, minEdge: SMALL_MEDIA_MIN_PREVIEW_EDGE } };
}

/**
 * A plain link has no thumbnail to improve on, so its page is the only source and
 * the plan is silent: nothing shows unless a picture of real size loads.
 */
function textLinkPlan(anchor: HTMLAnchorElement): PreviewPlan {
  const url = isEligibleTextLink(anchor) ? normalizeUrl(anchor.href, anchor.baseURI) : null;
  return {
    attempts: url ? [textLinkLookup(url)] : [],
    quiet: true,
  };
}

function textLinkLookup(url: string): DeferredAttempts {
  return {
    expand: async (signal) => {
      const document = await resolveLinkedDocument(url, signal);
      signal.throwIfAborted();
      const linked = matchLinkedCandidates(document, {
        urls: [],
        minEdge: TEXT_LINK_MIN_EDGE,
        siteImages: ownShareImages(),
      }).filter((candidate) => candidate.kind !== "audio");
      return rankCandidates(linked, { showSameSizeImages: true }).slice(0, MAX_TEXT_LINK_ATTEMPTS);
    },
  };
}

/** The same order for a gallery item, which only has its own best candidate to offer. */
export function galleryItemAttempts(item: MediaCandidate): PreviewAttempt[] {
  if (item.kind !== "image") return [item];
  const sources = item.thumbnail ? [{ ...item, url: item.thumbnail.url }, item] : [];
  const guesses = sizeGuesses(sources, item.thumbnail, undefined);
  const lookup: DeferredAttempts[] = item.linkedPageUrl
    ? [
        {
          expand: async (signal) => {
            const upgraded = await resolveGalleryCandidate(item, signal);
            return upgraded ? [upgraded] : [];
          },
        },
      ]
    : [];
  if (isClearEvidence(item, displayedWidth(item.thumbnail))) {
    return [item, ...guesses, ...lookup];
  }
  return isExplicitImage(item)
    ? [...guesses, item, ...lookup]
    : [...guesses, ...lookup, item];
}

async function resolveGalleryCandidate(
  candidate: MediaCandidate,
  signal: AbortSignal,
): Promise<MediaCandidate | null> {
  if (!candidate.linkedPageUrl) return null;
  signal.throwIfAborted();
  const document = await resolveLinkedDocument(candidate.linkedPageUrl, signal);
  signal.throwIfAborted();
  const matching = matchLinkedCandidates(document, {
    urls: itemUrls(candidate),
    ...(candidate.thumbnail ? { thumbnail: candidate.thumbnail } : {}),
    siteImages: ownShareImages(),
  });
  const sameKind = matching.filter((item) => item.kind === candidate.kind);
  const selected = rankCandidates([...sameKind, candidate], {
    showSameSizeImages: true,
  })[0];
  if (!selected || selected.url === candidate.url) return null;
  const singleCandidate = stripGallery(selected);
  return {
    ...singleCandidate,
    linkedPageUrl: candidate.linkedPageUrl,
    ...(singleCandidate.caption || !candidate.caption
      ? {}
      : { caption: candidate.caption }),
  };
}

export async function resolveDownloadCandidate(
  candidate: MediaCandidate,
  signal: AbortSignal,
): Promise<MediaCandidate | null> {
  if (!candidate.linkedPageUrl) return null;
  signal.throwIfAborted();
  const document = await resolveLinkedDocument(candidate.linkedPageUrl, signal);
  signal.throwIfAborted();
  return selectOriginalLink(document, candidate.kind, itemUrls(candidate));
}

function itemUrls(candidate: MediaCandidate): string[] {
  return [candidate.url, ...(candidate.thumbnail ? [candidate.thumbnail.url] : [])];
}

function isClearEvidence(candidate: MediaCandidate, displayed: number | undefined): boolean {
  if (candidate.kind !== "image") return candidate.confidence >= EXPLICIT_EVIDENCE_CONFIDENCE;
  if (candidate.quality === "original") return true;
  if (candidate.confidence < EXPLICIT_EVIDENCE_CONFIDENCE || !candidate.width) return false;
  return !displayed || candidate.width >= displayed * CLEARLY_LARGER_WIDTH_RATIO;
}

function isExplicitImage(candidate: MediaCandidate): boolean {
  return candidate.kind === "image" && candidate.confidence >= EXPLICIT_EVIDENCE_CONFIDENCE;
}

function isGuessableSource(candidate: MediaCandidate): boolean {
  return candidate.kind === "image" && candidate.source !== "video-poster";
}

function displayedWidth(
  thumbnail: ThumbnailReference | undefined,
  renderedSize?: RenderedSize,
): number | undefined {
  const width = Math.max(thumbnail?.width ?? 0, renderedSize?.width ?? 0);
  return width > 0 ? width : undefined;
}

/**
 * Candidates for larger versions, each provable only by loading. They never carry a
 * linked page, so pressing the download key on an accepted guess saves that same image.
 */
function sizeGuesses(
  sources: readonly MediaCandidate[],
  thumbnail: ThumbnailReference | undefined,
  rendered: RenderedSize | undefined,
): MediaCandidate[] {
  const guesses = new Map<string, MediaCandidate>();
  for (const source of sources) {
    for (const url of generateSizeVariants(source.url)) {
      if (guesses.has(url) || guesses.size >= MAX_SIZE_VARIANTS) continue;
      if (sources.some((item) => item.url === url)) continue;
      guesses.set(url, {
        url,
        kind: "image",
        source: "url-guess",
        confidence: GUESS_CONFIDENCE,
        check: {
          thumbnail: thumbnail ?? { url: source.url },
          // Another rendering of one file can be a looser crop, but is never another picture.
          shapeTolerance: isSameFile(url, source.url)
            ? PAGE_IMAGE_SHAPE_TOLERANCE
            : RENDITION_SHAPE_TOLERANCE,
          ...(rendered ? { rendered } : {}),
        },
        ...(source.caption ? { caption: source.caption } : {}),
      });
    }
  }
  return [...guesses.values()];
}

function linkedPageLookup(
  anchorUrl: string,
  resolution: DomResolution,
  directLink: MediaCandidate | undefined,
  rendered: RenderedSize | undefined,
): DeferredAttempts {
  const localImage = resolution.fallbackCandidates.find(isGuessableSource);
  const thumbnail = resolution.thumbnail ?? (localImage ? { url: localImage.url } : undefined);
  const item: HoveredItem = {
    urls: [
      ...(thumbnail ? [thumbnail.url] : []),
      ...resolution.fallbackCandidates.map((candidate) => candidate.url),
    ],
    ...(thumbnail ? { thumbnail } : {}),
  };
  return {
    expand: async (signal) => {
      const document = await resolveLinkedDocument(anchorUrl, signal);
      signal.throwIfAborted();
      const selected = selectLinkedCandidate(
        matchLinkedCandidates(document, { ...item, siteImages: ownShareImages() }),
        resolution,
        directLink,
      );
      if (!selected) return [];
      const single = resolution.gallery ? stripGallery(selected) : selected;
      return [withRenderedCheck(attachLinkedPage(single, resolution), rendered)];
    },
  };
}

function ownShareImages(): Set<string> {
  const urls = Array.from(document.querySelectorAll(SHARE_IMAGE_META), (meta) =>
    normalizeUrl(meta.getAttribute("content") ?? "", document.baseURI),
  );
  return new Set(urls.filter((url) => url !== null));
}

function selectLinkedCandidate(
  linked: MediaCandidate[],
  resolution: DomResolution,
  directLink: MediaCandidate | undefined,
): MediaCandidate | null {
  const verifiedLinkedKind = directLink
    ? rankCandidates(linked, { showSameSizeImages: true })[0]?.kind
    : undefined;
  const expectedKind =
    resolution.candidates.find((candidate) => candidate.source === "video-source")?.kind ??
    verifiedLinkedKind ??
    directLink?.kind ??
    resolution.candidates[0]?.kind;
  const candidates = directLink ? [...linked, directLink] : linked;
  const sameKind = expectedKind
    ? candidates.filter((candidate) => candidate.kind === expectedKind)
    : candidates;
  return rankCandidates(sameKind, { showSameSizeImages: true })[0] ?? null;
}

function attachLinkedPage(
  candidate: MediaCandidate,
  resolution: DomResolution,
): MediaCandidate {
  const linkedPageUrl = resolution.anchorUrl;
  if (
    !linkedPageUrl ||
    !resolution.lookupAllowed ||
    linkedPageUrl === candidate.url ||
    candidate.linkedPageUrl ||
    candidate.source === "document-metadata" ||
    candidate.source === "document-original-link"
  ) {
    return candidate;
  }
  return { ...candidate, linkedPageUrl };
}

function withRenderedCheck(
  candidate: MediaCandidate,
  rendered: RenderedSize | undefined,
): MediaCandidate {
  if (!rendered || candidate.kind !== "image") return candidate;
  return { ...candidate, check: { ...candidate.check, rendered } };
}
