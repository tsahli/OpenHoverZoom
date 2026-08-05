import { extractBackgroundImageUrls } from "./background-image";
import type { MediaCandidate, RenderedSize } from "./candidate";
import { discoverDomGallery, type DiscoveredGallery } from "./dom-gallery";
import { mediaKindFromUrl } from "./media-type";
import { applyRewriteRules } from "./rewrite-rules";
import { rankCandidates } from "./score-candidates";
import { selectLargestSrcset } from "./srcset";
import { normalizeUrl } from "./url";

export const LAZY_SOURCE_ATTRIBUTES = [
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-full",
  "data-full-src",
  "data-image",
  "data-url",
] as const;

const MAX_CONTEXT_DEPTH = 5;
const MAX_DESCENDANT_DEPTH = 4;
const MAX_DESCENDANTS = 32;

export interface DomResolution {
  candidates: MediaCandidate[];
  anchorUrl: string | null;
  renderedSize?: RenderedSize;
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
  const context = [
    ...collectContextElements(target),
    ...(associatedMedia ? collectContextElements(associatedMedia) : []),
  ].filter((element, index, elements) => elements.indexOf(element) === index);
  const candidates: MediaCandidate[] = [];
  const primaryImage = context.find(
    (element): element is HTMLImageElement => element instanceof HTMLImageElement,
  );
  const renderedSize = primaryImage ? sizeOf(primaryImage) : undefined;
  const caption = primaryImage?.alt.trim() || undefined;
  const gallery = primaryImage
    ? discoverDomGallery(primaryImage, baseUrl, LAZY_SOURCE_ATTRIBUTES)
    : null;

  for (const element of context) {
    if (element instanceof HTMLImageElement) {
      addImageCandidates(candidates, element, baseUrl, caption);
    }
    if (element instanceof HTMLPictureElement) {
      addPictureCandidates(candidates, element, baseUrl, caption);
    }
    if (element instanceof HTMLVideoElement) {
      addVideoCandidates(candidates, element, baseUrl);
    }
    addLazyCandidates(candidates, element, baseUrl, caption);
    addBackgroundCandidates(candidates, element, baseUrl, caption);
  }

  const anchor = context.find(
    (element): element is HTMLAnchorElement => element instanceof HTMLAnchorElement,
  );
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
        ...(caption ? { caption } : {}),
      });
    }
  }

  const rewritten = candidates.flatMap((candidate) =>
    applyRewriteRules(candidate, {
      pageUrl: document.location.href,
      target: candidate.source === "direct-link" ? "link" : "image",
    }),
  );
  const rankOptions = {
    showSameSizeImages: options.showSameSizeImages,
    ...(renderedSize ? { renderedSize } : {}),
  };

  return {
    candidates: rankCandidates([...rewritten, ...candidates], rankOptions),
    anchorUrl,
    ...(renderedSize ? { renderedSize } : {}),
    ...(gallery ? { gallery } : {}),
  };
}

export function collectContextElements(target: Element): Element[] {
  const elements: Element[] = [];
  let current: Element | null = target;
  for (let depth = 0; current && depth < MAX_CONTEXT_DEPTH; depth += 1) {
    elements.push(current);
    if (current instanceof HTMLPictureElement || current instanceof HTMLAnchorElement) {
      elements.push(...collectBoundedDescendants(current));
    }
    current = current.parentElement;
  }
  return [...new Set(elements)];
}

function collectBoundedDescendants(element: Element): Element[] {
  const descendants: Element[] = [];
  const queue = Array.from(element.children, (child) => ({ element: child, depth: 1 }));

  while (queue.length > 0 && descendants.length < MAX_DESCENDANTS) {
    const entry = queue.shift();
    if (!entry) break;
    descendants.push(entry.element);
    if (entry.depth >= MAX_DESCENDANT_DEPTH) continue;
    for (const child of Array.from(entry.element.children)) {
      queue.push({ element: child, depth: entry.depth + 1 });
    }
  }
  return descendants;
}

function findAssociatedLinkedMedia(anchor: HTMLAnchorElement): Element | null {
  const href = anchor.href;
  if (!href) return null;

  let root = anchor.parentElement;
  for (let depth = 0; root && depth < MAX_CONTEXT_DEPTH; depth += 1) {
    for (const element of collectBoundedDescendants(root)) {
      if (
        element instanceof HTMLAnchorElement &&
        element !== anchor &&
        element.href === href
      ) {
        const media = collectBoundedDescendants(element).find(
          (descendant) =>
            descendant instanceof HTMLImageElement ||
            descendant instanceof HTMLPictureElement ||
            descendant instanceof HTMLVideoElement,
        );
        if (media) return media;
      }
    }
    root = root.parentElement;
  }
  return null;
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
  addCandidate(candidates, video.poster, baseUrl, {
    kind: "image",
    source: "video-poster",
    confidence: 78,
  });
  addCandidate(candidates, video.currentSrc || video.src, baseUrl, {
    kind: "video",
    source: "video-source",
    confidence: 92,
  });
  for (const source of video.querySelectorAll(":scope > source[src]")) {
    addCandidate(candidates, source.getAttribute("src"), baseUrl, {
      kind: "video",
      source: "video-source",
      confidence: 90,
    });
  }
}

function addLazyCandidates(
  candidates: MediaCandidate[],
  element: Element,
  baseUrl: string,
  caption: string | undefined,
): void {
  for (const attribute of LAZY_SOURCE_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const normalized = normalizeUrl(value, baseUrl, { allowPageLocal: true });
    if (!normalized) continue;
    candidates.push({
      url: normalized,
      kind: mediaKindFromUrl(normalized) ?? "image",
      source: "data-attribute",
      confidence: attribute.includes("full") || attribute === "data-original" ? 88 : 80,
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
  const view = element.ownerDocument.defaultView;
  if (!view) return;
  const backgroundImage = view.getComputedStyle(element).backgroundImage;
  for (const url of extractBackgroundImageUrls(backgroundImage)) {
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
