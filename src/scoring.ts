import type { Shape } from "./data";

// Max 5000 points per round, GeoGuessr-style.
export const MAX_POINTS = { shape: 1000, secrets: 1000, name: 3000 } as const;
export const MAX_ROUND = MAX_POINTS.shape + MAX_POINTS.secrets + MAX_POINTS.name;

// Number of 1x1 tiles each room shape covers.
export const TILES: Record<Shape, number> = { "1x1": 1, "1x2": 2, "1x3": 3, "1x4": 4, "2x2": 4, L: 3 };

// Exact shape 1000. Otherwise by tile-count difference: same size but other
// shape (e.g. 2x2 vs 1x4) 600, one tile off 400, two off 150, three off 0.
export function scoreShape(guess: Shape, answer: Shape) {
  if (guess === answer) return MAX_POINTS.shape;
  const off = Math.abs(TILES[guess] - TILES[answer]);
  return [600, 400, 150][off] ?? 0;
}

// Partial credit for being close: exact 1000, off by 1 → 600, by 2 → 300.
export function scoreSecrets(guess: number, answer: number) {
  const off = Math.abs(guess - answer);
  return [1000, 600, 300][off] ?? 0;
}

export const scoreName = (guessId: string, answerId: string) =>
  guessId === answerId ? MAX_POINTS.name : 0;

// Dungeon score ranks as in the game (out of 300), scaled to the game's max:
// with 25,000 max, S+ = 25,000, S ≥ 22,500, A ≥ 19,167, B ≥ 13,334, C ≥ 8,334.
export const RANKS = [
  { rank: "S+", min: 300 },
  { rank: "S", min: 270 },
  { rank: "A", min: 230 },
  { rank: "B", min: 160 },
  { rank: "C", min: 100 },
  { rank: "D", min: 0 },
] as const;
export type Rank = (typeof RANKS)[number]["rank"];

export function scoreRank(score: number, max: number): Rank {
  // Integer comparison (score/max ≥ min/300) avoids floating-point edge cases.
  return RANKS.find((r) => score * 300 >= r.min * max)!.rank;
}

// Points needed for each rank at a given max, for display.
export const rankThreshold = (min: number, max: number) => Math.ceil((min * max) / 300);
