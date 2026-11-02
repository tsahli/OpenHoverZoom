import { galleryItemAttempts, type PreviewPlan } from "../resolver";
import {
  isDisplayedSource,
  stripGallery,
  type DeferredAttempts,
  type LoadCheck,
  type MediaCandidate,
  type PreviewAttempt,
} from "../resolver/candidate";
import { passesLoadCheck } from "../resolver/size-variants";
import { LruCache } from "../shared/lru-cache";
import {
  DEFAULT_DOWNLOAD_SHORTCUT,
  sanitizeDownloadShortcut,
} from "../shared/keyboard-shortcut";
import type { DownloadResult } from "../shared/messages";
import { DEFAULT_SETTINGS } from "../shared/settings";
import {
  calculatePlacement,
  type PlacementSide,
  type Point,
} from "./positioning";

const HOST_ID = "open-hover-zoom-host";
const MAX_GALLERY_ITEMS = 64;
const PANEL_INLINE_BORDER_PIXELS = 2;
// Dimensions arrive with the first bytes of an image, so a request that has none by
// now has stalled however large the file is. A slow server may take seconds to scale
// an image on demand, so this is generous for a first response.
const LOAD_STALL_MILLISECONDS = 8_000;
// An image reporting dimensions is transferring, and only needs a limit in case the
// transfer itself stalls. This allows about 19 MB at 5 Mbit/s.
const IMAGE_TRANSFER_LIMIT_MILLISECONDS = 30_000;
const FAILED_GUESS_TTL_MILLISECONDS = 5 * 60_000;
const LOOKUP_SPINNER_DELAY_MILLISECONDS = 120;
// A preview glanced at in passing should not cost its neighbours' downloads.
const PRELOAD_DWELL_MILLISECONDS = 400;
// Long enough to read a word, short enough to be gone before the next hover.
const DOWNLOAD_STATUS_MILLISECONDS = 2_500;

type DownloadState = "saving" | DownloadResult;

// "Saved" is only said once Chrome reports the file written. A download that began but
// was not seen to finish, or was handed to the page to start, is only that.
const DOWNLOAD_STATUS_TEXT: Readonly<Record<DownloadState, string>> = {
  saving: "Saving…",
  complete: "Saved",
  started: "Download started",
  failed: "Download failed",
};
const DOWNLOAD_STATUS_TITLE: Readonly<Record<DownloadState, string>> = {
  saving: "Starting the download",
  complete: "Chrome finished saving the file to your downloads folder",
  started: "Chrome started the download. It may not have finished, and failure is not reported",
  failed: "Chrome could not save this file",
};
const DOWNLOAD_HINT_TITLE = "Download this media";

type LoadOutcome = "loaded" | "failed" | "timed-out";
type PreviewMedia = HTMLImageElement | HTMLVideoElement | HTMLAudioElement;

export type PreviewOutcome = "accepted" | "none" | "cancelled";

interface PreparedMedia {
  media: PreviewMedia;
  ready: Promise<LoadOutcome>;
}

interface AcceptedMedia {
  candidate: MediaCandidate;
  media: PreviewMedia;
}

interface PreloadEntry {
  controller: AbortController;
  result: Promise<AcceptedMedia | null>;
}

interface AttemptHooks {
  beforeLoad?: () => void;
  /** Runs as a lookup starts and returns what to do when it ends. */
  onLookup?: () => () => void;
  /** Preloading spends no page fetches and never touches video or audio. */
  imagesWithoutLookups?: boolean;
}

// A guess that failed to load stays failed for a while, so hovering the same image
// again skips straight to the attempt that worked.
const failedGuesses = new LruCache<string, true>(200);

export class PreviewOverlay {
  readonly #host: HTMLDivElement;
  readonly #panel: HTMLDivElement;
  #isInTopLayer = false;
  #anchor: Point = { x: 0, y: 0 };
  #hasAnchor = false;
  #preferredSide: PlacementSide | null = null;
  #maxPreviewPercent: number;
  #downloadShortcut: string;
  #mediaVolumePercent: number;
  #gallery: MediaCandidate[] = [];
  #galleryIndex = 0;
  #requestedGalleryIndex = 0;
  /** Gallery items with nothing left to work out, because one was accepted. */
  #settledGalleryItems = new Set<number>();
  #preloads = new Map<number, PreloadEntry>();
  #preloadTimer: number | null = null;
  #hasNavigated = false;
  #run: AbortController | null = null;
  #downloadStatusTimer: number | null = null;
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
    this.#host.setAttribute("popover", "manual");
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
    if (hint && !hint.dataset.state) hint.textContent = this.#downloadHintText();
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

  showLoading(): void {
    this.#raiseToTopLayer();
    this.#beginRun();
    this.#clearDownloadStatusTimer();
    this.#stopPanelMedia();
    this.#resetGallery();
    this.#currentCandidate = null;
    this.#showLoader("Resolving preview");
  }

  /** Tries the plan's attempts in order until one is accepted, the signal aborts or a newer run starts. */
  show(plan: PreviewPlan, signal: AbortSignal): Promise<PreviewOutcome> {
    const run = this.#beginRun(signal);
    this.#resetGallery();
    const items = plan.gallery?.items.slice(0, MAX_GALLERY_ITEMS) ?? [];
    this.#gallery = items.map(stripGallery);
    this.#galleryIndex = clampIndex(plan.gallery?.index ?? 0, this.#gallery.length);
    this.#requestedGalleryIndex = this.#galleryIndex;
    const hooks = plan.quiet ? {} : { beforeLoad: () => this.#ensureLoader() };
    return this.#runAttempts(plan.attempts, this.#galleryIndex, run, hooks);
  }

  /**
   * Moves through the gallery. The visible image stays up until the next one is
   * accepted, so only a page lookup that takes a noticeable time shows a spinner.
   */
  navigateGallery(delta: -1 | 1, signal: AbortSignal): boolean {
    if (this.#panel.hidden || this.#gallery.length < 2) return false;
    const nextIndex =
      (this.#requestedGalleryIndex + delta + this.#gallery.length) % this.#gallery.length;
    if (!this.#gallery[nextIndex]) return false;
    this.#requestedGalleryIndex = nextIndex;
    this.#hasNavigated = true;
    this.#clearPreloadTimer();
    const run = this.#beginRun(signal);
    const owner = this.#run;
    void this.#showGalleryItem(nextIndex, run).then((outcome) => {
      if (this.#run !== owner || outcome === "accepted") return;
      this.#requestedGalleryIndex = this.#galleryIndex;
      if (outcome === "none" && !this.#panel.querySelector(".media-frame")) this.hide();
    });
    return true;
  }

  /**
   * Shows how a download started from the visible preview is going, in its metadata
   * bar. The download carries on if the preview goes away, and then nothing is shown.
   */
  trackDownload(candidate: MediaCandidate, result: Promise<DownloadResult>): void {
    this.#showDownloadStatus(candidate, "saving");
    void result.then((outcome) => this.#showDownloadStatus(candidate, outcome));
  }

  hide(): void {
    this.#beginRun();
    this.#clearDownloadStatusTimer();
    this.#stopPanelMedia();
    this.#resetGallery();
    this.#currentCandidate = null;
    this.#hasAnchor = false;
    this.#preferredSide = null;
    this.#panel.style.removeProperty("width");
    this.#panel.hidden = true;
    this.#panel.className = "panel";
    this.#panel.replaceChildren();
    this.#leaveTopLayer();
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

  #showDownloadStatus(candidate: MediaCandidate, state: DownloadState): void {
    if (this.#panel.hidden || this.#currentCandidate !== candidate) return;
    const hint = this.#panel.querySelector<HTMLElement>(".download-hint");
    if (!hint) return;
    this.#clearDownloadStatusTimer();
    hint.textContent = DOWNLOAD_STATUS_TEXT[state];
    hint.title = DOWNLOAD_STATUS_TITLE[state];
    hint.dataset.state = state;
    if (state === "saving") return;
    this.#downloadStatusTimer = window.setTimeout(() => {
      this.#downloadStatusTimer = null;
      hint.textContent = this.#downloadHintText();
      hint.title = DOWNLOAD_HINT_TITLE;
      delete hint.dataset.state;
    }, DOWNLOAD_STATUS_MILLISECONDS);
  }

  #clearDownloadStatusTimer(): void {
    if (this.#downloadStatusTimer !== null) {
      clearTimeout(this.#downloadStatusTimer);
      this.#downloadStatusTimer = null;
    }
  }

  /** Cancels whatever is running. The returned signal also follows the caller's. */
  #beginRun(external?: AbortSignal): AbortSignal {
    this.#run?.abort();
    this.#run = new AbortController();
    return external ? AbortSignal.any([external, this.#run.signal]) : this.#run.signal;
  }

  #resetGallery(): void {
    this.#clearPreloads();
    this.#gallery = [];
    this.#galleryIndex = 0;
    this.#requestedGalleryIndex = 0;
    this.#settledGalleryItems.clear();
    this.#hasNavigated = false;
  }

  async #runAttempts(
    attempts: readonly PreviewAttempt[],
    index: number,
    signal: AbortSignal,
    hooks: AttemptHooks,
  ): Promise<PreviewOutcome> {
    const accepted = await this.#firstAccepted(attempts, signal, hooks);
    if (signal.aborted) {
      if (accepted) this.#discardMedia(accepted.media);
      return "cancelled";
    }
    if (!accepted) return "none";
    this.#commitAccepted(accepted, index);
    return "accepted";
  }

  async #showGalleryItem(index: number, signal: AbortSignal): Promise<PreviewOutcome> {
    const preload = this.#preloads.get(index);
    if (preload) {
      // Waiting reuses a transfer already under way instead of restarting it.
      const accepted = await untilAborted(preload.result, signal);
      if (signal.aborted) return "cancelled";
      if (accepted) {
        this.#preloads.delete(index);
        this.#commitAccepted(accepted, index);
        return "accepted";
      }
    }
    const attempts = this.#galleryAttempts(index);
    return this.#runAttempts(attempts, index, signal, {
      beforeLoad: () => this.#ensureLoader(),
      onLookup: () => this.#delaySpinnerDuringLookup(signal),
    });
  }

  #galleryAttempts(index: number): PreviewAttempt[] {
    const item = this.#gallery[index];
    if (!item) return [];
    return this.#settledGalleryItems.has(index) ? [item] : galleryItemAttempts(item);
  }

  /** Loads attempts one at a time. Nothing here touches what is on screen. */
  async #firstAccepted(
    attempts: readonly PreviewAttempt[],
    signal: AbortSignal,
    hooks: AttemptHooks,
  ): Promise<AcceptedMedia | null> {
    const queue = [...attempts];
    const tried = new Set<string>();
    while (!signal.aborted) {
      const attempt = queue.shift();
      if (!attempt) return null;
      if ("expand" in attempt) {
        if (hooks.imagesWithoutLookups) return null;
        queue.unshift(...await this.#expandAttempts(attempt, signal, hooks));
        continue;
      }
      if (hooks.imagesWithoutLookups && attempt.kind !== "image") return null;
      // The same URL can return without a check, as a gallery's same-size item does.
      const key = `${mediaKey(attempt)}\u0000${attempt.check ? "checked" : "unchecked"}`;
      if (tried.has(key) || failedGuesses.get(attempt.url)) continue;
      tried.add(key);

      // The displayed image is already loaded, so waiting for it needs no spinner.
      if (!isDisplayedSource(attempt)) hooks.beforeLoad?.();
      const prepared = this.#prepareMedia(attempt, signal);
      const outcome = await prepared.ready;
      if (
        outcome === "loaded" &&
        !signal.aborted &&
        await this.#passesCheck(prepared.media, attempt.check, signal) &&
        !signal.aborted
      ) {
        return { candidate: attempt, media: prepared.media };
      }
      this.#discardMedia(prepared.media);
      if (signal.aborted) return null;
      // A timeout may be a passing network problem, so only a real failure is remembered.
      if (outcome === "failed" && attempt.source === "url-guess") {
        failedGuesses.set(attempt.url, true, FAILED_GUESS_TTL_MILLISECONDS);
      }
      if (outcome !== "loaded" && attempt.source !== "url-guess") {
        console.debug(
          `[OpenHoverZoom] Preview candidate did not load (${attempt.kind}, ${attempt.source}, ${outcome}): ${attempt.url}`,
        );
      }
    }
    return null;
  }

  async #expandAttempts(
    deferred: DeferredAttempts,
    signal: AbortSignal,
    hooks: AttemptHooks,
  ): Promise<PreviewAttempt[]> {
    const endLookup = hooks.onLookup?.();
    try {
      return await deferred.expand(signal);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.warn("[OpenHoverZoom] Linked page lookup failed", error);
      }
      return [];
    } finally {
      endLookup?.();
    }
  }

  async #passesCheck(
    media: PreviewMedia,
    check: LoadCheck | undefined,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (!check) return true;
    if (media instanceof HTMLVideoElement) {
      // Only a minimum size can be asked of a video, which has no thumbnail to match.
      return check.minEdge
        ? passesLoadCheck(
            { width: media.videoWidth, height: media.videoHeight },
            { minEdge: check.minEdge },
          )
        : true;
    }
    if (!(media instanceof HTMLImageElement)) return true;
    const actual = { width: media.naturalWidth, height: media.naturalHeight };
    const thumbnail = check.thumbnail;
    if (!thumbnail || (thumbnail.width && thumbnail.height)) return passesLoadCheck(actual, check);

    // The page has not said how big its image is, so load it to find out. It is
    // usually already displayed, which makes this a cache hit.
    const reference = this.#prepareMedia(
      { url: thumbnail.url, kind: "image", source: "image-src", confidence: 0 },
      signal,
    );
    const loaded = await reference.ready === "loaded";
    const size = reference.media instanceof HTMLImageElement
      ? { width: reference.media.naturalWidth, height: reference.media.naturalHeight }
      : null;
    this.#discardMedia(reference.media);
    return loaded && size !== null
      ? passesLoadCheck(actual, { ...check, thumbnail: { ...thumbnail, ...size } })
      : false;
  }

  #commitAccepted(accepted: AcceptedMedia, requestedIndex: number): void {
    let index = requestedIndex;
    const supplied = accepted.candidate.gallery?.slice(0, MAX_GALLERY_ITEMS) ?? [];
    if (supplied.length > 1) {
      this.#clearPreloads();
      this.#settledGalleryItems.clear();
      this.#gallery = supplied.map(stripGallery);
      index = clampIndex(accepted.candidate.galleryIndex ?? 0, this.#gallery.length);
    }
    // Its check has been passed, so a later return to this item needs no repeat.
    const { check: _check, ...shown } = stripGallery(accepted.candidate);
    this.#gallery[index] = shown;
    this.#settledGalleryItems.add(index);
    this.#galleryIndex = index;
    this.#requestedGalleryIndex = index;
    this.#raiseToTopLayer();
    this.#commitMedia(accepted.media, shown);
    this.#schedulePreloads();
  }

  /** Readies the items either side of the visible one, next first, one at a time. */
  #schedulePreloads(): void {
    this.#clearPreloadTimer();
    const length = this.#gallery.length;
    if (length < 2) return;
    const center = this.#galleryIndex;
    for (const [index, entry] of this.#preloads) {
      const distance = Math.abs(index - center);
      if (Math.min(distance, length - distance) > 1) {
        this.#preloads.delete(index);
        this.#cancelPreload(entry);
      }
    }
    const neighbours = [(center + 1) % length, (center - 1 + length) % length];
    this.#preloadTimer = window.setTimeout(() => {
      this.#preloadTimer = null;
      void (async () => {
        for (const index of neighbours) {
          if (this.#galleryIndex !== center || this.#panel.hidden) return;
          await this.#preload(index)?.result;
        }
      })();
    }, this.#hasNavigated ? 0 : PRELOAD_DWELL_MILLISECONDS);
  }

  #preload(index: number): PreloadEntry | null {
    const existing = this.#preloads.get(index);
    if (existing) return existing;
    if (index === this.#galleryIndex || this.#gallery[index]?.kind !== "image") return null;
    const controller = new AbortController();
    const entry: PreloadEntry = {
      controller,
      result: this.#firstAccepted(this.#galleryAttempts(index), controller.signal, {
        imagesWithoutLookups: true,
      }),
    };
    this.#preloads.set(index, entry);
    return entry;
  }

  #cancelPreload(entry: PreloadEntry): void {
    entry.controller.abort();
    void entry.result.then((accepted) => {
      if (accepted) this.#discardMedia(accepted.media);
    });
  }

  #clearPreloads(): void {
    this.#clearPreloadTimer();
    for (const entry of this.#preloads.values()) this.#cancelPreload(entry);
    this.#preloads.clear();
  }

  #clearPreloadTimer(): void {
    if (this.#preloadTimer !== null) {
      clearTimeout(this.#preloadTimer);
      this.#preloadTimer = null;
    }
  }

  #ensureLoader(): void {
    if (
      this.#panel.querySelector(".media-frame") ||
      (!this.#panel.hidden && this.#panel.classList.contains("loading"))
    ) {
      return;
    }
    this.#raiseToTopLayer();
    this.#showLoader("Loading preview");
  }

  #showLoader(label: string): void {
    this.#panel.style.removeProperty("width");
    this.#panel.replaceChildren(this.#createLoader(label));
    this.#panel.className = "panel loading";
    this.#panel.hidden = false;
    this.reposition();
  }

  /** A lookup that answers quickly, such as from the cache, never disturbs the image. */
  #delaySpinnerDuringLookup(signal: AbortSignal): () => void {
    if (!this.#panel.querySelector(".media-frame")) return () => undefined;
    const timer = window.setTimeout(() => {
      if (signal.aborted) return;
      this.#stopPanelMedia();
      this.#currentCandidate = null;
      this.#showLoader("Resolving preview");
    }, LOOKUP_SPINNER_DELAY_MILLISECONDS);
    return () => clearTimeout(timer);
  }

  #commitMedia(media: HTMLElement, candidate: MediaCandidate): void {
    const frame = document.createElement("div");
    frame.className = "media-frame";
    media.classList.add("media");
    frame.append(media);
    this.#stopPanelMedia(media);
    this.#clearDownloadStatusTimer();
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

  #prepareMedia(candidate: MediaCandidate, signal: AbortSignal): PreparedMedia {
    const media = createMediaElement(candidate);
    const ready = new Promise<LoadOutcome>((resolve) => {
      let timer: number | undefined;
      const finish = (outcome: LoadOutcome): void => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(outcome);
      };
      const onAbort = (): void => finish("failed");
      const onStall = (): void => {
        if (media instanceof HTMLImageElement && media.naturalWidth > 0) {
          timer = window.setTimeout(
            () => finish("timed-out"),
            IMAGE_TRANSFER_LIMIT_MILLISECONDS - LOAD_STALL_MILLISECONDS,
          );
        } else {
          finish("timed-out");
        }
      };
      media.addEventListener(
        media instanceof HTMLImageElement ? "load" : "loadedmetadata",
        () => finish("loaded"),
        { once: true },
      );
      media.addEventListener("error", () => finish("failed"), { once: true });
      if (signal.aborted) {
        finish("failed");
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      timer = window.setTimeout(onStall, LOAD_STALL_MILLISECONDS);
      media.src = candidate.url;
    });
    return { media, ready };
  }

  #discardMedia(media: PreviewMedia): void {
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
    downloadHint.title = DOWNLOAD_HINT_TITLE;
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
    if (this.#host.isConnected) return;
    this.#isInTopLayer = false;
    document.documentElement.append(this.#host);
  }

  #raiseToTopLayer(): void {
    this.#ensureConnected();
    if (
      typeof this.#host.showPopover !== "function" ||
      typeof this.#host.hidePopover !== "function"
    ) return;

    if (this.#isInTopLayer) {
      try {
        this.#host.hidePopover();
      } catch {
        // The page may have removed or closed the popover since the last preview.
      }
      this.#isInTopLayer = false;
    }

    try {
      this.#host.showPopover();
      this.#isInTopLayer = true;
    } catch {
      // The existing high z-index remains a fallback for inactive documents.
    }
  }

  #leaveTopLayer(): void {
    if (!this.#isInTopLayer || typeof this.#host.hidePopover !== "function") return;
    try {
      this.#host.hidePopover();
    } catch {
      // The popover is already closed or disconnected.
    }
    this.#isInTopLayer = false;
  }
}

function createMediaElement(candidate: MediaCandidate): PreviewMedia {
  if (candidate.kind === "video") {
    const video = document.createElement("video");
    video.autoplay = false;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.setAttribute("referrerpolicy", "no-referrer");
    return video;
  }
  if (candidate.kind === "audio") {
    const audio = document.createElement("audio");
    audio.autoplay = false;
    audio.muted = true;
    audio.preload = "metadata";
    audio.controls = true;
    audio.setAttribute("referrerpolicy", "no-referrer");
    return audio;
  }
  const image = document.createElement("img");
  image.alt = "";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  return image;
}

function untilAborted<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      if (signal.aborted) resolve(null);
      signal.addEventListener("abort", () => resolve(null), { once: true });
    }),
  ]);
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
  .download-hint[data-state="saving"] { color: rgba(246, 247, 249, 0.86); }
  .download-hint[data-state="complete"] { color: rgba(146, 214, 160, 0.9); }
  .download-hint[data-state="failed"] { color: rgba(246, 150, 140, 0.9); }
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
