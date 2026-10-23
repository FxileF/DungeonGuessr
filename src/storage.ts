// Everything here lives in the player's own browser (localStorage). It can be
// unavailable (private mode, blocked storage), so every access is guarded.
import { addDays } from "./random";

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export interface Points { shape: number; secrets: number; name: number }

export interface SavedRound {
  shotId: string;
  shape?: string;
  secrets?: number;
  nameId?: string;
  points: Points;
}

export interface DailyEntry {
  rounds: SavedRound[];
  done: boolean;
  score: number;
  max: number;
}

const DAILY_KEY = "dg.daily";
const STATS_KEY = "dg.stats";
const PREFS_KEY = "dg.prefs";

export const getDailyHistory = () => read<Record<string, DailyEntry>>(DAILY_KEY, {});
export const getDaily = (date: string): DailyEntry | undefined => getDailyHistory()[date];

export function saveDaily(date: string, entry: DailyEntry) {
  write(DAILY_KEY, { ...getDailyHistory(), [date]: entry });
}

// Current streak counts back from today, or from yesterday if today's daily
// isn't finished yet (so the streak isn't shown as lost mid-day).
export function getStreaks(today: string) {
  const history = getDailyHistory();
  const done = (d: string) => history[d]?.done === true;

  let current = 0;
  let day = done(today) ? today : addDays(today, -1);
  while (done(day)) {
    current++;
    day = addDays(day, -1);
  }

  let best = 0;
  let run = 0;
  let prev = "";
  for (const d of Object.keys(history).filter(done).sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best };
}

export interface Stats { played: number; totalScore: number; totalMax: number; best: number }

export const getStats = () =>
  read<Stats>(STATS_KEY, { played: 0, totalScore: 0, totalMax: 0, best: 0 });

export function recordGame(score: number, max: number) {
  const s = getStats();
  write(STATS_KEY, {
    played: s.played + 1,
    totalScore: s.totalScore + score,
    totalMax: s.totalMax + max,
    best: Math.max(s.best, score),
  });
}

export interface Prefs { filterByShape: boolean; difficulty: string; includePuzzles: boolean }

const DEFAULT_PREFS: Prefs = { filterByShape: false, difficulty: "all", includePuzzles: true };

// Merge with defaults so prefs saved by older versions gain new fields.
export const getPrefs = (): Prefs => ({ ...DEFAULT_PREFS, ...read<Partial<Prefs>>(PREFS_KEY, {}) });

export function setPrefs(patch: Partial<Prefs>) {
  write(PREFS_KEY, { ...getPrefs(), ...patch });
}
