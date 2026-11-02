export interface DescendantWalkLimits {
  maxDepth: number;
  maxElements: number;
}

/** Media rendered at or below this size on both axes is treated as an icon or avatar. */
const SMALL_MEDIA_MAX_EDGE = 64;
const MIN_COMPARABLE_AREA_RATIO = 0.25;
const MAX_COMPARABLE_AREA_RATIO = 4;

/** Open shadow roots are searched this many levels deep when hit testing a point. */
const MAX_SHADOW_DEPTH = 4;

/**
 * The element's parent, stepping from the top of an open or closed shadow tree to
 * its host so that ancestor walks cross web component boundaries.
 */
export function parentAcrossShadow(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** `closest()`, continuing from the shadow host when the search leaves a shadow tree. */
export function closestAcrossShadow(element: Element, selector: string): Element | null {
  let current: Element | null = element;
  while (current) {
    const match = current.closest(selector);
    if (match) return match;
    const root: Node = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

/** `contains()`, also true when `node` sits in a shadow tree under `ancestor`. */
export function containsAcrossShadow(ancestor: Element, node: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (ancestor.contains(current)) return true;
    const root: Node = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}

/** Element children, preceded by those of an open shadow root, which are what renders. */
export function childElements(element: Element): Element[] {
  const shadow = element.shadowRoot;
  return shadow
    ? [...shadow.children, ...element.children]
    : Array.from(element.children);
}

/**
 * Like `elementsFromPoint`, but looks inside open shadow roots, which the document
 * reports only as their host. Elements of a shadow tree come just before their host.
 */
export function elementsFromPointDeep(
  doc: Document,
  x: number,
  y: number,
  limit: number,
): Element[] {
  const outer = doc.elementsFromPoint?.(x, y);
  if (!outer) return [];
  return expandShadowHosts(outer.slice(0, limit), x, y, MAX_SHADOW_DEPTH).slice(0, limit);
}

function expandShadowHosts(
  stack: readonly Element[],
  x: number,
  y: number,
  depth: number,
): Element[] {
  if (depth <= 0 || !stack.some((element) => element.shadowRoot)) return [...stack];
  const seen = new Set(stack);
  const result: Element[] = [];
  for (const element of stack) {
    const shadow = element.shadowRoot;
    if (shadow) {
      // Some engines report the whole stack from inside the root. Keep only what
      // lives in this tree and has not already been reported.
      const inner = shadow
        .elementsFromPoint(x, y)
        .filter((candidate) => !seen.has(candidate) && candidate.getRootNode() === shadow);
      for (const candidate of inner) seen.add(candidate);
      result.push(...expandShadowHosts(inner, x, y, depth - 1));
    }
    result.push(element);
  }
  return result;
}

/** The topmost element at a point within an open shadow root of `host`, if any. */
export function shadowElementAtPoint(host: Element, x: number, y: number): Element | null {
  let current = host;
  for (let depth = 0; depth < MAX_SHADOW_DEPTH; depth += 1) {
    const shadow = current.shadowRoot;
    const inner = shadow?.elementFromPoint(x, y);
    if (!inner || inner === current || inner.getRootNode() !== shadow) break;
    current = inner;
  }
  return current === host ? null : current;
}

export function* walkBoundedDescendants(
  root: Element,
  limits: DescendantWalkLimits,
): Generator<Element> {
  const queue = childElements(root).map((element) => ({ element, depth: 1 }));
  let cursor = 0;
  let visited = 0;

  while (cursor < queue.length && visited < limits.maxElements) {
    const entry = queue[cursor];
    cursor += 1;
    if (!entry) break;
    visited += 1;
    yield entry.element;
    if (entry.depth >= limits.maxDepth) continue;
    for (const child of childElements(entry.element)) {
      queue.push({ element: child, depth: entry.depth + 1 });
    }
  }
}

export function intersectionArea(left: DOMRect, right: DOMRect): number {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return width * height;
}

export function comparableAreaOverlap(left: Element, right: Element): number {
  const leftRect = left.getBoundingClientRect();
  const rightRect = right.getBoundingClientRect();
  const leftArea = leftRect.width * leftRect.height;
  const rightArea = rightRect.width * rightRect.height;
  if (leftArea <= 0 || rightArea <= 0) return 0;

  const areaRatio = leftArea / rightArea;
  if (
    areaRatio < MIN_COMPARABLE_AREA_RATIO ||
    areaRatio > MAX_COMPARABLE_AREA_RATIO
  ) return 0;
  return intersectionArea(leftRect, rightRect) / Math.min(leftArea, rightArea);
}

/** True when `outer` covers all of `inner`, give or take rounding. */
export function containsRect(outer: Element, inner: Element): boolean {
  const a = outer.getBoundingClientRect();
  const b = inner.getBoundingClientRect();
  return (
    a.left <= b.left + 1 &&
    a.top <= b.top + 1 &&
    a.right >= b.right - 1 &&
    a.bottom >= b.bottom - 1
  );
}

export function isSmallMedia(element: Element): boolean {
  const rectangle = element.getBoundingClientRect();
  return (
    rectangle.width > 0 &&
    rectangle.height > 0 &&
    rectangle.width <= SMALL_MEDIA_MAX_EDGE &&
    rectangle.height <= SMALL_MEDIA_MAX_EDGE
  );
}

/** True inside an iframe whose top document belongs to another origin. */
export function isCrossOriginFrame(): boolean {
  try {
    if (window.top === window) return false;
    // Reading a cross-origin location throws instead of returning a value.
    void window.top?.location.href;
    return false;
  } catch {
    return true;
  }
}

const EDITABLE_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);

/** True when a key event comes from a text-entry context or an IME composition. */
export function isEditingKeyEvent(event: KeyboardEvent): boolean {
  if (event.isComposing) return true;
  // composedPath sees through shadow roots, where event.target is only the host.
  const path = event.composedPath();
  const origin = path[0] ?? event.target;
  if (origin instanceof Element && origin.ownerDocument.designMode === "on") return true;
  if (origin instanceof HTMLElement && origin.isContentEditable) return true;
  return path.some(
    (node) =>
      node instanceof Element &&
      (EDITABLE_TAGS.has(node.tagName) || node.getAttribute("role")?.toLowerCase() === "textbox"),
  );
}
