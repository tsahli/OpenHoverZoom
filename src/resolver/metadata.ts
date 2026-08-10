import type {
  CandidateQuality,
  MediaCandidate,
  MediaKind,
} from "./candidate";
import { mediaKindFromUrl } from "./media-type";
import { selectLargestSrcset } from "./srcset";
import { normalizeUrl } from "./url";

const JSON_LD_KEYS = new Set(["image", "contentUrl", "thumbnailUrl"]);
const MAX_JSON_LD_SCRIPTS = 20;
const MAX_JSON_LD_DEPTH = 8;
const MAX_JSON_LD_VALUES = 1_000;
const FULL_SIZE_ATTRIBUTES = ["data-original", "data-full", "data-full-src"] as const;
const LAZY_SRCSET_ATTRIBUTES = ["data-srcset", "data-lazy-srcset"] as const;
const PRIMARY_MEDIA_KEYS = new Set(["audio", "image", "video"]);
const ORIGINAL_MEDIA_LINK = /\boriginal(?:\s+(?:file|image|media|resolution|size))?\b/iu;

export function extractMetadataCandidates(
  html: string,
  documentUrl: string,
): MediaCandidate[] {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const caption = extractCaption(parsed);
  const candidates: MediaCandidate[] = [];
  const structuredGalleryUrls: string[] = [];
  let openGraphImage: MediaCandidate | null = null;
  let openGraphVideo: MediaCandidate | null = null;
  let twitterImage: MediaCandidate | null = null;

  for (const meta of parsed.querySelectorAll("meta[property], meta[name]")) {
    const key = (meta.getAttribute("property") ?? meta.getAttribute("name") ?? "").toLowerCase();
    const content = meta.getAttribute("content");
    if (!content) continue;
    if (key === "og:image" || key === "og:image:url" || key === "og:image:secure_url") {
      openGraphImage = addCandidate(
        candidates,
        content,
        documentUrl,
        "image",
        98,
        "responsive",
        caption,
      );
    } else if (key === "og:image:width") {
      setDimension(openGraphImage, "width", content);
    } else if (key === "og:image:height") {
      setDimension(openGraphImage, "height", content);
    } else if (key === "twitter:image" || key === "twitter:image:src") {
      twitterImage = addCandidate(
        candidates,
        content,
        documentUrl,
        "image",
        95,
        "responsive",
        caption,
      );
    } else if (key === "twitter:image:width") {
      setDimension(twitterImage, "width", content);
    } else if (key === "twitter:image:height") {
      setDimension(twitterImage, "height", content);
    } else if (key === "og:video" || key === "og:video:secure_url") {
      openGraphVideo = addCandidate(
        candidates,
        content,
        documentUrl,
        "video",
        96,
        "responsive",
        caption,
      );
    } else if (key === "og:video:width") {
      setDimension(openGraphVideo, "width", content);
    } else if (key === "og:video:height") {
      setDimension(openGraphVideo, "height", content);
    } else if (key === "og:audio" || key === "og:audio:secure_url") {
      addCandidate(candidates, content, documentUrl, "audio", 96, "responsive", caption);
    }
  }

  for (const video of parsed.querySelectorAll("video")) {
    addHtmlMediaCandidates(candidates, video, documentUrl, "video", caption);
  }
  for (const audio of parsed.querySelectorAll("audio")) {
    addHtmlMediaCandidates(candidates, audio, documentUrl, "audio", caption);
  }

  for (const link of parsed.querySelectorAll("link[href]")) {
    const relation = new Set((link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/u));
    const href = link.getAttribute("href");
    if (!href) continue;
    if (relation.has("image_src")) {
      addCandidate(candidates, href, documentUrl, "image", 93, "responsive", caption);
    } else if (relation.has("preload") && link.getAttribute("as")?.toLowerCase() === "image") {
      const largest = selectLargestSrcset(link.getAttribute("imagesrcset") ?? "");
      addCandidate(
        candidates,
        largest?.url ?? href,
        documentUrl,
        "image",
        82,
        "responsive",
        caption,
        largest?.width,
      );
    }
  }

  for (const element of parsed.querySelectorAll("img[srcset], source[srcset]")) {
    const largest = selectLargestSrcset(element.getAttribute("srcset") ?? "");
    if (!largest) continue;
    addCandidate(
      candidates,
      largest.url,
      documentUrl,
      "image",
      78,
      "responsive",
      caption,
      largest.width,
    );
  }

  for (const attribute of LAZY_SRCSET_ATTRIBUTES) {
    for (const element of parsed.querySelectorAll(`[${attribute}]`)) {
      const largest = selectLargestSrcset(element.getAttribute(attribute) ?? "");
      if (!largest) continue;
      addCandidate(
        candidates,
        largest.url,
        documentUrl,
        "image",
        88,
        "responsive",
        caption,
        largest.width,
      );
    }
  }

  for (const attribute of FULL_SIZE_ATTRIBUTES) {
    for (const element of parsed.querySelectorAll(`[${attribute}]`)) {
      const value = element.getAttribute(attribute);
      if (value) {
        // These attributes can appear on unrelated recommendations or avatars.
        // Keep them as high-resolution hints without letting them outrank the
        // linked document's primary metadata solely because of their name.
        addCandidate(candidates, value, documentUrl, "image", 92, "responsive", caption);
      }
    }
  }

  for (const element of parsed.querySelectorAll("a[download][href]")) {
    const href = element.getAttribute("href");
    if (!href) continue;
    const url = normalizeUrl(href, documentUrl);
    if (!url) continue;
    const kind = mediaKindFromUrl(url);
    if (kind) addCandidate(candidates, url, documentUrl, kind, 94, "responsive", caption);
  }

  for (const element of parsed.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (!isExplicitOriginalMediaLink(element)) continue;
    const href = element.getAttribute("href");
    if (!href) continue;
    const url = normalizeUrl(href, documentUrl);
    if (!url) continue;
    const kind = mediaKindFromUrl(url);
    if (!kind) continue;
    candidates.push({
      url,
      kind,
      source: "document-original-link",
      confidence: 99,
      quality: "original",
      ...(caption ? { caption } : {}),
    });
  }

  const scripts = Array.from(parsed.querySelectorAll('script[type="application/ld+json"]')).slice(
    0,
    MAX_JSON_LD_SCRIPTS,
  );
  for (const script of scripts) {
    const source = script.textContent;
    if (!source) continue;
    try {
      const value: unknown = JSON.parse(source);
      for (const item of collectJsonLdMedia(value)) {
        if (item.key === "contentUrl" && !item.primaryMedia) continue;
        const countBefore = candidates.length;
        addCandidate(
          candidates,
          item.url,
          documentUrl,
          item.key === "thumbnailUrl" || item.key === "image"
            ? "image"
            : mediaKindFromUrl(item.url) ?? item.kind ?? "image",
          item.key === "thumbnailUrl" ? 76 : item.key === "contentUrl" ? 96 : 86,
          item.key === "thumbnailUrl"
            ? "thumbnail"
            : item.key === "contentUrl"
              ? "original"
              : "responsive",
          caption,
          item.width,
          item.height,
        );
        const added = candidates.length > countBefore ? candidates.at(-1) : undefined;
        if (added && item.key !== "thumbnailUrl") structuredGalleryUrls.push(added.url);
      }
    } catch {
      // Malformed metadata fails closed and does not prevent other extraction.
    }
  }

  return attachStructuredGallery(deduplicate(candidates), structuredGalleryUrls);
}

interface CollectedJsonLdMedia {
  key: string;
  url: string;
  primaryMedia: boolean;
  kind?: MediaKind;
  width?: number;
  height?: number;
}

function collectJsonLdMedia(root: unknown): CollectedJsonLdMedia[] {
  const results: CollectedJsonLdMedia[] = [];
  const stack: Array<{
    depth: number;
    key: string;
    value: unknown;
    primaryMedia: boolean;
    kind?: MediaKind;
    width?: number;
    height?: number;
  }> = [
    { depth: 0, key: "", value: root, primaryMedia: false },
  ];
  let visited = 0;

  while (stack.length > 0 && visited < MAX_JSON_LD_VALUES) {
    const item = stack.pop();
    if (!item) break;
    visited += 1;
    if (item.depth > MAX_JSON_LD_DEPTH) continue;

    if (typeof item.value === "string") {
      if (JSON_LD_KEYS.has(item.key)) {
        results.push({
          key: item.key,
          url: item.value,
          primaryMedia: item.primaryMedia,
          ...(item.kind ? { kind: item.kind } : {}),
          ...(item.width ? { width: item.width } : {}),
          ...(item.height ? { height: item.height } : {}),
        });
      }
      continue;
    }
    if (Array.isArray(item.value)) {
      for (const value of item.value) {
        stack.push({
          depth: item.depth + 1,
          key: item.key,
          value,
          primaryMedia: item.primaryMedia,
          ...(item.kind ? { kind: item.kind } : {}),
          ...(item.width ? { width: item.width } : {}),
          ...(item.height ? { height: item.height } : {}),
        });
      }
      continue;
    }
    if (typeof item.value !== "object" || item.value === null) continue;
    const record = item.value as Record<string, unknown>;
    const width = jsonLdDimension(record.width) ?? item.width;
    const height = jsonLdDimension(record.height) ?? item.height;
    const types = jsonLdTypes(record["@type"]);
    const isImageObject = types.some(
      (type) => type === "ImageObject" || /[/#]ImageObject$/u.test(type),
    );
    const isVideoObject = types.some(
      (type) => type === "VideoObject" || /[/#]VideoObject$/u.test(type),
    );
    const isAudioObject = types.some(
      (type) => type === "AudioObject" || /[/#]AudioObject$/u.test(type),
    );
    const isMediaObject = types.some(
      (type) =>
        /^(?:AudioObject|ImageObject|MediaObject|VideoObject)$/u.test(type) ||
        /[/#](?:AudioObject|ImageObject|MediaObject|VideoObject)$/u.test(type),
    );
    const kind: MediaKind | undefined = isVideoObject
      ? "video"
      : isAudioObject
        ? "audio"
        : isImageObject
          ? "image"
          : item.kind;
    const primaryMedia =
      item.primaryMedia || (item.key === "" && isMediaObject);
    for (const [key, value] of Object.entries(item.value)) {
      const mediaKey = key === "url" && isImageObject && primaryMedia ? "contentUrl" : key;
      if (typeof value === "object" || JSON_LD_KEYS.has(mediaKey)) {
        stack.push({
          depth: item.depth + 1,
          key: mediaKey,
          value,
          primaryMedia: primaryMedia || PRIMARY_MEDIA_KEYS.has(key),
          ...(kind ? { kind } : {}),
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
        });
      }
    }
  }
  return results;
}

function addHtmlMediaCandidates(
  candidates: MediaCandidate[],
  media: HTMLMediaElement,
  documentUrl: string,
  kind: "video" | "audio",
  caption: string | undefined,
): void {
  const width = kind === "video" ? elementDimension(media, "width") : undefined;
  const height = kind === "video" ? elementDimension(media, "height") : undefined;
  const src = media.getAttribute("src");
  if (src) {
    addCandidate(
      candidates,
      src,
      documentUrl,
      kind,
      86,
      "display",
      caption,
      width,
      height,
    );
  }
  for (const source of media.querySelectorAll(":scope > source[src]")) {
    addCandidate(
      candidates,
      source.getAttribute("src") ?? "",
      documentUrl,
      kind,
      84,
      "display",
      caption,
      kind === "video" ? elementDimension(source, "width") ?? width : undefined,
      kind === "video" ? elementDimension(source, "height") ?? height : undefined,
    );
  }
}

function elementDimension(element: Element, dimension: "width" | "height"): number | undefined {
  for (const attribute of [`data-${dimension}`, dimension]) {
    const value = element.getAttribute(attribute);
    if (value) {
      const parsed = positiveDimension(value);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

function addCandidate(
  candidates: MediaCandidate[],
  value: string,
  baseUrl: string,
  kind: MediaKind,
  confidence: number,
  quality: CandidateQuality,
  caption: string | undefined,
  width?: number,
  height?: number,
): MediaCandidate | null {
  const url = normalizeUrl(value, baseUrl);
  if (!url) return null;
  const candidate: MediaCandidate = {
    url,
    kind,
    source: "document-metadata",
    confidence,
    quality,
    ...(caption ? { caption } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  };
  candidates.push(candidate);
  return candidate;
}

function setDimension(
  candidate: MediaCandidate | null,
  key: "width" | "height",
  value: string,
): void {
  const dimension = positiveDimension(value);
  if (candidate && dimension) candidate[key] = dimension;
}

function positiveDimension(value: string | number): number | undefined {
  const dimension = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(dimension) && dimension > 0 ? dimension : undefined;
}

function jsonLdDimension(value: unknown): number | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return positiveDimension(value);
  }
  if (typeof value !== "object" || value === null || !("value" in value)) return undefined;
  const nested = (value as { value?: unknown }).value;
  return typeof nested === "string" || typeof nested === "number"
    ? positiveDimension(nested)
    : undefined;
}

function jsonLdTypes(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isExplicitOriginalMediaLink(element: HTMLAnchorElement): boolean {
  const relation = new Set((element.getAttribute("rel") ?? "").toLowerCase().split(/\s+/u));
  if (relation.has("enclosure") || relation.has("original")) return true;
  const label = [
    element.textContent ?? "",
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
  ].join(" ");
  return ORIGINAL_MEDIA_LINK.test(label);
}

function extractCaption(document: Document): string | undefined {
  for (const meta of document.querySelectorAll("meta[property], meta[name]")) {
    const key = (meta.getAttribute("property") ?? meta.getAttribute("name") ?? "").toLowerCase();
    if (key === "og:title" || key === "twitter:title") {
      const content = meta.getAttribute("content")?.trim();
      if (content) return content.slice(0, 500);
    }
  }
  const title = document.title.trim();
  return title ? title.slice(0, 500) : undefined;
}

function deduplicate(candidates: readonly MediaCandidate[]): MediaCandidate[] {
  const byUrl = new Map<string, MediaCandidate>();
  for (const candidate of candidates) {
    const existing = byUrl.get(candidate.url);
    if (!existing) {
      byUrl.set(candidate.url, candidate);
      continue;
    }
    if (candidate.width && (!existing.width || candidate.width > existing.width)) {
      existing.width = candidate.width;
    }
    if (candidate.height && (!existing.height || candidate.height > existing.height)) {
      existing.height = candidate.height;
    }
    if (
      candidate.quality &&
      qualityRank(candidate.quality) > qualityRank(existing.quality)
    ) {
      existing.quality = candidate.quality;
    }
    if (candidate.source === "document-original-link") {
      existing.source = candidate.source;
    }
    existing.confidence = Math.max(existing.confidence, candidate.confidence);
  }
  return [...byUrl.values()];
}

function qualityRank(quality: CandidateQuality | undefined): number {
  if (quality === "original") return 3;
  if (quality === "responsive") return 2;
  if (quality === "display") return 1;
  return 0;
}

function attachStructuredGallery(
  candidates: MediaCandidate[],
  collectedUrls: readonly string[],
): MediaCandidate[] {
  const orderedUrls = [...new Set(collectedUrls)].reverse();
  if (orderedUrls.length < 2) return candidates;
  const byUrl = new Map(candidates.map((candidate) => [candidate.url, candidate]));
  const gallery = orderedUrls
    .map((url) => byUrl.get(url))
    .filter((candidate): candidate is MediaCandidate => candidate !== undefined);
  if (gallery.length < 2) return candidates;

  const selected = candidates[0];
  if (!selected) return candidates;
  let galleryIndex = gallery.findIndex((candidate) => candidate.url === selected.url);
  if (galleryIndex < 0) {
    gallery.unshift(selected);
    galleryIndex = 0;
  }
  candidates[0] = { ...selected, gallery, galleryIndex };
  return candidates;
}
