import {
  extractPreviewableBackgroundImageUrls,
  isPageScaleDecoration,
} from "../resolver/background-image";
import { LAZY_SOURCE_ATTRIBUTES } from "../resolver/dom-resolver";
import { mediaKindFromUrl } from "../resolver/media-type";
import { isEligibleTextLink } from "../resolver/text-link";
import {
  closestAcrossShadow,
  comparableAreaOverlap,
  containsAcrossShadow,
  containsRect,
  elementsFromPointDeep,
  intersectionArea,
  parentAcrossShadow,
  walkBoundedDescendants,
} from "../shared/dom";

const MAX_DEPTH = 5;
const MAX_POINT_STACK = 12;
const MEDIA_DESCENDANT_WALK = { maxDepth: 4, maxElements: 32 } as const;
const MAX_MEDIA_LINK_ANCESTORS = 4;
const MAX_UI_SURFACE_ANCESTORS = 8;
const MIN_UI_SURFACE_CONTROLS = 3;
const MIN_ASSOCIATED_SURFACE_OVERLAP = 0.75;
const MIN_MEDIA_SURFACE_COVERAGE = 0.6;
const OPAQUE_LAYER_ALPHA = 0.85;
const INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "summary",
  "textarea",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
].join(",");
const ALWAYS_INERT_SURFACE_SELECTOR = [
  "dialog",
  "menu",
  "[popover]",
  "[aria-modal='true']",
  "[role='dialog']",
  "[role='menu']",
].join(",");
const STRUCTURAL_NAVIGATION_SELECTOR = "header,nav,[role='navigation']";
const UI_SURFACE_SEMANTICS =
  /(?:^|[-_\s])(dialog|dropdown|flyout|mega[-_\s]?menu|modal|popover)(?:$|[-_\s])/iu;
const HOVER_SOURCE_ATTRIBUTES = LAZY_SOURCE_ATTRIBUTES.filter(
  (attribute) => attribute !== "data-url",
);
const MEDIA_DECLARATION_ATTRIBUTES = ["data-kind", "data-media-kind", "data-type", "type"];

export interface PointerPosition {
  x: number;
  y: number;
}

export interface HoverTargetOptions {
  /** Also accept a plain link with no media, whose page may have a picture. */
  textLinks?: boolean;
}

export function findHoverTarget(
  eventTarget: EventTarget | null,
  pointer?: PointerPosition,
  options: HoverTargetOptions = {},
): Element | null {
  if (!(eventTarget instanceof Element)) return null;
  if (isInsideInteractiveUiSurface(eventTarget, pointer)) return null;

  const hitStack = collectHitStack(eventTarget, pointer);
  const paths = collectHitPaths(eventTarget, hitStack);

  // Prefer concrete media. Many galleries place a transparent link or
  // control layer above a nested image.
  const directMedia = paths.find(isMediaElement);
  if (directMedia) {
    if (pointer && isObscuredByForeground(directMedia, eventTarget, hitStack)) {
      return null;
    }
    return isActivelyPlayingMedia(directMedia) ? null : directMedia;
  }

  for (const element of paths) {
    const media = findBoundedMediaDescendant(element, pointer);
    if (media) {
      if (pointer && isObscuredByForeground(media, eventTarget, hitStack)) {
        return null;
      }
      return isActivelyPlayingMedia(media) ? null : media;
    }
  }

  for (const element of paths) {
    if (isSourceCandidate(element)) {
      return pointer && isObscuredByForeground(element, eventTarget, hitStack)
        ? null
        : element;
    }
  }

  for (const element of paths) {
    if (element instanceof HTMLAnchorElement && isSupportedMediaLink(element)) {
      return element;
    }
  }

  if (options.textLinks) {
    // Only the nearest link counts: an outer link around it is a different target.
    const link = paths.find((element) => element instanceof HTMLAnchorElement);
    if (
      link instanceof HTMLAnchorElement &&
      isEligibleTextLink(link) &&
      !(pointer && isObscuredByForeground(link, eventTarget, hitStack))
    ) {
      return link;
    }
  }

  return null;
}

/** True for an anchor found by `findHoverTarget` only because it is a plain link. */
export function isTextLinkTarget(target: Element): target is HTMLAnchorElement {
  return target instanceof HTMLAnchorElement && !isSupportedMediaLink(target);
}

export function isActivelyPlayingMedia(element: Element): boolean {
  return (
    element instanceof HTMLMediaElement &&
    !element.paused &&
    !element.ended
  );
}

function isInsideInteractiveUiSurface(
  eventTarget: Element,
  pointer?: PointerPosition,
): boolean {
  let current: Element | null = eventTarget;
  for (
    let depth = 0;
    current && depth < MAX_UI_SURFACE_ANCESTORS;
    depth += 1, current = parentAcrossShadow(current)
  ) {
    if (current.matches(ALWAYS_INERT_SURFACE_SELECTOR)) return true;
    // aria-label is deliberately ignored: sites copy image alt text into it.
    // SVG elements have a non-string className, so read the attribute instead.
    const semantics = [
      current.id,
      current.getAttribute("class") ?? "",
      current.getAttribute("role") ?? "",
    ].join(" ");
    if (UI_SURFACE_SEMANTICS.test(semantics)) return true;
    // A persistent header or navigation bar is page structure, not a transient
    // interaction surface. A nested flyout is caught before we reach this point.
    if (current.matches(STRUCTURAL_NAVIGATION_SELECTOR)) break;

    if (
      current !== eventTarget &&
      isPositionedOpaqueSurface(current) &&
      current.querySelectorAll(INTERACTIVE_SELECTOR).length >= MIN_UI_SURFACE_CONTROLS &&
      !isMediaDominatedSurface(current, pointer)
    ) {
      return true;
    }
    if (
      current instanceof HTMLBodyElement ||
      current instanceof HTMLHtmlElement
    ) {
      break;
    }
  }
  return false;
}

function isPositionedOpaqueSurface(element: Element): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style || !["absolute", "fixed", "sticky"].includes(style.position)) return false;
  return backgroundAlpha(style.backgroundColor) >= OPAQUE_LAYER_ALPHA;
}

function isMediaDominatedSurface(
  surface: Element,
  pointer?: PointerPosition,
): boolean {
  if (!pointer) return false;
  const media = findBoundedMediaDescendant(surface, pointer);
  if (!media) return false;

  const surfaceRect = surface.getBoundingClientRect();
  const mediaRect = media.getBoundingClientRect();
  const surfaceArea = surfaceRect.width * surfaceRect.height;
  if (surfaceArea <= 0) return false;
  return (
    intersectionArea(surfaceRect, mediaRect) / surfaceArea >=
    MIN_MEDIA_SURFACE_COVERAGE
  );
}

function isObscuredByForeground(
  candidate: Element,
  eventTarget: Element,
  hitStack: readonly Element[],
): boolean {
  const interactive = closestAcrossShadow(eventTarget, INTERACTIVE_SELECTOR);
  if (interactive && !isAssociatedSurface(interactive, candidate)) return true;

  const candidateIndex = hitStack.findIndex(
    (element) => element === candidate || containsAcrossShadow(element, candidate),
  );
  const foreground = candidateIndex >= 0
    ? hitStack.slice(0, candidateIndex)
    : hitStack;

  return foreground.some((element) => {
    if (
      element === candidate ||
      containsAcrossShadow(element, candidate) ||
      containsAcrossShadow(candidate, element) ||
      element instanceof HTMLBodyElement ||
      element instanceof HTMLHtmlElement
    ) {
      return false;
    }
    const foregroundInteractive = closestAcrossShadow(element, INTERACTIVE_SELECTOR);
    if (
      foregroundInteractive &&
      !isAssociatedSurface(foregroundInteractive, candidate)
    ) {
      return true;
    }
    if (isAssociatedSurface(element, candidate)) return false;
    return isBlockingSurface(element);
  });
}

function isAssociatedSurface(foreground: Element, candidate: Element): boolean {
  if (
    foreground === candidate ||
    containsAcrossShadow(foreground, candidate) ||
    containsAcrossShadow(candidate, foreground)
  ) {
    return true;
  }

  return (
    comparableAreaOverlap(foreground, candidate) >= MIN_ASSOCIATED_SURFACE_OVERLAP ||
    isStretchedLink(foreground, candidate)
  );
}

// A transparent link across a whole card leaves its picture visible and is the same
// click, unlike a smaller control sitting on top of the picture.
function isStretchedLink(foreground: Element, candidate: Element): boolean {
  return (
    foreground instanceof HTMLAnchorElement &&
    containsRect(foreground, candidate) &&
    !isBlockingSurface(foreground)
  );
}

function isBlockingSurface(element: Element): boolean {
  if (element.matches(ALWAYS_INERT_SURFACE_SELECTOR)) return true;
  const backgroundColor = element.ownerDocument.defaultView
    ?.getComputedStyle(element)
    .backgroundColor;
  return backgroundAlpha(backgroundColor) >= OPAQUE_LAYER_ALPHA;
}

function backgroundAlpha(value: string | undefined): number {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized || normalized === "transparent") return 0;
  const match = normalized.match(/^rgba?\((.*)\)$/u);
  if (!match) return 0;
  const components = match[1]?.split(",").map((component) => component.trim()) ?? [];
  if (normalized.startsWith("rgb(")) return 1;
  const alpha = Number.parseFloat(components[3] ?? "0");
  return Number.isFinite(alpha) ? alpha : 0;
}

function collectHitStack(
  eventTarget: Element,
  pointer?: PointerPosition,
): Element[] {
  return pointer
    ? elementsFromPointDeep(eventTarget.ownerDocument, pointer.x, pointer.y, MAX_POINT_STACK)
    : [];
}

function collectHitPaths(
  eventTarget: Element,
  hitStack: readonly Element[],
): Element[] {
  const roots: readonly Element[] = [eventTarget, ...hitStack];

  const paths: Element[] = [];
  const seen = new Set<Element>();
  for (const root of roots) {
    let current: Element | null = root;
    for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
      if (!seen.has(current)) {
        seen.add(current);
        paths.push(current);
      }
      current = parentAcrossShadow(current);
    }
  }
  return paths;
}

function findBoundedMediaDescendant(
  root: Element,
  pointer?: PointerPosition,
): Element | null {
  for (const element of walkBoundedDescendants(root, MEDIA_DESCENDANT_WALK)) {
    if (isMediaElement(element) && (!pointer || containsPoint(element, pointer))) {
      return element;
    }
  }
  return null;
}

function isMediaElement(element: Element): boolean {
  const isConcreteMedia =
    element instanceof HTMLImageElement ||
    element instanceof HTMLPictureElement ||
    element instanceof HTMLVideoElement;
  return isConcreteMedia && !isPageScaleDecoration(element);
}

function isSourceCandidate(element: Element): boolean {
  if (isPageScaleDecoration(element)) return false;
  if (
    HOVER_SOURCE_ATTRIBUTES.some((attribute) => element.hasAttribute(attribute))
  ) {
    return true;
  }
  return extractPreviewableBackgroundImageUrls(element).length > 0;
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
    current = parentAcrossShadow(current);
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

  let root = parentAcrossShadow(anchor);
  for (let depth = 0; root && depth < MAX_MEDIA_LINK_ANCESTORS; depth += 1) {
    for (const element of walkBoundedDescendants(root, MEDIA_DESCENDANT_WALK)) {
      if (
        element instanceof HTMLAnchorElement &&
        element !== anchor &&
        element.href === href &&
        findBoundedMediaDescendant(element)
      ) {
        return true;
      }
    }
    root = parentAcrossShadow(root);
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
