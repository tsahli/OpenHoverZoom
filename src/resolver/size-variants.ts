import type { LoadCheck, RenderedSize } from "./candidate";
import { isLargerThanRendered } from "./score-candidates";

/** Every guess is a request made on a hunch, so each image gets only a few. */
export const MAX_SIZE_VARIANTS = 4;

/** A larger rendition of the same picture keeps its shape, give or take rounding and a trim. */
export const RENDITION_SHAPE_TOLERANCE = 1.25;
/** A page's hero image is often a looser crop of the picture it shows. */
export const PAGE_IMAGE_SHAPE_TOLERANCE = 1.5;
/** Square thumbnails are usually centre crops of a wider or taller original. */
const SQUARE_CROP_SHAPE_TOLERANCE = 2;
const SQUARE_THUMBNAIL_TOLERANCE = 1.02;
const MIN_LARGER_AREA_RATIO = 1.1;

const LARGER_SIZE_WORDS = ["orig", "original", "full", "large"] as const;
const LARGER_DIRECTORIES = ["original", "originals", "large"] as const;

const SIZE_WORD = /^(?:thumb(?:nail)?s?|tiny|mini|small|medium|large|preview|low|lowres|xs|sm|md|lg)$/iu;
const DIMENSIONS = /^(?:\d{2,5}x\d{0,5}|x\d{2,5})$/iu;
const SIZE_PARAMETER = /^(?:w|h|s|sz|size|width|height|maxwidth|maxheight|resize)$/iu;
const SINGLE_LETTER_SIZE = /^[sml]$/iu;
const LISTED_DIMENSIONS = /^\d{2,5}(?:x|,|%2c)\d{0,5}$/iu;
const MIN_NUMERIC_SIZE = 16;
const NUMERIC_SIZE = /^\d{2,5}$/u;
const SIZE_FUNCTION_SUFFIX = /=(?:s[1-9]\d*|[wh][1-9]\d*(?:-[wh][1-9]\d*)?)(?:-[a-z0-9]+)*$/iu;
const FILE_NAME = /^(.*?)(\.[a-z0-9]{2,5})?$/iu;
const UNSCALABLE_FILE = /\.(?:svg|ico)$/iu;
const RENDITION_FILE_PREFIX = /(?:^|[-_])\d{2,5}px-/iu;
const THUMBNAIL_DIRECTORY = /^thumb(?:nail)?s?$/iu;
const SIZE_DIRECTORY =
  /^(?:thumb(?:nail)?s?|tiny|mini|small|medium|large|previews?|\d{2,5}x\d{0,5}|x\d{2,5}|\d{2,5}px|[whs]\d{2,5})$/iu;
const LABELLED_THUMBNAIL_DIRECTORY = /^(.+?)([-_])thumbnails?$/iu;
const TRANSFORM_DIRECTORY = /(?:^|,)[whs]_\d{2,5}(?:,|$)/iu;
const SCALE_DIRECTORY = /^s\d{2,5}$/iu;
const FILE_SIZE_PREFIX = /^(?:(?:thumb(?:nail)?s?|small|tn)[-_]|\d{2,5}px-)/iu;
const FILE_SIZE_SUFFIXES = [
  // photo._AC_UL320_ marks a server-side transform between dots and underscores.
  /\._[a-z0-9_,-]*\d[a-z0-9_,-]*_$/iu,
  /[-_.](?:\d{2,5}x\d{0,5}|x\d{2,5})(?:_crop_[a-z]+)?(?:@\d(?:\.\d)?x)?$/iu,
  /[-_.](?:thumb(?:nail)?s?|tiny|mini|small|medium|large|big|bigger|normal|scaled|preview|tn|xs|sm|md|lg)(?:@\d(?:\.\d)?x)?$/iu,
  /[-_.](?:\d{2,5}(?:w|px)|w\d{2,5})$/iu,
] as const;
const MAX_MARKER_PASSES = 2;

// Stems too common to say two URLs show the same picture. Shorter ones are
// already excluded by the length requirement.
const MIN_IDENTITY_LENGTH = 6;
const GENERIC_STEM =
  /^(?:images?|photos?|picture|pictures|thumbs?|thumbnail|thumbnails|original|medium|default|avatar|poster|banner|preview|profile|unnamed|download|\d{2,5}x\d{0,5})$/iu;
// One plain lowercase word, such as featured or uploads, is a name many pictures share.
const PLAIN_WORD = /^[a-z]+$/u;
const IDENTITY_PARAMETER = /^(?:id|image_id|photo_id|img|image|photo)$/iu;

interface UrlParts {
  origin: string;
  path: string;
  query: readonly string[];
}

type VariantRule = (parts: UrlParts) => UrlParts[];

// Ordered by how directly the URL states its size, so a query parameter is
// tried before a guess about what a directory name means.
const VARIANT_RULES: readonly VariantRule[] = [
  namedSizeParameter,
  numericSizeParameters,
  sizeFunctionSuffix,
  fileNameSizeMarker,
  sizeDirectory,
];

/**
 * Same-host URLs that may name a larger version of an image, likeliest first,
 * read only from size hints in the URL. A guess can be wrong, so nothing may be
 * shown from this list until it has loaded and passed `passesLoadCheck`.
 */
export function generateSizeVariants(value: string): string[] {
  const parts = parseUrl(value);
  if (!parts || UNSCALABLE_FILE.test(parts.path)) return [];

  const parentFile = renditionOfParentFile(parts);
  if (parentFile) return [formatUrl(parentFile)];

  // Hints can stack, so the first guess applies every rule's best reading at once.
  let combined = parts;
  for (const rule of VARIANT_RULES) combined = rule(combined)[0] ?? combined;
  const variants = [combined, ...VARIANT_RULES.flatMap((rule) => rule(parts))];

  const source = formatUrl(parts);
  const urls = new Set(variants.map(formatUrl));
  urls.delete(source);
  return [...urls].slice(0, MAX_SIZE_VARIANTS);
}

/** SVG and icon files draw at any size, so their natural size says nothing about detail. */
export function isUnscalableImage(value: string): boolean {
  const parts = parseUrl(value);
  return parts !== null && UNSCALABLE_FILE.test(parts.path);
}

/** Whether two URLs name one file and differ only in what they ask the server to do with it. */
export function isSameFile(left: string, right: string): boolean {
  const a = parseUrl(left);
  const b = parseUrl(right);
  return a !== null && b !== null && a.origin === b.origin && a.path === b.path;
}

/**
 * Whether loaded media may be shown. The thumbnail comparison is what keeps a
 * guess or an unrelated page image from replacing the picture being hovered.
 */
export function passesLoadCheck(actual: RenderedSize, check: LoadCheck): boolean {
  if (check.minEdge && Math.max(actual.width, actual.height) < check.minEdge) return false;
  if (check.rendered && !isLargerThanRendered(actual, check.rendered)) return false;
  const thumbnail = check.thumbnail;
  if (!thumbnail) return true;
  if (!thumbnail.width || !thumbnail.height || actual.width <= 0 || actual.height <= 0) {
    return false;
  }
  const isLarger =
    actual.width >= thumbnail.width &&
    actual.height >= thumbnail.height &&
    actual.width * actual.height >= thumbnail.width * thumbnail.height * MIN_LARGER_AREA_RATIO;
  if (!isLarger) return false;
  const thumbnailShape = thumbnail.width / thumbnail.height;
  const shapeDifference = shapeRatio(actual.width / actual.height, thumbnailShape);
  const tolerance = check.shapeTolerance ?? RENDITION_SHAPE_TOLERANCE;
  return shapeRatio(thumbnailShape, 1) <= SQUARE_THUMBNAIL_TOLERANCE
    ? shapeDifference <= Math.max(tolerance, SQUARE_CROP_SHAPE_TOLERANCE)
    : shapeDifference <= tolerance;
}

/**
 * The part of an image URL that names the picture rather than a rendition of it,
 * or null when the URL has nothing distinctive enough to compare.
 */
export function imageIdentity(value: string): string | null {
  const parts = parseUrl(value);
  if (!parts) return null;
  const segments = parts.path.split("/").filter(Boolean);
  const file = segments.at(-1);
  if (!file) return null;

  const parent = segments.at(-2);
  const name = parent && isRenditionOfParent(file, parent) ? parent : file;
  const stem = stripFileSizeMarkers(splitFileName(name.replace(SIZE_FUNCTION_SUFFIX, "")).stem);
  if (isDistinctiveStem(stem)) return stem.toLowerCase();

  // /image?id=abc and /media/abc/thumb.jpg name the picture outside the file name.
  for (const parameter of parts.query) {
    const { name: key, value: parameterValue } = splitParameter(parameter);
    if (IDENTITY_PARAMETER.test(key) && isDistinctiveStem(parameterValue)) {
      return parameterValue.toLowerCase();
    }
  }
  return parent && isDistinctiveStem(parent) ? parent.toLowerCase() : null;
}

function parseUrl(value: string): UrlParts | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return {
    origin: url.origin,
    path: url.pathname,
    query: url.search.slice(1).split("&").filter(Boolean),
  };
}

function formatUrl(parts: UrlParts): string {
  const query = parts.query.length > 0 ? `?${parts.query.join("&")}` : "";
  return `${parts.origin}${parts.path}${query}`;
}

function splitParameter(parameter: string): { name: string; value: string } {
  const separator = parameter.indexOf("=");
  return separator < 0
    ? { name: parameter, value: "" }
    : { name: parameter.slice(0, separator), value: parameter.slice(separator + 1) };
}

// ?name=small or ?name=360x360 selects a named rendition, so another name may
// select a larger one. Which names exist varies, hence several ordered attempts.
function namedSizeParameter(parts: UrlParts): UrlParts[] {
  const index = parts.query.findIndex((parameter) => {
    const { name, value } = splitParameter(parameter);
    if (SIZE_WORD.test(value)) return true;
    return SIZE_PARAMETER.test(name)
      ? SINGLE_LETTER_SIZE.test(value)
      : DIMENSIONS.test(value);
  });
  const parameter = parts.query[index];
  if (parameter === undefined) return [];
  const { name, value } = splitParameter(parameter);
  return LARGER_SIZE_WORDS.filter((word) => word !== value.toLowerCase()).map((word) => ({
    ...parts,
    query: parts.query.map((item, itemIndex) =>
      itemIndex === index ? `${name}=${word}` : item,
    ),
  }));
}

// ?w=200&h=200 scales the image on request, so leaving it out returns the source.
function numericSizeParameters(parts: UrlParts): UrlParts[] {
  const query = parts.query.filter((parameter) => !isNumericSizeParameter(parameter));
  return query.length === parts.query.length ? [] : [{ ...parts, query }];
}

function isNumericSizeParameter(parameter: string): boolean {
  const { name, value } = splitParameter(parameter);
  if (!SIZE_PARAMETER.test(name)) return false;
  if (NUMERIC_SIZE.test(value)) return Number(value) >= MIN_NUMERIC_SIZE;
  // A single letter with a non-number is more often a signature or hash than a size.
  return name.length > 1 && LISTED_DIMENSIONS.test(value);
}

// /photo=s120 and /photo=w200-h200-c ask for a size in the path. s0 asks for the source.
function sizeFunctionSuffix(parts: UrlParts): UrlParts[] {
  if (!SIZE_FUNCTION_SUFFIX.test(parts.path)) return [];
  return [
    { ...parts, path: parts.path.replace(SIZE_FUNCTION_SUFFIX, "=s0") },
    { ...parts, path: parts.path.replace(SIZE_FUNCTION_SUFFIX, "") },
  ];
}

// /thumb/a/a9/Example.jpg/120px-Example.jpg stores each rendition under its source
// file, which makes the source's location certain enough to be the only guess.
function renditionOfParentFile(parts: UrlParts): UrlParts | null {
  const segments = parts.path.split("/");
  const file = segments.at(-1);
  const parent = segments.at(-2);
  if (!file || !parent || !isRenditionOfParent(file, parent)) return null;
  const path = segments
    .slice(0, -1)
    .filter((segment) => !THUMBNAIL_DIRECTORY.test(segment))
    .join("/");
  return { ...parts, path };
}

function isRenditionOfParent(file: string, parent: string): boolean {
  return (
    /\.[a-z0-9]{2,5}$/iu.test(parent) &&
    RENDITION_FILE_PREFIX.test(file) &&
    file.includes(parent)
  );
}

function fileNameSizeMarker(parts: UrlParts): UrlParts[] {
  const separator = parts.path.lastIndexOf("/") + 1;
  const directory = parts.path.slice(0, separator);
  const { stem, extension } = splitFileName(parts.path.slice(separator));
  if (!stem) return [];

  // /media/abc/thumb.jpg: the whole name is the size, so a sibling may be larger.
  if (SIZE_WORD.test(stem) || DIMENSIONS.test(stem)) {
    return LARGER_SIZE_WORDS.filter((word) => word !== stem.toLowerCase()).map((word) => ({
      ...parts,
      path: `${directory}${word}${extension}`,
    }));
  }
  const stripped = stripFileSizeMarkers(stem);
  return stripped && stripped !== stem
    ? [{ ...parts, path: `${directory}${stripped}${extension}` }]
    : [];
}

function splitFileName(file: string): { stem: string; extension: string } {
  const match = FILE_NAME.exec(file);
  return { stem: match?.[1] ?? file, extension: match?.[2] ?? "" };
}

function stripFileSizeMarkers(stem: string): string {
  let current = stem;
  for (let pass = 0; pass < MAX_MARKER_PASSES; pass += 1) {
    const next = FILE_SIZE_SUFFIXES.reduce(
      (value, marker) => value.replace(marker, ""),
      current,
    ).replace(FILE_SIZE_PREFIX, "");
    if (next === current || !next) break;
    current = next;
  }
  return current;
}

function sizeDirectory(parts: UrlParts): UrlParts[] {
  const segments = parts.path.split("/");
  // The last segment is the file itself, and the first is empty before the leading slash.
  for (let index = segments.length - 2; index > 0; index -= 1) {
    const segment = segments[index] ?? "";
    if (TRANSFORM_DIRECTORY.test(segment)) {
      return [{ ...parts, path: replaceSegment(segments, index, null) }];
    }
    // /img/feed_thumbnail/ names what it is for as well as its size.
    const labelled = LABELLED_THUMBNAIL_DIRECTORY.exec(segment);
    if (labelled) {
      const [, label = "", separator = ""] = labelled;
      return [`${label}${separator}fullsize`, label].map((replacement) => ({
        ...parts,
        path: replaceSegment(segments, index, replacement),
      }));
    }
    if (!SIZE_DIRECTORY.test(segment)) continue;
    const replacements: readonly (string | null)[] = SCALE_DIRECTORY.test(segment)
      ? ["s0", null]
      : [null, ...LARGER_DIRECTORIES.filter((name) => name !== segment.toLowerCase())];
    return replacements.map((replacement) => ({
      ...parts,
      path: replaceSegment(segments, index, replacement),
    }));
  }
  return [];
}

function replaceSegment(
  segments: readonly string[],
  index: number,
  replacement: string | null,
): string {
  return segments
    .flatMap((segment, position) =>
      position !== index ? [segment] : replacement === null ? [] : [replacement],
    )
    .join("/");
}

function shapeRatio(left: number, right: number): number {
  return Math.max(left, right) / Math.min(left, right);
}

function isDistinctiveStem(stem: string): boolean {
  return stem.length >= MIN_IDENTITY_LENGTH && !GENERIC_STEM.test(stem) && !PLAIN_WORD.test(stem);
}
