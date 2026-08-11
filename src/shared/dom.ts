export interface DescendantWalkLimits {
  maxDepth: number;
  maxElements: number;
}

const MIN_COMPARABLE_AREA_RATIO = 0.25;
const MAX_COMPARABLE_AREA_RATIO = 4;

export function* walkBoundedDescendants(
  root: Element,
  limits: DescendantWalkLimits,
): Generator<Element> {
  const queue = Array.from(root.children, (element) => ({ element, depth: 1 }));
  let cursor = 0;
  let visited = 0;

  while (cursor < queue.length && visited < limits.maxElements) {
    const entry = queue[cursor];
    cursor += 1;
    if (!entry) break;
    visited += 1;
    yield entry.element;
    if (entry.depth >= limits.maxDepth) continue;
    for (const child of Array.from(entry.element.children)) {
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
