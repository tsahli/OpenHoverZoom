export function extractBackgroundImageUrls(value: string): string[] {
  const urls: string[] = [];
  const expression = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/giu;
  for (const match of value.matchAll(expression)) {
    const url = match[1] ?? match[2] ?? match[3]?.trim();
    if (url) urls.push(url);
  }
  return urls;
}

const EXPLICIT_MEDIA_SELECTOR = [
  "a[href]",
  "button",
  "figure",
  "video[controls]",
  "[role='img']",
  "[itemprop~='image']",
  "[itemtype*='ImageObject']",
].join(",");
const LARGE_SURFACE_MIN_AREA_COVERAGE = 0.3;
const LARGE_SURFACE_MIN_AXIS_COVERAGE = 0.7;

/**
 * Returns CSS background URLs that behave like a single media item rather
 * than page decoration. Repeating tiles and page-scale decorative surfaces
 * are especially prone to producing distracting previews.
 */
export function extractPreviewableBackgroundImageUrls(element: Element): string[] {
  const view = element.ownerDocument.defaultView;
  if (!view || element instanceof HTMLBodyElement || element instanceof HTMLHtmlElement) {
    return [];
  }

  const style = view.getComputedStyle(element);
  const imageLayers = splitCssList(style.backgroundImage);
  if (imageLayers.length === 0) return [];
  const repeatLayers = splitCssList(style.backgroundRepeat);

  const urls = imageLayers.flatMap((layer, index) => {
    const repeat = repeatLayers[index % repeatLayers.length] ?? "repeat";
    return isTiledRepeat(repeat) ? [] : extractBackgroundImageUrls(layer);
  });
  if (urls.length === 0 || isPageScaleDecoration(element)) return [];
  return urls;
}

function isTiledRepeat(value: string): boolean {
  const axes = value.trim().toLowerCase().split(/\s+/u);
  return axes.length === 0 || axes.some((axis) => axis !== "no-repeat");
}

/** Returns whether a large surface behaves like ambient page decoration. */
export function isPageScaleDecoration(element: Element): boolean {
  if (element.closest(EXPLICIT_MEDIA_SELECTOR)) return false;

  if (
    element instanceof HTMLImageElement &&
    element.alt.trim().length > 0
  ) {
    return false;
  }
  if (
    element instanceof HTMLPictureElement &&
    [...element.querySelectorAll("img")].some((image) => image.alt.trim().length > 0)
  ) {
    return false;
  }

  const view = element.ownerDocument.defaultView;
  if (!view) return false;

  const rectangle = element.getBoundingClientRect();
  if (
    rectangle.width <= 0 ||
    rectangle.height <= 0 ||
    view.innerWidth <= 0 ||
    view.innerHeight <= 0
  ) {
    return false;
  }

  const widthCoverage = Math.min(rectangle.width, view.innerWidth) / view.innerWidth;
  const heightCoverage = Math.min(rectangle.height, view.innerHeight) / view.innerHeight;
  const areaCoverage = widthCoverage * heightCoverage;
  return (
    areaCoverage >= LARGE_SURFACE_MIN_AREA_COVERAGE &&
    Math.max(widthCoverage, heightCoverage) >= LARGE_SURFACE_MIN_AXIS_COVERAGE
  );
}

function splitCssList(value: string): string[] {
  const items: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      const item = value.slice(start, index).trim();
      if (item) items.push(item);
      start = index + 1;
    }
  }

  const item = value.slice(start).trim();
  if (item && item !== "none") items.push(item);
  return items;
}
