import { requestDocument } from "../content/fetch-client";
import { LruCache } from "../shared/lru-cache";
import type { MediaCandidate } from "./candidate";
import { mediaKindFromContentType } from "./media-type";
import { extractMetadataCandidates } from "./metadata";
import { isRemoteUrl } from "./url";

const POSITIVE_TTL_MILLISECONDS = 5 * 60_000;
const NEGATIVE_TTL_MILLISECONDS = 60_000;
const cache = new LruCache<string, MediaCandidate[] | null>(100);

export async function resolveLinkedDocument(
  anchorUrl: string,
  signal: AbortSignal,
): Promise<MediaCandidate[]> {
  if (!isRemoteUrl(anchorUrl)) return [];
  const cached = cache.get(anchorUrl);
  if (cached !== undefined) return cached ?? [];

  const response = await requestDocument(anchorUrl, signal);
  if (!response) {
    cache.set(anchorUrl, null, NEGATIVE_TTL_MILLISECONDS);
    return [];
  }

  const directKind = mediaKindFromContentType(response.contentType);
  const candidates = directKind
    ? [
        {
          url: response.finalUrl,
          kind: directKind,
          source: "document-metadata" as const,
          confidence: 99,
        },
      ]
    : response.body
      ? extractMetadataCandidates(response.body, response.finalUrl)
      : [];
  cache.set(
    anchorUrl,
    candidates.length > 0 ? candidates : null,
    candidates.length > 0 ? POSITIVE_TTL_MILLISECONDS : NEGATIVE_TTL_MILLISECONDS,
  );
  return candidates;
}
