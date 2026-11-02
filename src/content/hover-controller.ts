import { resolveDownloadCandidate, resolveTarget, type PreviewPlan } from "../resolver";
import type { MediaCandidate } from "../resolver/candidate";
import {
  containsAcrossShadow,
  isEditingKeyEvent,
  parentAcrossShadow,
  shadowElementAtPoint,
} from "../shared/dom";
import type { DownloadResult } from "../shared/messages";
import { isSiteDisabled, type Settings } from "../shared/settings";
import {
  isModifierOnlyPreviewDisableShortcut,
  matchesDownloadShortcut,
  matchesPreviewDisableModifiers,
  matchesPreviewDisableShortcut,
  releasesPreviewDisableShortcut,
} from "../shared/keyboard-shortcut";
import { requestMediaDownload } from "./download-client";
import { PreviewOverlay } from "./preview-overlay";
import {
  findHoverTarget,
  isActivelyPlayingMedia,
  isTextLinkTarget,
} from "./target-inspector";

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
  #downloadsInFlight = new Set<MediaCandidate>();
  /** The hovered target when it is only a plain link, which is previewed silently. */
  #hoveredTextLink: Element | null = null;
  /** A plain link whose page had nothing to show, so hovering it more changes nothing. */
  #emptyTextLink: Element | null = null;
  /** Planning walks the DOM, so one hover plans once. */
  #planned: { target: Element; plan: PreviewPlan } | null = null;

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
    const textLinksTurnedOff = this.#settings.previewTextLinks && !settings.previewTextLinks;
    this.#settings = settings;
    this.#enabled = settings.enabled && !isSiteDisabled(settings, location.href);
    this.overlay.updateSettings(
      settings.maxPreviewPercent,
      settings.downloadShortcut,
      settings.mediaVolumePercent,
    );
    if (!this.#isEnabled() || textLinksTurnedOff) this.#clearAll();
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
    this.#trackPointer(eventOrigin(event), { x: event.clientX, y: event.clientY }, event);
  };

  #onPointerOut = (event: PointerEvent): void => {
    // Moving into an iframe can provide the iframe element as relatedTarget,
    // then stop delivering pointer events to this document entirely.
    this.#cancelPointerFrame();
    // Outside the document's own tree, relatedTarget is a shadow host when the
    // pointer moved into a web component, so look at what is under the pointer.
    const point = { x: event.clientX, y: event.clientY };
    this.#trackPointer(this.#intoShadowRoots(event.relatedTarget, point), point, event);
  };

  #onPointerMove = (event: PointerEvent): void => {
    const eventTarget = eventOrigin(event);
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
    if (
      eventTarget === this.#activeTarget ||
      eventTarget === this.#pendingTarget ||
      this.#isInsideTextLink(eventTarget)
    ) {
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
    // Typing in a chat or post box must never trigger a shortcut. A modifier-only
    // disable shortcut is harmless there, so it keeps working.
    const typing = isEditingKeyEvent(event);
    if (
      matchesPreviewDisableShortcut(event, this.#settings.previewDisableShortcut) &&
      (!typing || isModifierOnlyPreviewDisableShortcut(this.#settings.previewDisableShortcut))
    ) {
      this.#beginPreviewDisable();
      return;
    }
    if (typing) return;
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
    if (!direction) return;
    const request = new AbortController();
    if (this.overlay.navigateGallery(direction, request.signal)) {
      event.preventDefault();
      event.stopPropagation();
      this.#cancelGalleryRequest();
      this.#galleryRequest = request;
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
    const target = findHoverTarget(eventTarget, point, {
      textLinks: this.#settings.previewTextLinks,
    });
    this.#hoveredTextLink =
      target && this.#settings.previewTextLinks && isTextLinkTarget(target) ? target : null;
    this.#syncNativeTitles(eventTarget, target);
    this.#trackTarget(target, point);
  }

  #currentPointerTarget(point: TrackedPoint): EventTarget | null {
    return typeof document.elementFromPoint === "function"
      ? this.#intoShadowRoots(document.elementFromPoint(point.x, point.y), point)
      : this.#lastPointerTarget;
  }

  /** Documents report an element in an open shadow root as its host. Finds what is inside. */
  #intoShadowRoots(target: EventTarget | null, point: TrackedPoint): EventTarget | null {
    return target instanceof Element && target.shadowRoot
      ? shadowElementAtPoint(target, point.x, point.y) ?? target
      : target;
  }

  /** Moving within the link being previewed cannot change the result, text or not. */
  #isInsideTextLink(eventTarget: EventTarget | null): boolean {
    const owner = this.#activeTarget ?? this.#pendingTarget ?? this.#emptyTextLink;
    return (
      owner !== null &&
      owner === this.#hoveredTextLink &&
      eventTarget instanceof Element &&
      containsAcrossShadow(owner, eventTarget)
    );
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
    // A plain link keeps its tooltip, which is all it has, until a preview is shown.
    if (target === this.#hoveredTextLink) return;
    this.#suppressTitleChain(eventTarget);
    this.#suppressTitleChain(target);
  }

  #suppressTitleChain(start: EventTarget | null): void {
    let current = start instanceof Element ? start : null;
    for (
      let depth = 0;
      current && depth < MAX_TITLE_ANCESTORS;
      depth += 1, current = parentAcrossShadow(current)
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
    if (target !== this.#emptyTextLink) this.#emptyTextLink = null;
    if (target && target === this.#emptyTextLink) {
      this.#cancelLeaveTimer();
      return;
    }
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
    if (!this.#activeTarget && !this.overlay.hasVisibleMedia()) {
      const loadingDelay = Math.min(LOADING_DELAY_MILLISECONDS, this.#settings.hoverDelayMs);
      // Decided here rather than up front, so elements the pointer only crosses cost nothing.
      this.#loadingTimer = window.setTimeout(() => {
        this.#loadingTimer = null;
        if (this.#pendingTarget === target && !this.#resolvesSilently(target)) {
          this.overlay.setAnchor(point.x, point.y);
          this.overlay.showLoading();
        }
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
    if (isActivelyPlayingMedia(target)) {
      this.#clearAll();
      return;
    }
    this.#pendingTarget = null;
    this.#pendingPoint = null;
    this.#clearLoadingTimer();
    this.#cancelActiveRequest();
    this.#activeTarget = target;
    this.overlay.setAnchor(point.x, point.y);
    if (!this.#resolvesSilently(target)) {
      this.overlay.showLoading();
    }
    void this.#resolve(target, target === this.#hoveredTextLink);
  }

  async #resolve(target: Element, textLink: boolean): Promise<void> {
    const request = new AbortController();
    this.#request = request;

    try {
      const plan = this.#planFor(target);
      this.#planned = null;
      const outcome = await this.overlay.show(plan, request.signal);
      if (this.#request !== request || request.signal.aborted) return;
      if (outcome === "cancelled") return;
      if (outcome === "accepted" && textLink) this.#suppressTitleChain(target);
      if (outcome === "accepted" && isActivelyPlayingMedia(target)) {
        this.#clearAll();
        return;
      }
      if (outcome === "none") {
        if (textLink) this.#emptyTextLink = target;
        this.#activeTarget = null;
        this.#restoreNativeTitles();
        this.overlay.hide();
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

  async #downloadMedia(candidate: MediaCandidate): Promise<void> {
    // The status in the metadata bar says it is under way, so a second press adds nothing.
    if (this.#downloadsInFlight.has(candidate)) return;
    this.#downloadsInFlight.add(candidate);
    const result = this.#saveMedia(candidate);
    this.overlay.trackDownload(candidate, result);
    try {
      await result;
    } finally {
      this.#downloadsInFlight.delete(candidate);
    }
  }

  async #saveMedia(candidate: MediaCandidate): Promise<DownloadResult> {
    let downloadCandidate = candidate;
    if (candidate.linkedPageUrl) {
      try {
        downloadCandidate =
          await resolveDownloadCandidate(candidate, new AbortController().signal) ?? candidate;
      } catch (error) {
        console.warn("[OpenHoverZoom] Original media lookup failed", error);
      }
    }
    return requestMediaDownload(downloadCandidate.url);
  }

  #clearAll(): void {
    this.#cancelPointerFrame();
    this.#cancelViewportFrame();
    this.#lastInspectedTarget = null;
    this.#lastInspectedPoint = null;
    this.#hoveredTextLink = null;
    this.#emptyTextLink = null;
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
    this.#planned = null;
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
    return target instanceof HTMLAnchorElement || this.#planFor(target).quiet;
  }

  #planFor(target: Element): PreviewPlan {
    if (this.#planned?.target !== target) {
      this.#planned = {
        target,
        plan: resolveTarget(target, {
          showSameSizeImages: this.#settings.showSameSizeImages,
          textLink: target === this.#hoveredTextLink,
        }),
      };
    }
    return this.#planned.plan;
  }
}

/**
 * The element the pointer is really over. A document listener sees an element in an
 * open shadow root as its host, so look at the full event path instead.
 */
function eventOrigin(event: Event): EventTarget | null {
  const target = event.target;
  return target instanceof Element && target.shadowRoot
    ? event.composedPath()[0] ?? target
    : target;
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
