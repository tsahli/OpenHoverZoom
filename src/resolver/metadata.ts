import type { MediaCandidate, MediaKind } from "./candidate";
import { mediaKindFromUrl } from "./media-type";
import { selectLargestSrcset } from "./srcset";
import { normalizeUrl } from "./url";

const JSON_LD_KEYS = new Set(["image", "contentUrl", "thumbnailUrl"]);
const MAX_JSON_LD_SCRIPTS = 20;
const MAX_JSON_LD_DEPTH = 8;
const MAX_JSON_LD_VALUES = 1_000;

export function extractMetadataCandidates(
  html: string,
  documentUrl: string,
): MediaCandidate[] {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const caption = extractCaption(parsed);
  const candidates: MediaCandidate[] = [];
  const structuredGalleryUrls: string[] = [];

  for (const meta of parsed.querySelectorAll("meta[property], meta[name]")) {
    const key = (meta.getAttribute("property") ?? meta.getAttribute("name") ?? "").toLowerCase();
    const content = meta.getAttribute("content");
    if (!content) continue;
    if (key === "og:image" || key === "og:image:secure_url") {
      addCandidate(candidates, content, documentUrl, "image", 98, caption);
    } else if (key === "twitter:image" || key === "twitter:image:src") {
      addCandidate(candidates, content, documentUrl, "image", 95, caption);
    } else if (key === "og:video" || key === "og:video:secure_url") {
      addCandidate(candidates, content, documentUrl, "video", 96, caption);
    }
  }

  for (const link of parsed.querySelectorAll("link[href]")) {
    const relation = new Set((link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/u));
    const href = link.getAttribute("href");
    if (!href) continue;
    if (relation.has("image_src")) {
      addCandidate(candidates, href, documentUrl, "image", 93, caption);
    } else if (relation.has("preload") && link.getAttribute("as")?.toLowerCase() === "image") {
      addCandidate(candidates, href, documentUrl, "image", 82, caption);
    }
  }

  for (const element of parsed.querySelectorAll("img[srcset], source[srcset]")) {
    const largest = selectLargestSrcset(element.getAttribute("srcset") ?? "");
    if (!largest) continue;
    addCandidate(candidates, largest.url, documentUrl, "image", 78, caption, largest.width);
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
        const countBefore = candidates.length;
        addCandidate(
          candidates,
          item.url,
          documentUrl,
          mediaKindFromUrl(item.url) ?? "image",
          item.key === "thumbnailUrl" ? 76 : 86,
          caption,
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

function collectJsonLdMedia(root: unknown): Array<{ key: string; url: string }> {
  const results: Array<{ key: string; url: string }> = [];
  const stack: Array<{ depth: number; key: string; value: unknown }> = [
    { depth: 0, key: "", value: root },
  ];
  let visited = 0;

  while (stack.length > 0 && visited < MAX_JSON_LD_VALUES) {
    const item = stack.pop();
    if (!item) break;
    visited += 1;
    if (item.depth > MAX_JSON_LD_DEPTH) continue;

    if (typeof item.value === "string") {
      if (JSON_LD_KEYS.has(item.key)) results.push({ key: item.key, url: item.value });
      continue;
    }
    if (Array.isArray(item.value)) {
      for (const value of item.value) {
        stack.push({ depth: item.depth + 1, key: item.key, value });
      }
      continue;
    }
    if (typeof item.value !== "object" || item.value === null) continue;
    for (const [key, value] of Object.entries(item.value)) {
      if (typeof value === "object" || JSON_LD_KEYS.has(key)) {
        stack.push({ depth: item.depth + 1, key, value });
      }
    }
  }
  return results;
}

function addCandidate(
  candidates: MediaCandidate[],
  value: string,
  baseUrl: string,
  kind: MediaKind,
  confidence: number,
  caption: string | undefined,
  width?: number,
): void {
  const url = normalizeUrl(value, baseUrl);
  if (!url) return;
  candidates.push({
    url,
    kind,
    source: "document-metadata",
    confidence,
    ...(caption ? { caption } : {}),
    ...(width ? { width } : {}),
  });
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
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
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
