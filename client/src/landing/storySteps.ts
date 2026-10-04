/** The layer groups the story builds up, in the order they appear (the `WORLD_GROUPS` of buildWorld, minus the reserved one). */
export const STORY_LAYERS = ["ground", "area_features", "roads", "blocks", "buildings"] as const;
export type StoryLayer = (typeof STORY_LAYERS)[number];

export interface StoryStep {
  id: "map" | "streets" | "blocks" | "buildings";
  title: string;
  body: string;
  /** What the stage adds at this step, on top of every earlier step. */
  adds: readonly StoryLayer[];
}

export const STORY_STEPS: readonly StoryStep[] = [
  {
    id: "map",
    title: "The map",
    body: "The engine starts from OpenStreetMap: the ground, and the parks and water that cover it.",
    adds: ["ground", "area_features"],
  },
  {
    id: "streets",
    title: "Streets",
    body: "Roads are drawn at their real widths and coloured by lane type: narrow, normal or wide.",
    adds: ["roads"],
  },
  {
    id: "blocks",
    title: "Blocks",
    body: "What the roads enclose becomes a block, and each block knows how much of it can be built on.",
    adds: ["blocks"],
  },
  {
    id: "buildings",
    title: "Buildings",
    body: "Footprints are raised to the heights OpenStreetMap gives them, and the place is whole.",
    adds: ["buildings"],
  },
];

/** The last step: what the hero shows. */
export const FINAL_STEP = STORY_STEPS.length - 1;

const clampStep = (step: number): number => Math.min(Math.max(Math.trunc(step), 0), FINAL_STEP);

/** The layers visible at `step` (0-based): everything added by steps `0..step`. */
export function layersFor(step: number): StoryLayer[] {
  const active = clampStep(step);
  return STORY_STEPS.slice(0, active + 1).flatMap((s) => [...s.adds]);
}

export interface LayerChange {
  /** Layers that were hidden and now show; the stage fades them in (buildings rise). */
  animate: StoryLayer[];
  /** Layers that were shown and now hide. */
  hide: StoryLayer[];
  /** Every layer visible afterwards. */
  visible: StoryLayer[];
}

/** What changes going from step `from` to step `to`. `from` is `null` when nothing is shown yet. */
export function changeBetween(from: number | null, to: number): LayerChange {
  const before = new Set<StoryLayer>(from === null ? [] : layersFor(from));
  const visible = layersFor(to);
  const after = new Set<StoryLayer>(visible);
  return {
    animate: visible.filter((layer) => !before.has(layer)),
    hide: STORY_LAYERS.filter((layer) => before.has(layer) && !after.has(layer)),
    visible,
  };
}

/** Which of the stage's slots should hold the canvas: the more visible one, or none when neither shows. */
export function pickSlot<K extends string>(ratios: Record<K, number>, current: K | null): K | null {
  let best: K | null = null;
  let bestRatio = 0;
  for (const key of Object.keys(ratios) as K[]) {
    if (ratios[key] > bestRatio) {
      best = key;
      bestRatio = ratios[key];
    }
  }
  // Keep the canvas where it is when it is still (about) as visible as the leader, so it doesn't flap.
  if (best !== null && current !== null && ratios[current] >= bestRatio - 0.05) return current;
  return best;
}
