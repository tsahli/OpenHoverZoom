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
  | "rewrite-rule"
  | "adapter";

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
}

export interface RenderedSize {
  width: number;
  height: number;
}
