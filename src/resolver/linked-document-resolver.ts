import { requestDocument } from "../content/fetch-client";
import { LruCache } from "../shared/lru-cache";
import type { MediaCandidate } from "./candidate";
import { mediaKindFromContentType } from "./media-type";
import { extractMetadataCandidates } from "./metadata";
import { isRemoteUrl } from "./url";

const POSITIVE_TTL_MILLISECONDS = 5 * 60_000;
const NEGATIVE_TTL_MILLISECONDS = 60_000;
const cache = new LruCache<string, LinkedDocument>(100);

export interface LinkedDocument {
  requestedUrl: string;
  /** Where redirects ended up, which says whether the page is still about the item. */
  finalUrl: string;
  /** The link answered with media rather than a page describing some. */
  directMedia: boolean;
  candidates: MediaCandidate[];
}

export async function resolveLinkedDocument(
  anchorUrl: string,
  signal: AbortSignal,
): Promise<LinkedDocument> {
  const empty: LinkedDocument = {
    requestedUrl: anchorUrl,
    finalUrl: anchorUrl,
    directMedia: false,
    candidates: [],
  };
  if (!isRemoteUrl(anchorUrl)) return empty;
  const cached = cache.get(anchorUrl);
  if (cached !== undefined) return cached;

  const response = await requestDocument(anchorUrl, signal);
  // An error page describes the error, even when it carries the site's usual metadata.
  if (!response || response.status >= 400) {
    cache.set(anchorUrl, empty, NEGATIVE_TTL_MILLISECONDS);
    return empty;
  }

  const directKind = mediaKindFromContentType(response.contentType);
  const candidates = directKind
    ? [
        {
          url: response.finalUrl,
          kind: directKind,
          source: "document-metadata" as const,
          confidence: 99,
          quality: "original" as const,
        },
      ]
    : response.body
      ? extractMetadataCandidates(response.body, response.finalUrl)
      : [];
  const document: LinkedDocument = {
    requestedUrl: anchorUrl,
    finalUrl: response.finalUrl,
    directMedia: directKind !== null,
    candidates,
  };
  cache.set(
    anchorUrl,
    document,
    candidates.length > 0 ? POSITIVE_TTL_MILLISECONDS : NEGATIVE_TTL_MILLISECONDS,
  );
  return document;
}
