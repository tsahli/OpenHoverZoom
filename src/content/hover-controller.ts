import { resolveGalleryCandidate, resolveTarget } from "../resolver";
import type { MediaCandidate } from "../resolver/candidate";
import { isSiteDisabled, type Settings } from "../shared/settings";
import { matchesDownloadShortcut } from "../shared/keyboard-shortcut";
import { requestImageDownload } from "./download-client";
import { PreviewOverlay, type GallerySelection } from "./preview-overlay";
import { findHoverTarget } from "./target-inspector";

const LOADING_DELAY_MILLISECONDS = 120;
const LEAVE_GRACE_MILLISECONDS = 160;

interface TrackedPoint {
  x: number;
  y: number;
}

export class HoverController {
  #settings: Settings;
  #activeTarget: Element | null = null;
  #pendingTarget: Element | null = null;
  #pendingPoint: TrackedPoint | null = null;
  #hoverTimer: number | null = null;
  #loadingTimer: number | null = null;
  #leaveTimer: number | null = null;
  #request: AbortController | null = null;
  #galleryRequest: AbortController | null = null;
  #sequence = 0;

  constructor(
    private readonly overlay: PreviewOverlay,
    settings: Settings,
  ) {
    this.#settings = settings;
    document.addEventListener("pointerover", this.#onPointerOver, true);
    document.addEventListener("pointerout", this.#onPointerOut, true);
    document.addEventListener("pointermove", this.#onPointerMove, true);
    document.addEventListener("keydown", this.#onKeyDown, true);
    document.addEventListener("visibilitychange", this.#onVisibilityChange);
    window.addEventListener("blur", this.#onWindowBlur);
    window.addEventListener("resize", this.#onViewportChange, { passive: true });
    window.addEventListener("scroll", this.#onViewportChange, { capture: true, passive: true });
  }

  updateSettings(settings: Settings): void {
    this.#settings = settings;
    this.overlay.updateSettings(settings.maxPreviewPercent, settings.downloadShortcut);
    if (!this.#isEnabled()) this.#clearAll();
  }

  destroy(): void {
    document.removeEventListener("pointerover", this.#onPointerOver, true);
    document.removeEventListener("pointerout", this.#onPointerOut, true);
    document.removeEventListener("pointermove", this.#onPointerMove, true);
    document.removeEventListener("keydown", this.#onKeyDown, true);
    document.removeEventListener("visibilitychange", this.#onVisibilityChange);
    window.removeEventListener("blur", this.#onWindowBlur);
    window.removeEventListener("resize", this.#onViewportChange);
    window.removeEventListener("scroll", this.#onViewportChange, true);
    this.#clearAll();
  }

  #onPointerOver = (event: PointerEvent): void => {
    this.#trackPointer(event.target, { x: event.clientX, y: event.clientY });
  };

  #onPointerOut = (event: PointerEvent): void => {
    // Moving into an iframe can provide the iframe element as relatedTarget,
    // then stop delivering pointer events to this document entirely.
    this.#trackPointer(event.relatedTarget, { x: event.clientX, y: event.clientY });
  };

  #onPointerMove = (event: PointerEvent): void => {
    this.#trackPointer(event.target, { x: event.clientX, y: event.clientY });
  };

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      this.#clearAll();
      return;
    }
    const imageUrl = this.overlay.getVisibleImageUrl();
    if (imageUrl && matchesDownloadShortcut(event, this.#settings.downloadShortcut)) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) {
        void requestImageDownload(imageUrl).catch((error: unknown) => {
          console.warn("[OpenHoverZoom] Image download request failed", error);
        });
      }
      return;
    }
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : null;
    const selection = direction ? this.overlay.navigateGallery(direction) : null;
    if (selection) {
      event.preventDefault();
      event.stopPropagation();
      this.#upgradeGallerySelection(selection);
    }
  };

  #onViewportChange = (): void => this.overlay.reposition();

  #onWindowBlur = (): void => this.#clearAll();

  #onVisibilityChange = (): void => {
    if (document.hidden) this.#clearAll();
  };

  #trackPointer(eventTarget: EventTarget | null, point: TrackedPoint): void {
    if (!this.#isEnabled()) return;
    this.overlay.updatePointer(point.x, point.y);
    const target = findHoverTarget(eventTarget, point);
    this.#trackTarget(target, point);
  }

  #trackTarget(target: Element | null, point: TrackedPoint): void {
    if (target && target === this.#activeTarget) {
      this.#cancelPendingTarget();
      this.#cancelLeaveTimer();
      return;
    }
    if (target) {
      this.#cancelLeaveTimer();
      if (target === this.#pendingTarget) return;
      this.#cancelGalleryRequest();
      if (this.#request) {
        this.#cancelActiveRequest();
        this.#activeTarget = null;
      }
      if (this.#activeTarget && !this.overlay.hasVisibleMedia()) {
        this.#activeTarget = null;
        this.overlay.hide();
      }
      this.#scheduleTarget(target, point);
      return;
    }

    this.#cancelPendingTarget();
    this.#cancelGalleryRequest();
    if (this.#request) {
      this.#cancelActiveRequest();
      this.#activeTarget = null;
    }
    if (!this.#activeTarget && !this.overlay.hasVisibleMedia()) {
      if (this.overlay.isVisible()) this.overlay.hide();
      return;
    }
    if (this.#leaveTimer === null) {
      this.#leaveTimer = window.setTimeout(() => {
        this.#leaveTimer = null;
        this.#clearAll();
      }, LEAVE_GRACE_MILLISECONDS);
    }
  }

  #scheduleTarget(target: Element, point: TrackedPoint): void {
    this.#cancelPendingTarget();
    if (
      !this.#activeTarget &&
      this.overlay.isVisible() &&
      !this.overlay.hasVisibleMedia()
    ) this.overlay.hide();
    this.#pendingTarget = target;
    this.#pendingPoint = point;
    if (
      !this.#activeTarget &&
      !this.overlay.hasVisibleMedia() &&
      !this.#resolvesSilently(target)
    ) {
      this.overlay.setAnchor(point.x, point.y);
      const loadingDelay = Math.min(LOADING_DELAY_MILLISECONDS, this.#settings.hoverDelayMs);
      this.#loadingTimer = window.setTimeout(() => {
        this.#loadingTimer = null;
        if (this.#pendingTarget === target) this.overlay.showLoading();
      }, loadingDelay);
    }
    this.#hoverTimer = window.setTimeout(() => {
      this.#hoverTimer = null;
      this.#activatePendingTarget();
    }, this.#settings.hoverDelayMs);
  }

  #activatePendingTarget(): void {
    const target = this.#pendingTarget;
    const point = this.#pendingPoint;
    if (!target || !point) return;
    this.#pendingTarget = null;
    this.#pendingPoint = null;
    this.#clearLoadingTimer();
    this.#cancelActiveRequest();
    this.#activeTarget = target;
    const sequence = ++this.#sequence;
    this.overlay.setAnchor(point.x, point.y);
    if (!this.overlay.isVisible() && !this.#resolvesSilently(target)) {
      this.overlay.showLoading();
    }
    void this.#resolve(target, sequence);
  }

  async #resolve(target: Element, sequence: number): Promise<void> {
    const request = new AbortController();
    this.#request = request;
    let upgradePromise: Promise<MediaCandidate | null> | null = null;

    try {
      const candidate = await resolveTarget(
        target,
        { showSameSizeImages: this.#settings.showSameSizeImages },
        request.signal,
        {
          onLocalCandidate: (localCandidate) => this.overlay.prepare(localCandidate),
          onUpgrade: (upgrade) => {
            upgradePromise = upgrade;
          },
        },
      );
      if (
        sequence !== this.#sequence ||
        request.signal.aborted ||
        target !== this.#activeTarget
      ) return;
      this.#clearLoadingTimer();
      if (candidate) this.overlay.show(candidate);
      else {
        this.#activeTarget = null;
        this.overlay.hide();
        return;
      }

      if (upgradePromise) {
        const upgrade = await upgradePromise;
        if (
          upgrade &&
          sequence === this.#sequence &&
          !request.signal.aborted &&
          target === this.#activeTarget
        ) {
          this.overlay.show(upgrade);
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.warn("[OpenHoverZoom] Preview resolution failed", error);
        this.#activeTarget = null;
        this.overlay.hide();
      }
    } finally {
      if (this.#request === request) this.#request = null;
      this.#clearLoadingTimer();
    }
  }

  #upgradeGallerySelection(selection: GallerySelection): void {
    this.#cancelGalleryRequest();
    if (!selection.candidate.linkedPageUrl) return;
    const request = new AbortController();
    this.#galleryRequest = request;
    void resolveGalleryCandidate(selection.candidate, request.signal)
      .then((candidate) => {
        if (candidate && this.#galleryRequest === request && !request.signal.aborted) {
          this.overlay.upgradeGalleryItem(selection, candidate);
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("[OpenHoverZoom] Gallery item upgrade failed", error);
        }
      })
      .finally(() => {
        if (this.#galleryRequest === request) this.#galleryRequest = null;
      });
  }

  #clearAll(): void {
    this.#activeTarget = null;
    this.#sequence += 1;
    this.#cancelPendingTarget();
    this.#cancelLeaveTimer();
    this.#cancelActiveRequest();
    this.#cancelGalleryRequest();
    this.overlay.hide();
  }

  #cancelPendingTarget(): void {
    if (this.#hoverTimer !== null) {
      clearTimeout(this.#hoverTimer);
      this.#hoverTimer = null;
    }
    this.#pendingTarget = null;
    this.#pendingPoint = null;
    this.#clearLoadingTimer();
  }

  #cancelActiveRequest(): void {
    this.#request?.abort();
    this.#request = null;
  }

  #cancelGalleryRequest(): void {
    this.#galleryRequest?.abort();
    this.#galleryRequest = null;
  }

  #cancelLeaveTimer(): void {
    if (this.#leaveTimer !== null) {
      clearTimeout(this.#leaveTimer);
      this.#leaveTimer = null;
    }
  }

  #clearLoadingTimer(): void {
    if (this.#loadingTimer !== null) {
      clearTimeout(this.#loadingTimer);
      this.#loadingTimer = null;
    }
  }

  #isEnabled(): boolean {
    return this.#settings.enabled && !isSiteDisabled(this.#settings, location.href);
  }

  #resolvesSilently(target: Element): boolean {
    return target instanceof HTMLAnchorElement;
  }
}
