import {
  extractPreviewableBackgroundImageUrls,
  isPageScaleDecoration,
} from "./background-image";
import type { MediaCandidate, RenderedSize, ThumbnailReference } from "./candidate";
import { discoverDomGallery, thumbnailForImage, type DiscoveredGallery } from "./dom-gallery";
import { mediaKindFromUrl } from "./media-type";
import { rankCandidates } from "./score-candidates";
import { selectLargestSrcset } from "./srcset";
import { normalizeUrl } from "./url";
import {
  closestAcrossShadow,
  comparableAreaOverlap,
  containsAcrossShadow,
  containsRect,
  isCrossOriginFrame,
  isSmallMedia,
  parentAcrossShadow,
  walkBoundedDescendants,
} from "../shared/dom";

export const LAZY_SOURCE_ATTRIBUTES = [
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-full",
  "data-full-src",
  "data-image",
  "data-url",
] as const;

const LAZY_SRCSET_ATTRIBUTES = ["data-srcset", "data-lazy-srcset"] as const;

const MAX_CONTEXT_DEPTH = 5;
const CONTEXT_DESCENDANT_WALK = { maxDepth: 4, maxElements: 32 } as const;
const MIN_COVERING_LINK_OVERLAP = 0.75;
/** Images stacked this closely, such as a placeholder and its photo, show one picture. */
const MIN_STACKED_IMAGE_OVERLAP = 0.75;

export interface DomResolution {
  candidates: MediaCandidate[];
  fallbackCandidates: MediaCandidate[];
  anchorUrl: string | null;
  /** The anchor's page may be fetched. See `mayFetchLinkedPage`. */
  lookupAllowed: boolean;
  /** The hovered media is an icon or avatar too small to justify a page lookup. */
  smallMedia: boolean;
  renderedSize?: RenderedSize;
  /** What the page displays for the hovered image, which guesses must beat. */
  thumbnail?: ThumbnailReference;
  gallery?: DiscoveredGallery;
}

export interface DomResolverOptions {
  showSameSizeImages: boolean;
}

export function resolveDomTarget(
  target: Element,
  options: DomResolverOptions,
): DomResolution {
  const document = target.ownerDocument;
  const baseUrl = document.baseURI;
  const associatedMedia = target instanceof HTMLAnchorElement
    ? findAssociatedLinkedMedia(target)
    : null;
  const initialContext = uniqueElements([
    ...collectContextElements(target),
    ...(associatedMedia ? collectContextElements(associatedMedia) : []),
  ]);
  const initialImage = initialContext.find(
    (element): element is HTMLImageElement => element instanceof HTMLImageElement,
  );
  // The link around a card can sit further up than the context reaches.
  const enclosingAnchor = closestAcrossShadow(initialImage ?? target, "a[href]");
  const coveringAnchor =
    initialImage && !enclosingAnchor
      ? findCoveringSiblingAnchor(initialImage, baseUrl)
      : null;
  const context = uniqueElements([
    ...initialContext,
    ...(coveringAnchor ? collectContextElements(coveringAnchor) : []),
  ]);
  const candidates: MediaCandidate[] = [];
  const primaryImage = context.find(
    (element): element is HTMLImageElement =>
      element instanceof HTMLImageElement &&
      !isPageScaleDecoration(element) &&
      !isSeparatePicture(element, associatedMedia ?? target),
  );
  const renderedSize = primaryImage ? sizeOf(primaryImage) : undefined;
  const caption = primaryImage?.alt.trim() || undefined;
  const gallery = primaryImage
    ? discoverDomGallery(
        primaryImage,
        baseUrl,
        LAZY_SOURCE_ATTRIBUTES,
        (image) => findLinkedPageUrl(image, baseUrl),
      )
    : null;

  for (const element of context) {
    // A link can hold several pictures, and only the hovered one speaks for this hover.
    if (isSeparatePicture(element, primaryImage ?? associatedMedia ?? target)) continue;
    const isDecoration = isPageScaleDecoration(element);
    if (element instanceof HTMLImageElement && !isDecoration) {
      addImageCandidates(candidates, element, baseUrl, caption);
    }
    if (element instanceof HTMLPictureElement && !isDecoration) {
      addPictureCandidates(candidates, element, baseUrl, caption);
    }
    if (element instanceof HTMLVideoElement && !isDecoration) {
      addVideoCandidates(candidates, element, baseUrl);
    }
    if (!isDecoration) {
      addLazySrcsetCandidates(candidates, element, baseUrl, caption);
      addLazyCandidates(
        candidates,
        element,
        baseUrl,
        caption,
        element === target || element === primaryImage,
      );
    }
    if (element === target && !isDecoration) {
      addBackgroundCandidates(candidates, element, baseUrl, caption);
    }
  }

  const anchor =
    context.find(
      (element): element is HTMLAnchorElement => element instanceof HTMLAnchorElement,
    ) ?? (enclosingAnchor instanceof HTMLAnchorElement ? enclosingAnchor : null);
  const anchorUrl = anchor ? normalizeUrl(anchor.href, baseUrl) : null;
  if (anchorUrl) {
    const kind = mediaKindFromUrl(anchorUrl);
    if (kind) {
      candidates.push({
        url: anchorUrl,
        kind,
        source: "direct-link",
        // A route such as /photo/example.jpg can still return HTML. Treat the
        // extension as a strong hint, then let the linked-document resolver
        // verify the response content type before it receives top priority.
        confidence: 92,
        quality: "display",
        ...(caption ? { caption } : {}),
      });
    }
  }

  const rankOptions = {
    showSameSizeImages: options.showSameSizeImages,
    ...(renderedSize ? { renderedSize } : {}),
  };
  const thumbnail = primaryImage ? thumbnailForImage(primaryImage, baseUrl) : undefined;

  return {
    candidates: rankCandidates(candidates, rankOptions),
    fallbackCandidates: rankCandidates(candidates, {
      ...rankOptions,
      showSameSizeImages: true,
    }).filter((candidate) => candidate.source !== "direct-link"),
    anchorUrl,
    lookupAllowed: anchor ? mayFetchLinkedPage(anchor) : false,
    // A short text link is not an icon, and only its size says otherwise.
    smallMedia: primaryImage
      ? isSmallMedia(primaryImage)
      : !(target instanceof HTMLAnchorElement) && isSmallMedia(target),
    ...(renderedSize ? { renderedSize } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    ...(gallery ? { gallery } : {}),
  };
}

function isSeparatePicture(element: Element, reference: Element): boolean {
  // A link or picture speaks for the images it holds.
  if (
    (reference instanceof HTMLAnchorElement || reference instanceof HTMLPictureElement) &&
    containsAcrossShadow(reference, element)
  ) {
    return false;
  }
  const image =
    element instanceof HTMLImageElement
      ? element
      : element instanceof HTMLPictureElement
        ? element.querySelector("img")
        : null;
  return (
    image !== null &&
    image !== reference &&
    comparableAreaOverlap(image, reference) < MIN_STACKED_IMAGE_OVERLAP
  );
}

export function collectContextElements(target: Element): Element[] {
  const elements: Element[] = [];
  let current: Element | null = target;
  for (let depth = 0; current && depth < MAX_CONTEXT_DEPTH; depth += 1) {
    elements.push(current);
    if (current instanceof HTMLPictureElement || current instanceof HTMLAnchorElement) {
      elements.push(...walkBoundedDescendants(current, CONTEXT_DESCENDANT_WALK));
    }
    current = parentAcrossShadow(current);
  }
  return [...new Set(elements)];
}

function uniqueElements(elements: readonly Element[]): Element[] {
  return [...new Set(elements)];
}

/** False for links that declare sponsorship or tracking, and from ad iframes. */
export function mayFetchLinkedPage(anchor: HTMLAnchorElement): boolean {
  return !(
    anchor.relList.contains("sponsored") ||
    anchor.hasAttribute("ping") ||
    anchor.hasAttribute("attributionsrc") ||
    isCrossOriginFrame()
  );
}

function findAssociatedLinkedMedia(anchor: HTMLAnchorElement): Element | null {
  const href = anchor.href;
  if (!href) return null;

  let root = parentAcrossShadow(anchor);
  for (let depth = 0; root && depth < MAX_CONTEXT_DEPTH; depth += 1) {
    for (const element of walkBoundedDescendants(root, CONTEXT_DESCENDANT_WALK)) {
      if (
        element instanceof HTMLAnchorElement &&
        element !== anchor &&
        element.href === href
      ) {
        const media = [...walkBoundedDescendants(element, CONTEXT_DESCENDANT_WALK)].find(
          (descendant) =>
            descendant instanceof HTMLImageElement ||
            descendant instanceof HTMLPictureElement ||
            descendant instanceof HTMLVideoElement,
        );
        if (media) return media;
      }
    }
    root = parentAcrossShadow(root);
  }
  return null;
}

function findCoveringSiblingAnchor(
  image: HTMLImageElement,
  baseUrl: string,
): HTMLAnchorElement | null {
  const seen = new Set<HTMLAnchorElement>();
  let best: { anchor: HTMLAnchorElement; score: number } | null = null;
  let root = parentAcrossShadow(image);

  for (let depth = 0; root && depth < MAX_CONTEXT_DEPTH; depth += 1) {
    for (const element of walkBoundedDescendants(root, CONTEXT_DESCENDANT_WALK)) {
      if (
        !(element instanceof HTMLAnchorElement) ||
        containsAcrossShadow(element, image) ||
        seen.has(element)
      ) {
        continue;
      }
      seen.add(element);
      const href = element.getAttribute("href")?.trim();
      const normalized = href ? normalizeUrl(href, baseUrl) : null;
      if (!normalized || normalized === image.ownerDocument.location.href) continue;

      const score = coveringLinkScore(element, image);
      if (score >= MIN_COVERING_LINK_OVERLAP && (!best || score > best.score)) {
        best = { anchor: element, score };
      }
    }
    if (best?.score === 1) break;
    root = parentAcrossShadow(root);
  }
  return best?.anchor ?? null;
}

// Gallery items answer to the same limits as a hovered image: no page lookups for
// icons, for links that declare tracking, or from ad iframes.
function findLinkedPageUrl(image: HTMLImageElement, baseUrl: string): string | null {
  if (isSmallMedia(image)) return null;
  const ancestor = closestAcrossShadow(image, "a[href]");
  const anchor =
    (ancestor instanceof HTMLAnchorElement ? ancestor : null) ??
    findCoveringSiblingAnchor(image, baseUrl);
  if (!anchor || !mayFetchLinkedPage(anchor)) return null;
  const normalized = normalizeUrl(anchor.href, baseUrl);
  return normalized === image.ownerDocument.location.href ? null : normalized;
}

function coveringLinkScore(anchor: Element, image: Element): number {
  return isStretchedOverImage(anchor, image) ? 1 : comparableAreaOverlap(anchor, image);
}

// An empty link stretched across a card makes all of it clickable, picture included.
function isStretchedOverImage(anchor: Element, image: Element): boolean {
  if (!containsRect(anchor, image)) return false;
  const { left, top, width, height } = image.getBoundingClientRect();
  // The document only reports a shadow tree's host, so ask the tree holding the link.
  const root = anchor.getRootNode();
  const scope = root instanceof ShadowRoot ? root : image.ownerDocument;
  const topmost = scope.elementFromPoint(left + width / 2, top + height / 2);
  return topmost === anchor;
}

function addImageCandidates(
  candidates: MediaCandidate[],
  image: HTMLImageElement,
  baseUrl: string,
  caption: string | undefined,
): void {
  const dimensions = image.naturalWidth > 0 && image.naturalHeight > 0
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : {};

  addCandidate(candidates, image.currentSrc, baseUrl, {
    kind: "image",
    source: "current-src",
    confidence: 62,
    ...dimensions,
    ...(caption ? { caption } : {}),
  });
  addCandidate(candidates, image.getAttribute("src"), baseUrl, {
    kind: "image",
    source: "image-src",
    confidence: 58,
    ...dimensions,
    ...(caption ? { caption } : {}),
  });

  const largest = selectLargestSrcset(image.srcset);
  if (largest) {
    addCandidate(candidates, largest.url, baseUrl, {
      kind: "image",
      source: "srcset",
      confidence: 90,
      quality: "responsive",
      ...(largest.width ? { width: largest.width } : {}),
      ...(caption ? { caption } : {}),
    });
  }
}

function addPictureCandidates(
  candidates: MediaCandidate[],
  picture: HTMLPictureElement,
  baseUrl: string,
  caption: string | undefined,
): void {
  for (const source of picture.querySelectorAll(":scope > source[srcset]")) {
    const largest = selectLargestSrcset(source.getAttribute("srcset") ?? "");
    if (!largest) continue;
    addCandidate(candidates, largest.url, baseUrl, {
      kind: "image",
      source: "picture",
      confidence: 94,
      quality: "responsive",
      ...(largest.width ? { width: largest.width } : {}),
      ...(caption ? { caption } : {}),
    });
  }
}

function addVideoCandidates(
  candidates: MediaCandidate[],
  video: HTMLVideoElement,
  baseUrl: string,
): void {
  const dimensions = video.videoWidth > 0 && video.videoHeight > 0
    ? { width: video.videoWidth, height: video.videoHeight }
    : {};
  addCandidate(candidates, video.poster, baseUrl, {
    kind: "image",
    source: "video-poster",
    confidence: 78,
  });
  addCandidate(candidates, video.currentSrc || video.src, baseUrl, {
    kind: "video",
    source: "video-source",
    confidence: 92,
    ...dimensions,
  });
  for (const source of video.querySelectorAll(":scope > source[src]")) {
    const width = sourceDimension(source, "width");
    const height = sourceDimension(source, "height");
    addCandidate(candidates, source.getAttribute("src"), baseUrl, {
      kind: "video",
      source: "video-source",
      confidence: 90,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    });
  }
}

function sourceDimension(source: Element, dimension: "width" | "height"): number | undefined {
  for (const attribute of [`data-${dimension}`, dimension]) {
    const value = Number.parseFloat(source.getAttribute(attribute) ?? "");
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function addLazyCandidates(
  candidates: MediaCandidate[],
  element: Element,
  baseUrl: string,
  caption: string | undefined,
  isPrimaryElement: boolean,
): void {
  for (const attribute of LAZY_SOURCE_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const normalized = normalizeUrl(value, baseUrl, { allowPageLocal: true });
    if (!normalized) continue;
    const isExplicitFullSize = attribute.includes("full") || attribute === "data-original";
    candidates.push({
      url: normalized,
      kind: mediaKindFromUrl(normalized) ?? "image",
      source: "data-attribute",
      confidence: isExplicitFullSize ? 88 : 80,
      quality: isExplicitFullSize && isPrimaryElement ? "original" : "display",
      ...(caption ? { caption } : {}),
    });
  }
}

function addLazySrcsetCandidates(
  candidates: MediaCandidate[],
  element: Element,
  baseUrl: string,
  caption: string | undefined,
): void {
  for (const attribute of LAZY_SRCSET_ATTRIBUTES) {
    const largest = selectLargestSrcset(element.getAttribute(attribute) ?? "");
    if (!largest) continue;
    addCandidate(candidates, largest.url, baseUrl, {
      kind: "image",
      source: "srcset",
      confidence: 90,
      quality: "responsive",
      ...(largest.width ? { width: largest.width } : {}),
      ...(caption ? { caption } : {}),
    });
  }
}

function addBackgroundCandidates(
  candidates: MediaCandidate[],
  element: Element,
  baseUrl: string,
  caption: string | undefined,
): void {
  for (const url of extractPreviewableBackgroundImageUrls(element)) {
    addCandidate(candidates, url, baseUrl, {
      kind: "image",
      source: "background-image",
      confidence: 72,
      ...(caption ? { caption } : {}),
    });
  }
}

function addCandidate(
  candidates: MediaCandidate[],
  value: string | null,
  baseUrl: string,
  candidate: Omit<MediaCandidate, "url">,
): void {
  if (!value) return;
  const url = normalizeUrl(value, baseUrl, { allowPageLocal: true });
  if (url) candidates.push({ url, ...candidate });
}

function sizeOf(element: Element): RenderedSize | undefined {
  const rectangle = element.getBoundingClientRect();
  if (rectangle.width <= 0 || rectangle.height <= 0) return undefined;
  return { width: rectangle.width, height: rectangle.height };
}
