export interface WindowModel {
  importance: number[];
  x: number[];
  y: number[];
  onDemand: boolean[];
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// The set of nodes the renderer should hold right now: everything important enough for the overview,
// plus everything inside the current viewport, plus whatever is pinned (selected or hovered), capped
// so the renderer never holds the whole dataset. Over the cap, pinned wins, then the most important.
export function computeWindow(
  model: WindowModel,
  bounds: Bounds,
  threshold: number,
  cap: number,
  pinned: Set<number>,
): Set<number> {
  const inBounds = (index: number): boolean =>
    model.x[index] >= bounds.minX && model.x[index] <= bounds.maxX
    && model.y[index] >= bounds.minY && model.y[index] <= bounds.maxY;

  const candidates: number[] = [];
  for (let index = 0; index < model.importance.length; index += 1) {
    if (pinned.has(index)) {
      candidates.push(index);
      continue;
    }
    // On-demand nodes (the maintainer social layer) never fill the viewport on their own; they load
    // only when something is selected, so a dense social cluster cannot flood the window.
    if (!model.onDemand[index] && (model.importance[index] >= threshold || inBounds(index))) {
      candidates.push(index);
    }
  }
  if (candidates.length <= cap) {
    return new Set(candidates);
  }
  candidates.sort((a, b) => {
    const pinnedDelta = Number(pinned.has(b)) - Number(pinned.has(a));
    return pinnedDelta !== 0 ? pinnedDelta : model.importance[b] - model.importance[a];
  });
  return new Set(candidates.slice(0, cap));
}
