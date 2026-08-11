import type { MediaCandidate } from "../resolver/candidate";
import {
  DEFAULT_DOWNLOAD_SHORTCUT,
  sanitizeDownloadShortcut,
} from "../shared/keyboard-shortcut";
import { DEFAULT_SETTINGS } from "../shared/settings";
import {
  calculatePlacement,
  type PlacementSide,
  type Point,
} from "./positioning";

const HOST_ID = "open-hover-zoom-host";
const MAX_GALLERY_ITEMS = 64;
const PANEL_INLINE_BORDER_PIXELS = 2;

interface PreparedMedia {
  key: string;
  media: HTMLElement;
  ready: Promise<boolean>;
}

export interface GallerySelection {
  index: number;
  candidate: MediaCandidate;
}

export class PreviewOverlay {
  readonly #host: HTMLDivElement;
  readonly #panel: HTMLDivElement;
  #anchor: Point = { x: 0, y: 0 };
  #hasAnchor = false;
  #preferredSide: PlacementSide | null = null;
  #maxPreviewPercent: number;
  #downloadShortcut: string;
  #mediaVolumePercent: number;
  #gallery: MediaCandidate[] = [];
  #galleryIndex = 0;
  #requestedGalleryIndex = 0;
  #renderSequence = 0;
  #prepared: PreparedMedia | null = null;
  #currentCandidate: MediaCandidate | null = null;

  constructor(
    maxPreviewPercent: number,
    downloadShortcut = DEFAULT_DOWNLOAD_SHORTCUT,
    mediaVolumePercent = DEFAULT_SETTINGS.mediaVolumePercent,
  ) {
    this.#maxPreviewPercent = maxPreviewPercent;
    this.#downloadShortcut = sanitizeDownloadShortcut(downloadShortcut);
    this.#mediaVolumePercent = normalizedVolumePercent(mediaVolumePercent);
    this.#host = document.createElement("div");
    this.#host.id = HOST_ID;
    this.#host.setAttribute("aria-hidden", "true");
    this.#host.style.setProperty("pointer-events", "none", "important");
    const shadow = this.#host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = OVERLAY_CSS;
    this.#panel = document.createElement("div");
    this.#panel.className = "panel";
    this.#panel.hidden = true;
    shadow.append(style, this.#panel);
  }

  updateSettings(
    maxPreviewPercent: number,
    downloadShortcut = this.#downloadShortcut,
    mediaVolumePercent = this.#mediaVolumePercent,
  ): void {
    this.#maxPreviewPercent = maxPreviewPercent;
    this.#downloadShortcut = sanitizeDownloadShortcut(downloadShortcut);
    this.#mediaVolumePercent = normalizedVolumePercent(mediaVolumePercent);
    const hint = this.#panel.querySelector<HTMLElement>(".download-hint");
    if (hint) hint.textContent = this.#downloadHintText();
    const media = this.#panel.querySelector(".media-frame > .media");
    if (media instanceof HTMLMediaElement) this.#startMediaPlayback(media);
    this.reposition();
  }

  updatePointer(x: number, y: number): void {
    if (!this.#hasAnchor) this.#anchor = { x, y };
  }

  setAnchor(x: number, y: number): void {
    this.#anchor = { x, y };
    this.#hasAnchor = true;
    this.#preferredSide = null;
  }

  isVisible(): boolean {
    return !this.#panel.hidden;
  }

  hasVisibleMedia(): boolean {
    return !this.#panel.hidden && this.#currentCandidate !== null;
  }

  getVisibleMediaCandidate(): MediaCandidate | null {
    return !this.#panel.hidden ? this.#currentCandidate : null;
  }

  getVisibleImageUrl(): string | null {
    return !this.#panel.hidden && this.#currentCandidate?.kind === "image"
      ? this.#currentCandidate.url
      : null;
  }

  getVisibleImageCandidate(): MediaCandidate | null {
    return !this.#panel.hidden && this.#currentCandidate?.kind === "image"
      ? this.#currentCandidate
      : null;
  }

  showLoading(): void {
    this.#ensureConnected();
    this.#renderSequence += 1;
    this.#stopPanelMedia();
    this.#gallery = [];
    this.#galleryIndex = 0;
    this.#requestedGalleryIndex = 0;
    this.#currentCandidate = null;
    this.#panel.style.removeProperty("width");
    this.#panel.replaceChildren(this.#createLoader("Resolving preview"));
    this.#panel.className = "panel loading";
    this.#panel.hidden = false;
    this.reposition();
  }

  prepare(candidate: MediaCandidate): void {
    const key = mediaKey(candidate);
    if (this.#prepared?.key === key) return;
    this.#ensureConnected();
    this.#discardPrepared();
    this.#prepared = this.#prepareMedia(candidate);
  }

  show(candidate: MediaCandidate, fallback: MediaCandidate | null = null): void {
    const preparedKey = this.#prepared?.key;
    if (
      preparedKey &&
      preparedKey !== mediaKey(candidate) &&
      (!fallback || preparedKey !== mediaKey(fallback))
    ) {
      this.#discardPrepared();
    }
    const suppliedGallery = candidate.gallery?.slice(0, MAX_GALLERY_ITEMS) ?? [];
    this.#gallery = suppliedGallery.length > 1
      ? suppliedGallery.map(stripGallery)
      : [stripGallery(candidate)];
    this.#galleryIndex = clampIndex(candidate.galleryIndex ?? 0, this.#gallery.length);
    this.#requestedGalleryIndex = this.#galleryIndex;
    this.#gallery[this.#galleryIndex] = stripGallery(candidate);
    this.#loadIndex(this.#galleryIndex, fallback);
  }

  navigateGallery(delta: -1 | 1): GallerySelection | null {
    if (this.#panel.hidden || this.#gallery.length < 2) return null;
    const nextIndex =
      (this.#requestedGalleryIndex + delta + this.#gallery.length) % this.#gallery.length;
    const candidate = this.#gallery[nextIndex];
    if (!candidate) return null;
    if (candidate.linkedPageUrl && candidate.source !== "document-metadata") {
      this.#requestedGalleryIndex = nextIndex;
      this.#showGalleryLoading(candidate);
    } else {
      this.#loadIndex(nextIndex);
    }
    return { index: nextIndex, candidate };
  }

  resolveGallerySelection(
    selection: GallerySelection,
    candidate: MediaCandidate | null,
  ): boolean {
    const current = this.#gallery[selection.index];
    if (
      !current ||
      current.url !== selection.candidate.url ||
      current.linkedPageUrl !== selection.candidate.linkedPageUrl
    ) {
      return false;
    }
    const resolved = candidate && candidate.url !== current.url
      ? stripGallery(candidate)
      : current;
    this.#gallery[selection.index] = resolved;
    if (this.#requestedGalleryIndex === selection.index) {
      this.#loadIndex(
        selection.index,
        resolved.url !== current.url ? current : null,
      );
    }
    return true;
  }

  hide(): void {
    this.#renderSequence += 1;
    this.#discardPrepared();
    this.#stopPanelMedia();
    this.#gallery = [];
    this.#galleryIndex = 0;
    this.#requestedGalleryIndex = 0;
    this.#currentCandidate = null;
    this.#hasAnchor = false;
    this.#preferredSide = null;
    this.#panel.style.removeProperty("width");
    this.#panel.hidden = true;
    this.#panel.className = "panel";
    this.#panel.replaceChildren();
  }

  reposition(): void {
    if (this.#panel.hidden) return;
    this.#applySizeLimit();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const initial = this.#panel.getBoundingClientRect();
    const firstPlacement = calculatePlacement(
      this.#anchor,
      { width: initial.width, height: initial.height },
      viewport,
      18,
      12,
      this.#preferredSide ?? undefined,
    );
    this.#applySizeLimit(firstPlacement.maxWidth, firstPlacement.maxHeight);
    this.#syncPanelWidthToMedia();
    const constrained = this.#panel.getBoundingClientRect();
    const placement = calculatePlacement(
      this.#anchor,
      { width: constrained.width, height: constrained.height },
      viewport,
      18,
      12,
      firstPlacement.side,
    );
    this.#preferredSide = placement.side;
    this.#panel.style.left = `${placement.left}px`;
    this.#panel.style.top = `${placement.top}px`;
  }

  #loadIndex(index: number, fallback: MediaCandidate | null = null): void {
    const candidate = this.#gallery[index];
    if (!candidate) {
      this.hide();
      return;
    }
    this.#requestedGalleryIndex = index;

    this.#ensureConnected();
    const sequence = ++this.#renderSequence;
    const hasVisibleMedia = this.#panel.querySelector(".media-frame") !== null;
    for (const stalePreloader of this.#panel.querySelectorAll(".preload-bin")) {
      for (const media of stalePreloader.querySelectorAll<HTMLMediaElement>("audio, video")) {
        this.#disposeMedia(media);
      }
      stalePreloader.remove();
    }
    if (!hasVisibleMedia && (this.#panel.hidden || !this.#panel.classList.contains("loading"))) {
      this.#panel.style.removeProperty("width");
      this.#panel.replaceChildren(this.#createLoader("Loading preview"));
      this.#panel.className = "panel loading";
      this.#panel.hidden = false;
    }
    this.#applySizeLimit();

    const prepared = this.#takePrepared(candidate) ?? this.#prepareMedia(candidate);
    const media = prepared.media;
    const preloader = document.createElement("div");
    preloader.className = "preload-bin";
    preloader.append(media);
    this.#panel.append(preloader);
    void prepared.ready.then((ready) => {
      if (sequence !== this.#renderSequence) return;
      if (ready) {
        this.#galleryIndex = index;
        this.#requestedGalleryIndex = index;
        this.#discardPrepared();
        this.#commitMedia(media, candidate);
        return;
      }
      if (fallback && fallback.url !== candidate.url) {
        this.#gallery[index] = stripGallery(fallback);
        this.#loadIndex(index);
        return;
      }
      if (hasVisibleMedia) {
        this.#requestedGalleryIndex = this.#galleryIndex;
        preloader.remove();
        return;
      }
      console.debug(
        `[OpenHoverZoom] Preview candidate did not load (${candidate.kind}, ${candidate.source}): ${candidate.url}`,
      );
      this.hide();
    });
    const loader = this.#panel.querySelector<HTMLElement>(".loader");
    if (!hasVisibleMedia && loader) loader.setAttribute("aria-label", "Loading preview");
    requestAnimationFrame(() => this.reposition());
  }

  #showGalleryLoading(fallback: MediaCandidate): void {
    this.#ensureConnected();
    this.#renderSequence += 1;
    this.#discardPrepared();
    this.#stopPanelMedia();
    this.#currentCandidate = null;
    this.#panel.style.removeProperty("width");
    this.#panel.replaceChildren(this.#createLoader("Resolving preview"));
    this.#panel.className = "panel loading";
    this.#panel.hidden = false;
    this.reposition();
    this.prepare(fallback);
  }

  #commitMedia(media: HTMLElement, candidate: MediaCandidate): void {
    const frame = document.createElement("div");
    frame.className = "media-frame";
    media.classList.add("media");
    frame.append(media);
    this.#stopPanelMedia(media);
    this.#panel.style.removeProperty("width");
    this.#panel.replaceChildren(frame);
    this.#panel.className = "panel";
    this.#panel.hidden = false;
    this.#currentCandidate = candidate;
    const metadata = this.#createMetadata(candidate);
    if (metadata) this.#panel.append(metadata);
    if (media instanceof HTMLMediaElement) this.#startMediaPlayback(media);
    this.reposition();
  }

  #syncPanelWidthToMedia(): void {
    const media = this.#panel.querySelector<HTMLElement>(".media-frame > .media");
    if (!media) return;

    const mediaWidth = media.getBoundingClientRect().width;
    if (mediaWidth > 0) {
      this.#panel.style.width = `${Math.ceil(mediaWidth + PANEL_INLINE_BORDER_PIXELS)}px`;
    }
  }

  #prepareMedia(candidate: MediaCandidate): PreparedMedia {
    let settle: ((ready: boolean) => void) | undefined;
    const ready = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    const onReady = (): void => settle?.(true);
    const onError = (): void => settle?.(false);
    let media: HTMLElement;
    if (candidate.kind === "video") {
      const video = document.createElement("video");
      video.autoplay = false;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.setAttribute("referrerpolicy", "no-referrer");
      video.addEventListener("loadedmetadata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.src = candidate.url;
      media = video;
    } else if (candidate.kind === "audio") {
      const audio = document.createElement("audio");
      audio.autoplay = false;
      audio.muted = true;
      audio.preload = "metadata";
      audio.controls = true;
      audio.setAttribute("referrerpolicy", "no-referrer");
      audio.addEventListener("loadedmetadata", onReady, { once: true });
      audio.addEventListener("error", onError, { once: true });
      audio.src = candidate.url;
      media = audio;
    } else {
      const image = document.createElement("img");
      image.alt = "";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("load", onReady, { once: true });
      image.addEventListener("error", onError, { once: true });
      image.src = candidate.url;
      media = image;
    }
    return { key: mediaKey(candidate), media, ready };
  }

  #takePrepared(candidate: MediaCandidate): PreparedMedia | null {
    if (this.#prepared?.key !== mediaKey(candidate)) return null;
    const prepared = this.#prepared;
    this.#prepared = null;
    return prepared;
  }

  #discardPrepared(): void {
    const media = this.#prepared?.media;
    this.#prepared = null;
    if (!media) return;
    if (media instanceof HTMLMediaElement) {
      this.#disposeMedia(media);
    } else {
      media.removeAttribute("src");
    }
  }

  #startMediaPlayback(media: HTMLMediaElement): void {
    const volume = this.#mediaVolumePercent / 100;
    media.volume = volume;
    media.muted = volume === 0;
    this.#clearAudioBlockedStatus();

    let playback: Promise<void>;
    try {
      playback = media.play();
    } catch (error) {
      this.#handlePlaybackFailure(media, error, volume);
      return;
    }
    void playback.catch((error: unknown) => this.#handlePlaybackFailure(media, error, volume));
  }

  #handlePlaybackFailure(
    media: HTMLMediaElement,
    error: unknown,
    requestedVolume: number,
  ): void {
    if (!this.#isCommittedMedia(media)) return;
    if (
      requestedVolume > 0 &&
      error instanceof DOMException &&
      error.name === "NotAllowedError"
    ) {
      media.muted = true;
      this.#showAudioBlockedStatus();
      try {
        void media.play().catch(() => undefined);
      } catch {
        // A failed muted fallback leaves the loaded preview visible but paused.
      }
      return;
    }
    console.debug("[OpenHoverZoom] Media playback did not start", error);
  }

  #isCommittedMedia(media: HTMLMediaElement): boolean {
    return (
      !this.#panel.hidden &&
      this.#panel.querySelector(".media-frame > .media") === media
    );
  }

  #showAudioBlockedStatus(): void {
    const metadata = this.#panel.querySelector<HTMLElement>(".metadata");
    if (!metadata || metadata.querySelector(".audio-status")) return;
    const status = document.createElement("span");
    status.className = "audio-status";
    status.textContent = "Audio blocked";
    status.title = "Chrome blocked audible autoplay for this site";
    metadata.prepend(status);
  }

  #clearAudioBlockedStatus(): void {
    this.#panel.querySelector(".audio-status")?.remove();
  }

  #stopPanelMedia(except?: HTMLElement): void {
    for (const media of this.#panel.querySelectorAll<HTMLMediaElement>("audio, video")) {
      if (media !== except) this.#disposeMedia(media);
    }
  }

  #disposeMedia(media: HTMLMediaElement): void {
    media.pause();
    media.removeAttribute("src");
    media.load();
  }

  #createLoader(label: string): HTMLDivElement {
    const loader = document.createElement("div");
    loader.className = "loader";
    loader.setAttribute("aria-label", label);
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    loader.append(spinner);
    return loader;
  }

  #createMetadata(candidate: MediaCandidate): HTMLDivElement | null {
    const hasGallery = this.#gallery.length > 1;
    const captionText = candidate.caption?.replace(/^file:\s*/iu, "").trim();

    const metadata = document.createElement("div");
    metadata.className = "metadata";
    if (captionText) {
      const caption = document.createElement("span");
      caption.className = "caption";
      caption.textContent = captionText;
      metadata.append(caption);
    }
    const downloadHint = document.createElement("span");
    downloadHint.className = "download-hint";
    downloadHint.textContent = this.#downloadHintText();
    downloadHint.title = "Download this media";
    metadata.append(downloadHint);
    if (hasGallery) {
      const status = document.createElement("span");
      status.className = "gallery-status";
      status.textContent = `${this.#galleryIndex + 1} / ${this.#gallery.length}  ·  ← →`;
      status.title = "Use the left and right arrow keys to browse this gallery";
      metadata.append(status);
    }
    return metadata;
  }

  #downloadHintText(): string {
    return `${this.#downloadShortcut} ⤓`;
  }

  #applySizeLimit(availableWidth = Number.POSITIVE_INFINITY, availableHeight = Number.POSITIVE_INFINITY): void {
    const userWidth = window.innerWidth * this.#maxPreviewPercent / 100;
    const userHeight = window.innerHeight * this.#maxPreviewPercent / 100;
    const width = Math.max(1, Math.min(userWidth, availableWidth));
    const height = Math.max(1, Math.min(userHeight, availableHeight));
    this.#panel.style.setProperty("--ohz-max-width", `${width}px`);
    this.#panel.style.setProperty("--ohz-max-height", `${height}px`);
  }

  #ensureConnected(): void {
    if (!this.#host.isConnected) document.documentElement.append(this.#host);
  }
}

function stripGallery(candidate: MediaCandidate): MediaCandidate {
  const { gallery: _gallery, galleryIndex: _galleryIndex, ...item } = candidate;
  return item;
}

function mediaKey(candidate: MediaCandidate): string {
  return `${candidate.kind}\u0000${candidate.url}`;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isInteger(index) || length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index));
}

function normalizedVolumePercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.mediaVolumePercent;
  return Math.min(100, Math.max(0, Math.round(value)));
}

const OVERLAY_CSS = `
  :host { all: initial; pointer-events: none !important; }
  .panel {
    --ohz-max-width: 85vw;
    --ohz-max-height: 85vh;
    all: initial;
    position: fixed;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    max-width: var(--ohz-max-width);
    max-height: var(--ohz-max-height);
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 7px;
    background: rgba(20, 22, 27, 0.96);
    box-shadow: 0 12px 38px rgba(0, 0, 0, 0.42), 0 2px 8px rgba(0, 0, 0, 0.24);
    color: #f6f7f9;
    font: 13px/1.4 system-ui, sans-serif;
    pointer-events: none;
  }
  .panel, .panel * { pointer-events: none !important; }
  .panel[hidden] { display: none; }
  .panel.loading {
    border-color: rgba(255, 255, 255, 0.18);
    border-radius: 10px;
    background: rgba(24, 27, 33, 0.68);
    box-shadow: 0 7px 22px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(9px) saturate(1.12);
  }
  .media-frame {
    all: initial;
    display: block;
    overflow: hidden;
    max-width: var(--ohz-max-width);
    max-height: calc(var(--ohz-max-height) - 30px);
    background: #17191e;
  }
  img, video {
    all: initial;
    display: block;
    max-width: var(--ohz-max-width);
    max-height: calc(var(--ohz-max-height) - 30px);
    object-fit: contain;
  }
  audio {
    display: block;
    width: min(360px, var(--ohz-max-width));
  }
  .preload-bin { display: none !important; }
  .loader {
    all: initial;
    box-sizing: border-box;
    display: grid;
    width: 44px;
    height: 44px;
    align-items: center;
    justify-content: center;
  }
  .spinner {
    all: initial;
    box-sizing: border-box;
    display: block;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.16);
    border-top-color: rgba(255, 255, 255, 0.72);
    border-radius: 50%;
    animation: ohz-spin 0.8s linear infinite;
  }
  .metadata {
    all: initial;
    box-sizing: border-box;
    display: flex;
    min-height: 26px;
    max-width: 100%;
    align-items: center;
    gap: 12px;
    padding: 4px 8px 5px;
    border-top: 1px solid rgba(255, 255, 255, 0.13);
    background: linear-gradient(90deg, rgba(39, 43, 51, 0.9), rgba(29, 33, 40, 0.86));
    box-shadow: inset 0 1px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(10px) saturate(1.1);
  }
  .caption {
    all: initial;
    display: block;
    flex: 1 1 auto;
    overflow: hidden;
    min-width: 0;
    color: rgba(246, 247, 249, 0.82);
    font: 11px/1.35 system-ui, sans-serif;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gallery-status {
    all: initial;
    display: block;
    flex: none;
    margin-left: auto;
    color: rgba(246, 247, 249, 0.56);
    font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .download-hint {
    all: initial;
    display: block;
    flex: none;
    margin-left: auto;
    color: rgba(246, 247, 249, 0.62);
    font: 11px/1.35 system-ui, sans-serif;
    white-space: nowrap;
  }
  .audio-status {
    all: initial;
    display: block;
    flex: none;
    color: rgba(246, 197, 116, 0.78);
    font: 11px/1.35 system-ui, sans-serif;
    white-space: nowrap;
  }
  .download-hint + .gallery-status { margin-left: 10px; }
  @keyframes ohz-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .spinner { animation: none; }
  }
`;
