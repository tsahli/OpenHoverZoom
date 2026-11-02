import type { LoadCheck, MediaCandidate, MediaKind, ThumbnailReference } from "./candidate";
import type { LinkedDocument } from "./linked-document-resolver";
import { rankCandidates } from "./score-candidates";
import {
  imageIdentity,
  PAGE_IMAGE_SHAPE_TOLERANCE,
  passesLoadCheck,
} from "./size-variants";

const SIGN_IN_PATH = /(?:^|\/)(?:log-?in|sign-?in|sign-?up|auth|oauth|sso|consent)(?:\/|$)/iu;
// Sites fall back to these when a page has no picture of its own.
const GENERIC_PAGE_IMAGE = /(?:^|[-_.])(?:logo|placeholder|default|fallback|favicon|sprite|brand|share|sharing|social|opengraph)(?:[-_.]|$)/iu;

export interface HoveredItem {
  /** Every URL the page gives for the item, used to recognise it on the linked page. */
  urls: readonly string[];
  thumbnail?: ThumbnailReference;
  /**
   * For an item with no picture of its own to compare against, such as a text link:
   * whatever is shown must load at least this many pixels along its longest side.
   */
  minEdge?: number;
  /** The share images of the page being browsed. A linked page declaring one has nothing of its own. */
  siteImages?: ReadonlySet<string>;
}

/**
 * Keeps only what a linked page can be trusted to say about the hovered item. A
 * wrong picture is worse than a smaller correct one, so in order:
 *
 * 1. A link that answers with media is the item itself.
 * 2. A shared identity (same file stem or ID once size markers are gone) is a
 *    confident match, and it outranks every other image on the page.
 * 3. A redirect away from the item (to an ancestor path, a home page or a sign-in
 *    page) means the page no longer describes it, so nothing else is believed.
 * 4. Otherwise the image is plausible but unproven. It may not be a site-wide
 *    generic image, whether by name or because the page being browsed declares it too,
 *    and it must load larger than the thumbnail with a similar shape.
 *
 * An item with a `minEdge` and no thumbnail, such as a text link, has no picture to
 * compare with, so everything that survives must also load at least that large.
 */
export function matchLinkedCandidates(
  document: LinkedDocument,
  item: HoveredItem,
): MediaCandidate[] {
  const matched = matchPlausibleCandidates(document, item);
  const { minEdge } = item;
  if (!minEdge) return matched;
  return matched
    .filter((candidate) => !isRuledOutBySize(candidate, { minEdge }))
    .map((candidate) => ({ ...candidate, check: { ...candidate.check, minEdge } }));
}

function matchPlausibleCandidates(
  document: LinkedDocument,
  item: HoveredItem,
): MediaCandidate[] {
  if (document.directMedia) return [...document.candidates];

  const identities = identitiesOf(item.urls);
  const isSamePicture = (candidate: MediaCandidate): boolean =>
    candidate.kind === "image" &&
    candidate.url !== item.thumbnail?.url &&
    identities.has(imageIdentity(candidate.url) ?? "");
  const samePicture = document.candidates.filter(isSamePicture);
  if (isRedirectAwayFromItem(document.requestedUrl, document.finalUrl)) return samePicture;

  const otherMedia = document.candidates.filter((candidate) => candidate.kind !== "image");
  if (samePicture.length > 0) return [...samePicture, ...otherMedia];
  return document.candidates.flatMap((candidate) =>
    candidate.kind === "image"
      ? item.siteImages?.has(candidate.url)
        ? []
        : unprovenPageImage(candidate, item.thumbnail)
      : [candidate],
  );
}

/**
 * Explicit original links for a download. A page with several can only be trusted
 * for the one matching the shown item, and a page that redirected away for none.
 */
export function selectOriginalLink(
  document: LinkedDocument,
  kind: MediaKind,
  urls: readonly string[],
): MediaCandidate | null {
  if (isRedirectAwayFromItem(document.requestedUrl, document.finalUrl)) return null;
  const originals = document.candidates.filter(
    (candidate) => candidate.kind === kind && candidate.source === "document-original-link",
  );
  const identities = identitiesOf(urls);
  const matching = originals.filter((candidate) =>
    identities.has(imageIdentity(candidate.url) ?? ""),
  );
  const trusted = matching.length > 0 || originals.length > 1 ? matching : originals;
  return rankCandidates(trusted, { showSameSizeImages: true })[0] ?? null;
}

export function isRedirectAwayFromItem(requestedUrl: string, finalUrl: string): boolean {
  let requested: URL;
  let final: URL;
  try {
    requested = new URL(requestedUrl);
    final = new URL(finalUrl);
  } catch {
    return false;
  }
  const from = pathSegments(requested);
  const to = pathSegments(final);
  if (from.length === 0) return false;
  if (to.length === 0) return true;
  if (SIGN_IN_PATH.test(final.pathname) && !SIGN_IN_PATH.test(requested.pathname)) return true;
  if (!isSameSite(requested.hostname, final.hostname)) return false;
  return to.length < from.length && to.every((segment, index) => segment === from[index]);
}

function unprovenPageImage(
  candidate: MediaCandidate,
  thumbnail: ThumbnailReference | undefined,
): MediaCandidate[] {
  const fileName = new URL(candidate.url).pathname.split("/").at(-1) ?? "";
  if (GENERIC_PAGE_IMAGE.test(fileName)) return [];
  if (!thumbnail) return [candidate];
  const check = { thumbnail, shapeTolerance: PAGE_IMAGE_SHAPE_TOLERANCE };
  if (thumbnail.width && isRuledOutBySize(candidate, check)) return [];
  return [{ ...candidate, check: { ...candidate.check, ...check } }];
}

/** Declared dimensions can rule an image out without spending a request on it. */
function isRuledOutBySize({ width, height }: MediaCandidate, check: LoadCheck): boolean {
  return Boolean(width && height) && !passesLoadCheck({ width: width!, height: height! }, check);
}

function identitiesOf(urls: readonly string[]): Set<string> {
  return new Set(urls.flatMap((url) => imageIdentity(url) ?? []));
}

function pathSegments(url: URL): string[] {
  return url.pathname.toLowerCase().split("/").filter(Boolean);
}

function isSameSite(left: string, right: string): boolean {
  const a = left.replace(/^www\./u, "");
  const b = right.replace(/^www\./u, "");
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}
