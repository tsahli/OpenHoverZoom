import type { CandidateSource, MediaCandidate } from "./candidate";
import { mediaKindFromUrl } from "./media-type";
import { applyRewriteRules } from "./rewrite-rules";
import { rankCandidates } from "./score-candidates";
import { selectLargestSrcset, type SrcsetCandidate } from "./srcset";
import { normalizeUrl } from "./url";

const MAX_GALLERY_ANCESTORS = 6;
const MAX_GALLERY_DEPTH = 6;
const MAX_INSPECTED_NODES = 640;
const MAX_GALLERY_ITEMS = 64;
const MAX_CAPTION_LENGTH = 500;
const LAZY_SRCSET_ATTRIBUTES = ["data-srcset", "data-lazy-srcset"] as const;
const GALLERY_SEMANTICS = /(?:^|[-_\s])(album|carousel|gallery|grid|media-list|photos?|slider|slideshow)(?:$|[-_\s])/iu;

export interface DiscoveredGallery {
  items: MediaCandidate[];
  index: number;
}

export function discoverDomGallery(
  primaryImage: HTMLImageElement,
  baseUrl: string,
  lazyAttributes: readonly string[],
  linkedPageForImage?: (image: HTMLImageElement) => string | null,
): DiscoveredGallery | null {
  let root = primaryImage.parentElement;

  for (let depth = 0; root && depth < MAX_GALLERY_ANCESTORS; depth += 1) {
    if (root === primaryImage.ownerDocument.body || root === primaryImage.ownerDocument.documentElement) {
      break;
    }
    if (root.classList.contains("thread")) break;

    const images = collectBoundedImages(root);
    if (images.includes(primaryImage) && images.length >= 2) {
      const grouped = selectGalleryImages(root, primaryImage, images);
      const gallery = grouped
        ? createGallery(
            grouped,
            primaryImage,
            baseUrl,
            lazyAttributes,
            linkedPageForImage,
          )
        : null;
      if (gallery) return gallery;
    }
    root = root.parentElement;
  }
  return null;
}

function collectBoundedImages(root: Element): HTMLImageElement[] {
  const images: HTMLImageElement[] = [];
  const stack = Array.from(root.children, (element) => ({ element, depth: 1 })).reverse();
  let inspected = 0;

  while (
    stack.length > 0 &&
    inspected < MAX_INSPECTED_NODES &&
    images.length < MAX_GALLERY_ITEMS
  ) {
    const entry = stack.pop();
    if (!entry) break;
    inspected += 1;
    if (entry.element instanceof HTMLImageElement && isLikelyGalleryImage(entry.element)) {
      images.push(entry.element);
    }
    if (entry.depth >= MAX_GALLERY_DEPTH) continue;
    for (const child of Array.from(entry.element.children).reverse()) {
      stack.push({ element: child, depth: entry.depth + 1 });
    }
  }

  // The depth-first stack pushes children in reverse, so popped images are
  // already in document order. Avoid an O(n log n) DOM-position sort here.
  return images;
}

function selectGalleryImages(
  root: Element,
  primaryImage: HTMLImageElement,
  images: readonly HTMLImageElement[],
): HTMLImageElement[] | null {
  if (hasGallerySemantics(root)) return [...images];

  const primaryBranch = directBranch(root, primaryImage);
  if (!primaryBranch) return null;
  const primarySignature = branchSignature(primaryBranch);
  const matching = images.filter((image) => {
    const branch = directBranch(root, image);
    return branch ? branchSignature(branch) === primarySignature : false;
  });
  const branches = new Set(matching.map((image) => directBranch(root, image)).filter(Boolean));
  return branches.size >= 2 ? matching : null;
}

function createGallery(
  images: readonly HTMLImageElement[],
  primaryImage: HTMLImageElement,
  baseUrl: string,
  lazyAttributes: readonly string[],
  linkedPageForImage?: (image: HTMLImageElement) => string | null,
): DiscoveredGallery | null {
  const items: MediaCandidate[] = [];
  const indices = new Map<string, number>();
  const prioritizedLazyAttributes = [...lazyAttributes].sort(
    (left, right) => lazyPriority(right) - lazyPriority(left),
  );
  let activeIndex = -1;

  for (const image of images) {
    const localCandidate = candidateForImage(
      image,
      baseUrl,
      prioritizedLazyAttributes,
    );
    if (!localCandidate) continue;
    const linkedPageUrl = linkedPageForImage?.(image) ?? null;
    const candidate = linkedPageUrl && linkedPageUrl !== localCandidate.url
      ? { ...localCandidate, linkedPageUrl }
      : localCandidate;
    const existing = indices.get(candidate.url);
    if (existing !== undefined) {
      if (image === primaryImage) activeIndex = existing;
      continue;
    }
    const index = items.length;
    indices.set(candidate.url, index);
    items.push(candidate);
    if (image === primaryImage) activeIndex = index;
  }

  if (items.length < 2 || activeIndex < 0) return null;
  return { items, index: activeIndex };
}

function candidateForImage(
  image: HTMLImageElement,
  baseUrl: string,
  lazyAttributes: readonly string[],
): MediaCandidate | null {
  const caption = captionForImage(image);
  const candidates: MediaCandidate[] = [];
  const picture = image.closest("picture");
  if (picture?.contains(image)) {
    const largest = largestPictureSource(picture);
    const candidate = largest
      ? createCandidate(
          largest.url,
          baseUrl,
          "picture",
          94,
          caption,
          largest.width,
          "responsive",
        )
      : null;
    if (candidate) candidates.push(candidate);
  }

  const responsive = selectLargestSrcset(image.srcset);
  if (responsive) {
    const candidate = createCandidate(
      responsive.url,
      baseUrl,
      "srcset",
      90,
      caption,
      responsive.width,
      "responsive",
    );
    if (candidate) candidates.push(candidate);
  }

  for (const attribute of LAZY_SRCSET_ATTRIBUTES) {
    const lazyResponsive = selectLargestSrcset(image.getAttribute(attribute) ?? "");
    if (!lazyResponsive) continue;
    const candidate = createCandidate(
      lazyResponsive.url,
      baseUrl,
      "srcset",
      90,
      caption,
      lazyResponsive.width,
      "responsive",
    );
    if (candidate) candidates.push(candidate);
  }

  for (const attribute of lazyAttributes) {
    const value = image.getAttribute(attribute);
    if (!value) continue;
    const quality = attribute.includes("full") || attribute === "data-original"
      ? "original"
      : "display";
    const candidate = createCandidate(
      value,
      baseUrl,
      "data-attribute",
      86,
      caption,
      undefined,
      quality,
    );
    if (candidate) candidates.push(candidate);
  }

  const dimensions = image.naturalWidth > 0 && image.naturalHeight > 0
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : {};
  const url = normalizeUrl(image.currentSrc || image.getAttribute("src") || "", baseUrl, {
    allowPageLocal: true,
  });
  if (url) {
    candidates.push({
      url,
      kind: "image",
      source: "current-src",
      confidence: 70,
      ...dimensions,
      ...(caption ? { caption } : {}),
    });
  }
  const rewritten = candidates.flatMap((candidate) =>
    applyRewriteRules(candidate, {
      pageUrl: image.ownerDocument.location.href,
      target: "image",
    }),
  );
  return rankCandidates([...rewritten, ...candidates], { showSameSizeImages: true })[0] ?? null;
}

function largestPictureSource(picture: HTMLPictureElement): SrcsetCandidate | null {
  let largest: SrcsetCandidate | null = null;
  for (const source of picture.querySelectorAll(":scope > source[srcset]")) {
    const candidate = selectLargestSrcset(source.getAttribute("srcset") ?? "");
    if (candidate && (!largest || srcsetScore(candidate) > srcsetScore(largest))) {
      largest = candidate;
    }
  }
  return largest;
}

function createCandidate(
  value: string,
  baseUrl: string,
  source: CandidateSource,
  confidence: number,
  caption: string | undefined,
  width?: number,
  quality?: MediaCandidate["quality"],
): MediaCandidate | null {
  const url = normalizeUrl(value, baseUrl, { allowPageLocal: true });
  if (!url) return null;
  return {
    url,
    kind: mediaKindFromUrl(url) ?? "image",
    source,
    confidence,
    ...(width ? { width } : {}),
    ...(quality ? { quality } : {}),
    ...(caption ? { caption } : {}),
  };
}

function captionForImage(image: HTMLImageElement): string | undefined {
  const figureCaption = image.closest("figure")?.querySelector("figcaption")?.textContent;
  const value =
    image.alt.trim() ||
    image.title.trim() ||
    figureCaption?.trim() ||
    image.closest("a")?.title.trim();
  return value ? value.slice(0, MAX_CAPTION_LENGTH) : undefined;
}

function hasGallerySemantics(element: Element): boolean {
  const value = [
    element.id,
    element.className,
    element.getAttribute("role") ?? "",
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("aria-roledescription") ?? "",
  ].join(" ");
  return GALLERY_SEMANTICS.test(value);
}

function directBranch(root: Element, descendant: Element): Element | null {
  let current: Element | null = descendant;
  while (current?.parentElement && current.parentElement !== root) current = current.parentElement;
  return current?.parentElement === root ? current : null;
}

function branchSignature(element: Element): string {
  const classes = Array.from(element.classList).sort().slice(0, 4).join(".");
  return `${element.tagName.toLowerCase()}|${classes}|${element.getAttribute("role") ?? ""}`;
}

function isLikelyGalleryImage(image: HTMLImageElement): boolean {
  if (image.getAttribute("aria-hidden") === "true") return false;
  const declaredWidth = Number.parseFloat(image.getAttribute("width") ?? "0");
  const declaredHeight = Number.parseFloat(image.getAttribute("height") ?? "0");
  if (declaredWidth > 0 && declaredHeight > 0 && declaredWidth <= 64 && declaredHeight <= 64) {
    return false;
  }
  if (
    image.naturalWidth > 0 &&
    image.naturalHeight > 0 &&
    image.naturalWidth <= 64 &&
    image.naturalHeight <= 64
  ) {
    return false;
  }
  return true;
}

function srcsetScore(candidate: SrcsetCandidate): number {
  return candidate.width ?? (candidate.density ?? 1) * 10_000;
}

function lazyPriority(attribute: string): number {
  if (attribute.includes("full") || attribute === "data-original") return 2;
  return 1;
}
