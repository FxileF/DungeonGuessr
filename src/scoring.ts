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
