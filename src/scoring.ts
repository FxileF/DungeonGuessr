// Max 5000 points per round, GeoGuessr-style.
export const MAX_POINTS = { shape: 1000, secrets: 1000, name: 3000 } as const;
export const MAX_ROUND = MAX_POINTS.shape + MAX_POINTS.secrets + MAX_POINTS.name;

export const scoreShape = (guess: string, answer: string) =>
  guess === answer ? MAX_POINTS.shape : 0;

// Partial credit for being close: exact 1000, off by 1 → 600, by 2 → 300.
export function scoreSecrets(guess: number, answer: number) {
  const off = Math.abs(guess - answer);
  return [1000, 600, 300][off] ?? 0;
}

export const scoreName = (guessId: string, answerId: string) =>
  guessId === answerId ? MAX_POINTS.name : 0;
