export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  side: PlacementSide;
  maxWidth: number;
  maxHeight: number;
}

export type PlacementSide = "right" | "left" | "below" | "above";

const SIDE_HYSTERESIS_RATIO = 0.85;

export function calculatePlacement(
  pointer: Point,
  preview: Size,
  viewport: Size,
  gap = 18,
  margin = 12,
  preferredSide?: PlacementSide,
): Placement {
  const contentWidth = Math.max(0, viewport.width - margin * 2);
  const contentHeight = Math.max(0, viewport.height - margin * 2);
  const candidatesWithoutScale: Array<Omit<PlacementCandidate, "scale">> = [
    {
      side: "right",
      maxWidth: Math.max(0, viewport.width - pointer.x - gap - margin),
      maxHeight: contentHeight,
      primaryRoom: viewport.width - pointer.x,
    },
    {
      side: "left",
      maxWidth: Math.max(0, pointer.x - gap - margin),
      maxHeight: contentHeight,
      primaryRoom: pointer.x,
    },
    {
      side: "below",
      maxWidth: contentWidth,
      maxHeight: Math.max(0, viewport.height - pointer.y - gap - margin),
      primaryRoom: viewport.height - pointer.y,
    },
    {
      side: "above",
      maxWidth: contentWidth,
      maxHeight: Math.max(0, pointer.y - gap - margin),
      primaryRoom: pointer.y,
    },
  ];
  const candidates: PlacementCandidate[] = candidatesWithoutScale.map((candidate) => ({
    ...candidate,
    scale: scaleFor(candidate, preview),
  }));

  const best = candidates.reduce((current, candidate) =>
    compareCandidates(candidate, current) > 0 ? candidate : current,
  );
  const preferred = candidates.find((candidate) => candidate.side === preferredSide);
  const selected = preferred && preferred.scale >= best.scale * SIDE_HYSTERESIS_RATIO
    ? preferred
    : best;
  const scale = selected.scale;
  const displayed = {
    width: preview.width * scale,
    height: preview.height * scale,
  };
  const proposed = positionForSide(pointer, displayed, selected.side, gap);

  return {
    left: clamp(
      proposed.x,
      margin,
      Math.max(margin, viewport.width - displayed.width - margin),
    ),
    top: clamp(
      proposed.y,
      margin,
      Math.max(margin, viewport.height - displayed.height - margin),
    ),
    side: selected.side,
    maxWidth: selected.maxWidth,
    maxHeight: selected.maxHeight,
  };
}

interface PlacementCandidate {
  side: PlacementSide;
  maxWidth: number;
  maxHeight: number;
  primaryRoom: number;
  scale: number;
}

function scaleFor(candidate: Omit<PlacementCandidate, "scale">, preview: Size): number {
  if (preview.width <= 0 || preview.height <= 0) return 1;
  return Math.min(1, candidate.maxWidth / preview.width, candidate.maxHeight / preview.height);
}

function compareCandidates(left: PlacementCandidate, right: PlacementCandidate): number {
  const scaleDifference = left.scale - right.scale;
  if (Math.abs(scaleDifference) > 0.001) return scaleDifference;
  const leftHorizontal = left.side === "left" || left.side === "right";
  const rightHorizontal = right.side === "left" || right.side === "right";
  if (leftHorizontal !== rightHorizontal) return leftHorizontal ? 1 : -1;
  return left.primaryRoom - right.primaryRoom;
}

function positionForSide(
  pointer: Point,
  preview: Size,
  side: PlacementSide,
  gap: number,
): Point {
  if (side === "right") return { x: pointer.x + gap, y: pointer.y - preview.height / 2 };
  if (side === "left") {
    return { x: pointer.x - gap - preview.width, y: pointer.y - preview.height / 2 };
  }
  if (side === "below") return { x: pointer.x - preview.width / 2, y: pointer.y + gap };
  return { x: pointer.x - preview.width / 2, y: pointer.y - gap - preview.height };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
