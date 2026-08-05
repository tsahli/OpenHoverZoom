import { extractBackgroundImageUrls } from "../resolver/background-image";
import { LAZY_SOURCE_ATTRIBUTES } from "../resolver/dom-resolver";
import { mediaKindFromUrl } from "../resolver/media-type";

const MAX_DEPTH = 5;
const MAX_POINT_STACK = 12;
const MAX_DESCENDANT_DEPTH = 4;
const MAX_DESCENDANTS = 32;
const MAX_MEDIA_LINK_ANCESTORS = 4;
const HOVER_SOURCE_ATTRIBUTES = LAZY_SOURCE_ATTRIBUTES.filter(
  (attribute) => attribute !== "data-url",
);
const MEDIA_DECLARATION_ATTRIBUTES = ["data-kind", "data-media-kind", "data-type", "type"];

export interface PointerPosition {
  x: number;
  y: number;
}

export function findHoverTarget(
  eventTarget: EventTarget | null,
  pointer?: PointerPosition,
): Element | null {
  if (!(eventTarget instanceof Element)) return null;

  const paths = collectHitPaths(eventTarget, pointer);

  // Prefer concrete media. Many galleries place a transparent link or
  // control layer above a nested image.
  for (const element of paths) {
    if (isMediaElement(element)) return element;
  }

  for (const element of paths) {
    const media = findBoundedMediaDescendant(element, pointer);
    if (media) return media;
  }

  for (const element of paths) {
    if (isSourceCandidate(element)) return element;
  }

  for (const element of paths) {
    if (element instanceof HTMLAnchorElement && isSupportedMediaLink(element)) {
      return element;
    }
  }

  return null;
}

function collectHitPaths(eventTarget: Element, pointer?: PointerPosition): Element[] {
  const roots: Element[] = [eventTarget];
  if (pointer) {
    const elementsFromPoint = eventTarget.ownerDocument.elementsFromPoint?.bind(
      eventTarget.ownerDocument,
    );
    if (elementsFromPoint) {
      roots.push(...elementsFromPoint(pointer.x, pointer.y).slice(0, MAX_POINT_STACK));
    }
  }

  const paths: Element[] = [];
  const seen = new Set<Element>();
  for (const root of roots) {
    let current: Element | null = root;
    for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
      if (!seen.has(current)) {
        seen.add(current);
        paths.push(current);
      }
      current = current.parentElement;
    }
  }
  return paths;
}

function findBoundedMediaDescendant(
  root: Element,
  pointer?: PointerPosition,
): Element | null {
  const queue = Array.from(root.children, (element) => ({ element, depth: 1 }));
  let inspected = 0;

  while (queue.length > 0 && inspected < MAX_DESCENDANTS) {
    const entry = queue.shift();
    if (!entry) break;
    inspected += 1;

    if (isMediaElement(entry.element) && (!pointer || containsPoint(entry.element, pointer))) {
      return entry.element;
    }
    if (entry.depth >= MAX_DESCENDANT_DEPTH) continue;
    for (const child of Array.from(entry.element.children)) {
      queue.push({ element: child, depth: entry.depth + 1 });
    }
  }
  return null;
}

function isMediaElement(element: Element): boolean {
  return (
    element instanceof HTMLImageElement ||
    element instanceof HTMLPictureElement ||
    element instanceof HTMLVideoElement
  );
}

function isSourceCandidate(element: Element): boolean {
  if (
    HOVER_SOURCE_ATTRIBUTES.some((attribute) => element.hasAttribute(attribute))
  ) {
    return true;
  }
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  return extractBackgroundImageUrls(view.getComputedStyle(element).backgroundImage).length > 0;
}

function isSupportedMediaLink(anchor: HTMLAnchorElement): boolean {
  if (mediaKindFromUrl(anchor.href)) return true;
  if (!hasDeclaredMediaContext(anchor)) return false;
  return hasMatchingLinkedMedia(anchor);
}

function hasDeclaredMediaContext(element: Element): boolean {
  let current: Element | null = element;
  for (let depth = 0; current && depth < MAX_MEDIA_LINK_ANCESTORS; depth += 1) {
    for (const attribute of MEDIA_DECLARATION_ATTRIBUTES) {
      if (isMediaDeclaration(current.getAttribute(attribute))) return true;
    }
    const itemType = current.getAttribute("itemtype")?.toLowerCase() ?? "";
    if (/(?:image|video|audio)object$/u.test(itemType)) return true;
    current = current.parentElement;
  }
  return false;
}

function isMediaDeclaration(value: string | null): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return (
    normalized === "image" ||
    normalized === "video" ||
    normalized === "audio" ||
    normalized.startsWith("image/") ||
    normalized.startsWith("video/") ||
    normalized.startsWith("audio/")
  );
}

function hasMatchingLinkedMedia(anchor: HTMLAnchorElement): boolean {
  const href = anchor.href;
  if (!href) return false;

  let root = anchor.parentElement;
  for (let depth = 0; root && depth < MAX_MEDIA_LINK_ANCESTORS; depth += 1) {
    const queue = Array.from(root.children, (element) => ({ element, depth: 1 }));
    let inspected = 0;
    while (queue.length > 0 && inspected < MAX_DESCENDANTS) {
      const entry = queue.shift();
      if (!entry) break;
      inspected += 1;
      if (
        entry.element instanceof HTMLAnchorElement &&
        entry.element !== anchor &&
        entry.element.href === href &&
        findBoundedMediaDescendant(entry.element)
      ) {
        return true;
      }
      if (entry.depth >= MAX_DESCENDANT_DEPTH) continue;
      for (const child of Array.from(entry.element.children)) {
        queue.push({ element: child, depth: entry.depth + 1 });
      }
    }
    root = root.parentElement;
  }
  return false;
}

function containsPoint(element: Element, pointer: PointerPosition): boolean {
  const rectangle = element.getBoundingClientRect();
  return (
    rectangle.width > 0 &&
    rectangle.height > 0 &&
    pointer.x >= rectangle.left &&
    pointer.x <= rectangle.right &&
    pointer.y >= rectangle.top &&
    pointer.y <= rectangle.bottom
  );
}
