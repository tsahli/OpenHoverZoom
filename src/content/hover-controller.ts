import {
  resolveDownloadCandidate,
  resolveGalleryCandidate,
  resolveTarget,
} from "../resolver";
import type { MediaCandidate } from "../resolver/candidate";
import { isSiteDisabled, type Settings } from "../shared/settings";
import {
  matchesDownloadShortcut,
  matchesPreviewDisableModifiers,
  matchesPreviewDisableShortcut,
  releasesPreviewDisableShortcut,
} from "../shared/keyboard-shortcut";
import { requestMediaDownload } from "./download-client";
import { PreviewOverlay, type GallerySelection } from "./preview-overlay";
import { findHoverTarget } from "./target-inspector";

const LOADING_DELAY_MILLISECONDS = 120;
const LEAVE_GRACE_MILLISECONDS = 160;
const MAX_TITLE_ANCESTORS = 6;

interface TrackedPoint {
  x: number;
  y: number;
}

interface QueuedPointer {
  eventTarget: EventTarget | null;
  point: TrackedPoint;
  modifiers: Pick<PointerEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;
}

export class HoverController {
  #settings: Settings;
  #enabled: boolean;
  #activeTarget: Element | null = null;
  #pendingTarget: Element | null = null;
  #pendingPoint: TrackedPoint | null = null;
  #hoverTimer: number | null = null;
  #loadingTimer: number | null = null;
  #leaveTimer: number | null = null;
  #request: AbortController | null = null;
  #galleryRequest: AbortController | null = null;
  #previewDisablePressed = false;
  #lastPointerTarget: EventTarget | null = null;
  #lastPointerPoint: TrackedPoint | null = null;
  #lastInspectedTarget: EventTarget | null = null;
  #lastInspectedPoint: TrackedPoint | null = null;
  #queuedPointer: QueuedPointer | null = null;
  #pointerFrame: number | null = null;
  #viewportFrame: number | null = null;
  #titleTarget: Element | null = null;
  #suppressedTitles = new Map<Element, string>();

  constructor(
    private readonly overlay: PreviewOverlay,
    settings: Settings,
  ) {
    this.#settings = settings;
    this.#enabled = settings.enabled && !isSiteDisabled(settings, location.href);
    document.addEventListener("pointerover", this.#onPointerOver, true);
    document.addEventListener("pointerout", this.#onPointerOut, true);
    document.addEventListener("pointermove", this.#onPointerMove, true);
    document.addEventListener("keydown", this.#onKeyDown, true);
    document.addEventListener("keyup", this.#onKeyUp, true);
    document.addEventListener("visibilitychange", this.#onVisibilityChange);
    window.addEventListener("blur", this.#onWindowBlur);
    window.addEventListener("resize", this.#onViewportChange, { passive: true });
  }

  updateSettings(settings: Settings): void {
    if (settings.previewDisableShortcut !== this.#settings.previewDisableShortcut) {
      this.#previewDisablePressed = false;
    }
    this.#settings = settings;
    this.#enabled = settings.enabled && !isSiteDisabled(settings, location.href);
    this.overlay.updateSettings(
      settings.maxPreviewPercent,
      settings.downloadShortcut,
      settings.mediaVolumePercent,
    );
    if (!this.#isEnabled()) this.#clearAll();
  }

  destroy(): void {
    document.removeEventListener("pointerover", this.#onPointerOver, true);
    document.removeEventListener("pointerout", this.#onPointerOut, true);
    document.removeEventListener("pointermove", this.#onPointerMove, true);
    document.removeEventListener("keydown", this.#onKeyDown, true);
    document.removeEventListener("keyup", this.#onKeyUp, true);
    document.removeEventListener("visibilitychange", this.#onVisibilityChange);
    window.removeEventListener("blur", this.#onWindowBlur);
    window.removeEventListener("resize", this.#onViewportChange);
    this.#clearAll();
  }

  #onPointerOver = (event: PointerEvent): void => {
    this.#cancelPointerFrame();
    this.#trackPointer(event.target, { x: event.clientX, y: event.clientY }, event);
  };

  #onPointerOut = (event: PointerEvent): void => {
    // Moving into an iframe can provide the iframe element as relatedTarget,
    // then stop delivering pointer events to this document entirely.
    this.#cancelPointerFrame();
    this.#trackPointer(
      event.relatedTarget,
      { x: event.clientX, y: event.clientY },
      event,
    );
  };

  #onPointerMove = (event: PointerEvent): void => {
    const eventTarget = event.target;
    const point = { x: event.clientX, y: event.clientY };
    this.#lastPointerTarget = eventTarget;
    this.#lastPointerPoint = point;
    if (
      matchesPreviewDisableModifiers(event, this.#settings.previewDisableShortcut)
    ) {
      this.#beginPreviewDisable();
    }
    if (this.#previewDisablePressed || !this.#isEnabled()) return;
    this.overlay.updatePointer(point.x, point.y);

    // Once a concrete source owns the hover, pointermove events over that same
    // element cannot change the result. Avoid repeating the much more expensive
    // hit testing, style inspection, and bounded DOM walks on every raw event.
    if (eventTarget === this.#activeTarget || eventTarget === this.#pendingTarget) {
      this.#cancelPointerFrame();
      this.#cancelLeaveTimer();
      this.#lastInspectedTarget = eventTarget;
      this.#lastInspectedPoint = point;
      return;
    }

    // Browser pointer transitions normally arrive through pointerover/out. Keep
    // direct media transitions synchronous as well so script-dispatched events
    // and unusual embedded documents do not add a frame of cancellation delay.
    if (isConcreteMediaElement(eventTarget)) {
      this.#cancelPointerFrame();
      this.#trackPointer(eventTarget, point, event);
      return;
    }

    // Transparent gallery layers can keep the same event target while the
    // media underneath changes. They still need coordinate-based hit testing,
    // but never more than once per rendered frame.
    this.#queuedPointer = {
      eventTarget,
      point,
      modifiers: pointerModifiers(event),
    };
    if (this.#pointerFrame !== null) return;
    this.#pointerFrame = window.requestAnimationFrame(() => {
      this.#pointerFrame = null;
      const queued = this.#queuedPointer;
      this.#queuedPointer = null;
      if (queued) {
        this.#trackPointer(queued.eventTarget, queued.point, queued.modifiers);
      }
    });
  };

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      this.#clearAll();
      return;
    }
    if (matchesPreviewDisableShortcut(event, this.#settings.previewDisableShortcut)) {
      this.#beginPreviewDisable();
      return;
    }
    const mediaCandidate = this.overlay.getVisibleMediaCandidate();
    if (mediaCandidate && matchesDownloadShortcut(event, this.#settings.downloadShortcut)) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) {
        void this.#downloadMedia(mediaCandidate).catch((error: unknown) => {
          console.warn("[OpenHoverZoom] Media download request failed", error);
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

  #onKeyUp = (event: KeyboardEvent): void => {
    if (releasesPreviewDisableShortcut(event, this.#settings.previewDisableShortcut)) {
      const wasPreviewDisabled = this.#previewDisablePressed;
      this.#previewDisablePressed = false;
      if (wasPreviewDisabled && this.#lastPointerPoint) {
        this.#trackPointer(
          this.#currentPointerTarget(this.#lastPointerPoint),
          this.#lastPointerPoint,
          event,
        );
      }
    }
  };

  #onViewportChange = (): void => {
    if (!this.overlay.isVisible() || this.#viewportFrame !== null) return;
    this.#viewportFrame = window.requestAnimationFrame(() => {
      this.#viewportFrame = null;
      if (this.overlay.isVisible()) this.overlay.reposition();
    });
  };

  #onWindowBlur = (): void => {
    this.#previewDisablePressed = false;
    this.#clearAll();
  };

  #onVisibilityChange = (): void => {
    if (document.hidden) {
      this.#previewDisablePressed = false;
      this.#clearAll();
    }
  };

  #trackPointer(
    eventTarget: EventTarget | null,
    point: TrackedPoint,
    modifiers: Pick<PointerEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
  ): void {
    this.#lastPointerTarget = eventTarget;
    this.#lastPointerPoint = point;
    if (
      matchesPreviewDisableModifiers(modifiers, this.#settings.previewDisableShortcut)
    ) {
      this.#beginPreviewDisable();
    }
    if (this.#previewDisablePressed) return;
    if (!this.#isEnabled()) return;
    this.overlay.updatePointer(point.x, point.y);
    if (
      eventTarget === this.#lastInspectedTarget &&
      point.x === this.#lastInspectedPoint?.x &&
      point.y === this.#lastInspectedPoint.y
    ) {
      return;
    }
    this.#lastInspectedTarget = eventTarget;
    this.#lastInspectedPoint = point;
    const target = findHoverTarget(eventTarget, point);
    this.#syncNativeTitles(eventTarget, target);
    this.#trackTarget(target, point);
  }

  #currentPointerTarget(point: TrackedPoint): EventTarget | null {
    return typeof document.elementFromPoint === "function"
      ? document.elementFromPoint(point.x, point.y)
      : this.#lastPointerTarget;
  }

  #beginPreviewDisable(): void {
    if (this.#previewDisablePressed) return;
    this.#previewDisablePressed = true;
    this.#clearAll();
  }

  #syncNativeTitles(eventTarget: EventTarget | null, target: Element | null): void {
    if (!target) {
      this.#restoreNativeTitles();
      return;
    }
    if (target !== this.#titleTarget) {
      this.#restoreNativeTitles();
      this.#titleTarget = target;
    }
    this.#suppressTitleChain(eventTarget);
    this.#suppressTitleChain(target);
  }

  #suppressTitleChain(start: EventTarget | null): void {
    let current = start instanceof Element ? start : null;
    for (
      let depth = 0;
      current && depth < MAX_TITLE_ANCESTORS;
      depth += 1, current = current.parentElement
    ) {
      const title = current.getAttribute("title");
      if (title === null || title.trim().length === 0) continue;
      if (!this.#suppressedTitles.has(current)) {
        this.#suppressedTitles.set(current, title);
      }
      current.removeAttribute("title");
    }
  }

  #restoreNativeTitles(): void {
    for (const [element, title] of this.#suppressedTitles) {
      if (!element.hasAttribute("title")) element.setAttribute("title", title);
    }
    this.#suppressedTitles.clear();
    this.#titleTarget = null;
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
      !this.overlay.hasVisibleMedia() &&
      this.#resolvesSilently(target)
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
    this.overlay.setAnchor(point.x, point.y);
    if (!this.#resolvesSilently(target)) {
      this.overlay.showLoading();
    }
    void this.#resolve(target);
  }

  async #resolve(target: Element): Promise<void> {
    const request = new AbortController();
    this.#request = request;

    try {
      const resolution = await resolveTarget(
        target,
        { showSameSizeImages: this.#settings.showSameSizeImages },
        request.signal,
        {
          onFallbackCandidate: (fallback) => this.overlay.prepare(fallback),
        },
      );
      if (this.#request !== request || request.signal.aborted) return;
      this.#clearLoadingTimer();
      if (resolution.candidate) {
        if (resolution.fallback) {
          this.overlay.show(resolution.candidate, resolution.fallback);
        } else {
          this.overlay.show(resolution.candidate);
        }
      }
      else {
        this.#activeTarget = null;
        this.#restoreNativeTitles();
        this.overlay.hide();
        return;
      }
    } catch (error) {
      if (this.#request !== request || request.signal.aborted) return;
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.warn("[OpenHoverZoom] Preview resolution failed", error);
        this.#activeTarget = null;
        this.#restoreNativeTitles();
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
        if (this.#galleryRequest === request && !request.signal.aborted) {
          this.overlay.resolveGallerySelection(selection, candidate);
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("[OpenHoverZoom] Gallery item upgrade failed", error);
          if (this.#galleryRequest === request && !request.signal.aborted) {
            this.overlay.resolveGallerySelection(selection, null);
          }
        }
      })
      .finally(() => {
        if (this.#galleryRequest === request) this.#galleryRequest = null;
      });
  }

  async #downloadMedia(candidate: MediaCandidate): Promise<void> {
    let downloadCandidate = candidate;
    if (candidate.linkedPageUrl) {
      try {
        downloadCandidate =
          await resolveDownloadCandidate(candidate, new AbortController().signal) ?? candidate;
      } catch (error) {
        console.warn("[OpenHoverZoom] Original media lookup failed", error);
      }
    }
    await requestMediaDownload(downloadCandidate.url);
  }

  #clearAll(): void {
    this.#cancelPointerFrame();
    this.#cancelViewportFrame();
    this.#lastInspectedTarget = null;
    this.#lastInspectedPoint = null;
    this.#activeTarget = null;
    this.#cancelPendingTarget();
    this.#cancelLeaveTimer();
    this.#cancelActiveRequest();
    this.#cancelGalleryRequest();
    this.#restoreNativeTitles();
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

  #cancelPointerFrame(): void {
    if (this.#pointerFrame !== null) {
      window.cancelAnimationFrame(this.#pointerFrame);
      this.#pointerFrame = null;
    }
    this.#queuedPointer = null;
  }

  #cancelViewportFrame(): void {
    if (this.#viewportFrame !== null) {
      window.cancelAnimationFrame(this.#viewportFrame);
      this.#viewportFrame = null;
    }
  }

  #isEnabled(): boolean {
    return this.#enabled;
  }

  #resolvesSilently(target: Element): boolean {
    return target instanceof HTMLAnchorElement;
  }
}

function pointerModifiers(
  event: Pick<PointerEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
): Pick<PointerEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey"> {
  return {
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  };
}

function isConcreteMediaElement(target: EventTarget | null): target is Element {
  return (
    target instanceof HTMLImageElement ||
    target instanceof HTMLPictureElement ||
    target instanceof HTMLVideoElement
  );
}
