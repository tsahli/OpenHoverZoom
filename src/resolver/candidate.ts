export type MediaKind = "image" | "video" | "audio";

/** How strongly the page identifies this URL as a high-quality rendition. */
export type CandidateQuality = "thumbnail" | "display" | "responsive" | "original";

export type CandidateSource =
  | "current-src"
  | "image-src"
  | "srcset"
  | "picture"
  | "background-image"
  | "data-attribute"
  | "direct-link"
  | "video-poster"
  | "video-source"
  | "document-metadata"
  | "document-original-link"
  | "url-guess";

export interface MediaCandidate {
  url: string;
  kind: MediaKind;
  source: CandidateSource;
  confidence: number;
  quality?: CandidateQuality;
  /** Detail page that may expose a better version of this gallery item. */
  linkedPageUrl?: string;
  width?: number;
  height?: number;
  caption?: string;
  gallery?: MediaCandidate[];
  galleryIndex?: number;
  /** The rendition the page displays for this gallery item. */
  thumbnail?: ThumbnailReference;
  /** What this candidate must prove once loaded before it may be shown. */
  check?: LoadCheck;
}

export interface RenderedSize {
  width: number;
  height: number;
}

/** An image on the page. Its size is absent until known, and is then read by loading it. */
export interface ThumbnailReference {
  url: string;
  width?: number;
  height?: number;
}

export interface LoadCheck {
  /** Must load larger than this image, with a similar aspect ratio. */
  thumbnail?: ThumbnailReference;
  /** The largest accepted ratio between the two aspect ratios. */
  shapeTolerance?: number;
  /** Must load larger than this. Present only when same-size previews are off. */
  rendered?: RenderedSize;
  /** Its longest side must be at least this many pixels once loaded. */
  minEdge?: number;
}

/** Further attempts that are costly to find, so they are only looked for if needed. */
export interface DeferredAttempts {
  expand(signal: AbortSignal): Promise<PreviewAttempt[]>;
}

export type PreviewAttempt = MediaCandidate | DeferredAttempts;

/** The image the page has already loaded, so showing it takes no waiting. */
export function isDisplayedSource(candidate: Pick<MediaCandidate, "source">): boolean {
  return candidate.source === "current-src" || candidate.source === "image-src";
}

export function stripGallery(candidate: MediaCandidate): MediaCandidate {
  const { gallery: _gallery, galleryIndex: _galleryIndex, ...item } = candidate;
  return item;
}
