export const SHAPES = ["1x1", "1x2", "1x3", "1x4", "2x2", "L"] as const;
export type Shape = (typeof SHAPES)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface Room {
  id: string;
  name: string;
  type: string;
  shape: Shape;
  secrets: number;
  crypts: number;
  guessable: boolean;
}

export interface Screenshot {
  id: string;
  image: string;
  roomId: string;
  difficulty: Difficulty | null;
}

// BASE_URL is "./" (see vite.config.ts), so paths resolve relative to the page
// and keep working when hosted under a sub-path on GitHub Pages.
export const asset = (path: string) => import.meta.env.BASE_URL + path;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(asset(path));
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

export async function loadData() {
  const [rooms, screenshots] = await Promise.all([
    getJson<Room[]>("data/rooms.json"),
    getJson<Screenshot[]>("data/screenshots.json"),
  ]);
  const roomsById = new Map(rooms.map((r) => [r.id, r]));
  const missing = screenshots.filter((s) => !roomsById.has(s.roomId));
  if (missing.length) console.warn("Screenshots with unknown roomId:", missing);
  const valid = screenshots.filter((s) => roomsById.has(s.roomId));
  return {
    rooms,
    roomsById,
    guessableRooms: rooms.filter((r) => r.guessable),
    screenshots: valid,
    screenshotsById: new Map(valid.map((s) => [s.id, s])),
  };
}

export type GameData = Awaited<ReturnType<typeof loadData>>;
