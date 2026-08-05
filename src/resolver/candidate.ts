export type MediaKind = "image" | "video" | "audio";

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
  | "rewrite-rule"
  | "adapter";

export interface MediaCandidate {
  url: string;
  kind: MediaKind;
  source: CandidateSource;
  confidence: number;
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
